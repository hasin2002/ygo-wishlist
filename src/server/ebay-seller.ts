import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { ebayConnections } from "@/db/schema";
import {
  ebayBaseScope,
  ebaySellerScopeList,
} from "@/lib/records/ebay-oauth-scopes";
import { createExpiringSingleFlightCache } from "@/lib/expiring-single-flight-cache";
import {
  ebayTokenFailureKind,
  type EbayTokenRequestKind,
} from "@/lib/ebay-token-failure";

export { ebaySellerScopeList } from "@/lib/records/ebay-oauth-scopes";
const ebaySellerScopes = ebaySellerScopeList.join(" ");
const stateLifetimeMs = 10 * 60 * 1_000;
let applicationTokenCache: {
  accessToken: string;
  expiresAt: number;
  scopes: string;
} | null = null;
const sellerTokenRefreshSkewMs = 60_000;
const sellerAccessTokenCache = createExpiringSingleFlightCache<string>();

type EbayTokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  scope?: string;
};

type StoredSecret = {
  ciphertext: string;
  iv: string;
  tag: string;
};

type OAuthState = {
  issuedAt: number;
  nonce: string;
  ownerId: string;
};

export class EbayConfigurationError extends Error {}
export class EbayAuthorizationError extends Error {}
export class EbayTemporaryError extends Error {}

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new EbayConfigurationError(`${name} is not configured.`);
  }
  return value;
}

function encryptionKey() {
  // The established Better Auth secret is server-only and already required in
  // production. Deriving a distinct key keeps eBay refresh tokens unreadable
  // in the database without introducing another secret for the owner to manage.
  return createHash("sha256")
    .update(requiredEnvironment("BETTER_AUTH_SECRET"))
    .update("\0ebay-seller-token-encryption-v1")
    .digest();
}

function sellerDiagnosticOwner(ownerId: string) {
  return createHash("sha256")
    .update(ownerId)
    .update("\0ebay-seller-diagnostic-v1")
    .digest("hex")
    .slice(0, 12);
}

function stateSigningKey() {
  return createHash("sha256")
    .update(requiredEnvironment("BETTER_AUTH_SECRET"))
    .update("\0ebay-oauth-state-v1")
    .digest();
}

function credentialsHeader() {
  const clientId = requiredEnvironment("EBAY_CLIENT_ID");
  const clientSecret = requiredEnvironment("EBAY_CLIENT_SECRET");
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

function oauthRuName() {
  const localRuName = process.env.EBAY_OAUTH_LOCAL_RU_NAME?.trim();
  if (process.env.NODE_ENV !== "production" && localRuName) return localRuName;
  return requiredEnvironment("EBAY_OAUTH_RU_NAME");
}

function encodeStatePayload(value: OAuthState) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function signStatePayload(payload: string) {
  return createHmac("sha256", stateSigningKey()).update(payload).digest("base64url");
}

export function createEbayOAuthState(ownerId: string) {
  const payload = encodeStatePayload({
    issuedAt: Date.now(),
    nonce: randomBytes(24).toString("base64url"),
    ownerId,
  });
  return `${payload}.${signStatePayload(payload)}`;
}

export function parseEbayOAuthState(state: string): OAuthState | null {
  const [payload, signature, extra] = state.split(".");
  if (!payload || !signature || extra) return null;

  const expectedSignature = signStatePayload(payload);
  const actual = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as OAuthState;
    if (
      !parsed.ownerId
      || !parsed.nonce
      || !Number.isFinite(parsed.issuedAt)
      || Date.now() - parsed.issuedAt > stateLifetimeMs
      || parsed.issuedAt > Date.now() + 30_000
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function ebayConsentUrl(state: string) {
  const url = new URL("https://auth.ebay.com/oauth2/authorize");
  url.searchParams.set("client_id", requiredEnvironment("EBAY_CLIENT_ID"));
  url.searchParams.set("redirect_uri", oauthRuName());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", ebaySellerScopes);
  url.searchParams.set("state", state);
  return url;
}

function encryptSecret(value: string): StoredSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

function decryptSecret(value: StoredSecret) {
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(value.iv, "base64"));
  decipher.setAuthTag(Buffer.from(value.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(value.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

async function ebayTokenRequest(body: URLSearchParams, requestKind: EbayTokenRequestKind) {
  let response: Response;
  try {
    response = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
      body,
      headers: {
        Authorization: credentialsHeader(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      method: "POST",
    });
  } catch {
    throw new EbayTemporaryError("eBay could not be reached. Try again shortly.");
  }

  if (!response.ok) {
    const failureKind = ebayTokenFailureKind(response.status, requestKind);
    if (failureKind === "authorization") {
      throw new EbayAuthorizationError("eBay rejected the saved seller connection. Reconnect eBay and try again.");
    }
    if (failureKind === "configuration") {
      throw new EbayConfigurationError("eBay rejected the app connection settings.");
    }
    throw new EbayTemporaryError("eBay could not refresh access right now. Try again shortly.");
  }

  try {
    return await response.json() as EbayTokenResponse;
  } catch {
    throw new EbayTemporaryError("eBay returned an invalid token response. Try again shortly.");
  }
}

export async function exchangeEbayAuthorizationCode(code: string) {
  const body = new URLSearchParams({
    code,
    grant_type: "authorization_code",
    redirect_uri: oauthRuName(),
  });
  const token = await ebayTokenRequest(body, "authorization_code");
  if (!token.refresh_token || !token.refresh_token_expires_in) {
    throw new EbayAuthorizationError("eBay did not return a renewable seller connection.");
  }
  return token as EbayTokenResponse & Required<Pick<EbayTokenResponse, "refresh_token" | "refresh_token_expires_in">>;
}

export async function getEbayApplicationAccessToken(
  scopes: readonly string[] = [ebayBaseScope],
) {
  const scopeValue = scopes.join(" ");
  if (
    applicationTokenCache
    && applicationTokenCache.scopes === scopeValue
    && applicationTokenCache.expiresAt > Date.now() + 60_000
  ) {
    return applicationTokenCache.accessToken;
  }
  const token = await ebayTokenRequest(new URLSearchParams({
    grant_type: "client_credentials",
    scope: scopeValue,
  }), "application");
  applicationTokenCache = {
    accessToken: token.access_token,
    expiresAt: Date.now() + token.expires_in * 1_000,
    scopes: scopeValue,
  };
  return token.access_token;
}

export async function saveEbayConnection({
  ownerId,
  refreshToken,
  refreshTokenExpiresIn,
  scopes,
}: {
  ownerId: string;
  refreshToken: string;
  refreshTokenExpiresIn: number;
  scopes?: string;
}) {
  const now = new Date();
  const token = encryptSecret(refreshToken);
  const refreshTokenExpiresAt = new Date(now.getTime() + refreshTokenExpiresIn * 1_000);

  await db
    .insert(ebayConnections)
    .values({
      createdAt: now,
      ownerId,
      refreshTokenCiphertext: token.ciphertext,
      refreshTokenExpiresAt,
      refreshTokenIv: token.iv,
      refreshTokenTag: token.tag,
      scopes: scopes?.trim() || ebaySellerScopes,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      set: {
        refreshTokenCiphertext: token.ciphertext,
        refreshTokenExpiresAt,
        refreshTokenIv: token.iv,
        refreshTokenTag: token.tag,
        scopes: scopes?.trim() || ebaySellerScopes,
        updatedAt: now,
      },
      target: ebayConnections.ownerId,
    });
  sellerAccessTokenCache.invalidate(ownerId);
  console.info("[ebay] seller connection stored", {
    owner: sellerDiagnosticOwner(ownerId),
    scopeCount: (scopes?.trim() || ebaySellerScopes).split(/\s+/).filter(Boolean).length,
  });
}

export async function getEbayConnectionStatus(ownerId: string) {
  const [connection] = await db
    .select({
      connectedAt: ebayConnections.createdAt,
      refreshTokenExpiresAt: ebayConnections.refreshTokenExpiresAt,
      scopes: ebayConnections.scopes,
    })
    .from(ebayConnections)
    .where(eq(ebayConnections.ownerId, ownerId))
    .limit(1);
  if (!connection) return null;
  const grantedScopes = new Set(connection.scopes.split(/\s+/).filter(Boolean));
  const missingScopes = ebaySellerScopeList.filter((scope) => !grantedScopes.has(scope));
  return {
    ...connection,
    missingScopes,
    notificationReady: missingScopes.length === 0,
  };
}

export async function deleteEbayConnection(ownerId: string) {
  await db.delete(ebayConnections).where(eq(ebayConnections.ownerId, ownerId));
  sellerAccessTokenCache.invalidate(ownerId);
}

/**
 * Seller API calls use this helper. It refreshes an access token on demand and
 * intentionally keeps the short-lived access token out of the database.
 */
export async function getEbaySellerAccessToken(ownerId: string) {
  const [connection] = await db
    .select()
    .from(ebayConnections)
    .where(eq(ebayConnections.ownerId, ownerId))
    .limit(1);

  if (!connection) {
    throw new EbayAuthorizationError("No eBay seller account is connected.");
  }
  if (connection.refreshTokenExpiresAt <= new Date()) {
    throw new EbayAuthorizationError("The eBay connection has expired. Connect eBay again.");
  }

  try {
    return await sellerAccessTokenCache.get(ownerId, async () => {
      let refreshToken: string;
      try {
        refreshToken = decryptSecret({
          ciphertext: connection.refreshTokenCiphertext,
          iv: connection.refreshTokenIv,
          tag: connection.refreshTokenTag,
        });
      } catch {
        throw new EbayAuthorizationError("The saved eBay connection could not be used. Reconnect eBay and try again.");
      }
      const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        scope: connection.scopes,
      });
      const token = await ebayTokenRequest(body, "seller_refresh");
      if (!token.access_token || !Number.isFinite(token.expires_in) || token.expires_in <= 0) {
        throw new EbayTemporaryError("eBay returned an incomplete access token. Try again shortly.");
      }
      return {
        expiresAt: Date.now() + token.expires_in * 1_000 - sellerTokenRefreshSkewMs,
        value: token.access_token,
      };
    });
  } catch (error) {
    const failure = error instanceof EbayAuthorizationError
      ? "authorization"
      : error instanceof EbayConfigurationError
        ? "configuration"
        : "temporary";
    console.warn("[ebay] seller access token refresh failed", {
      failure,
      owner: sellerDiagnosticOwner(ownerId),
    });
    throw error;
  }
}

export function isEbayOAuthConfigured() {
  const ruName = process.env.NODE_ENV !== "production"
    ? process.env.EBAY_OAUTH_LOCAL_RU_NAME?.trim() || process.env.EBAY_OAUTH_RU_NAME?.trim()
    : process.env.EBAY_OAUTH_RU_NAME?.trim();
  return Boolean(
    process.env.BETTER_AUTH_SECRET?.trim()
    && process.env.EBAY_CLIENT_ID?.trim()
    && process.env.EBAY_CLIENT_SECRET?.trim()
    && ruName,
  );
}

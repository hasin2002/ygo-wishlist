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

const ebayInventoryScope = "https://api.ebay.com/oauth/api_scope/sell.inventory";
const ebayAccountReadonlyScope = "https://api.ebay.com/oauth/api_scope/sell.account.readonly";
const ebaySellerScopes = [ebayInventoryScope, ebayAccountReadonlyScope].join(" ");
const stateLifetimeMs = 10 * 60 * 1_000;

type EbayTokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
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

async function ebayTokenRequest(body: URLSearchParams) {
  const response = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    body,
    headers: {
      Authorization: credentialsHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new EbayAuthorizationError(`eBay token request failed (${response.status}).`);
  }

  return response.json() as Promise<EbayTokenResponse>;
}

export async function exchangeEbayAuthorizationCode(code: string) {
  const body = new URLSearchParams({
    code,
    grant_type: "authorization_code",
    redirect_uri: oauthRuName(),
  });
  const token = await ebayTokenRequest(body);
  if (!token.refresh_token || !token.refresh_token_expires_in) {
    throw new EbayAuthorizationError("eBay did not return a renewable seller connection.");
  }
  return token as EbayTokenResponse & Required<Pick<EbayTokenResponse, "refresh_token" | "refresh_token_expires_in">>;
}

export async function saveEbayConnection({
  ownerId,
  refreshToken,
  refreshTokenExpiresIn,
}: {
  ownerId: string;
  refreshToken: string;
  refreshTokenExpiresIn: number;
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
      scopes: ebaySellerScopes,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      set: {
        refreshTokenCiphertext: token.ciphertext,
        refreshTokenExpiresAt,
        refreshTokenIv: token.iv,
        refreshTokenTag: token.tag,
        scopes: ebaySellerScopes,
        updatedAt: now,
      },
      target: ebayConnections.ownerId,
    });
}

export async function getEbayConnectionStatus(ownerId: string) {
  const [connection] = await db
    .select({
      connectedAt: ebayConnections.createdAt,
      refreshTokenExpiresAt: ebayConnections.refreshTokenExpiresAt,
    })
    .from(ebayConnections)
    .where(eq(ebayConnections.ownerId, ownerId))
    .limit(1);
  return connection ?? null;
}

export async function deleteEbayConnection(ownerId: string) {
  await db.delete(ebayConnections).where(eq(ebayConnections.ownerId, ownerId));
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

  const refreshToken = decryptSecret({
    ciphertext: connection.refreshTokenCiphertext,
    iv: connection.refreshTokenIv,
    tag: connection.refreshTokenTag,
  });
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    scope: connection.scopes,
  });
  const token = await ebayTokenRequest(body);
  return token.access_token;
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

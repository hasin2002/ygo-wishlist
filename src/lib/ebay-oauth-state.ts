import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export const ebayOAuthStateLifetimeMs = 10 * 60 * 1_000;

export type EbayOAuthState = {
  issuedAt: number;
  nonce: string;
  ownerId: string;
  purpose: "connect" | "replacement";
  returnTo?: string;
};

function signingKey(secret: string) {
  return createHash("sha256")
    .update(secret)
    .update("\0ebay-oauth-state-v1")
    .digest();
}

function encode(value: EbayOAuthState) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function sign(payload: string, secret: string) {
  return createHmac("sha256", signingKey(secret)).update(payload).digest("base64url");
}

export function createSignedEbayOAuthState(
  ownerId: string,
  secret: string,
  options: { now?: number; purpose?: EbayOAuthState["purpose"]; returnTo?: string } = {},
) {
  const payload = encode({
    issuedAt: options.now ?? Date.now(),
    nonce: randomBytes(24).toString("base64url"),
    ownerId,
    purpose: options.purpose ?? "connect",
    ...(options.returnTo ? { returnTo: options.returnTo } : {}),
  });
  return `${payload}.${sign(payload, secret)}`;
}

export function parseSignedEbayOAuthState(
  state: string,
  secret: string,
  now = Date.now(),
): EbayOAuthState | null {
  const [payload, signature, extra] = state.split(".");
  if (!payload || !signature || extra) return null;

  const actual = Buffer.from(signature);
  const expected = Buffer.from(sign(payload, secret));
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as EbayOAuthState;
    if (
      !parsed.ownerId
      || !parsed.nonce
      || (parsed.purpose !== "connect" && parsed.purpose !== "replacement")
      || (parsed.returnTo !== undefined && (typeof parsed.returnTo !== "string" || !parsed.returnTo.startsWith("/records/")))
      || !Number.isFinite(parsed.issuedAt)
      || now - parsed.issuedAt > ebayOAuthStateLifetimeMs
      || parsed.issuedAt > now + 30_000
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

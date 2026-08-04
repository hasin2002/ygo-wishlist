import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const ebayTradingAuthSessionLifetimeMs = 5 * 60 * 1_000;

export type EbayTradingAuthSession = {
  issuedAt: number;
  ownerId: string;
  sessionId: string;
  state: string;
};

function signingKey(secret: string) {
  return createHash("sha256")
    .update(secret)
    .update("\0ebay-trading-auth-session-v1")
    .digest();
}

function sign(payload: string, secret: string) {
  return createHmac("sha256", signingKey(secret)).update(payload).digest("base64url");
}

export function createSignedEbayTradingAuthSession(
  input: Omit<EbayTradingAuthSession, "issuedAt">,
  secret: string,
  now = Date.now(),
) {
  const payload = Buffer.from(JSON.stringify({
    ...input,
    issuedAt: now,
  } satisfies EbayTradingAuthSession)).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

export function parseSignedEbayTradingAuthSession(
  value: string,
  secret: string,
  now = Date.now(),
): EbayTradingAuthSession | null {
  const [payload, signature, extra] = value.split(".");
  if (!payload || !signature || extra) return null;
  const actual = Buffer.from(signature);
  const expected = Buffer.from(sign(payload, secret));
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;

  try {
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as EbayTradingAuthSession;
    if (
      !parsed.ownerId
      || !parsed.sessionId
      || !parsed.state
      || !Number.isFinite(parsed.issuedAt)
      || now - parsed.issuedAt > ebayTradingAuthSessionLifetimeMs
      || parsed.issuedAt > now + 30_000
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

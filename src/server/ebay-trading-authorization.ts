import "server-only";

import {
  createSignedEbayTradingAuthSession,
  parseSignedEbayTradingAuthSession,
} from "@/lib/ebay-trading-auth-state";
import {
  ebayTradingAuthorizationFailureFromText,
  type EbayTradingAuthorizationFailureCode,
} from "@/lib/ebay-trading-auth-failure";
import {
  createEbayOAuthState,
  EbayAuthorizationError,
  EbayConfigurationError,
  EbayTemporaryError,
  getEbayConnectionStatus,
} from "@/server/ebay-seller";
import {
  callEbayTradingKeysetApi,
  EbayTradingError,
  ebayXmlEscape,
  ebayXmlText,
} from "@/server/ebay-trading";
import {
  ensureEbayTradingNotificationPreferences,
  storeVerifiedEbayTradingAuthorization,
} from "@/server/ebay-trading-notification-service";

export { ebayTradingAuthorizationFailureCanRetry } from "@/lib/ebay-trading-auth-failure";

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new EbayConfigurationError(`${name} is not configured.`);
  return value;
}

function tradingRuName() {
  const local = process.env.EBAY_OAUTH_LOCAL_RU_NAME?.trim();
  if (process.env.NODE_ENV !== "production" && local) return local;
  return requiredEnvironment("EBAY_OAUTH_RU_NAME");
}

function signingSecret() {
  return requiredEnvironment("BETTER_AUTH_SECRET");
}

function tradingFailureText(error: unknown) {
  if (!(error instanceof Error)) return "";
  const details = error instanceof EbayTradingError
    ? error.details.map((detail) => detail.message).filter(Boolean)
    : [];
  return [error.message, ...details].join(" ").toLowerCase();
}

export function ebayTradingAuthorizationFailureCode(
  error: unknown,
): EbayTradingAuthorizationFailureCode {
  if (error instanceof EbayConfigurationError) return "trading_configuration";
  if (error instanceof EbayTemporaryError) return "trading_temporary";

  return ebayTradingAuthorizationFailureFromText(
    tradingFailureText(error),
    error instanceof EbayTradingError
      ? error.details.map((detail) => detail.code)
      : [],
  );
}

export function ebayTradingAuthorizationFailureDiagnostics(error: unknown) {
  return {
    ebayCodes: error instanceof EbayTradingError
      ? error.details.map((detail) => detail.code).filter(Boolean)
      : [],
    failure: ebayTradingAuthorizationFailureCode(error),
    source: error instanceof Error ? error.constructor.name : typeof error,
  };
}

export function isEbayTradingAuthorizationConfigured() {
  const ruName = process.env.NODE_ENV !== "production"
    ? process.env.EBAY_OAUTH_LOCAL_RU_NAME?.trim() || process.env.EBAY_OAUTH_RU_NAME?.trim()
    : process.env.EBAY_OAUTH_RU_NAME?.trim();
  return Boolean(
    process.env.BETTER_AUTH_SECRET?.trim()
    && process.env.EBAY_CLIENT_ID?.trim()
    && process.env.EBAY_CLIENT_SECRET?.trim()
    && process.env.EBAY_DEV_ID?.trim()
    && ruName,
  );
}

export async function beginEbayTradingAuthorization(ownerId: string) {
  if (!await getEbayConnectionStatus(ownerId)) {
    throw new EbayAuthorizationError(
      "Connect the eBay seller account before renewing Trading authorization.",
    );
  }
  const ruName = tradingRuName();
  const result = await callEbayTradingKeysetApi({
    body: `<RuName>${ebayXmlEscape(ruName)}</RuName>`,
    callName: "GetSessionID",
  });
  const sessionId = ebayXmlText(result.xml, "SessionID");
  if (!sessionId) {
    throw new EbayAuthorizationError(
      "eBay did not return a Trading authorization session. Retry shortly.",
    );
  }
  const state = createEbayOAuthState(ownerId, {
    purpose: "trading_authorization",
  });
  const cookieValue = createSignedEbayTradingAuthSession({
    ownerId,
    sessionId,
    state,
  }, signingSecret());
  const signInUrl = new URL("https://signin.ebay.com/ws/eBayISAPI.dll");
  const ruparams = new URLSearchParams({ tradingState: state });
  signInUrl.search = [
    "SignIn",
    `RUName=${encodeURIComponent(ruName)}`,
    `SessID=${encodeURIComponent(sessionId)}`,
    `ruparams=${encodeURIComponent(ruparams.toString())}`,
  ].join("&");
  return { cookieValue, signInUrl };
}

export function parseEbayTradingAuthorizationCookie(value: string) {
  return parseSignedEbayTradingAuthSession(value, signingSecret());
}

export async function fetchEbayTradingAuthorization(sessionId: string) {
  const result = await callEbayTradingKeysetApi({
    body: `<SessionID>${ebayXmlEscape(sessionId)}</SessionID>`,
    callName: "FetchToken",
  });
  const token = ebayXmlText(result.xml, "eBayAuthToken");
  const expirationText = ebayXmlText(result.xml, "HardExpirationTime");
  const expiresAt = expirationText ? new Date(expirationText) : null;
  if (!token || !expiresAt || Number.isNaN(expiresAt.getTime())) {
    throw new EbayAuthorizationError(
      "eBay did not return a complete Trading authorization. Sign in and agree again.",
    );
  }
  return { expiresAt, token };
}

export async function completeEbayTradingAuthorization(
  ownerId: string,
  sessionId: string,
) {
  const fetched = await fetchEbayTradingAuthorization(sessionId);
  await storeVerifiedEbayTradingAuthorization({
    expiresAt: fetched.expiresAt,
    ownerId,
    token: fetched.token,
  });
  return ensureEbayTradingNotificationPreferences(ownerId);
}

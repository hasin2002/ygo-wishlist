import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createSignedEbayOAuthState,
} from "../src/lib/ebay-oauth-state.ts";
import {
  createSignedEbayTradingAuthSession,
  ebayTradingAuthSessionLifetimeMs,
  parseSignedEbayTradingAuthSession,
} from "../src/lib/ebay-trading-auth-state.ts";
import {
  ebayTradingAuthorizationFailureCanRetry,
  ebayTradingAuthorizationFailureFromText,
} from "../src/lib/ebay-trading-auth-failure.ts";

const secret = "test-only-trading-auth-secret";
const issuedAt = 2_000_000;

test("Trading renewal state binds the one-time eBay session to its owner", () => {
  const state = createSignedEbayOAuthState("owner-a", secret, {
    now: issuedAt,
    purpose: "trading_authorization",
  });
  const cookie = createSignedEbayTradingAuthSession({
    ownerId: "owner-a",
    sessionId: "ebay-session-a",
    state,
  }, secret, issuedAt);
  assert.deepEqual(parseSignedEbayTradingAuthSession(cookie, secret, issuedAt + 1), {
    issuedAt,
    ownerId: "owner-a",
    sessionId: "ebay-session-a",
    state,
  });
  assert.equal(
    parseSignedEbayTradingAuthSession(`${cookie}x`, secret, issuedAt + 1),
    null,
  );
  assert.equal(
    parseSignedEbayTradingAuthSession(
      cookie,
      secret,
      issuedAt + ebayTradingAuthSessionLifetimeMs + 1,
    ),
    null,
  );
});

test("Trading renewal failures distinguish unfinished consent from expired sessions", () => {
  const incomplete = ebayTradingAuthorizationFailureFromText(
    "",
    ["21916017"],
  );
  const expired = ebayTradingAuthorizationFailureFromText(
    "The SessionID is not valid because the session has expired.",
  );
  assert.equal(incomplete, "trading_incomplete");
  assert.equal(ebayTradingAuthorizationFailureCanRetry(incomplete), true);
  assert.equal(expired, "trading_expired");
  assert.equal(ebayTradingAuthorizationFailureCanRetry(expired), false);
});

test("Trading renewal routes require admin session, signed state, and same-origin completion", () => {
  const connect = readFileSync(new URL(
    "../src/app/api/ebay/trading-auth/connect/route.ts",
    import.meta.url,
  ), "utf8");
  const complete = readFileSync(new URL(
    "../src/app/api/ebay/trading-auth/complete/route.ts",
    import.meta.url,
  ), "utf8");
  const callback = readFileSync(new URL(
    "../src/app/api/ebay/callback/route.ts",
    import.meta.url,
  ), "utf8");
  assert.match(connect, /session\.user\.role !== "admin"/);
  assert.match(connect, /ebayTradingAuthSessionCookieOptions/);
  assert.match(complete, /getAllowedRequestOrigin/);
  assert.match(complete, /state\.purpose !== "trading_authorization"/);
  assert.match(complete, /ebayTradingAuthorizationFailureCode/);
  assert.match(complete, /NextResponse\.redirect\(new URL\(destination, request\.url\), 303\)/);
  assert.match(callback, /sameValue\(tradingState, pending\.state\)/);
  assert.match(callback, /completeEbayTradingAuthorization/);
});

test("Trading authorization errors and recovery stay beside the current status", () => {
  const page = readFileSync(new URL(
    "../src/app/ebay/page.tsx",
    import.meta.url,
  ), "utf8");
  const card = readFileSync(new URL(
    "../src/components/ebay-notification-setup-card.tsx",
    import.meta.url,
  ), "utf8");
  assert.match(page, /authorizationFlow=\{\{/);
  assert.doesNotMatch(page, /<h2 className="text-lg font-black">Complete Trading authorization<\/h2>/);
  assert.match(card, /action="\/api\/ebay\/trading-auth\/complete"/);
  assert.match(card, /refreshOnSettled=\{false\}/);
  assert.match(card, /Complete this only after eBay shows that authorization succeeded/);
  assert.match(card, /Checking eBay approval…/);
  assert.match(card, /aria-busy=\{completingAuthorization\}/);
  assert.match(card, /disabled=\{completingAuthorization\}/);
  assert.match(card, /authorizationSuccessDurationMs = 5_000/);
  assert.match(card, /url\.searchParams\.delete\("tradingAuthorized"\)/);
  assert.match(card, /window\.history\.replaceState/);
  const notice = card.indexOf("authorizationFlow.error || authorizationFlow.pending || showAuthorizationSuccess");
  const completeAction = card.indexOf('action="/api/ebay/trading-auth/complete"');
  const secondaryActions = card.indexOf('<div className="mt-5 flex flex-wrap gap-3">');
  assert.ok(notice < completeAction && completeAction < secondaryActions);
});

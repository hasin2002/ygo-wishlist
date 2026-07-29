import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const connectSource = readFileSync(new URL("../src/app/api/ebay/connect/route.ts", import.meta.url), "utf8");
const callbackSource = readFileSync(new URL("../src/app/api/ebay/callback/route.ts", import.meta.url), "utf8");
const manualSource = readFileSync(new URL("../src/app/api/ebay/manual-callback/route.ts", import.meta.url), "utf8");
const pageSource = readFileSync(new URL("../src/app/ebay/page.tsx", import.meta.url), "utf8");
const handoffSource = readFileSync(new URL("../src/components/ebay-connection-handoff.tsx", import.meta.url), "utf8");

test("replacement start is signed, owner-bound, short-lived, and its cookie is available to the settings page", () => {
  assert.match(connectSource, /purpose: connection \? "replacement" : "connect"/);
  assert.match(connectSource, /createEbayOAuthState\(session\.user\.id/);
  assert.match(connectSource, /ebayOAuthStateCookieOptions\(\)/);
  assert.match(pageSource, /cookies\(\)/);
  assert.match(pageSource, /pendingState\.ownerId === session\.user\.id/);
  assert.match(pageSource, /Complete replacement connection URL/);
  assert.match(pageSource, /within ten minutes/);
  assert.match(pageSource, /database configured for this local server/);
});

test("the development handoff refreshes server settings when focus or visibility returns", () => {
  assert.match(pageSource, /EbayConnectionHandoff/);
  assert.match(handoffSource, /router\.refresh\(\)/);
  assert.match(handoffSource, /visibilitychange/);
  assert.match(handoffSource, /window\.addEventListener\("focus"/);
  assert.match(pageSource, /key=\{localCompletionPending \? "pending-oauth" : "idle-oauth"\}/);
  assert.match(pageSource, /autoFocus=\{localCompletionPending\}/);
});

test("manual replacement rejects untrusted URL shape and only consumes a pending state on terminal outcomes", () => {
  assert.match(manualSource, /parseEbayManualCallbackUrl/);
  assert.match(manualSource, /request\.cookies\.get\(ebayOAuthStateCookieName\)/);
  assert.match(manualSource, /sameValue\(state, expectedState\)/);
  assert.match(manualSource, /session\.user\.id !== stateDetails\.ownerId/);
  assert.match(manualSource, /EbayTemporaryError/);
  assert.match(manualSource, /false\);/);
  assert.match(manualSource, /saveEbayConnection\(/);
  assert.match(manualSource, /return finish\(request, completionDestination\)/);
});

test("the Production callback still validates the same signed owner state and clears its exact cookie path", () => {
  assert.match(callbackSource, /sameValue\(state, expectedState\)/);
  assert.match(callbackSource, /session\.user\.id !== stateDetails\.ownerId/);
  assert.match(callbackSource, /clearEbayOAuthStateCookie/);
  assert.match(callbackSource, /return finish\(request, "\/ebay\?connected=1"\)/);
});

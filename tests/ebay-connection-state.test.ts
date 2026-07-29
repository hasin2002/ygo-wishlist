import assert from "node:assert/strict";
import test from "node:test";
import {
  ebayConnectHref,
  ebayConnectionPresentation,
  parseEbayManualCallbackUrl,
  safeEbayReturnTo,
  shouldRefreshEbaySettings,
} from "../src/lib/ebay-connection-state.ts";

test("stored connections are not presented as verified health", () => {
  assert.equal(ebayConnectionPresentation("stored").label, "Stored");
  assert.equal(ebayConnectionPresentation("recently_verified").label, "Recently verified");
  assert.match(ebayConnectionPresentation("temporarily_unavailable").message, /Try the listing action again/);
});

test("the local handoff refreshes the settings RSC after eBay opens or the owner returns", () => {
  assert.equal(shouldRefreshEbaySettings({ awaitingReturn: false, event: "focus", leftForEbay: true }), false);
  assert.equal(shouldRefreshEbaySettings({ awaitingReturn: true, event: "settled", leftForEbay: false }), true);
  assert.equal(shouldRefreshEbaySettings({ awaitingReturn: true, event: "focus", leftForEbay: true }), true);
  assert.equal(shouldRefreshEbaySettings({ awaitingReturn: true, event: "visible", leftForEbay: true }), true);
  assert.equal(shouldRefreshEbaySettings({ awaitingReturn: true, event: "focus", leftForEbay: false }), false);
});

test("a Copy-specific Records return path round-trips but external and malformed paths do not", () => {
  const copyPath = "/records/inventory/card/target-1?copy=copy-1";
  assert.equal(safeEbayReturnTo(copyPath), copyPath);
  assert.equal(ebayConnectHref(copyPath), `/api/ebay/connect?returnTo=${encodeURIComponent(copyPath)}`);
  assert.equal(safeEbayReturnTo("https://example.com/records/inventory/card/target-1"), null);
  assert.equal(safeEbayReturnTo("//example.com/records/inventory/card/target-1"), null);
  assert.equal(safeEbayReturnTo("/ebay"), null);
});

test("manual completion requires an allowed eBay host plus state and code, not a query flag alone", () => {
  assert.deepEqual(parseEbayManualCallbackUrl("https://auth2.ebay.com/oauth?isAuthSuccessful=true"), { kind: "invalid" });
  assert.deepEqual(parseEbayManualCallbackUrl("https://example.com/oauth?state=s&code=c"), { kind: "invalid" });
  assert.deepEqual(parseEbayManualCallbackUrl("https://auth2.ebay.com/oauth?isAuthSuccessful=false"), { kind: "cancelled" });
  assert.deepEqual(parseEbayManualCallbackUrl("https://auth2.ebay.com/oauth?state=s&code=c"), {
    code: "c",
    kind: "success",
    state: "s",
  });
});

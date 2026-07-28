import assert from "node:assert/strict";
import test from "node:test";
import {
  copyExposureSelectorLabel,
  copyRemovalDecision,
  ebayExposurePresentation,
  ebayExposureSummary,
} from "../src/components/records/ebay-copy-exposure-presentation.ts";
import type { CopyEbayExposureState } from "../src/lib/records/types.ts";

function exposure(overrides: Partial<CopyEbayExposureState> = {}): CopyEbayExposureState {
  return {
    action: { code: "no_related_offers", disposition: "sell", reason: "No related eBay offers are recorded for this Copy." },
    aggregateState: "not_listed",
    copyId: "copy-1",
    endedOfferCount: 0,
    liveOfferCount: 0,
    offers: [],
    physical: { code: "owned", reason: "This physical Copy is owned.", state: "owned" },
    ...overrides,
  };
}

test("eBay exposure summary labels cover zero, one, and several live offers", () => {
  assert.equal(ebayExposureSummary(exposure()), "0 live offers · 0 ended offers");
  assert.equal(ebayExposureSummary(exposure({ liveOfferCount: 1 })), "1 live offer · 0 ended offers");
  assert.equal(ebayExposureSummary(exposure({ endedOfferCount: 1, liveOfferCount: 2 })), "2 live offers · 1 ended offer");
  assert.equal(ebayExposurePresentation("live", 1).label, "Live on eBay");
  assert.equal(ebayExposurePresentation("live", 2).label, "Live in 2 offers");
});

test("eBay exposure presentation has stable plain-language labels", () => {
  assert.equal(ebayExposurePresentation("not_listed", 0).label, "Not listed");
  assert.equal(ebayExposurePresentation("payment_pending", 0).label, "Payment pending");
  assert.equal(ebayExposurePresentation("needs_attention", 0).label, "Needs attention");
  assert.equal(ebayExposurePresentation("paid_sale_recorded", 0).label, "Paid · Sale recorded");
  assert.equal(ebayExposurePresentation("needs_takedown", 0).label, "Needs takedown");
  assert.equal(ebayExposurePresentation("reserved_by_order", 0).label, "Reserved by order");
  assert.equal(ebayExposurePresentation("ending_automatically", 0).label, "Ending automatically");
});

test("Copy selector language keeps physical ownership and eBay exposure distinct", () => {
  assert.equal(copyExposureSelectorLabel("Copy 1", exposure()), "Copy 1 · Owned · eBay 0 live offers · 0 ended offers");
  assert.equal(copyExposureSelectorLabel("Copy 2", exposure({ physical: { code: "sold", reason: "Sold.", state: "sold" } })), "Copy 2 · Sold · eBay 0 live offers · 0 ended offers");
  assert.equal(copyExposureSelectorLabel("Copy 3", exposure({ physical: { code: "copy_void", reason: "Unavailable.", state: "unavailable" } })), "Copy 3 · Unavailable · eBay 0 live offers · 0 ended offers");
});

test("Copy removal preserves any eBay listing history", () => {
  assert.deepEqual(copyRemovalDecision(exposure()), { available: true, reason: null });
  assert.equal(copyRemovalDecision(undefined).available, false);
  const withHistory = exposure({ offers: [{ listingId: "listing-1" }] as CopyEbayExposureState["offers"] });
  assert.deepEqual(copyRemovalDecision(withHistory), {
    available: false,
    reason: "This Copy has eBay listing history and cannot be removed because that history must be preserved.",
  });
});

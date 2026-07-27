import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCopyEbayExposureStates,
  dedupeEbayOffersMembershipFirst,
} from "../src/lib/records/copy-ebay-exposure.ts";
import type { CardCopy, EbayOfferExposure, RecordEntry } from "../src/lib/records/types.ts";

const record: Pick<RecordEntry, "id" | "status"> = { id: "purchase-1", status: "active" };

function copy(id: string, status: CardCopy["status"] = "available"): CardCopy {
  return {
    acquiredRecordId: "purchase-1", allocationIndex: null, allocationPence: null,
    bulkLotId: null, condition: "Near Mint", createdAt: "2026-07-27T10:00:00.000Z",
    id, location: null, printingId: "printing-1", privateNote: "", soldRecordId: status === "sold" ? "sale-1" : null,
    status, stickerNumber: null,
  };
}

function offer(overrides: Partial<EbayOfferExposure> = {}): EbayOfferExposure {
  return {
    cancelledAt: null, copyId: "copy-1", fulfilmentPosition: 0, itemId: "1001", kind: "individual",
    lastError: null, lastErrorAt: null, lastSyncedAt: "2026-07-27T10:00:00.000Z",
    listingEndedAt: null, listingId: "listing-1", listingStartedAt: "2026-07-27T09:00:00.000Z",
    listingState: "active", listingUrl: "https://www.ebay.co.uk/itm/1001", memberId: "member-1",
    paidAt: null, paymentPendingAt: null, quantitySold: 0, relationSource: "member",
    saleRecordId: null, saleState: "none", title: "Example offer", updatedAt: "2026-07-27T10:00:00.000Z",
    ...overrides,
  };
}

test("an Owned Copy keeps physical ownership separate from zero, one, and many offers", () => {
  const states = buildCopyEbayExposureStates(
    [copy("zero"), copy("one"), copy("many")],
    [record],
    [
      offer({ copyId: "one" }),
      offer({ copyId: "many", listingId: "ended", listingState: "ended", saleState: "cancelled" }),
      offer({ copyId: "many", listingId: "live" }),
      offer({ copyId: "many", listingId: "live-2", itemId: "1002", listingUrl: "https://www.ebay.co.uk/itm/1002" }),
    ],
  );
  assert.deepEqual(states.map((state) => [state.copyId, state.physical.state, state.aggregateState, state.liveOfferCount, state.endedOfferCount]), [
    ["zero", "owned", "not_listed", 0, 0],
    ["one", "owned", "live", 1, 0],
    ["many", "owned", "live", 2, 1],
  ]);
  assert.equal(states[0]?.action.code, "no_related_offers");
  assert.equal(states[2]?.action.code, "live_offer");
});

test("pending, paid without Sale, errors, and ended history each have an explicit safe state", () => {
  const pending = buildCopyEbayExposureStates([copy("pending")], [record], [offer({ copyId: "pending", listingState: "ended", saleState: "pending" })])[0]!;
  const paidWithoutSale = buildCopyEbayExposureStates([copy("paid")], [record], [offer({ copyId: "paid", listingState: "ended", saleState: "paid", quantitySold: 1 })])[0]!;
  const errored = buildCopyEbayExposureStates([copy("errored")], [record], [offer({ copyId: "errored", lastError: "Timed out" })])[0]!;
  const ended = buildCopyEbayExposureStates([copy("ended")], [record], [offer({ copyId: "ended", listingState: "ended", saleState: "cancelled" })])[0]!;
  const paidRecorded = buildCopyEbayExposureStates([copy("recorded")], [record], [offer({ copyId: "recorded", listingState: "ended", saleState: "paid", saleRecordId: "sale-1", quantitySold: 1 })])[0]!;
  assert.equal(pending.aggregateState, "payment_pending");
  assert.equal(paidWithoutSale.aggregateState, "needs_attention");
  assert.equal(errored.aggregateState, "needs_attention");
  assert.equal(ended.aggregateState, "not_listed");
  assert.equal(ended.action.code, "only_ended_offers");
  assert.equal(paidRecorded.aggregateState, "paid_sale_recorded");
});

test("restoring a source Record returns an otherwise available Copy to Owned", () => {
  const unavailable = buildCopyEbayExposureStates(
    [copy("restorable")],
    [{ id: record.id, status: "void" }],
    [],
  )[0]!;
  const restored = buildCopyEbayExposureStates([copy("restorable")], [record], [])[0]!;
  assert.equal(unavailable.physical.state, "unavailable");
  assert.equal(unavailable.action.code, "copy_unavailable");
  assert.equal(restored.physical.state, "owned");
  assert.equal(restored.action.code, "no_related_offers");
});

test("sold and unavailable Copies preserve offer history and flag a live offer for takedown", () => {
  const sold = buildCopyEbayExposureStates([copy("sold", "sold")], [record], [offer({ copyId: "sold" })])[0]!;
  const unavailable = buildCopyEbayExposureStates([copy("void", "void")], [record], [offer({ copyId: "void", listingState: "ended", saleState: "paid", saleRecordId: "sale-1", quantitySold: 1 })])[0]!;
  assert.equal(sold.physical.state, "sold");
  assert.equal(sold.aggregateState, "needs_takedown");
  assert.equal(sold.action.code, "needs_takedown");
  assert.equal(unavailable.physical.state, "unavailable");
  assert.equal(unavailable.offers.length, 1);
  assert.equal(unavailable.action.code, "copy_unavailable");
});

test("membership-first dedupe retains the exact member relationship over a legacy pair", () => {
  const merged = dedupeEbayOffersMembershipFirst([
    offer({ memberId: null, relationSource: "legacy" }),
    offer({ fulfilmentPosition: 2, memberId: "member-1", relationSource: "member" }),
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.relationSource, "member");
  assert.equal(merged[0]?.fulfilmentPosition, 2);
});

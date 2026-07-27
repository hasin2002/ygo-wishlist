import assert from "node:assert/strict";
import test from "node:test";
import {
  decideEbayCopyListingEligibility,
  type EbayCopyListingEligibilityCandidate,
} from "../src/lib/records/ebay-copy-listing-eligibility.ts";

const older = new Date("2026-07-26T10:00:00.000Z");
const newer = new Date("2026-07-26T11:00:00.000Z");

function listing(
  id: string,
  overrides: Partial<EbayCopyListingEligibilityCandidate> = {},
): EbayCopyListingEligibilityCandidate {
  return {
    createdAt: older,
    id,
    listingState: "active",
    relistAllowed: false,
    saleState: "none",
    ...overrides,
  };
}

test("a newer ended offer cannot hide an older unresolved offer", () => {
  const decision = decideEbayCopyListingEligibility([
    listing("older-active"),
    listing("newer-ended", {
      createdAt: newer,
      listingState: "ended",
      relistAllowed: true,
    }),
  ]);

  assert.deepEqual(decision, {
    blockingListingIds: ["older-active"],
    eligible: false,
    representativeListingId: "older-active",
    status: "active_listing",
  });
});

test("only definitive ended or cancelled history permits relisting", () => {
  const decision = decideEbayCopyListingEligibility([
    listing("older-cancelled", {
      listingState: "ended",
      relistAllowed: true,
      saleState: "cancelled",
    }),
    listing("newer-ended", {
      createdAt: newer,
      listingState: "ended",
      relistAllowed: true,
    }),
  ]);

  assert.deepEqual(decision, {
    blockingListingIds: [],
    eligible: true,
    representativeListingId: "newer-ended",
    status: "eligible",
  });
});

test("every unresolved offer remains available for reconciliation", () => {
  const decision = decideEbayCopyListingEligibility([
    listing("active"),
    listing("pending", { saleState: "pending" }),
    listing("ended", {
      listingState: "ended",
      relistAllowed: true,
    }),
  ]);

  assert.equal(decision.eligible, false);
  assert.deepEqual(decision.blockingListingIds, ["active", "pending"]);
  assert.equal(decision.representativeListingId, "pending");
  assert.equal(decision.status, "payment_pending");
});

test("blocking status uses fail-closed severity with a matching representative", () => {
  const decision = decideEbayCopyListingEligibility([
    listing("active"),
    listing("unknown", { listingState: "unknown" }),
    listing("pending", { saleState: "pending" }),
    listing("paid", { saleState: "paid" }),
    listing("review", { saleState: "needs_review" }),
  ]);

  assert.equal(decision.eligible, false);
  assert.equal(decision.representativeListingId, "review");
  assert.equal(decision.status, "needs_review");
});

test("unknown and suspended states return the existing suspended status", () => {
  for (const listingState of ["unknown", "suspended"] as const) {
    const decision = decideEbayCopyListingEligibility([
      listing(listingState, { listingState }),
    ]);

    assert.equal(decision.eligible, false);
    assert.equal(decision.representativeListingId, listingState);
    assert.equal(decision.status, "suspended");
  }
});

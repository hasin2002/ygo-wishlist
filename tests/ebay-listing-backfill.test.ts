import assert from "node:assert/strict";
import test from "node:test";
import {
  assertEbayListingBackfillApplySafe,
  planEbayListingCompositionBackfill,
  type EbayListingBackfillInputs,
  type LegacyEbayListingForBackfill,
} from "../src/lib/records/ebay-listing-backfill.ts";

const pendingAt = new Date("2026-07-20T10:00:00.000Z");
const paidAt = new Date("2026-07-20T11:00:00.000Z");
const cancelledAt = new Date("2026-07-20T12:00:00.000Z");

function listing(
  overrides: Partial<LegacyEbayListingForBackfill> = {},
): LegacyEbayListingForBackfill {
  return {
    id: "listing-1",
    ownerId: "owner-1",
    copyId: "copy-1",
    status: "active",
    listingState: "active",
    saleState: "none",
    orderId: null,
    orderLineItemId: null,
    transactionId: null,
    saleRecordId: null,
    quantitySold: 0,
    remoteOrderStatus: null,
    paymentPendingAt: null,
    paidAt: null,
    cancelledAt: null,
    lastRemoteEventAt: pendingAt,
    ...overrides,
  };
}

function inputs(
  listings: LegacyEbayListingForBackfill[],
  overrides: Partial<EbayListingBackfillInputs> = {},
): EbayListingBackfillInputs {
  return {
    listings,
    copyOwnerById: new Map([
      ["copy-1", "owner-1"],
      ["copy-2", "owner-1"],
    ]),
    saleOwnerById: new Map([["sale-1", "owner-1"]]),
    saleCopyIdsByOwnerRecord: new Map([
      ["owner-1\u0000sale-1", new Set(["copy-1"])],
    ]),
    ...overrides,
  };
}

test("active Listing projects one position-zero individual member", () => {
  const plan = planEbayListingCompositionBackfill(inputs([listing()]));
  assert.deepEqual(plan.members[0], {
    action: "create",
    copyId: "copy-1",
    fulfilmentPosition: 0,
    kind: "individual",
    listingId: "listing-1",
    ownerId: "owner-1",
  });
  assert.equal(plan.counts.active, 1);
  assert.equal(plan.orderLines.length, 0);
  assert.equal(plan.safeToApply, true);
});

test("ended-unsold Listing keeps its exact member without inventing order history", () => {
  const plan = planEbayListingCompositionBackfill(inputs([
    listing({ status: "ended", listingState: "ended" }),
  ]));
  assert.equal(plan.counts.ended, 1);
  assert.equal(plan.members.length, 1);
  assert.equal(plan.orderLines.length, 0);
  assert.equal(plan.allocations.length, 0);
});

test("pending Listing preserves quantity, payment state, timestamp, and allocation", () => {
  const plan = planEbayListingCompositionBackfill(inputs([
    listing({
      status: "ended",
      listingState: "ended",
      saleState: "pending",
      orderId: "order-1",
      orderLineItemId: "line-1",
      quantitySold: 1,
      remoteOrderStatus: "PENDING",
      paymentPendingAt: pendingAt,
    }),
  ]));
  assert.equal(plan.orderLines[0]?.quantityPurchased, 1);
  assert.equal(plan.orderLines[0]?.paymentState, "pending");
  assert.equal(plan.orderLines[0]?.paymentPendingAt, pendingAt);
  assert.equal(plan.allocations[0]?.allocatedAt, pendingAt);
  assert.equal(plan.allocations[0]?.releasedAt, null);
  assert.equal(plan.safeToApply, true);
});

test("paid but Sale-unlinked Listing retains paid state and exact allocation", () => {
  const plan = planEbayListingCompositionBackfill(inputs([
    listing({
      status: "ended",
      listingState: "ended",
      saleState: "paid",
      transactionId: "transaction-1",
      quantitySold: 1,
      paidAt,
      lastRemoteEventAt: paidAt,
    }),
  ]));
  assert.equal(plan.orderLines[0]?.paymentState, "paid");
  assert.equal(plan.orderLines[0]?.paidAt, paidAt);
  assert.equal(plan.orderLines[0]?.saleRecordId, null);
  assert.equal(plan.allocations[0]?.action, "create");
});

test("cancelled Listing retains a released allocation and cancellation history", () => {
  const plan = planEbayListingCompositionBackfill(inputs([
    listing({
      status: "ended",
      listingState: "ended",
      saleState: "cancelled",
      orderId: "order-1",
      orderLineItemId: "line-1",
      quantitySold: 0,
      cancelledAt,
      lastRemoteEventAt: cancelledAt,
    }),
  ]));
  assert.equal(plan.orderLines[0]?.paymentState, "cancelled");
  assert.equal(plan.orderLines[0]?.cancelledAt, cancelledAt);
  assert.equal(plan.allocations[0]?.releasedAt, cancelledAt);
  assert.equal(plan.allocations[0]?.releaseReason, "cancelled");
  assert.equal(plan.safeToApply, true);
});

test("Sale-linked aggregate-none Listing still receives its exact paid allocation", () => {
  const plan = planEbayListingCompositionBackfill(inputs([
    listing({
      status: "ended",
      listingState: "ended",
      saleState: "none",
      transactionId: "transaction-1",
      saleRecordId: "sale-1",
      quantitySold: 0,
      paidAt,
      lastRemoteEventAt: paidAt,
    }),
  ]));
  assert.equal(plan.counts.saleLinked, 1);
  assert.equal(plan.orderLines[0]?.paymentState, "paid");
  assert.equal(plan.orderLines[0]?.saleRecordId, "sale-1");
  assert.equal(plan.allocations[0]?.copyId, "copy-1");
  assert.equal(plan.safeToApply, true);
});

test("duplicate logical order lines across Listings are blocking", () => {
  const plan = planEbayListingCompositionBackfill(inputs([
    listing({
      id: "listing-1",
      copyId: "copy-1",
      saleState: "paid",
      orderId: "order-1",
      orderLineItemId: "line-1",
      quantitySold: 1,
      paidAt,
    }),
    listing({
      id: "listing-2",
      copyId: "copy-2",
      saleState: "paid",
      orderId: "order-1",
      orderLineItemId: "line-1",
      quantitySold: 1,
      paidAt,
    }),
  ]));
  assert.equal(plan.safeToApply, false);
  assert.ok(plan.anomalies.some(
    (entry) => entry.category === "duplicate_logical_line" && entry.blocking,
  ));
  assert.equal(plan.orderLines.length, 1);
  assert.equal(plan.allocations.length, 1);
});

test("rerun reuses exact staged member, order line, and allocation", () => {
  const legacy = listing({
    status: "ended",
    listingState: "ended",
    saleState: "paid",
    transactionId: "transaction-1",
    quantitySold: 1,
    paidAt,
  });
  const key = "transaction:owner-1\u0000transaction-1";
  const plan = planEbayListingCompositionBackfill(inputs([legacy], {
    existingMembers: [{
      id: "member-1",
      ownerId: "owner-1",
      listingId: "listing-1",
      copyId: "copy-1",
      fulfilmentPosition: 0,
    }],
    existingOrderLines: [{
      ownerId: "owner-1",
      listingId: "listing-1",
      orderId: null,
      orderLineItemId: null,
      transactionId: "transaction-1",
      quantityPurchased: 1,
      paymentState: "paid",
      remoteOrderStatus: null,
      paymentPendingAt: null,
      paidAt,
      cancelledAt: null,
      lastRemoteEventAt: pendingAt,
      saleRecordId: null,
    }],
    existingAllocations: [{
      id: "allocation-1",
      ownerId: "owner-1",
      listingId: "listing-1",
      listingMemberId: "member-1",
      orderLineId: "line-1",
      copyId: "copy-1",
      orderLineKey: key,
      fulfilmentPosition: 0,
      allocatedAt: paidAt,
      releasedAt: null,
      releaseReason: null,
    }],
  }));
  assert.deepEqual(plan.counts.members, { create: 0, reuse: 1, skip: 0 });
  assert.deepEqual(plan.counts.orderLines, { create: 0, reuse: 1, skip: 0 });
  assert.deepEqual(plan.counts.allocations, { create: 0, reuse: 1, skip: 0 });
});

test("same-owner Sale linked to a different Copy is blocking", () => {
  const plan = planEbayListingCompositionBackfill(inputs([
    listing({
      saleState: "none",
      transactionId: "transaction-1",
      saleRecordId: "sale-1",
      paidAt,
      lastRemoteEventAt: paidAt,
    }),
  ], {
    saleCopyIdsByOwnerRecord: new Map([
      ["owner-1\u0000sale-1", new Set(["copy-2"])],
    ]),
  }));
  assert.equal(plan.safeToApply, false);
  assert.ok(plan.anomalies.some(
    (entry) => entry.category === "sale_copy_mismatch" && entry.blocking,
  ));
});

test("staged lifecycle mismatch is reported during dry-run planning", () => {
  const legacy = listing({
    status: "ended",
    listingState: "ended",
    saleState: "paid",
    transactionId: "transaction-1",
    quantitySold: 1,
    paidAt,
  });
  const plan = planEbayListingCompositionBackfill(inputs([legacy], {
    existingOrderLines: [{
      id: "line-1",
      ownerId: "owner-1",
      listingId: "listing-1",
      orderId: null,
      orderLineItemId: null,
      transactionId: "transaction-1",
      quantityPurchased: 1,
      paymentState: "pending",
      remoteOrderStatus: null,
      paymentPendingAt: null,
      paidAt: null,
      cancelledAt: null,
      lastRemoteEventAt: pendingAt,
      saleRecordId: null,
    }],
  }));
  assert.equal(plan.safeToApply, false);
  assert.ok(plan.anomalies.some(
    (entry) => entry.category === "staged_row_mismatch" && entry.blocking,
  ));
});

test("apply safety accepts exact plans and rejects blocking anomalies", () => {
  const safe = planEbayListingCompositionBackfill(inputs([listing()]));
  assert.doesNotThrow(() => assertEbayListingBackfillApplySafe(safe));

  const unsafe = planEbayListingCompositionBackfill(inputs([
    listing({
      saleState: "paid",
      transactionId: "transaction-1",
      quantitySold: 2,
      paidAt,
    }),
  ]));
  assert.throws(
    () => assertEbayListingBackfillApplySafe(unsafe),
    /blocking anomalies/,
  );
  assert.equal(unsafe.writes, 0);
});

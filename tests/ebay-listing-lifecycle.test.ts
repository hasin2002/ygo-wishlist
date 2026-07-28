import assert from "node:assert/strict";
import test from "node:test";
import {
  decideEbayLifecycleTransition,
  emptyEbayListingLifecycle,
  isEbayLifecycleBlocking,
  isEbayLifecycleRelistable,
  type EbayListingLifecycle,
} from "../src/lib/records/ebay-listing-lifecycle.ts";

const t1 = new Date("2026-07-24T10:00:00.000Z");
const t2 = new Date("2026-07-24T11:00:00.000Z");
const t3 = new Date("2026-07-24T12:00:00.000Z");

function activeLifecycle(): EbayListingLifecycle {
  return decideEbayLifecycleTransition(emptyEbayListingLifecycle(), {
    effectiveAt: t1,
    kind: "active",
    notificationId: "notification-active",
    remoteListingStatus: "Active",
  }).next;
}

function pendingLifecycle(): EbayListingLifecycle {
  return decideEbayLifecycleTransition(activeLifecycle(), {
    effectiveAt: t2,
    kind: "payment_pending",
    notificationId: "notification-pending",
    orderId: "order-1",
    orderLineItemId: "line-1",
    quantitySold: 1,
    remoteOrderStatus: "PENDING",
  }).next;
}

test("unknown state is fail-closed and active state blocks relisting", () => {
  const empty = emptyEbayListingLifecycle();
  assert.equal(empty.listingState, "unknown");
  assert.equal(isEbayLifecycleBlocking(empty), true);
  assert.equal(isEbayLifecycleRelistable(empty), false);

  const active = decideEbayLifecycleTransition(empty, {
    effectiveAt: t1,
    kind: "active",
    notificationId: "notification-active",
    remoteListingStatus: "Active",
  });
  assert.equal(active.action, "apply");
  assert.equal(active.next.listingState, "active");
  assert.equal(active.next.saleState, "none");
  assert.equal(active.next.quantitySold, 0);
  assert.equal(active.next.listingStartedAt?.toISOString(), t1.toISOString());
  assert.equal(active.blocksRelisting, true);
});

test("definitive ended-unsold state releases the Copy", () => {
  const ended = decideEbayLifecycleTransition(activeLifecycle(), {
    effectiveAt: t2,
    endingReason: "SellerEnded",
    kind: "ended_unsold",
    notificationId: "notification-ended",
    quantitySold: 0,
    remoteListingStatus: "Completed",
  });

  assert.equal(ended.action, "apply");
  assert.equal(ended.next.listingState, "ended");
  assert.equal(ended.next.saleState, "none");
  assert.equal(ended.next.quantitySold, 0);
  assert.equal(ended.next.listingEndedAt?.toISOString(), t2.toISOString());
  assert.equal(ended.relistAllowed, true);
});

test("payment-pending and paid observations remain protected", () => {
  const pending = decideEbayLifecycleTransition(activeLifecycle(), {
    effectiveAt: t2,
    kind: "payment_pending",
    notificationId: "notification-pending",
    orderId: "order-1",
    orderLineItemId: "line-1",
    quantitySold: 1,
    remoteOrderStatus: "PENDING",
  });
  assert.equal(pending.next.listingState, "ended");
  assert.equal(pending.next.saleState, "pending");
  assert.equal(pending.next.quantitySold, 1);
  assert.equal(pending.next.paymentPendingAt?.toISOString(), t2.toISOString());
  assert.equal(pending.blocksRelisting, true);

  const paid = decideEbayLifecycleTransition(pending.next, {
    effectiveAt: t3,
    kind: "paid",
    notificationId: "notification-paid",
    orderId: "order-1",
    orderLineItemId: "line-1",
    quantitySold: 1,
    remoteOrderStatus: "PAID",
    transactionId: "transaction-1",
  });
  assert.equal(paid.next.saleState, "paid");
  assert.equal(paid.next.paidAt?.toISOString(), t3.toISOString());
  assert.equal(paid.next.transactionId, "transaction-1");
  assert.equal(paid.blocksRelisting, true);
});

test("confirmed cancellation releases pending inventory but not a paid or recorded Sale", () => {
  const cancelled = decideEbayLifecycleTransition(pendingLifecycle(), {
    cancelledAt: t3,
    effectiveAt: t3,
    kind: "cancelled",
    notificationId: "notification-cancelled",
    orderId: "order-1",
    orderLineItemId: "line-1",
    remoteOrderStatus: "CANCELLED",
  });
  assert.equal(cancelled.next.saleState, "cancelled");
  assert.equal(cancelled.next.quantitySold, 0);
  assert.equal(cancelled.relistAllowed, true);

  const paid = decideEbayLifecycleTransition(pendingLifecycle(), {
    effectiveAt: t3,
    kind: "paid",
    orderId: "order-1",
    orderLineItemId: "line-1",
    quantitySold: 1,
  }).next;
  const cancellationAfterPayment = decideEbayLifecycleTransition(paid, {
    effectiveAt: new Date("2026-07-24T13:00:00.000Z"),
    kind: "cancelled",
    orderId: "order-1",
    orderLineItemId: "line-1",
  });
  assert.equal(cancellationAfterPayment.next.saleState, "needs_review");
  assert.equal(cancellationAfterPayment.blocksRelisting, true);

  const recorded = {
    ...pendingLifecycle(),
    saleRecordId: "sale-record-1",
  };
  const cancellationAfterRecord = decideEbayLifecycleTransition(recorded, {
    effectiveAt: t3,
    kind: "cancelled",
    orderId: "order-1",
    orderLineItemId: "line-1",
  });
  assert.equal(cancellationAfterRecord.next.saleState, "needs_review");
  assert.equal(cancellationAfterRecord.blocksRelisting, true);
});

test("a later pending observation cannot regress a paid parent lifecycle", () => {
  const paid = decideEbayLifecycleTransition(pendingLifecycle(), {
    effectiveAt: t3,
    kind: "paid",
    orderId: "order-1",
    orderLineItemId: "line-1",
    paidAt: t3,
    quantitySold: 1,
    transactionId: "transaction-1",
  }).next;
  const laterPending = decideEbayLifecycleTransition(paid, {
    effectiveAt: new Date("2026-07-24T13:00:00.000Z"),
    kind: "payment_pending",
    orderId: "order-1",
    orderLineItemId: "line-1",
    quantitySold: 1,
    transactionId: "transaction-1",
  });

  assert.equal(laterPending.next.saleState, "paid");
  assert.equal(laterPending.next.paidAt?.toISOString(), t3.toISOString());
  assert.equal(laterPending.blocksRelisting, true);
});

test("a matching paid observation can recover a reviewed parent lifecycle", () => {
  const reviewed = {
    ...pendingLifecycle(),
    paidAt: t3,
    saleState: "needs_review" as const,
  };
  const recovered = decideEbayLifecycleTransition(reviewed, {
    effectiveAt: new Date("2026-07-24T13:00:00.000Z"),
    kind: "paid",
    orderId: "order-1",
    orderLineItemId: "line-1",
    paidAt: t3,
    quantitySold: 1,
  });

  assert.equal(recovered.action, "apply");
  assert.equal(recovered.next.saleState, "paid");
  assert.equal(recovered.next.paidAt?.toISOString(), t3.toISOString());
  assert.equal(recovered.blocksRelisting, true);
});

test("suspended and unknown observations fail closed", () => {
  const suspended = decideEbayLifecycleTransition(activeLifecycle(), {
    effectiveAt: t2,
    endingReason: "AdminEnded",
    kind: "suspended",
    notificationId: "notification-suspended",
    remoteListingStatus: "Suspended",
  });
  assert.equal(suspended.next.listingState, "suspended");
  assert.equal(suspended.blocksRelisting, true);

  const ended = decideEbayLifecycleTransition(activeLifecycle(), {
    effectiveAt: t2,
    kind: "ended_unsold",
    quantitySold: 0,
  }).next;
  assert.equal(isEbayLifecycleRelistable(ended), true);

  const unknown = decideEbayLifecycleTransition(ended, {
    effectiveAt: t3,
    kind: "unknown",
    remoteListingStatus: "UnrecognizedValue",
  });
  assert.equal(unknown.action, "fail_closed");
  assert.equal(unknown.reason, "unknown_remote_state");
  assert.equal(unknown.next, ended);
  assert.equal(unknown.blocksRelisting, true);
});

test("duplicate and older notifications are idempotent and cannot regress state", () => {
  const active = activeLifecycle();
  const duplicate = decideEbayLifecycleTransition(active, {
    effectiveAt: t2,
    kind: "ended_unsold",
    notificationId: "notification-active",
    quantitySold: 0,
  });
  assert.equal(duplicate.action, "idempotent");
  assert.equal(duplicate.reason, "duplicate_notification");
  assert.equal(duplicate.next, active);

  const paid = decideEbayLifecycleTransition(pendingLifecycle(), {
    effectiveAt: t3,
    kind: "paid",
    orderId: "order-1",
    orderLineItemId: "line-1",
    quantitySold: 1,
  }).next;
  const staleCancellation = decideEbayLifecycleTransition(paid, {
    effectiveAt: t2,
    kind: "cancelled",
    orderId: "order-1",
    orderLineItemId: "line-1",
  });
  assert.equal(staleCancellation.action, "ignore_stale");
  assert.equal(staleCancellation.reason, "older_observation");
  assert.equal(staleCancellation.next, paid);
  assert.equal(staleCancellation.blocksRelisting, true);
});

test("same timestamp replays are idempotent and conflicting states fail closed", () => {
  const active = activeLifecycle();
  const replay = decideEbayLifecycleTransition(active, {
    effectiveAt: t1,
    kind: "active",
    notificationId: "another-delivery-id",
    remoteListingStatus: "Active",
  });
  assert.equal(replay.action, "idempotent");
  assert.equal(replay.reason, "same_state");
  assert.equal(replay.blocksRelisting, true);

  const replayWithoutNewIdentity = decideEbayLifecycleTransition(active, {
    effectiveAt: t1,
    kind: "active",
    remoteListingStatus: "Active",
  });
  assert.equal(replayWithoutNewIdentity.action, "idempotent");
  assert.equal(replayWithoutNewIdentity.reason, "same_state");

  const conflict = decideEbayLifecycleTransition(active, {
    effectiveAt: t1,
    kind: "ended_unsold",
    quantitySold: 0,
  });
  assert.equal(conflict.action, "fail_closed");
  assert.equal(conflict.reason, "same_timestamp_conflict");
  assert.equal(conflict.next, active);
});

test("invalid observations and conflicting remote identifiers fail closed", () => {
  const invalidQuantity = decideEbayLifecycleTransition(activeLifecycle(), {
    effectiveAt: t2,
    kind: "ended_unsold",
    quantitySold: 1,
  });
  assert.equal(invalidQuantity.action, "fail_closed");
  assert.equal(invalidQuantity.reason, "invalid_observation");

  const conflict = decideEbayLifecycleTransition(pendingLifecycle(), {
    effectiveAt: t3,
    kind: "paid",
    orderId: "another-order",
    orderLineItemId: "line-1",
    quantitySold: 1,
  });
  assert.equal(conflict.action, "fail_closed");
  assert.equal(conflict.reason, "conflicting_remote_identifier");
  assert.equal(conflict.blocksRelisting, true);
});

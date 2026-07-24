export const ebayListingStates = [
  "active",
  "ended",
  "suspended",
  "unknown",
] as const;

export const ebaySaleStates = [
  "none",
  "pending",
  "paid",
  "cancelled",
  "needs_review",
] as const;

export const ebayLifecycleObservationKinds = [
  "active",
  "ended_unsold",
  "payment_pending",
  "paid",
  "cancelled",
  "suspended",
  "unknown",
] as const;

export type EbayListingState = typeof ebayListingStates[number];
export type EbaySaleState = typeof ebaySaleStates[number];
export type EbayLifecycleObservationKind =
  typeof ebayLifecycleObservationKinds[number];

export type EbayListingLifecycle = {
  listingState: EbayListingState;
  saleState: EbaySaleState;
  quantitySold: number | null;
  remoteListingStatus: string | null;
  remoteOrderStatus: string | null;
  endingReason: string | null;
  listingStartedAt: Date | null;
  listingEndedAt: Date | null;
  paymentPendingAt: Date | null;
  paidAt: Date | null;
  cancelledAt: Date | null;
  orderId: string | null;
  orderLineItemId: string | null;
  transactionId: string | null;
  saleRecordId: string | null;
  lastRemoteEventAt: Date | null;
  lastNotificationId: string | null;
};

export type EbayLifecycleObservation = {
  kind: EbayLifecycleObservationKind;
  effectiveAt: Date;
  notificationId?: string | null;
  quantitySold?: number | null;
  remoteListingStatus?: string | null;
  remoteOrderStatus?: string | null;
  endingReason?: string | null;
  listingStartedAt?: Date | null;
  listingEndedAt?: Date | null;
  paymentPendingAt?: Date | null;
  paidAt?: Date | null;
  cancelledAt?: Date | null;
  orderId?: string | null;
  orderLineItemId?: string | null;
  transactionId?: string | null;
};

export type EbayLifecycleTransitionAction =
  | "apply"
  | "idempotent"
  | "ignore_stale"
  | "fail_closed";

export type EbayLifecycleTransitionReason =
  | "newer_observation"
  | "duplicate_notification"
  | "same_state"
  | "older_observation"
  | "unknown_remote_state"
  | "invalid_observation"
  | "conflicting_remote_identifier"
  | "same_timestamp_conflict";

export type EbayLifecycleTransitionDecision = {
  action: EbayLifecycleTransitionAction;
  reason: EbayLifecycleTransitionReason;
  next: EbayListingLifecycle;
  blocksRelisting: boolean;
  relistAllowed: boolean;
};

const protectedSaleStates = new Set<EbaySaleState>([
  "pending",
  "paid",
  "needs_review",
]);

export function emptyEbayListingLifecycle(): EbayListingLifecycle {
  return {
    listingState: "unknown",
    saleState: "none",
    quantitySold: null,
    remoteListingStatus: null,
    remoteOrderStatus: null,
    endingReason: null,
    listingStartedAt: null,
    listingEndedAt: null,
    paymentPendingAt: null,
    paidAt: null,
    cancelledAt: null,
    orderId: null,
    orderLineItemId: null,
    transactionId: null,
    saleRecordId: null,
    lastRemoteEventAt: null,
    lastNotificationId: null,
  };
}

export function isEbayLifecycleRelistable(state: EbayListingLifecycle) {
  return (
    state.listingState === "ended"
    && (state.saleState === "none" || state.saleState === "cancelled")
    && state.saleRecordId === null
  );
}

export function isEbayLifecycleBlocking(state: EbayListingLifecycle) {
  return !isEbayLifecycleRelistable(state);
}

function decision(
  action: EbayLifecycleTransitionAction,
  reason: EbayLifecycleTransitionReason,
  next: EbayListingLifecycle,
  forceBlocked = false,
): EbayLifecycleTransitionDecision {
  const relistAllowed = !forceBlocked && isEbayLifecycleRelistable(next);
  return {
    action,
    reason,
    next,
    blocksRelisting: !relistAllowed,
    relistAllowed,
  };
}

function validDate(value: Date | null | undefined) {
  return value == null || Number.isFinite(value.getTime());
}

function validQuantity(value: number | null | undefined) {
  return value == null || (Number.isInteger(value) && value >= 0);
}

function observationIsValid(observation: EbayLifecycleObservation) {
  if (
    !validDate(observation.effectiveAt)
    || !validDate(observation.listingStartedAt)
    || !validDate(observation.listingEndedAt)
    || !validDate(observation.paymentPendingAt)
    || !validDate(observation.paidAt)
    || !validDate(observation.cancelledAt)
    || !validQuantity(observation.quantitySold)
  ) {
    return false;
  }

  if (
    (observation.kind === "active" || observation.kind === "ended_unsold")
    && observation.quantitySold != null
    && observation.quantitySold !== 0
  ) {
    return false;
  }

  if (
    (observation.kind === "payment_pending" || observation.kind === "paid")
    && observation.quantitySold != null
    && observation.quantitySold < 1
  ) {
    return false;
  }

  return true;
}

function hasIdentifierConflict(
  current: EbayListingLifecycle,
  observation: EbayLifecycleObservation,
) {
  return ([
    ["orderId", current.orderId, observation.orderId],
    ["orderLineItemId", current.orderLineItemId, observation.orderLineItemId],
    ["transactionId", current.transactionId, observation.transactionId],
  ] as const).some(([, existing, incoming]) => (
    existing != null && incoming != null && existing !== incoming
  ));
}

function protectedSale(state: EbayListingLifecycle) {
  return state.saleRecordId !== null || protectedSaleStates.has(state.saleState);
}

function observedQuantity(
  current: EbayListingLifecycle,
  observation: EbayLifecycleObservation,
  minimum: number,
) {
  return Math.max(
    minimum,
    observation.quantitySold ?? 0,
    current.quantitySold ?? 0,
  );
}

function nextLifecycle(
  current: EbayListingLifecycle,
  observation: EbayLifecycleObservation,
): EbayListingLifecycle {
  const next: EbayListingLifecycle = {
    ...current,
    remoteListingStatus:
      observation.remoteListingStatus ?? current.remoteListingStatus,
    remoteOrderStatus:
      observation.remoteOrderStatus ?? current.remoteOrderStatus,
    endingReason: observation.endingReason ?? current.endingReason,
    listingStartedAt:
      observation.listingStartedAt ?? current.listingStartedAt,
    listingEndedAt:
      observation.listingEndedAt ?? current.listingEndedAt,
    paymentPendingAt:
      observation.paymentPendingAt ?? current.paymentPendingAt,
    paidAt: observation.paidAt ?? current.paidAt,
    cancelledAt: observation.cancelledAt ?? current.cancelledAt,
    orderId: observation.orderId ?? current.orderId,
    orderLineItemId:
      observation.orderLineItemId ?? current.orderLineItemId,
    transactionId: observation.transactionId ?? current.transactionId,
    lastRemoteEventAt: observation.effectiveAt,
    lastNotificationId:
      observation.notificationId ?? current.lastNotificationId,
  };

  switch (observation.kind) {
    case "active": {
      next.listingState = "active";
      next.listingStartedAt ??= observation.effectiveAt;
      if (!protectedSale(current)) {
        next.saleState = "none";
        next.quantitySold = 0;
      }
      return next;
    }
    case "ended_unsold": {
      next.listingState = "ended";
      next.listingEndedAt ??= observation.effectiveAt;
      if (protectedSale(current)) {
        next.saleState = "needs_review";
      } else {
        next.saleState = current.saleState === "cancelled" ? "cancelled" : "none";
        next.quantitySold = 0;
      }
      return next;
    }
    case "payment_pending": {
      next.listingState = "ended";
      next.listingEndedAt ??= observation.effectiveAt;
      next.paymentPendingAt ??= observation.effectiveAt;
      next.quantitySold = observedQuantity(current, observation, 1);
      if (current.saleState !== "paid" && current.saleState !== "needs_review") {
        next.saleState = current.saleRecordId ? "needs_review" : "pending";
      }
      return next;
    }
    case "paid": {
      next.listingState = "ended";
      next.listingEndedAt ??= observation.effectiveAt;
      next.paidAt ??= observation.effectiveAt;
      next.quantitySold = observedQuantity(current, observation, 1);
      next.saleState = "paid";
      return next;
    }
    case "cancelled": {
      next.listingState = "ended";
      next.listingEndedAt ??= observation.effectiveAt;
      next.cancelledAt ??= observation.effectiveAt;
      if (current.saleState === "paid" || current.saleRecordId) {
        next.saleState = "needs_review";
        next.quantitySold = current.quantitySold;
      } else {
        next.saleState = "cancelled";
        next.quantitySold = 0;
      }
      return next;
    }
    case "suspended": {
      next.listingState = "suspended";
      return next;
    }
    case "unknown":
      return next;
  }
}

function dateValue(value: Date | null) {
  return value?.getTime() ?? null;
}

function sameLifecycle(left: EbayListingLifecycle, right: EbayListingLifecycle) {
  return (
    left.listingState === right.listingState
    && left.saleState === right.saleState
    && left.quantitySold === right.quantitySold
    && left.remoteListingStatus === right.remoteListingStatus
    && left.remoteOrderStatus === right.remoteOrderStatus
    && left.endingReason === right.endingReason
    && dateValue(left.listingStartedAt) === dateValue(right.listingStartedAt)
    && dateValue(left.listingEndedAt) === dateValue(right.listingEndedAt)
    && dateValue(left.paymentPendingAt) === dateValue(right.paymentPendingAt)
    && dateValue(left.paidAt) === dateValue(right.paidAt)
    && dateValue(left.cancelledAt) === dateValue(right.cancelledAt)
    && left.orderId === right.orderId
    && left.orderLineItemId === right.orderLineItemId
    && left.transactionId === right.transactionId
    && left.saleRecordId === right.saleRecordId
    && dateValue(left.lastRemoteEventAt) === dateValue(right.lastRemoteEventAt)
  );
}

/**
 * Pure lifecycle transition policy shared by webhook, interaction, and repair
 * reconciliation. Unknown/invalid/conflicting observations never release a
 * Copy. Older events cannot regress newer authoritative state, while duplicate
 * notification IDs are idempotent.
 */
export function decideEbayLifecycleTransition(
  current: EbayListingLifecycle,
  observation: EbayLifecycleObservation,
): EbayLifecycleTransitionDecision {
  if (observation.kind === "unknown") {
    return decision("fail_closed", "unknown_remote_state", current, true);
  }

  if (
    observation.notificationId
    && observation.notificationId === current.lastNotificationId
  ) {
    return decision("idempotent", "duplicate_notification", current);
  }

  if (!observationIsValid(observation)) {
    return decision("fail_closed", "invalid_observation", current, true);
  }

  if (hasIdentifierConflict(current, observation)) {
    return decision(
      "fail_closed",
      "conflicting_remote_identifier",
      current,
      true,
    );
  }

  const currentEventTime = current.lastRemoteEventAt?.getTime();
  const observationTime = observation.effectiveAt.getTime();
  if (currentEventTime !== undefined && observationTime < currentEventTime) {
    return decision("ignore_stale", "older_observation", current);
  }

  const next = nextLifecycle(current, observation);
  if (currentEventTime === observationTime) {
    if (sameLifecycle(current, next)) {
      return decision("idempotent", "same_state", current);
    }
    return decision("fail_closed", "same_timestamp_conflict", current, true);
  }

  if (sameLifecycle(current, next)) {
    return decision("idempotent", "same_state", current);
  }

  return decision("apply", "newer_observation", next);
}

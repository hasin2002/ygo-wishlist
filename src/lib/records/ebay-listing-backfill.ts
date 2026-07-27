export type EbayPaymentState =
  | "pending"
  | "paid"
  | "cancelled"
  | "needs_review";

export type LegacyEbayListingForBackfill = {
  id: string;
  ownerId: string | null;
  copyId: string | null;
  status: "active" | "ended" | null;
  listingState: "active" | "ended" | "suspended" | "unknown" | null;
  saleState: "none" | EbayPaymentState | null;
  orderId: string | null;
  orderLineItemId: string | null;
  transactionId: string | null;
  saleRecordId: string | null;
  quantitySold: number | null;
  remoteOrderStatus: string | null;
  paymentPendingAt: Date | null;
  paidAt: Date | null;
  cancelledAt: Date | null;
  lastRemoteEventAt: Date | null;
};

export type EbayListingBackfillAnomalyCategory =
  | "missing_copy"
  | "owner_copy_mismatch"
  | "owner_sale_mismatch"
  | "sale_copy_mismatch"
  | "staged_row_mismatch"
  | "insufficient_ids"
  | "insufficient_quantity"
  | "missing_lifecycle_timestamp"
  | "duplicate_logical_line"
  | "active_allocation_conflict"
  | "quantity_exceeds_known_copy";

export type EbayListingBackfillAnomaly = {
  category: EbayListingBackfillAnomalyCategory;
  listingId: string;
  blocking: boolean;
  message: string;
};

export type EbayListingMemberProjection = {
  listingId: string;
  ownerId: string;
  copyId: string;
  fulfilmentPosition: 0;
  kind: "individual";
  action: "create" | "reuse" | "skip";
};

export type EbayOrderLineProjection = {
  key: string;
  ownerId: string;
  listingId: string;
  orderId: string | null;
  orderLineItemId: string | null;
  transactionId: string | null;
  quantityPurchased: 1;
  paymentState: EbayPaymentState;
  remoteOrderStatus: string | null;
  paymentPendingAt: Date | null;
  paidAt: Date | null;
  cancelledAt: Date | null;
  lastRemoteEventAt: Date | null;
  saleRecordId: string | null;
  action: "create" | "reuse";
};

export type EbayOrderLineAllocationProjection = {
  listingId: string;
  ownerId: string;
  copyId: string;
  orderLineKey: string;
  fulfilmentPosition: 0;
  allocatedAt: Date;
  releasedAt: Date | null;
  releaseReason: "cancelled" | null;
  action: "create" | "reuse" | "skip";
};

export type EbayListingBackfillPlan = {
  members: EbayListingMemberProjection[];
  orderLines: EbayOrderLineProjection[];
  allocations: EbayOrderLineAllocationProjection[];
  anomalies: EbayListingBackfillAnomaly[];
  counts: {
    listings: number;
    active: number;
    ended: number;
    pending: number;
    paid: number;
    cancelled: number;
    saleLinked: number;
    members: ActionCounts;
    orderLines: ActionCounts;
    allocations: ActionCounts;
  };
  safeToApply: boolean;
  writes: 0;
};

type ActionCounts = { create: number; reuse: number; skip: number };
type ExistingMember = {
  id?: string;
  ownerId: string;
  listingId: string;
  copyId: string;
  fulfilmentPosition: number;
  active?: boolean;
};
type ExistingOrderLine = Omit<
  EbayOrderLineProjection,
  "key" | "action"
> & { id?: string };
type ExistingAllocation = {
  id?: string;
  ownerId: string;
  listingId: string;
  listingMemberId?: string;
  orderLineId?: string;
  copyId: string;
  orderLineKey: string;
  fulfilmentPosition: number;
  allocatedAt: Date;
  releasedAt: Date | null;
  releaseReason: string | null;
};

export type EbayListingBackfillInputs = {
  listings: LegacyEbayListingForBackfill[];
  copyOwnerById: ReadonlyMap<string, string>;
  saleOwnerById: ReadonlyMap<string, string>;
  saleCopyIdsByOwnerRecord: ReadonlyMap<string, ReadonlySet<string>>;
  existingMembers?: ExistingMember[];
  existingOrderLines?: ExistingOrderLine[];
  existingAllocations?: ExistingAllocation[];
};

function nonBlank(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function paymentStateFor(listing: LegacyEbayListingForBackfill) {
  if (
    listing.saleState === "pending"
    || listing.saleState === "paid"
    || listing.saleState === "cancelled"
    || listing.saleState === "needs_review"
  ) {
    return listing.saleState;
  }
  return nonBlank(listing.saleRecordId) ? "paid" : null;
}

function activeExposure(listing: LegacyEbayListingForBackfill) {
  return listing.status === "active" || listing.listingState === "active";
}

function counters(): ActionCounts {
  return { create: 0, reuse: 0, skip: 0 };
}

function sameDate(left: Date | null, right: Date | null) {
  return left?.getTime() === right?.getTime();
}

function stagedOrderLineMatches(
  staged: ExistingOrderLine,
  expected: EbayOrderLineProjection,
) {
  return (
    staged.ownerId === expected.ownerId
    && staged.listingId === expected.listingId
    && staged.orderId === expected.orderId
    && staged.orderLineItemId === expected.orderLineItemId
    && staged.transactionId === expected.transactionId
    && staged.quantityPurchased === expected.quantityPurchased
    && staged.paymentState === expected.paymentState
    && staged.remoteOrderStatus === expected.remoteOrderStatus
    && sameDate(staged.paymentPendingAt, expected.paymentPendingAt)
    && sameDate(staged.paidAt, expected.paidAt)
    && sameDate(staged.cancelledAt, expected.cancelledAt)
    && sameDate(staged.lastRemoteEventAt, expected.lastRemoteEventAt)
    && staged.saleRecordId === expected.saleRecordId
  );
}

/** Stable internal identity. Callers must anonymize it before reporting. */
export function ebayOrderLineBackfillKey({
  ownerId,
  orderId,
  orderLineItemId,
  transactionId,
}: Pick<
  EbayOrderLineProjection,
  "ownerId" | "orderId" | "orderLineItemId" | "transactionId"
>) {
  const order = nonBlank(orderId);
  const line = nonBlank(orderLineItemId);
  const transaction = nonBlank(transactionId);
  if (order && line) return `order:${ownerId}\u0000${order}\u0000${line}`;
  if (transaction) return `transaction:${ownerId}\u0000${transaction}`;
  return null;
}

function allocationTimestamp(
  listing: LegacyEbayListingForBackfill,
  paymentState: EbayPaymentState,
) {
  if (paymentState === "cancelled") {
    return listing.paymentPendingAt
      ?? listing.cancelledAt
      ?? listing.lastRemoteEventAt;
  }
  return listing.paymentPendingAt
    ?? listing.paidAt
    ?? listing.lastRemoteEventAt;
}

/**
 * Produces the exact additive migration plan without writing or reconstructing
 * missing order quantities, timestamps, Copies, or Sale ownership.
 */
export function planEbayListingCompositionBackfill(
  inputs: EbayListingBackfillInputs,
): EbayListingBackfillPlan {
  const existingMemberByListing = new Map(
    (inputs.existingMembers ?? []).map((member) => [member.listingId, member]),
  );
  const existingOrderLineByKey = new Map(
    (inputs.existingOrderLines ?? []).flatMap((line) => {
      const key = ebayOrderLineBackfillKey(line);
      return key ? [[key, line] as const] : [];
    }),
  );
  const existingAllocationByKey = new Map<string, ExistingAllocation>(
    (inputs.existingAllocations ?? []).map(
      (allocation) =>
        [
          `${allocation.listingId}\u0000${allocation.copyId}\u0000${allocation.orderLineKey}`,
          allocation,
        ] as const,
    ),
  );
  const members = new Map<string, EbayListingMemberProjection>();
  const orderLines = new Map<string, EbayOrderLineProjection>();
  const allocations = new Map<string, EbayOrderLineAllocationProjection>();
  const anomalies: EbayListingBackfillAnomaly[] = [];
  const activeCopyListings = new Map<string, string>();

  for (const member of inputs.existingMembers ?? []) {
    if (member.active) activeCopyListings.set(member.copyId, member.listingId);
  }

  function anomaly(
    listing: LegacyEbayListingForBackfill,
    category: EbayListingBackfillAnomalyCategory,
    message: string,
  ) {
    anomalies.push({ listingId: listing.id, category, blocking: true, message });
  }

  for (const listing of inputs.listings) {
    const ownerId = nonBlank(listing.ownerId);
    const copyId = nonBlank(listing.copyId);
    if (!ownerId || !copyId || !inputs.copyOwnerById.has(copyId)) {
      anomaly(
        listing,
        "missing_copy",
        "The legacy Listing has no known physical Copy.",
      );
      continue;
    }
    if (inputs.copyOwnerById.get(copyId) !== ownerId) {
      anomaly(
        listing,
        "owner_copy_mismatch",
        "The legacy Listing and Copy belong to different owners.",
      );
      continue;
    }

    const existingMember = existingMemberByListing.get(listing.id);
    let memberAction: EbayListingMemberProjection["action"] =
      existingMember ? "reuse" : "create";
    if (
      existingMember
      && (
        existingMember.ownerId !== ownerId
        || existingMember.copyId !== copyId
        || existingMember.fulfilmentPosition !== 0
      )
    ) {
      anomaly(
        listing,
        "staged_row_mismatch",
        "The staged Listing member does not preserve the legacy position-zero Copy.",
      );
      memberAction = "skip";
    }
    const activeListingId = activeCopyListings.get(copyId);
    if (
      activeExposure(listing)
      && activeListingId
      && activeListingId !== listing.id
    ) {
      anomaly(
        listing,
        "active_allocation_conflict",
        "This Copy is already exposed by another active Listing.",
      );
      memberAction = "skip";
    }
    if (activeExposure(listing) && memberAction !== "skip") {
      activeCopyListings.set(copyId, listing.id);
    }
    members.set(listing.id, {
      listingId: listing.id,
      ownerId,
      copyId,
      fulfilmentPosition: 0,
      kind: "individual",
      action: memberAction,
    });

    if (listing.quantitySold !== null && listing.quantitySold > 1) {
      anomaly(
        listing,
        "quantity_exceeds_known_copy",
        "More than one unit was sold but the legacy Listing identifies only one Copy.",
      );
    }

    const saleRecordId = nonBlank(listing.saleRecordId);
    const saleOwnerMatches =
      saleRecordId && inputs.saleOwnerById.get(saleRecordId) === ownerId;
    const saleContainsCopy =
      saleRecordId
      && inputs.saleCopyIdsByOwnerRecord
        .get(`${ownerId}\u0000${saleRecordId}`)
        ?.has(copyId) === true;
    const safeSaleRecordId =
      saleRecordId && saleOwnerMatches && saleContainsCopy
        ? saleRecordId
        : null;
    if (saleRecordId && !saleOwnerMatches) {
      anomaly(
        listing,
        "owner_sale_mismatch",
        "The legacy Sale link is missing or belongs to another owner.",
      );
    } else if (saleRecordId && !saleContainsCopy) {
      anomaly(
        listing,
        "sale_copy_mismatch",
        "The linked Sale does not contain this legacy Copy.",
      );
    }

    const paymentState = paymentStateFor(listing);
    if (!paymentState) continue;
    if (
      paymentState !== "cancelled"
      && listing.quantitySold !== 1
      && !safeSaleRecordId
    ) {
      anomaly(
        listing,
        "insufficient_quantity",
        "The protected order does not prove that its one known Copy was purchased.",
      );
    }

    const orderLineKey = ebayOrderLineBackfillKey({
      ownerId,
      orderId: listing.orderId,
      orderLineItemId: listing.orderLineItemId,
      transactionId: listing.transactionId,
    });
    if (!orderLineKey) {
      anomaly(
        listing,
        "insufficient_ids",
        "No complete order-line pair or transaction identifier is available.",
      );
      continue;
    }

    const priorLine = orderLines.get(orderLineKey);
    const stagedLine = existingOrderLineByKey.get(orderLineKey);
    if (
      (priorLine && priorLine.listingId !== listing.id)
      || (stagedLine && stagedLine.listingId !== listing.id)
    ) {
      anomaly(
        listing,
        "duplicate_logical_line",
        "The same logical eBay order line appears on a different legacy Listing.",
      );
      continue;
    }

    if (!priorLine) {
      const expectedLine: EbayOrderLineProjection = {
        key: orderLineKey,
        ownerId,
        listingId: listing.id,
        orderId: nonBlank(listing.orderId),
        orderLineItemId: nonBlank(listing.orderLineItemId),
        transactionId: nonBlank(listing.transactionId),
        quantityPurchased: 1,
        paymentState,
        remoteOrderStatus: listing.remoteOrderStatus,
        paymentPendingAt: listing.paymentPendingAt,
        paidAt: listing.paidAt,
        cancelledAt: listing.cancelledAt,
        lastRemoteEventAt: listing.lastRemoteEventAt,
        saleRecordId: safeSaleRecordId,
        action: stagedLine ? "reuse" : "create",
      };
      if (stagedLine && !stagedOrderLineMatches(stagedLine, expectedLine)) {
        anomaly(
          listing,
          "staged_row_mismatch",
          "The staged order line does not exactly match the legacy payment history.",
        );
      }
      orderLines.set(orderLineKey, expectedLine);
    }

    const allocatedAt = allocationTimestamp(listing, paymentState);
    const releasedAt =
      paymentState === "cancelled"
        ? listing.cancelledAt ?? listing.lastRemoteEventAt
        : null;
    if (!allocatedAt || (paymentState === "cancelled" && !releasedAt)) {
      anomaly(
        listing,
        "missing_lifecycle_timestamp",
        "The allocation lifecycle has no authoritative remote timestamp.",
      );
      continue;
    }
    const allocationKey =
      `${listing.id}\u0000${copyId}\u0000${orderLineKey}`;
    const stagedAllocation = existingAllocationByKey.get(allocationKey);
    const expectedAllocation: EbayOrderLineAllocationProjection = {
      listingId: listing.id,
      ownerId,
      copyId,
      orderLineKey,
      fulfilmentPosition: 0,
      allocatedAt,
      releasedAt,
      releaseReason: paymentState === "cancelled" ? "cancelled" : null,
      action:
        memberAction === "skip"
        || (saleRecordId !== null && safeSaleRecordId === null)
          ? "skip"
          : stagedAllocation
            ? "reuse"
            : "create",
    };
    if (
      stagedAllocation
      && (
        stagedAllocation.ownerId !== expectedAllocation.ownerId
        || stagedAllocation.listingId !== expectedAllocation.listingId
        || stagedAllocation.copyId !== expectedAllocation.copyId
        || stagedAllocation.orderLineKey
          !== expectedAllocation.orderLineKey
        || stagedAllocation.fulfilmentPosition
          !== expectedAllocation.fulfilmentPosition
        || !sameDate(
          stagedAllocation.allocatedAt,
          expectedAllocation.allocatedAt,
        )
        || !sameDate(
          stagedAllocation.releasedAt,
          expectedAllocation.releasedAt,
        )
        || stagedAllocation.releaseReason
          !== expectedAllocation.releaseReason
        || (
          existingMember?.id !== undefined
          && stagedAllocation.listingMemberId !== existingMember.id
        )
        || (
          stagedLine?.id !== undefined
          && stagedAllocation.orderLineId !== stagedLine.id
        )
      )
    ) {
      anomaly(
        listing,
        "staged_row_mismatch",
        "The staged allocation does not exactly match its member, order line, or lifecycle.",
      );
    }
    allocations.set(allocationKey, expectedAllocation);
  }

  const memberCounts = counters();
  const orderLineCounts = counters();
  const allocationCounts = counters();
  for (const member of members.values()) memberCounts[member.action] += 1;
  for (const line of orderLines.values()) orderLineCounts[line.action] += 1;
  for (const allocation of allocations.values()) {
    allocationCounts[allocation.action] += 1;
  }

  return {
    members: [...members.values()],
    orderLines: [...orderLines.values()],
    allocations: [...allocations.values()],
    anomalies,
    counts: {
      listings: inputs.listings.length,
      active: inputs.listings.filter(activeExposure).length,
      ended: inputs.listings.filter((listing) => !activeExposure(listing)).length,
      pending: inputs.listings.filter(
        (listing) => listing.saleState === "pending",
      ).length,
      paid: inputs.listings.filter(
        (listing) => listing.saleState === "paid",
      ).length,
      cancelled: inputs.listings.filter(
        (listing) => listing.saleState === "cancelled",
      ).length,
      saleLinked: inputs.listings.filter(
        (listing) => nonBlank(listing.saleRecordId) !== null,
      ).length,
      members: memberCounts,
      orderLines: orderLineCounts,
      allocations: allocationCounts,
    },
    safeToApply: !anomalies.some((entry) => entry.blocking),
    writes: 0,
  };
}

export function assertEbayListingBackfillApplySafe(
  plan: EbayListingBackfillPlan,
) {
  if (
    !plan.safeToApply
    || plan.members.some((member) => member.action === "skip")
    || plan.allocations.some((allocation) => allocation.action === "skip")
  ) {
    throw new Error(
      "The eBay Listing composition backfill has blocking anomalies.",
    );
  }
}

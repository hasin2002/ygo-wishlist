import "server-only";

import {
  and,
  asc,
  eq,
  gte,
  isNull,
  lte,
  or,
} from "drizzle-orm";
import { db } from "@/db";
import {
  cardCopies,
  ebayListings,
  ebayListingMembers,
  ebayOrderLineAllocations,
  ebayOrderLines,
  type EbayListingRow,
} from "@/db/schema";
import {
  decideEbayLifecycleTransition,
  isEbayLifecycleRelistable,
  type EbayLifecycleObservation,
  type EbayListingLifecycle,
} from "@/lib/records/ebay-listing-lifecycle";
import {
  ebayListingReviewMessage,
  preferredEbayCompositionReviewReason,
  type EbayCompositionReviewReason,
} from "@/lib/records/ebay-listing-reconciliation-reason";
import {
  hasEbayOrderLineTerminalRegression,
  type EbayOrderLinePaymentState,
} from "@/lib/records/ebay-order-line-reconciliation";
import {
  getLatestEbayListingForCopyMembershipFirst,
  hasEbayCompositionSchema,
  legacySafeEbayListingSelection,
} from "@/server/ebay-listing-composition";
import { EbayAuthorizationError, EbayTemporaryError } from "@/server/ebay-seller";
import {
  EbayTradingError,
  getEbayRemoteListing,
  type EbayRemoteListing,
  type EbayRemoteTransaction,
} from "@/server/ebay-trading";

export class EbayListingReconciliationError extends Error {
  constructor(
    message: string,
    readonly reconnectRequired = false,
  ) {
    super(message);
  }
}

function lifecycleFromRow(row: EbayListingRow): EbayListingLifecycle {
  return {
    cancelledAt: row.cancelledAt,
    endingReason: row.endingReason,
    lastNotificationId: row.lastNotificationId,
    lastRemoteEventAt: row.lastRemoteEventAt,
    listingEndedAt: row.listingEndedAt,
    listingStartedAt: row.listingStartedAt,
    listingState: row.listingState,
    orderId: row.orderId,
    orderLineItemId: row.orderLineItemId,
    paidAt: row.paidAt,
    paymentPendingAt: row.paymentPendingAt,
    quantitySold: row.quantitySold,
    remoteListingStatus: row.remoteListingStatus,
    remoteOrderStatus: row.remoteOrderStatus,
    saleRecordId: row.saleRecordId,
    saleState: row.saleState,
    transactionId: row.transactionId,
  };
}

function transactionDate(transaction: EbayRemoteTransaction) {
  return transaction.paidAt?.getTime() ?? 0;
}

function mostRelevantTransaction(transactions: EbayRemoteTransaction[]) {
  return [...transactions].sort((left, right) => {
    if (left.paid !== right.paid) return left.paid ? -1 : 1;
    if (left.cancelled !== right.cancelled) return left.cancelled ? 1 : -1;
    return transactionDate(right) - transactionDate(left);
  })[0] ?? null;
}

function remoteOrderStatus(transaction: EbayRemoteTransaction | null) {
  if (!transaction) return null;
  if (transaction.cancelled) return "Cancelled";
  if (transaction.paid) return "Paid";
  return transaction.checkoutStatus
    ?? transaction.completeStatus
    ?? transaction.ebayPaymentStatus
    ?? "Pending";
}

export function ebayObservationFromRemote(
  remote: EbayRemoteListing,
  {
    effectiveAt = new Date(),
    notificationId = null,
  }: {
    effectiveAt?: Date;
    notificationId?: string | null;
  } = {},
): EbayLifecycleObservation {
  const listingStatus = remote.listingStatus?.toLowerCase() ?? "";
  const transaction = mostRelevantTransaction(remote.transactions);
  const base = {
    effectiveAt,
    endingReason: remote.endingReason,
    listingEndedAt: remote.endedAt,
    notificationId,
    orderId: transaction?.orderId,
    orderLineItemId: transaction?.orderLineItemId,
    quantitySold: remote.quantitySold,
    remoteListingStatus: remote.listingStatus,
    remoteOrderStatus: remoteOrderStatus(transaction),
    transactionId: transaction?.transactionId,
  } satisfies Omit<EbayLifecycleObservation, "kind">;

  if (remote.adminEnded || remote.listingOnHold || listingStatus.includes("suspend")) {
    return { ...base, kind: "suspended" };
  }
  if (transaction?.paid) {
    return {
      ...base,
      kind: "paid",
      paidAt: transaction.paidAt ?? effectiveAt,
    };
  }
  if (
    remote.transactions.length > 0
    && remote.transactions.every((candidate) => candidate.cancelled)
  ) {
    return {
      ...base,
      cancelledAt: effectiveAt,
      kind: "cancelled",
      quantitySold: 0,
    };
  }
  if (remote.quantitySold > 0 || remote.transactions.some((candidate) => !candidate.cancelled)) {
    return {
      ...base,
      kind: "payment_pending",
      paymentPendingAt: effectiveAt,
    };
  }
  if (listingStatus === "active") {
    return { ...base, kind: "active", quantitySold: 0 };
  }
  if (listingStatus === "ended" || listingStatus === "completed") {
    return {
      ...base,
      kind: "ended_unsold",
      quantitySold: 0,
    };
  }
  return { ...base, kind: "unknown" };
}

function retryDelayMilliseconds(retryCount: number) {
  if (retryCount <= 1) return 5 * 60 * 1_000;
  if (retryCount === 2) return 15 * 60 * 1_000;
  return 60 * 60 * 1_000;
}

function reconciliationError(error: unknown) {
  if (error instanceof EbayAuthorizationError) {
    return new EbayListingReconciliationError(
      "Reconnect eBay to refresh this listing status.",
      true,
    );
  }
  if (error instanceof EbayTemporaryError) {
    return new EbayListingReconciliationError(
      "eBay could not be reached to refresh this listing status. Try again shortly.",
    );
  }
  if (error instanceof EbayTradingError) {
    return new EbayListingReconciliationError(
      error.message || "eBay could not confirm this listing status.",
    );
  }
  return new EbayListingReconciliationError(
    "eBay could not confirm this listing status. Try again shortly.",
  );
}

export function ebayListingStatusSummary(row: EbayListingRow) {
  return {
    cancelledAt: row.cancelledAt,
    copyId: row.copyId,
    endingReason: row.endingReason,
    itemId: row.itemId,
    lastError: row.lastError,
    lastErrorAt: row.lastErrorAt,
    lastSyncAttemptAt: row.lastSyncAttemptAt,
    lastSyncedAt: row.lastSyncedAt,
    listingEndedAt: row.listingEndedAt,
    listingStartedAt: row.listingStartedAt,
    listingState: row.listingState,
    listingUrl: row.listingUrl,
    orderId: row.orderId,
    paidAt: row.paidAt,
    paymentPendingAt: row.paymentPendingAt,
    quantitySold: row.quantitySold,
    relistAllowed: isEbayLifecycleRelistable(lifecycleFromRow(row)),
    saleRecordId: row.saleRecordId,
    saleState: row.saleState,
    title: row.title,
    updatedAt: row.updatedAt,
  };
}

export async function getLatestEbayListingForCopy(ownerId: string, copyId: string) {
  return getLatestEbayListingForCopyMembershipFirst(ownerId, copyId);
}

function parentObservationWithoutConflictingOrderLine(
  current: EbayListingRow,
  observation: EbayLifecycleObservation,
): EbayLifecycleObservation {
  const identifiersConflict = [
    [current.orderId, observation.orderId],
    [current.orderLineItemId, observation.orderLineItemId],
    [current.transactionId, observation.transactionId],
  ].some(([existing, incoming]) => existing != null && incoming != null && existing !== incoming);
  if (!identifiersConflict) return observation;

  // A quantity listing can have several legitimate order lines. The legacy
  // parent row retains its first compatibility identifiers while normalized
  // order lines retain every remote line.
  return {
    ...observation,
    orderId: undefined,
    orderLineItemId: undefined,
    transactionId: undefined,
  };
}

function paymentStateForRemoteTransaction(
  transaction: EbayRemoteTransaction,
): "pending" | "paid" | "cancelled" {
  if (transaction.cancelled) return "cancelled" as const;
  if (transaction.paid) return "paid" as const;
  return "pending" as const;
}

async function persistRemoteOrderLines({
  listingId,
  ownerId,
  remote,
  timestamp,
  tx,
  enabled,
}: {
  enabled: boolean;
  listingId: string;
  ownerId: string;
  remote: EbayRemoteListing;
  timestamp: Date;
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0];
}) {
  if (!enabled) return { failureReasons: [] as EbayCompositionReviewReason[] };
  const failureReasons = new Set<EbayCompositionReviewReason>();
  const members = await tx
      .select()
      .from(ebayListingMembers)
      .where(and(
        eq(ebayListingMembers.ownerId, ownerId),
        eq(ebayListingMembers.listingId, listingId),
      ))
      .orderBy(asc(ebayListingMembers.fulfilmentPosition));

  for (const transaction of remote.transactions) {
      if (!transaction.orderLineItemId && !transaction.transactionId) continue;
      const existingRows = await tx
        .select()
        .from(ebayOrderLines)
        .where(and(
          eq(ebayOrderLines.ownerId, ownerId),
          or(
            transaction.orderLineItemId && transaction.orderId
              ? and(
                eq(ebayOrderLines.orderId, transaction.orderId),
                eq(ebayOrderLines.orderLineItemId, transaction.orderLineItemId),
              )
              : undefined,
            transaction.transactionId
              ? eq(ebayOrderLines.transactionId, transaction.transactionId)
              : undefined,
          ),
        ))
        .limit(2);
      const existing = existingRows[0];
      const observedState = paymentStateForRemoteTransaction(transaction);
      let state: EbayOrderLinePaymentState = observedState;
      const identifiersChanged = Boolean(existing && (
        (existing.orderId && transaction.orderId && existing.orderId !== transaction.orderId)
        || (
          existing.orderLineItemId
          && transaction.orderLineItemId
          && existing.orderLineItemId !== transaction.orderLineItemId
        )
        || (
          existing.transactionId
          && transaction.transactionId
          && existing.transactionId !== transaction.transactionId
        )
      ));
      const terminalRegression = hasEbayOrderLineTerminalRegression(
        existing,
        observedState,
      );
      const quantityChanged = Boolean(
        existing && existing.quantityPurchased !== transaction.quantityPurchased,
      );
      if (
        existingRows.length > 1
        || existing?.listingId !== undefined && existing.listingId !== listingId
        || identifiersChanged
        || terminalRegression
        || quantityChanged
      ) {
        state = "needs_review";
        if (
          existingRows.length > 1
          || existing?.listingId !== undefined && existing.listingId !== listingId
          || identifiersChanged
        ) {
          failureReasons.add("order_line_identity_conflict");
        }
        if (terminalRegression) failureReasons.add("order_line_terminal_regression");
        if (quantityChanged) failureReasons.add("order_line_quantity_conflict");
      }
      const values = {
        cancelledAt: state === "cancelled"
          ? existing?.cancelledAt ?? timestamp
          : existing?.cancelledAt ?? null,
        lastRemoteEventAt: timestamp,
        needsReviewAt: state === "needs_review"
          ? existing?.needsReviewAt ?? timestamp
          : null,
        orderId: existing?.orderId ?? transaction.orderId,
        orderLineItemId: existing?.orderLineItemId ?? transaction.orderLineItemId,
        paidAt: existing?.paidAt
          ?? (state === "paid" ? transaction.paidAt ?? timestamp : null),
        paymentPendingAt: existing?.paymentPendingAt
          ?? (state === "pending" ? timestamp : null),
        paymentState: state,
        quantityPurchased: existing?.quantityPurchased
          ?? Math.max(1, transaction.quantityPurchased),
        remoteOrderStatus: remoteOrderStatus(transaction),
        transactionId: existing?.transactionId ?? transaction.transactionId,
        updatedAt: timestamp,
      };
      const orderLineId = existing?.id ?? `ebay-order-line-${crypto.randomUUID()}`;
      if (existing) {
        await tx.update(ebayOrderLines).set(values).where(and(
          eq(ebayOrderLines.id, existing.id),
          eq(ebayOrderLines.ownerId, ownerId),
        ));
      } else {
        await tx.insert(ebayOrderLines).values({
          ...values,
          createdAt: timestamp,
          id: orderLineId,
          listingId,
          ownerId,
        });
      }

      if (state === "cancelled") {
        await tx.update(ebayOrderLineAllocations).set({
          releasedAt: timestamp,
          releaseReason: "eBay order line cancelled",
          updatedAt: timestamp,
        }).where(and(
          eq(ebayOrderLineAllocations.ownerId, ownerId),
          eq(ebayOrderLineAllocations.orderLineId, orderLineId),
          isNull(ebayOrderLineAllocations.releasedAt),
        ));
        continue;
      }

      // #15 preserves the existing one-Copy behaviour only. Quantity and
      // bundle fulfilment rules are owned by later tickets.
      if (state === "needs_review" || members.length !== 1 || transaction.quantityPurchased !== 1) {
        if (state === "needs_review") failureReasons.add("paid_order_needs_review");
        if (members.length === 0) failureReasons.add("missing_listing_member");
        if (members.length > 1) failureReasons.add("multiple_listing_members");
        if (transaction.quantityPurchased !== 1) failureReasons.add("non_single_order_quantity");
        if (state !== "needs_review") {
          await tx.update(ebayOrderLines).set({
            needsReviewAt: timestamp,
            paymentState: "needs_review",
            updatedAt: timestamp,
          }).where(and(
            eq(ebayOrderLines.id, orderLineId),
            eq(ebayOrderLines.ownerId, ownerId),
          ));
        }
        continue;
      }
      const member = members[0]!;
      const [copy] = await tx.select({
        id: cardCopies.id,
        soldRecordId: cardCopies.soldRecordId,
        status: cardCopies.status,
      }).from(cardCopies).where(and(
        eq(cardCopies.ownerId, ownerId),
        eq(cardCopies.id, member.copyId),
      )).for("update").limit(1);
      const [openAllocation] = await tx.select({
        id: ebayOrderLineAllocations.id,
        listingId: ebayOrderLineAllocations.listingId,
        listingMemberId: ebayOrderLineAllocations.listingMemberId,
        orderLineId: ebayOrderLineAllocations.orderLineId,
      })
        .from(ebayOrderLineAllocations)
        .where(and(
          eq(ebayOrderLineAllocations.ownerId, ownerId),
          eq(ebayOrderLineAllocations.copyId, member.copyId),
          isNull(ebayOrderLineAllocations.releasedAt),
        ))
        .limit(1);
      const allocationConflict = Boolean(
        !copy
        || (
          (
            copy.status !== "available"
            || copy.soldRecordId
          )
          && !(
            copy.status === "sold"
            && existing?.saleRecordId
            && copy.soldRecordId === existing.saleRecordId
            && openAllocation?.orderLineId === orderLineId
            && openAllocation.listingId === listingId
            && openAllocation.listingMemberId === member.id
          )
        )
        || (
          openAllocation
          && (
            openAllocation.orderLineId !== orderLineId
            || openAllocation.listingId !== listingId
            || openAllocation.listingMemberId !== member.id
          )
        ),
      );
      if (allocationConflict) {
        failureReasons.add("copy_allocation_conflict");
        await tx.update(ebayOrderLines).set({
          needsReviewAt: timestamp,
          paymentState: "needs_review",
          updatedAt: timestamp,
        }).where(and(
          eq(ebayOrderLines.id, orderLineId),
          eq(ebayOrderLines.ownerId, ownerId),
        ));
      } else if (!openAllocation) {
        await tx.insert(ebayOrderLineAllocations).values({
          allocatedAt: timestamp,
          copyId: member.copyId,
          createdAt: timestamp,
          fulfilmentPosition: 0,
          id: `ebay-order-line-allocation-${crypto.randomUUID()}`,
          listingId,
          listingMemberId: member.id,
          orderLineId,
          ownerId,
          updatedAt: timestamp,
        });
      }
  }
  return { failureReasons: [...failureReasons] };
}

export async function reconcileEbayListing({
  effectiveAt,
  listingId,
  notificationId,
  ownerId,
}: {
  effectiveAt?: Date;
  listingId: string;
  notificationId?: string | null;
  ownerId: string;
}) {
  const [knownListing] = await db
    .select(legacySafeEbayListingSelection)
    .from(ebayListings)
    .where(and(
      eq(ebayListings.id, listingId),
      eq(ebayListings.ownerId, ownerId),
    ))
    .limit(1);
  if (!knownListing) {
    throw new EbayListingReconciliationError("That tracked eBay listing no longer exists.");
  }

  const attemptedAt = new Date();
  const compositionSchemaReady = await hasEbayCompositionSchema();
  let remote: EbayRemoteListing;
  try {
    remote = await getEbayRemoteListing(ownerId, knownListing.itemId);
  } catch (error) {
    const failure = reconciliationError(error);
    const retryCount = knownListing.retryCount + 1;
    await db
      .update(ebayListings)
      .set({
        lastError: failure.message,
        lastErrorAt: attemptedAt,
        lastSyncAttemptAt: attemptedAt,
        nextRetryAt: new Date(attemptedAt.getTime() + retryDelayMilliseconds(retryCount)),
        retryCount,
        updatedAt: attemptedAt,
      })
      .where(and(
        eq(ebayListings.id, knownListing.id),
        eq(ebayListings.ownerId, ownerId),
      ));
    throw failure;
  }

  return db.transaction(async (tx) => {
    const [currentRow] = await tx
      .select(legacySafeEbayListingSelection)
      .from(ebayListings)
      .where(and(
        eq(ebayListings.id, listingId),
        eq(ebayListings.ownerId, ownerId),
      ))
      .for("update")
      .limit(1);
    if (!currentRow) {
      throw new EbayListingReconciliationError("That tracked eBay listing no longer exists.");
    }

    const normalized = await persistRemoteOrderLines({
      enabled: compositionSchemaReady,
      listingId: currentRow.id,
      ownerId,
      remote,
      timestamp: attemptedAt,
      tx,
    });

    const observation = parentObservationWithoutConflictingOrderLine(
      currentRow,
      ebayObservationFromRemote(remote, {
      effectiveAt: effectiveAt ?? attemptedAt,
      notificationId,
      }),
    );
    const decision = decideEbayLifecycleTransition(
      lifecycleFromRow(currentRow),
      observation,
    );
    const next = decision.next;
    const normalizedFailureReason = preferredEbayCompositionReviewReason(
      normalized.failureReasons,
    );
    const normalizedFailClosed = Boolean(normalizedFailureReason);
    const listingError = normalizedFailureReason
      ? ebayListingReviewMessage(normalizedFailureReason)
      : decision.action === "fail_closed"
        ? ebayListingReviewMessage(decision.reason)
        : null;
    const compatibilityStatus = decision.relistAllowed
      || (next.saleRecordId !== null && next.saleState === "paid")
      ? "ended"
      : "active";

    const [updated] = await tx
      .update(ebayListings)
      .set({
        cancelledAt: next.cancelledAt,
        endingReason: next.endingReason,
        lastError: listingError,
        lastErrorAt: decision.action === "fail_closed" || normalizedFailClosed
          ? attemptedAt
          : null,
        lastNotificationAt: notificationId ? attemptedAt : currentRow.lastNotificationAt,
        lastNotificationId: next.lastNotificationId,
        lastRemoteEventAt: next.lastRemoteEventAt,
        lastSyncAttemptAt: attemptedAt,
        lastSyncedAt: decision.action === "fail_closed" || normalizedFailClosed
          ? currentRow.lastSyncedAt
          : attemptedAt,
        listingEndedAt: next.listingEndedAt,
        listingStartedAt: next.listingStartedAt,
        listingState: next.listingState,
        nextRetryAt: decision.action === "fail_closed" || normalizedFailClosed
          ? new Date(attemptedAt.getTime() + retryDelayMilliseconds(currentRow.retryCount + 1))
          : null,
        orderId: next.orderId,
        orderLineItemId: next.orderLineItemId,
        paidAt: next.paidAt,
        paymentPendingAt: next.paymentPendingAt,
        quantitySold: next.quantitySold,
        remoteListingStatus: next.remoteListingStatus,
        remoteOrderStatus: next.remoteOrderStatus,
        retryCount: decision.action === "fail_closed" || normalizedFailClosed
          ? currentRow.retryCount + 1
          : 0,
        saleRecordId: next.saleRecordId,
        saleState: normalizedFailClosed ? "needs_review" : next.saleState,
        status: normalizedFailClosed ? "active" : compatibilityStatus,
        transactionId: next.transactionId,
        updatedAt: attemptedAt,
      })
      .where(and(
        eq(ebayListings.id, currentRow.id),
        eq(ebayListings.ownerId, ownerId),
      ))
      .returning();

    return {
      decision: normalizedFailClosed ? "fail_closed" as const : decision.action,
      reason: decision.reason,
      listing: ebayListingStatusSummary(updated),
    };
  });
}

export async function reconcileEbayListingForCopy(ownerId: string, copyId: string) {
  const listing = await getLatestEbayListingForCopy(ownerId, copyId);
  if (!listing || listing.status !== "active") {
    return listing ? ebayListingStatusSummary(listing) : null;
  }
  return (await reconcileEbayListing({
    listingId: listing.id,
    ownerId,
  })).listing;
}

export async function reconcileDueEbayListings({
  limit = 25,
  maxRuntimeMs = 4 * 60 * 1_000,
}: {
  limit?: number;
  maxRuntimeMs?: number;
} = {}) {
  const startedAt = Date.now();
  const now = new Date(startedAt);
  const recentPaidCutoff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1_000);
  const due = await db
    .select({ id: ebayListings.id, ownerId: ebayListings.ownerId })
    .from(ebayListings)
    .where(and(
      or(
        eq(ebayListings.status, "active"),
        eq(ebayListings.listingState, "unknown"),
        eq(ebayListings.saleState, "pending"),
        eq(ebayListings.saleState, "needs_review"),
        and(
          eq(ebayListings.saleState, "paid"),
          gte(ebayListings.paidAt, recentPaidCutoff),
        ),
      ),
      or(
        isNull(ebayListings.nextRetryAt),
        lte(ebayListings.nextRetryAt, now),
      ),
    ))
    .orderBy(asc(ebayListings.lastSyncAttemptAt), asc(ebayListings.createdAt))
    .limit(Math.max(1, Math.min(limit, 100)));

  const outcomes = {
    active: 0,
    cancelled: 0,
    checked: 0,
    endedUnsold: 0,
    failed: 0,
    needsReview: 0,
    paid: 0,
    pending: 0,
    suspended: 0,
  };

  for (const listing of due) {
    if (Date.now() - startedAt >= maxRuntimeMs) break;
    try {
      const result = await reconcileEbayListing({
        listingId: listing.id,
        ownerId: listing.ownerId,
      });
      outcomes.checked += 1;
      if (result.listing.saleState === "paid") outcomes.paid += 1;
      else if (result.listing.saleState === "pending") outcomes.pending += 1;
      else if (result.listing.saleState === "cancelled") outcomes.cancelled += 1;
      else if (result.listing.saleState === "needs_review") outcomes.needsReview += 1;
      else if (result.listing.listingState === "suspended") outcomes.suspended += 1;
      else if (result.listing.relistAllowed) outcomes.endedUnsold += 1;
      else outcomes.active += 1;
    } catch {
      outcomes.failed += 1;
    }
  }

  return {
    ...outcomes,
    attempted: outcomes.checked + outcomes.failed,
    remaining: Math.max(0, due.length - outcomes.checked - outcomes.failed),
  };
}

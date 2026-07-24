import "server-only";

import {
  and,
  asc,
  desc,
  eq,
  gte,
  isNull,
  lte,
  or,
} from "drizzle-orm";
import { db } from "@/db";
import {
  ebayListings,
  type EbayListingRow,
} from "@/db/schema";
import {
  decideEbayLifecycleTransition,
  isEbayLifecycleRelistable,
  type EbayLifecycleObservation,
  type EbayListingLifecycle,
} from "@/lib/records/ebay-listing-lifecycle";
import { EbayAuthorizationError } from "@/server/ebay-seller";
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
  const [listing] = await db
    .select()
    .from(ebayListings)
    .where(and(
      eq(ebayListings.ownerId, ownerId),
      eq(ebayListings.copyId, copyId),
    ))
    .orderBy(desc(ebayListings.createdAt))
    .limit(1);
  return listing ?? null;
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
    .select()
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
      .select()
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

    const observation = ebayObservationFromRemote(remote, {
      effectiveAt: effectiveAt ?? attemptedAt,
      notificationId,
    });
    const decision = decideEbayLifecycleTransition(
      lifecycleFromRow(currentRow),
      observation,
    );
    const next = decision.next;
    const compatibilityStatus = decision.relistAllowed
      || (next.saleRecordId !== null && next.saleState === "paid")
      ? "ended"
      : "active";

    const [updated] = await tx
      .update(ebayListings)
      .set({
        cancelledAt: next.cancelledAt,
        endingReason: next.endingReason,
        lastError: decision.action === "fail_closed"
          ? "eBay returned a listing state that needs review."
          : null,
        lastErrorAt: decision.action === "fail_closed" ? attemptedAt : null,
        lastNotificationAt: notificationId ? attemptedAt : currentRow.lastNotificationAt,
        lastNotificationId: next.lastNotificationId,
        lastRemoteEventAt: next.lastRemoteEventAt,
        lastSyncAttemptAt: attemptedAt,
        lastSyncedAt: decision.action === "fail_closed" ? currentRow.lastSyncedAt : attemptedAt,
        listingEndedAt: next.listingEndedAt,
        listingStartedAt: next.listingStartedAt,
        listingState: next.listingState,
        nextRetryAt: decision.action === "fail_closed"
          ? new Date(attemptedAt.getTime() + retryDelayMilliseconds(currentRow.retryCount + 1))
          : null,
        orderId: next.orderId,
        orderLineItemId: next.orderLineItemId,
        paidAt: next.paidAt,
        paymentPendingAt: next.paymentPendingAt,
        quantitySold: next.quantitySold,
        remoteListingStatus: next.remoteListingStatus,
        remoteOrderStatus: next.remoteOrderStatus,
        retryCount: decision.action === "fail_closed" ? currentRow.retryCount + 1 : 0,
        saleRecordId: next.saleRecordId,
        saleState: next.saleState,
        status: compatibilityStatus,
        transactionId: next.transactionId,
        updatedAt: attemptedAt,
      })
      .where(and(
        eq(ebayListings.id, currentRow.id),
        eq(ebayListings.ownerId, ownerId),
      ))
      .returning();

    return {
      decision: decision.action,
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

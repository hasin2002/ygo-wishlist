import "server-only";

import {
  and,
  asc,
  eq,
  inArray,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { db } from "@/db";
import {
  ebayListings,
  ebayNotificationEvents,
  ebayNotificationSubscriptions,
} from "@/db/schema";
import {
  ebayNotificationReconciliationItemIds,
  type ParsedEbayTradingNotification,
} from "@/lib/records/ebay-trading-notification";
import { ebayPurchaseNotificationNeedsRetry } from "@/lib/records/ebay-notification-processing";
import {
  reconcileEbayListing,
} from "@/server/ebay-listing-reconciliation";
import { getEbayOrderItemIds } from "@/server/ebay-trading";
import {
  getEbayTradingAuthTokenMetadata,
  getSingleEbayConnectionOwner,
} from "@/server/ebay-seller";

function retryDelayMilliseconds(attemptCount: number) {
  if (attemptCount <= 1) return 60 * 1_000;
  if (attemptCount === 2) return 5 * 60 * 1_000;
  if (attemptCount === 3) return 15 * 60 * 1_000;
  return 60 * 60 * 1_000;
}

const maxPurchaseLagAttempts = 4;

class EbayNotificationStateLagError extends Error {}

export async function persistEbayNotification({
  parsed,
  payloadHash,
}: {
  parsed: ParsedEbayTradingNotification;
  payloadHash: string;
}) {
  const deploymentOwnerId = await getSingleEbayConnectionOwner();
  const credential = deploymentOwnerId
    ? await getEbayTradingAuthTokenMetadata(deploymentOwnerId)
    : null;
  const sellerMatches = Boolean(
    deploymentOwnerId
    && credential?.ebayUserId
    && parsed.sellerUserId === credential.ebayUserId,
  );
  const routedOwnerId = sellerMatches ? deploymentOwnerId : null;
  const itemIds = parsed.listingRefs.map((reference) => reference.itemId);
  const listings = itemIds.length && routedOwnerId
    ? await db
      .select({ id: ebayListings.id, ownerId: ebayListings.ownerId })
      .from(ebayListings)
      .where(and(
        eq(ebayListings.ownerId, routedOwnerId),
        inArray(ebayListings.itemId, itemIds),
      ))
    : [];
  const firstListing = listings[0] ?? null;
  const checkoutFallback = Boolean(
    !firstListing
    && routedOwnerId
    && parsed.topic === "TRADING_AuctionCheckoutComplete"
    && parsed.orderId,
  );
  const ownerId = firstListing?.ownerId ?? (checkoutFallback ? routedOwnerId : null);
  const shouldProcess = Boolean(firstListing || checkoutFallback);
  const now = new Date();
  const [inserted] = await db.transaction(async (transaction) => {
    const rows = await transaction
      .insert(ebayNotificationEvents)
      .values({
        createdAt: now,
        eventAt: parsed.eventAt,
        id: `ebay-notification-event-${crypto.randomUUID()}`,
        itemId: parsed.listingRefs[0]?.itemId ?? null,
        listingId: firstListing?.id ?? null,
        listingRefs: parsed.listingRefs,
        notificationId: parsed.notificationId,
        orderId: parsed.orderId,
        orderLineItemId: parsed.listingRefs[0]?.orderLineItemId ?? null,
        outcome: shouldProcess
          ? null
          : !sellerMatches && deploymentOwnerId
            ? "Notification seller did not match the deployment's connected eBay seller."
            : "No tracked eBay listing matched this notification.",
        ownerId,
        payloadHash,
        processingStatus: shouldProcess ? "pending" : "ignored",
        publishedAt: parsed.publishedAt,
        receivedAt: now,
        sellerUserId: parsed.sellerUserId,
        topic: parsed.topic,
        updatedAt: now,
      })
      .onConflictDoNothing({
        target: ebayNotificationEvents.notificationId,
      })
      .returning({ id: ebayNotificationEvents.id });
    if (ownerId && parsed.topic.startsWith("TRADING_")) {
      await transaction.update(ebayNotificationSubscriptions).set({
        lastNotificationAt: now,
        updatedAt: now,
      }).where(and(
        eq(ebayNotificationSubscriptions.ownerId, ownerId),
        eq(ebayNotificationSubscriptions.topic, parsed.topic),
      ));
    }
    return rows;
  });
  return {
    duplicate: !inserted,
    eventId: inserted?.id ?? null,
    process: Boolean(inserted && shouldProcess),
  };
}

export async function claimEbayNotificationEvent(
  eventId: string,
  attemptedAt = new Date(),
) {
  const staleProcessingCutoff = new Date(attemptedAt.getTime() - 10 * 60 * 1_000);
  const [event] = await db
    .update(ebayNotificationEvents)
    .set({
      attemptCount: sql`${ebayNotificationEvents.attemptCount} + 1`,
      lastAttemptAt: attemptedAt,
      nextAttemptAt: null,
      processingStatus: "processing",
      updatedAt: attemptedAt,
    })
    .where(and(
      eq(ebayNotificationEvents.id, eventId),
      or(
        eq(ebayNotificationEvents.processingStatus, "pending"),
        eq(ebayNotificationEvents.processingStatus, "failed"),
        and(
          eq(ebayNotificationEvents.processingStatus, "processing"),
          lte(ebayNotificationEvents.lastAttemptAt, staleProcessingCutoff),
        ),
      ),
    ))
    .returning();
  return event ?? null;
}

export async function processEbayNotificationEvent(eventId: string) {
  const attemptedAt = new Date();
  const event = await claimEbayNotificationEvent(eventId, attemptedAt);
  if (!event) return null;

  try {
    const orderItemIds = event.topic === "TRADING_AuctionCheckoutComplete"
      && event.orderId
      && event.ownerId
      ? await getEbayOrderItemIds(event.ownerId, event.orderId)
      : [];
    const itemIds = ebayNotificationReconciliationItemIds(
      event.listingRefs,
      orderItemIds,
    );
    const listings = itemIds.length
      ? await db
        .select({ id: ebayListings.id, ownerId: ebayListings.ownerId })
        .from(ebayListings)
        .where(and(
          inArray(ebayListings.itemId, itemIds),
          event.ownerId ? eq(ebayListings.ownerId, event.ownerId) : undefined,
        ))
      : [];
    if (!listings.length) {
      await db
        .update(ebayNotificationEvents)
        .set({
          outcome: "No tracked eBay listing matched this notification.",
          processedAt: attemptedAt,
          processingStatus: "ignored",
          updatedAt: attemptedAt,
        })
        .where(and(
          eq(ebayNotificationEvents.id, event.id),
          eq(ebayNotificationEvents.processingStatus, "processing"),
          eq(ebayNotificationEvents.lastAttemptAt, attemptedAt),
        ));
      return { ignored: true };
    }

    const reconciled = [];
    for (const listing of listings) {
      reconciled.push(await reconcileEbayListing({
        listingId: listing.id,
        notificationId: event.notificationId,
        ownerId: listing.ownerId,
      }));
    }
    if (
      ebayPurchaseNotificationNeedsRetry(
        event.topic,
        reconciled.map(({ listing }) => listing),
      )
    ) {
      throw new EbayNotificationStateLagError(
        "eBay acknowledged the purchase notification, but its authoritative listing state has not caught up yet.",
      );
    }
    const firstListing = listings[0]!;
    await db.transaction(async (tx) => {
      await tx
        .update(ebayNotificationEvents)
        .set({
          lastError: null,
          listingRefs: itemIds.map((itemId) => ({
            itemId,
            orderLineItemId: event.listingRefs.find(
              (reference) => reference.itemId === itemId,
            )?.orderLineItemId ?? null,
          })),
          listingId: firstListing.id,
          nextAttemptAt: null,
          outcome: `Reconciled ${listings.length} tracked listing${listings.length === 1 ? "" : "s"}.`,
          ownerId: firstListing.ownerId,
          processedAt: new Date(),
          processingStatus: "processed",
          updatedAt: new Date(),
        })
        .where(and(
          eq(ebayNotificationEvents.id, event.id),
          eq(ebayNotificationEvents.processingStatus, "processing"),
          eq(ebayNotificationEvents.lastAttemptAt, attemptedAt),
        ));
      await tx
        .update(ebayNotificationSubscriptions)
        .set({
          lastNotificationAt: attemptedAt,
          updatedAt: attemptedAt,
        })
        .where(and(
          eq(ebayNotificationSubscriptions.ownerId, firstListing.ownerId),
          eq(ebayNotificationSubscriptions.topic, event.topic),
        ));
    });
    return { ignored: false, reconciled: listings.length };
  } catch (error) {
    if (
      error instanceof EbayNotificationStateLagError
      && event.attemptCount >= maxPurchaseLagAttempts
    ) {
      await db
        .update(ebayNotificationEvents)
        .set({
          lastError: null,
          nextAttemptAt: null,
          outcome: "eBay purchase state remained delayed after bounded retries; daily reconciliation remains active.",
          processedAt: new Date(),
          processingStatus: "processed",
          updatedAt: new Date(),
        })
        .where(and(
          eq(ebayNotificationEvents.id, event.id),
          eq(ebayNotificationEvents.processingStatus, "processing"),
          eq(ebayNotificationEvents.lastAttemptAt, attemptedAt),
        ));
      return { deferredToDailyReconciliation: true, ignored: false };
    }
    const nextAttemptAt = new Date(
      attemptedAt.getTime() + retryDelayMilliseconds(event.attemptCount),
    );
    await db
      .update(ebayNotificationEvents)
      .set({
        lastError: error instanceof Error
          ? error.message.slice(0, 1_000)
          : "The eBay notification could not be reconciled.",
        nextAttemptAt,
        processingStatus: "failed",
        updatedAt: new Date(),
      })
      .where(and(
        eq(ebayNotificationEvents.id, event.id),
        eq(ebayNotificationEvents.processingStatus, "processing"),
        eq(ebayNotificationEvents.lastAttemptAt, attemptedAt),
      ));
    throw error;
  }
}

export async function retryDueEbayNotificationEvents({
  limit = 20,
  maxRuntimeMs = 60_000,
}: {
  limit?: number;
  maxRuntimeMs?: number;
} = {}) {
  const startedAt = Date.now();
  const now = new Date(startedAt);
  const staleProcessingCutoff = new Date(now.getTime() - 10 * 60 * 1_000);
  const due = await db
    .select({ id: ebayNotificationEvents.id })
    .from(ebayNotificationEvents)
    .where(and(
      or(
        eq(ebayNotificationEvents.processingStatus, "pending"),
        eq(ebayNotificationEvents.processingStatus, "failed"),
        and(
          eq(ebayNotificationEvents.processingStatus, "processing"),
          lte(ebayNotificationEvents.lastAttemptAt, staleProcessingCutoff),
        ),
      ),
      or(
        isNull(ebayNotificationEvents.nextAttemptAt),
        lte(ebayNotificationEvents.nextAttemptAt, now),
      ),
    ))
    .orderBy(asc(ebayNotificationEvents.receivedAt))
    .limit(Math.max(1, Math.min(limit, 100)));

  let processed = 0;
  let failed = 0;
  let skipped = 0;
  for (const event of due) {
    if (Date.now() - startedAt >= maxRuntimeMs) break;
    try {
      const result = await processEbayNotificationEvent(event.id);
      if (result) processed += 1;
      else skipped += 1;
    } catch {
      failed += 1;
    }
  }
  return {
    attempted: processed + failed,
    failed,
    processed,
    remaining: Math.max(0, due.length - processed - failed - skipped),
    skipped,
  };
}

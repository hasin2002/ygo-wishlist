import "server-only";

import { createHash, createHmac } from "node:crypto";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  lte,
  or,
} from "drizzle-orm";
import { db } from "@/db";
import {
  ebayConnections,
  ebayListings,
  ebayNotificationEvents,
  ebayNotificationSubscriptions,
  users,
} from "@/db/schema";
import { isMissingDatabaseSchemaError } from "@/lib/database-error";
import type {
  ParsedEbayNotification,
} from "@/lib/records/ebay-notification-event";
import {
  latestEbayNotificationStatusRows,
  planEbayNotificationRowConsolidation,
  publicEbayNotificationError,
} from "@/lib/records/ebay-notification-status";
import {
  classifyEbayNotificationCapabilities,
  createEbayNotificationClient,
  ebayFulfillmentReadonlyScope,
  ebayFulfillmentScope,
  ebayListingReadScope,
  ebayNotificationSubscriptionScope,
  ebayNotificationTopics,
  EbayNotificationApiError,
  notificationPayloadFromTopic,
  type EbayNotificationTopicId,
} from "@/server/ebay-notification-api";
import {
  reconcileEbayListing,
} from "@/server/ebay-listing-reconciliation";
import {
  EbayConfigurationError,
  getEbayApplicationAccessToken,
  getEbayConnectionStatus,
  getEbaySellerAccessToken,
} from "@/server/ebay-seller";

const productionNotificationHost = "ygo-wishlist.vercel.app";
const destinationName = "YGO Wishlist listing lifecycle";
const subscriptionScopeVersion = 1;
const subscriptionAvailabilityRetryDelays = [0, 250, 750, 1_500, 3_000] as const;

function requiredSecret() {
  const value = process.env.BETTER_AUTH_SECRET?.trim();
  if (!value) {
    throw new EbayConfigurationError("BETTER_AUTH_SECRET is not configured.");
  }
  return value;
}

function publicHttpsEndpoint(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:") {
    throw new EbayConfigurationError("The eBay notification endpoint must use HTTPS.");
  }
  return url.toString();
}

export function getEbayNotificationEndpoint() {
  const explicit = process.env.EBAY_NOTIFICATION_ENDPOINT_URL?.trim();
  if (explicit) return publicHttpsEndpoint(explicit);

  if (process.env.NODE_ENV === "development") {
    throw new EbayConfigurationError(
      "Local eBay notification setup needs a public HTTPS webhook. Start the approved ngrok tunnel, set EBAY_NOTIFICATION_ENDPOINT_URL to its /api/ebay/notifications URL, restart the development server, then retry.",
    );
  }

  const productionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim()
    || productionNotificationHost;
  return publicHttpsEndpoint(
    `https://${productionHost}/api/ebay/notifications`,
  );
}

export function getEbayNotificationVerificationToken() {
  return createHmac("sha256", requiredSecret())
    .update("ebay-notification-destination-v1")
    .digest("base64url");
}

export function ebayChallengeResponse(challengeCode: string) {
  return createHash("sha256")
    .update(challengeCode)
    .update(getEbayNotificationVerificationToken())
    .update(getEbayNotificationEndpoint())
    .digest("hex");
}

function isMissingEbaySubscription(error: unknown) {
  return error instanceof EbayNotificationApiError
    && error.status === 404
    && (
      error.errorId === 195013
      || error.message.toLowerCase().includes("subscription id does not exist")
    );
}

async function retryWhileSubscriptionBecomesAvailable<T>(
  operation: () => Promise<T>,
) {
  let lastError: unknown;
  for (const delayMilliseconds of subscriptionAvailabilityRetryDelays) {
    if (delayMilliseconds > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMilliseconds));
    }
    try {
      return await operation();
    } catch (error) {
      if (!isMissingEbaySubscription(error)) throw error;
      lastError = error;
    }
  }
  throw lastError;
}

function retryDelayMilliseconds(attemptCount: number) {
  if (attemptCount <= 1) return 5 * 60 * 1_000;
  if (attemptCount === 2) return 15 * 60 * 1_000;
  return 60 * 60 * 1_000;
}

function subscriptionStatus(value: string) {
  if (value === "ENABLED") return "enabled" as const;
  if (value === "DISABLED") return "disabled" as const;
  if (value === "MARKED_DOWN") return "marked_down" as const;
  return "error" as const;
}

type NotificationSubscriptionInsert =
  typeof ebayNotificationSubscriptions.$inferInsert;

async function persistSubscriptionState({
  create,
  update,
}: {
  create: NotificationSubscriptionInsert;
  update: Partial<NotificationSubscriptionInsert>;
}) {
  await db.transaction(async (transaction) => {
    const existingRows = await transaction
      .select()
      .from(ebayNotificationSubscriptions)
      .where(and(
        eq(ebayNotificationSubscriptions.ownerId, create.ownerId),
        eq(ebayNotificationSubscriptions.topic, create.topic),
      ))
      .orderBy(desc(ebayNotificationSubscriptions.updatedAt));
    const { preferredId, staleIds } = planEbayNotificationRowConsolidation({
      destinationId: create.destinationId,
      remoteSubscriptionId: create.remoteSubscriptionId,
      rows: existingRows,
    });

    // Delete superseded destination rows before updating so a moved remote
    // subscription cannot collide with its own globally unique eBay ID.
    if (staleIds.length) {
      await transaction
        .delete(ebayNotificationSubscriptions)
        .where(inArray(ebayNotificationSubscriptions.id, staleIds));
    }
    if (preferredId) {
      await transaction
        .update(ebayNotificationSubscriptions)
        .set(update)
        .where(eq(ebayNotificationSubscriptions.id, preferredId));
      return;
    }
    await transaction.insert(ebayNotificationSubscriptions).values(create);
  });
}

function storedSubscriptionError(error: unknown) {
  if (error instanceof EbayNotificationApiError) {
    return error.message.slice(0, 1_000);
  }
  if (error instanceof Error && (
    error.message.startsWith("eBay created the ")
    || error.message.startsWith("eBay does not advertise ")
  )) {
    return error.message.slice(0, 1_000);
  }
  return "Records could not save the latest notification status. Retry setup after confirming the production database schema is up to date.";
}

async function saveSubscriptionError({
  destinationId,
  error,
  ownerId,
  topic,
}: {
  destinationId: string;
  error: unknown;
  ownerId: string;
  topic: EbayNotificationTopicId;
}) {
  const now = new Date();
  const existingRows = await db
    .select()
    .from(ebayNotificationSubscriptions)
    .where(and(
      eq(ebayNotificationSubscriptions.ownerId, ownerId),
      eq(ebayNotificationSubscriptions.topic, topic),
    ))
    .orderBy(desc(ebayNotificationSubscriptions.updatedAt));
  const existing = existingRows.find((row) => (
    row.destinationId === destinationId
  )) ?? existingRows[0];
  const retryCount = (existing?.retryCount ?? 0) + 1;
  const values = {
    destinationId,
    lastError: storedSubscriptionError(error),
    lastErrorAt: now,
    nextRetryAt: new Date(now.getTime() + retryDelayMilliseconds(retryCount)),
    retryCount,
    status: "error" as const,
    updatedAt: now,
  };
  await persistSubscriptionState({
    create: {
      ...values,
      createdAt: now,
      id: `ebay-notification-sub-${crypto.randomUUID()}`,
      ownerId,
      scopeVersion: subscriptionScopeVersion,
      topic,
    },
    update: values,
  });
}

async function saveUnsupportedSubscription({
  destinationId,
  message,
  ownerId,
  topic,
}: {
  destinationId: string;
  message: string;
  ownerId: string;
  topic: EbayNotificationTopicId;
}) {
  const now = new Date();
  const values = {
    destinationId,
    lastCheckedAt: now,
    lastError: message,
    lastErrorAt: now,
    nextRetryAt: null,
    remoteSubscriptionId: null,
    retryCount: 0,
    scopeVersion: subscriptionScopeVersion,
    status: "unsupported" as const,
    updatedAt: now,
  };
  await persistSubscriptionState({
    create: {
      ...values,
      createdAt: now,
      id: `ebay-notification-sub-${crypto.randomUUID()}`,
      ownerId,
      topic,
    },
    update: values,
  });
}

/**
 * Creates or repairs the two user subscriptions used by this application.
 * The destination is application-owned; subscriptions use the seller token.
 */
export async function ensureEbayNotificationSubscriptions(ownerId: string) {
  const connection = await getEbayConnectionStatus(ownerId);
  if (!connection) {
    throw new Error("Connect eBay before enabling listing notifications.");
  }
  if (!connection.notificationReady) {
    throw new Error("Reconnect eBay to approve the notification read scopes.");
  }

  const [applicationToken, sellerToken] = await Promise.all([
    getEbayApplicationAccessToken(),
    getEbaySellerAccessToken(ownerId),
  ]);
  const applicationClient = createEbayNotificationClient({
    accessToken: applicationToken,
  });
  const sellerClient = createEbayNotificationClient({
    accessToken: sellerToken,
  });
  const endpoint = getEbayNotificationEndpoint();
  const verificationToken = getEbayNotificationVerificationToken();
  const config = await applicationClient.getConfig();
  if (!config.alertEmail?.trim()) {
    const [owner] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, ownerId))
      .limit(1);
    const alertEmail = process.env.EBAY_NOTIFICATION_ALERT_EMAIL?.trim()
      || owner?.email?.trim();
    if (
      !alertEmail
      || alertEmail.endsWith(".invalid")
      || alertEmail.endsWith(".example")
    ) {
      throw new Error(
        "Configure an eBay notification alert email before enabling subscriptions.",
      );
    }
    await applicationClient.updateConfig(alertEmail);
  }
  // eBay rejects destination and subscription requests with HTTP 409 until the
  // application-level alert configuration above exists.
  const [topics, destinations, remoteSubscriptions] = await Promise.all([
    applicationClient.getTopics(),
    applicationClient.getDestinations(),
    sellerClient.getSubscriptions(),
  ]);
  const capabilities = classifyEbayNotificationCapabilities(
    topics,
    connection.scopes.split(/\s+/),
  );
  if (!capabilities.some((capability) => (
    capability.available && capability.missingScopes.length === 0
  ))) {
    throw new Error(
      "The current eBay connection cannot subscribe to any supported seller notification topic.",
    );
  }

  let destination = destinations.find(
    (candidate) => candidate.deliveryConfig.endpoint === endpoint,
  );
  if (!destination) {
    destination = await applicationClient.createDestination({
      endpoint,
      name: destinationName,
      verificationToken,
    });
  } else if (destination.status !== "ENABLED") {
    await applicationClient.updateDestination(destination.destinationId, {
      endpoint,
      name: destinationName,
      status: "ENABLED",
      verificationToken,
    });
    destination = { ...destination, status: "ENABLED" };
  }
  if (!destination?.destinationId) {
    throw new Error("eBay did not return a notification destination ID.");
  }

  const results: Array<{
    remoteSubscriptionId: string;
    status: string;
    topic: EbayNotificationTopicId;
  }> = [];
  for (const capability of capabilities) {
    const { topicId } = capability;
    if (!capability.available || capability.missingScopes.length > 0) {
      const reason = topicId === "LISTING"
        ? "Immediate listing-ended updates are unavailable because this eBay application keyset is not assigned the sell.listing.read permission. Records still checks listing state when you interact with a Copy and during daily reconciliation."
        : `eBay cannot enable ${topicId} notifications with the permissions granted to this connection.`;
      await saveUnsupportedSubscription({
        destinationId: destination.destinationId,
        message: reason,
        ownerId,
        topic: topicId,
      });
      continue;
    }
    const topic = topics.find((candidate) => candidate.topicId === topicId);
    const payload = topic ? notificationPayloadFromTopic(topic) : null;
    if (!payload) {
      await saveSubscriptionError({
        destinationId: destination.destinationId,
        error: new Error(`eBay does not advertise an HTTPS JSON payload for ${topicId}.`),
        ownerId,
        topic: topicId,
      });
      continue;
    }

    try {
      let subscription = remoteSubscriptions.find(
        (candidate) => candidate.topicId === topicId,
      );
      if (
        subscription
        && subscription.destinationId !== destination.destinationId
      ) {
        await sellerClient.updateSubscription(subscription.subscriptionId, {
          destinationId: destination.destinationId,
          payload,
          status: "DISABLED",
          topicId,
        });
        subscription = {
          ...subscription,
          destinationId: destination.destinationId,
          status: "DISABLED",
        };
      }
      if (!subscription) {
        subscription = await sellerClient.createSubscription({
          destinationId: destination.destinationId,
          payload,
          status: "DISABLED",
          topicId,
        });
        subscription = await retryWhileSubscriptionBecomesAvailable(
          () => sellerClient.getSubscription(subscription!.subscriptionId),
        );
      }
      if (!subscription?.subscriptionId) {
        throw new Error("eBay did not return a subscription ID.");
      }
      if (subscription.status !== "ENABLED") {
        await retryWhileSubscriptionBecomesAvailable(
          () => sellerClient.testSubscription(subscription!.subscriptionId),
        );
        await retryWhileSubscriptionBecomesAvailable(
          () => sellerClient.enableSubscription(subscription!.subscriptionId),
        );
        subscription = { ...subscription, status: "ENABLED" };
      }

      const now = new Date();
      const values = {
        destinationId: destination.destinationId,
        enabledAt: subscription.status === "ENABLED" ? now : null,
        lastCheckedAt: now,
        lastError: null,
        lastErrorAt: null,
        nextRetryAt: null,
        remoteSubscriptionId: subscription.subscriptionId,
        retryCount: 0,
        scopeVersion: subscriptionScopeVersion,
        status: subscriptionStatus(subscription.status),
        updatedAt: now,
        verifiedAt: now,
      };
      await persistSubscriptionState({
        create: {
          ...values,
          createdAt: now,
          id: `ebay-notification-sub-${crypto.randomUUID()}`,
          ownerId,
          topic: topicId,
        },
        update: values,
      });
      results.push({
        remoteSubscriptionId: subscription.subscriptionId,
        status: subscription.status,
        topic: topicId,
      });
    } catch (error) {
      const savedError = isMissingEbaySubscription(error)
        ? new Error(
          `eBay created the ${topicId} subscription but has not made it available yet. Wait a few seconds, then retry notification setup.`,
          { cause: error },
        )
        : error;
      await saveSubscriptionError({
        destinationId: destination.destinationId,
        error: savedError,
        ownerId,
        topic: topicId,
      });
    }
  }
  return results;
}

export async function getEbayNotificationSubscriptionStatus(ownerId: string) {
  try {
    const rows = await db
      .select()
      .from(ebayNotificationSubscriptions)
      .where(eq(ebayNotificationSubscriptions.ownerId, ownerId))
      .orderBy(asc(ebayNotificationSubscriptions.topic));
    const currentRows = latestEbayNotificationStatusRows(rows);
    return {
      coverage: ebayNotificationTopics.every((topic) => currentRows.some(
        (row) => row.topic === topic && row.status === "enabled",
      ))
        ? "full" as const
        : currentRows.some((row) => row.status === "enabled")
          ? "partial" as const
          : "none" as const,
      enabled: currentRows.some((row) => row.status === "enabled"),
      schemaReady: true,
      subscriptions: currentRows.map((row) => ({
        lastCheckedAt: row.lastCheckedAt,
        lastError: publicEbayNotificationError(row.lastError),
        lastNotificationAt: row.lastNotificationAt,
        status: row.status,
        topic: row.topic,
      })),
    };
  } catch (error) {
    if (!isMissingDatabaseSchemaError(error)) throw error;
    return {
      coverage: "none" as const,
      enabled: false,
      schemaReady: false,
      subscriptions: [],
    };
  }
}

export async function persistEbayNotification({
  parsed,
  payloadHash,
}: {
  parsed: ParsedEbayNotification;
  payloadHash: string;
}) {
  const itemIds = parsed.listingRefs.map((reference) => reference.itemId);
  const listings = itemIds.length
    ? await db
      .select({ id: ebayListings.id, ownerId: ebayListings.ownerId })
      .from(ebayListings)
      .where(inArray(ebayListings.itemId, itemIds))
    : [];
  const firstListing = listings[0] ?? null;
  const now = new Date();
  const [inserted] = await db
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
      outcome: firstListing ? null : "No tracked eBay listing matched this notification.",
      ownerId: firstListing?.ownerId ?? null,
      payloadHash,
      processingStatus: firstListing ? "pending" : "ignored",
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
  return {
    duplicate: !inserted,
    eventId: inserted?.id ?? null,
    process: Boolean(inserted && firstListing),
  };
}

export async function processEbayNotificationEvent(eventId: string) {
  const [event] = await db
    .select()
    .from(ebayNotificationEvents)
    .where(eq(ebayNotificationEvents.id, eventId))
    .limit(1);
  if (!event || event.processingStatus === "processed" || event.processingStatus === "ignored") {
    return null;
  }

  const attemptedAt = new Date();
  await db
    .update(ebayNotificationEvents)
    .set({
      attemptCount: event.attemptCount + 1,
      lastAttemptAt: attemptedAt,
      processingStatus: "processing",
      updatedAt: attemptedAt,
    })
    .where(eq(ebayNotificationEvents.id, event.id));

  try {
    const itemIds = event.listingRefs.map((reference) => reference.itemId);
    const listings = itemIds.length
      ? await db
        .select({ id: ebayListings.id, ownerId: ebayListings.ownerId })
        .from(ebayListings)
        .where(inArray(ebayListings.itemId, itemIds))
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
        .where(eq(ebayNotificationEvents.id, event.id));
      return { ignored: true };
    }

    for (const listing of listings) {
      await reconcileEbayListing({
        listingId: listing.id,
        notificationId: event.notificationId,
        ownerId: listing.ownerId,
      });
    }
    const firstListing = listings[0]!;
    await db.transaction(async (tx) => {
      await tx
        .update(ebayNotificationEvents)
        .set({
          lastError: null,
          listingId: firstListing.id,
          nextAttemptAt: null,
          outcome: `Reconciled ${listings.length} tracked listing${listings.length === 1 ? "" : "s"}.`,
          ownerId: firstListing.ownerId,
          processedAt: new Date(),
          processingStatus: "processed",
          updatedAt: new Date(),
        })
        .where(eq(ebayNotificationEvents.id, event.id));
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
    const nextAttemptAt = new Date(
      attemptedAt.getTime() + retryDelayMilliseconds(event.attemptCount + 1),
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
      .where(eq(ebayNotificationEvents.id, event.id));
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
  for (const event of due) {
    if (Date.now() - startedAt >= maxRuntimeMs) break;
    try {
      await processEbayNotificationEvent(event.id);
      processed += 1;
    } catch {
      failed += 1;
    }
  }
  return {
    attempted: processed + failed,
    failed,
    processed,
    remaining: Math.max(0, due.length - processed - failed),
  };
}

export async function repairDueEbayNotificationSubscriptions({
  limit = 5,
  maxRuntimeMs = 60_000,
}: {
  limit?: number;
  maxRuntimeMs?: number;
} = {}) {
  const startedAt = Date.now();
  const now = new Date(startedAt);
  const connections = await db
    .select({
      ownerId: ebayConnections.ownerId,
      scopes: ebayConnections.scopes,
    })
    .from(ebayConnections)
    .limit(Math.max(1, Math.min(limit * 4, 100)));
  const ownerIds = connections.map((connection) => connection.ownerId);
  const subscriptions = ownerIds.length
    ? await db
      .select()
      .from(ebayNotificationSubscriptions)
      .where(inArray(ebayNotificationSubscriptions.ownerId, ownerIds))
    : [];
  const dueOwners = connections.filter((connection) => {
    if (!hasRequiredEbayNotificationScopes(connection.scopes)) return false;
    return ebayNotificationTopics.some((topic) => {
      const subscription = subscriptions.find((candidate) => (
        candidate.ownerId === connection.ownerId && candidate.topic === topic
      ));
      if (!subscription) return true;
      if (
        subscription.status === "enabled"
        || subscription.status === "unsupported"
      ) return false;
      return !subscription.nextRetryAt || subscription.nextRetryAt <= now;
    });
  }).slice(0, Math.max(1, Math.min(limit, 25)));

  let repaired = 0;
  let failed = 0;
  for (const owner of dueOwners) {
    if (Date.now() - startedAt >= maxRuntimeMs) break;
    try {
      await ensureEbayNotificationSubscriptions(owner.ownerId);
      repaired += 1;
    } catch {
      failed += 1;
    }
  }
  return { attempted: repaired + failed, failed, repaired };
}

export function ebayNotificationPayloadHash(rawBody: string) {
  return createHash("sha256").update(rawBody).digest("hex");
}

export function hasRequiredEbayNotificationScopes(scopes: string) {
  const values = new Set(scopes.split(/\s+/).filter(Boolean));
  const hasTopicScope = values.has(ebayListingReadScope)
    || values.has(ebayFulfillmentScope)
    || values.has(ebayFulfillmentReadonlyScope);
  return values.has(ebayNotificationSubscriptionScope) && hasTopicScope;
}

import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  ebayConnections,
  ebayNotificationEvents,
  users,
} from "@/db/schema";
import { claimEbayNotificationEvent } from "@/server/ebay-notification-service";

test("the database enforces one seller and atomically claims one inbox event", async () => {
  let [connection] = await db
    .select({ ownerId: ebayConnections.ownerId })
    .from(ebayConnections)
    .limit(1);

  const suffix = crypto.randomUUID();
  const eventId = `test-ebay-notification-${suffix}`;
  const primaryOwnerId = `test-ebay-primary-owner-${suffix}`;
  const secondOwnerId = `test-ebay-owner-${suffix}`;
  const now = new Date();
  let createdPrimaryConnection = false;
  try {
    if (!connection) {
      await db.insert(users).values({
        createdAt: now,
        email: `primary-${suffix}@example.invalid`,
        emailVerified: true,
        id: primaryOwnerId,
        name: "Primary constraint test owner",
        publicCollection: false,
        role: "admin",
        updatedAt: now,
      });
      await db.insert(ebayConnections).values({
        createdAt: now,
        ownerId: primaryOwnerId,
        refreshTokenCiphertext: "test",
        refreshTokenExpiresAt: new Date(now.getTime() + 60_000),
        refreshTokenIv: "test",
        refreshTokenTag: "test",
        scopes: "test",
        updatedAt: now,
      });
      connection = { ownerId: primaryOwnerId };
      createdPrimaryConnection = true;
    }

    await db.insert(ebayNotificationEvents).values({
      createdAt: now,
      eventAt: now,
      id: eventId,
      listingRefs: [],
      notificationId: `test-notification-${suffix}`,
      ownerId: connection.ownerId,
      payloadHash: "0".repeat(64),
      processingStatus: "pending",
      publishedAt: now,
      receivedAt: now,
      topic: "TRADING_ItemRevised",
      updatedAt: now,
    });

    const claimed = await Promise.all([
      claimEbayNotificationEvent(eventId, now),
      claimEbayNotificationEvent(eventId, now),
    ]);
    assert.equal(claimed.filter(Boolean).length, 1);
    assert.equal(claimed.find(Boolean)?.processingStatus, "processing");

    await db.insert(users).values({
      createdAt: now,
      email: `${suffix}@example.invalid`,
      emailVerified: true,
      id: secondOwnerId,
      name: "Constraint test owner",
      publicCollection: false,
      role: "admin",
      updatedAt: now,
    });
    await assert.rejects(
      db.insert(ebayConnections).values({
        createdAt: now,
        ownerId: secondOwnerId,
        refreshTokenCiphertext: "test",
        refreshTokenExpiresAt: new Date(now.getTime() + 60_000),
        refreshTokenIv: "test",
        refreshTokenTag: "test",
        scopes: "test",
        updatedAt: now,
      }),
      (error) => {
        const cause = error instanceof Error ? error.cause : null;
        return Boolean(
          cause
          && typeof cause === "object"
          && "constraint" in cause
          && cause.constraint === "ebay_connections_single_deployment_unique",
        );
      },
    );
  } finally {
    await db.delete(ebayNotificationEvents).where(eq(ebayNotificationEvents.id, eventId));
    await db.delete(users).where(eq(users.id, secondOwnerId));
    if (createdPrimaryConnection) {
      await db
        .delete(ebayConnections)
        .where(eq(ebayConnections.ownerId, primaryOwnerId));
      await db.delete(users).where(eq(users.id, primaryOwnerId));
    }
    await globalThis.ygoWishlistPgPool?.end();
  }
});

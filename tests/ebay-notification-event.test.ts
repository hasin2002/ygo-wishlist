import assert from "node:assert/strict";
import test from "node:test";
import {
  parseEbayNotificationPayload,
} from "../src/lib/records/ebay-notification-event.ts";

test("extracts routing fields from a LISTING notification without buyer data", () => {
  const parsed = parseEbayNotificationPayload({
    metadata: { topic: "LISTING" },
    notification: {
      data: {
        listingId: "123456789",
        user: { username: "seller-name" },
      },
      eventDate: "2026-07-24T10:00:00.000Z",
      notificationId: "notification-listing-1",
      publishDate: "2026-07-24T10:00:01.000Z",
    },
  });

  assert.deepEqual(parsed, {
    eventAt: new Date("2026-07-24T10:00:00.000Z"),
    listingRefs: [{ itemId: "123456789", orderLineItemId: null }],
    notificationId: "notification-listing-1",
    orderId: null,
    publishedAt: new Date("2026-07-24T10:00:01.000Z"),
    sellerUserId: "seller-name",
    topic: "LISTING",
  });
});

test("extracts and de-duplicates every listing reference in an order notification", () => {
  const parsed = parseEbayNotificationPayload({
    metadata: { topic: "ORDER_CONFIRMATION" },
    notification: {
      data: {
        order: {
          orderId: "ORDER-1",
          orderLineItems: [
            { legacyItemId: "111", lineItemId: "LINE-1" },
            { listingId: "222", orderLineItemId: "LINE-2" },
            { listingId: "222", orderLineItemId: "LINE-2" },
          ],
        },
      },
      notificationId: "notification-order-1",
    },
  });

  assert.deepEqual(parsed?.listingRefs, [
    { itemId: "111", orderLineItemId: "LINE-1" },
    { itemId: "222", orderLineItemId: "LINE-2" },
  ]);
  assert.equal(parsed?.orderId, "ORDER-1");
});

test("rejects unsupported topics and notifications without an id", () => {
  assert.equal(parseEbayNotificationPayload({
    metadata: { topic: "ITEM_MARKED_DOWN" },
    notification: { notificationId: "one" },
  }), null);
  assert.equal(parseEbayNotificationPayload({
    metadata: { topic: "LISTING" },
    notification: { data: { listingId: "one" } },
  }), null);
});

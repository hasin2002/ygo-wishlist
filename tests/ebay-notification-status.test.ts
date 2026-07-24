import assert from "node:assert/strict";
import test from "node:test";
import {
  latestEbayNotificationStatusRows,
  planEbayNotificationRowConsolidation,
  publicEbayNotificationError,
} from "../src/lib/records/ebay-notification-status.ts";

test("moves an existing remote subscription instead of inserting a destination duplicate", () => {
  assert.deepEqual(
    planEbayNotificationRowConsolidation({
      destinationId: "production",
      remoteSubscriptionId: "remote-order-subscription",
      rows: [
        {
          destinationId: "ngrok",
          id: "old-enabled-row",
          remoteSubscriptionId: "remote-order-subscription",
        },
        {
          destinationId: "production",
          id: "new-error-row",
          remoteSubscriptionId: null,
        },
      ],
    }),
    {
      preferredId: "old-enabled-row",
      staleIds: ["new-error-row"],
    },
  );
});

test("keeps only the latest destination state for each notification topic", () => {
  const rows = latestEbayNotificationStatusRows([
    {
      createdAt: new Date("2026-07-24T22:00:00Z"),
      destinationId: "ngrok",
      id: "old-order",
      status: "enabled",
      topic: "ORDER_CONFIRMATION",
      updatedAt: new Date("2026-07-24T22:00:00Z"),
    },
    {
      createdAt: new Date("2026-07-24T23:00:00Z"),
      destinationId: "production",
      id: "new-order",
      status: "error",
      topic: "ORDER_CONFIRMATION",
      updatedAt: new Date("2026-07-24T23:00:00Z"),
    },
    {
      createdAt: new Date("2026-07-24T23:00:00Z"),
      destinationId: "production",
      id: "listing",
      status: "unsupported",
      topic: "LISTING",
      updatedAt: new Date("2026-07-24T23:00:00Z"),
    },
  ]);

  assert.deepEqual(
    rows.map((row) => [row.topic, row.destinationId, row.status]),
    [
      ["LISTING", "production", "unsupported"],
      ["ORDER_CONFIRMATION", "production", "error"],
    ],
  );
});

test("does not expose database queries as notification feedback", () => {
  assert.equal(
    publicEbayNotificationError(
      'Failed query: insert into "ebay_notification_subscriptions" values ($1)\nparams: one',
    ),
    "Records could not save the latest notification status. Retry setup after confirming the production database schema is up to date.",
  );
  assert.equal(
    publicEbayNotificationError("eBay rejected the notification destination."),
    "eBay rejected the notification destination.",
  );
  assert.equal(publicEbayNotificationError(null), null);
});

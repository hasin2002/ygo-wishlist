import assert from "node:assert/strict";
import test from "node:test";
import { hasEbayOrderLineTerminalRegression } from "../src/lib/records/ebay-order-line-reconciliation.ts";

const paidAt = new Date("2026-07-25T20:11:00.000Z");
const cancelledAt = new Date("2026-07-25T21:11:00.000Z");

test("a reviewed paid order line can recover when the next observation is still paid", () => {
  assert.equal(hasEbayOrderLineTerminalRegression({
    cancelledAt: null,
    paidAt,
    paymentState: "needs_review",
    saleRecordId: null,
  }, "paid"), false);
});

test("protected paid evidence still rejects pending or cancelled regressions", () => {
  const existing = {
    cancelledAt: null,
    paidAt,
    paymentState: "needs_review" as const,
    saleRecordId: null,
  };
  assert.equal(hasEbayOrderLineTerminalRegression(existing, "pending"), true);
  assert.equal(hasEbayOrderLineTerminalRegression(existing, "cancelled"), true);
});

test("a recorded Sale remains paid even if paidAt was not retained", () => {
  assert.equal(hasEbayOrderLineTerminalRegression({
    cancelledAt: null,
    paidAt: null,
    paymentState: "needs_review",
    saleRecordId: "sale-record-1",
  }, "cancelled"), true);
});

test("protected cancellation evidence rejects a later paid observation", () => {
  assert.equal(hasEbayOrderLineTerminalRegression({
    cancelledAt,
    paidAt: null,
    paymentState: "needs_review",
    saleRecordId: null,
  }, "paid"), true);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  tradingNotificationHealthPresentation,
  tradingNotificationHealthState,
} from "../src/lib/ebay-notification-health-presentation.ts";

test("Trading notification health gives each operational state a distinct customer-facing status", () => {
  assert.equal(tradingNotificationHealthPresentation("active").heading, "Automatic Listing and checkout updates active");
  assert.equal(tradingNotificationHealthPresentation("setup_required").heading, "Setup required");
  assert.equal(tradingNotificationHealthPresentation("delivery_attention").heading, "Delivery needs attention");
  assert.equal(tradingNotificationHealthPresentation("fallback").heading, "Falling back to interaction and daily checks");
});

test("only demonstrated Trading delivery is presented as active", () => {
  assert.equal(tradingNotificationHealthPresentation("active").tone, "success");
  assert.equal(tradingNotificationHealthPresentation("setup_required").tone, "warning");
  assert.equal(tradingNotificationHealthPresentation("delivery_attention").tone, "warning");
  assert.equal(tradingNotificationHealthPresentation("fallback").tone, "warning");
});

test("health requires verified configuration and a demonstrated receipt", () => {
  assert.equal(tradingNotificationHealthState({
    configured: false,
    deliveryAttention: false,
    demonstrated: false,
  }), "setup_required");
  assert.equal(tradingNotificationHealthState({
    configured: true,
    deliveryAttention: false,
    demonstrated: false,
  }), "fallback");
  assert.equal(tradingNotificationHealthState({
    configured: true,
    deliveryAttention: true,
    demonstrated: true,
  }), "delivery_attention");
  assert.equal(tradingNotificationHealthState({
    configured: true,
    deliveryAttention: false,
    demonstrated: true,
  }), "active");
});

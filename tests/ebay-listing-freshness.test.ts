import assert from "node:assert/strict";
import test from "node:test";
import {
  EbayListingFreshnessScheduler,
  ebayListingFreshnessIntervalMs,
  hasNonTerminalEbayListing,
} from "../src/lib/records/use-ebay-listing-freshness.ts";

test("listing freshness uses one visible-screen minute timer and refreshes only after a marker change", async () => {
  let visible = true;
  let timer: (() => void) | null = null;
  let marker = "first";
  let changed = 0;
  const scheduler = new EbayListingFreshnessScheduler({
    checkMarker: async () => marker,
    clearTimer: () => { timer = null; },
    isVisible: () => visible,
    onMarkerChange: () => { changed += 1; },
    setTimer: (callback, delay) => {
      assert.equal(delay, ebayListingFreshnessIntervalMs);
      assert.equal(timer, null, "only one timer is registered for the screen");
      timer = callback;
      return 1;
    },
  });
  scheduler.setBaseline(marker);
  scheduler.start();
  assert.ok(timer);
  const firstTimer = timer as (() => void) | null;
  timer = null;
  firstTimer!();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(changed, 0);
  assert.ok(timer, "the single timer is scheduled again after the marker check");

  marker = "second";
  const secondTimer = timer as (() => void) | null;
  timer = null;
  secondTimer!();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(changed, 1);

  visible = false;
  scheduler.stop();
  scheduler.start();
  assert.equal(timer, null, "hidden screens do not schedule a marker check");

  marker = "third";
  visible = true;
  scheduler.resume();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(changed, 2, "regaining focus checks the marker immediately");
  assert.ok(timer, "the minute timer resumes after the immediate focus check");
  scheduler.stop();
});

test("listing freshness treats live, pending, and uncertain listings as non-terminal", () => {
  assert.equal(hasNonTerminalEbayListing({ lastError: null, listingState: "active", saleState: "none" }), true);
  assert.equal(hasNonTerminalEbayListing({ lastError: null, listingState: "ended", saleState: "pending" }), true);
  assert.equal(hasNonTerminalEbayListing({ lastError: "eBay unavailable", listingState: "ended", saleState: "none" }), true);
  assert.equal(hasNonTerminalEbayListing({ lastError: null, listingState: "ended", saleState: "cancelled" }), false);
});

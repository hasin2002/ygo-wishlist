import assert from "node:assert/strict";
import test from "node:test";
import { toEbayListingTimestamp } from "../src/components/records/ebay-listing-timestamp.ts";

test("listing timestamps accept a Date and a restored string without throwing", () => {
  const timestamp = "2026-07-28T10:30:00.000Z";

  assert.equal(toEbayListingTimestamp(new Date(timestamp)), timestamp);
  assert.equal(toEbayListingTimestamp(timestamp), timestamp);
});

test("listing timestamps reject missing or invalid cache values", () => {
  assert.equal(toEbayListingTimestamp(null), undefined);
  assert.equal(toEbayListingTimestamp(new Date("invalid")), undefined);
  assert.equal(toEbayListingTimestamp("not-a-date"), undefined);
});

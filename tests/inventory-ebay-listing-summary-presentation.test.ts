import assert from "node:assert/strict";
import test from "node:test";
import { inventoryEbayListingSummary } from "../src/components/records/inventory-ebay-listing-summary-presentation.ts";

test("Inventory card eBay listing summary makes an empty state explicit", () => {
  assert.deepEqual(inventoryEbayListingSummary(0, 0), {
    accessibleLabel: "eBay listings. No eBay listings yet.",
    heading: "eBay listings",
    summary: "No eBay listings yet",
  });
});

test("Inventory card eBay listing summary uses natural singular and plural live-offer language", () => {
  assert.equal(inventoryEbayListingSummary(1, 0).summary, "1 live offer");
  assert.equal(inventoryEbayListingSummary(2, 0).summary, "2 live offers");
});

test("Inventory card eBay listing summary makes ended-only history clear without implying a live listing", () => {
  assert.equal(inventoryEbayListingSummary(0, 1).summary, "1 previous offer");
  assert.equal(inventoryEbayListingSummary(0, 2).summary, "2 previous offers");
});

test("Inventory card eBay listing summary combines current and previous offers clearly", () => {
  assert.deepEqual(inventoryEbayListingSummary(2, 1), {
    accessibleLabel: "eBay listings. 2 live offers · 1 previous offer.",
    heading: "eBay listings",
    summary: "2 live offers · 1 previous offer",
  });
});

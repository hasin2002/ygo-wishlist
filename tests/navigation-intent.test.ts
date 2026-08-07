import assert from "node:assert/strict";
import test from "node:test";
import {
  addTaskHref,
  currentNavigationHref,
  loginHref,
  paidEbaySaleReviewHref,
  parseNavigationIntent,
  parsePaidEbaySaleReviewIntent,
  parseSaleReviewIntent,
  protectedLoginHref,
  recordEditHref,
  reviewSaleHref,
  safeNavigationHref,
  serializeNavigationIntent,
  taskReturnHref,
} from "../src/lib/navigation-intent.ts";

test("navigation intents round-trip supported protected workspace URLs", () => {
  const paths = [
    "/records/inventory/cards/target-1?kind=cards&rarity=Ultra+Rare&rarity=Secret+Rare&page=3&copy=copy-1",
    "/records/listings/listing-1?query=Dark+Magician&lifecycle=paid&page=2",
    "/ebay?returnTo=%2Frecords%2Finventory%3Fpage%3D2",
    "/wheel?mode=pick",
    "/spend?month=2026-07",
    "/assign-chase?target=target-1",
    "/wishlist/new",
  ];

  for (const path of paths) {
    const intent = parseNavigationIntent(path);
    assert.ok(intent, path);
    assert.equal(serializeNavigationIntent(intent), path);
  }
});

test("navigation intents reject external, malformed, and unsupported destinations", () => {
  for (const value of [
    "https://example.test/records",
    "//example.test/records",
    "javascript:alert(1)",
    "/%2f%2fexample.test",
    "/records%2f..%2fsecret",
    "/feature-ideas",
    "/login",
    "/api/records",
    "/records\\evil",
    "/records\u0000evil",
    "/records?query=%",
    "/records/%2e%2e/ebay",
    "records/inventory",
  ]) {
    assert.equal(parseNavigationIntent(value), null, value);
  }
  assert.equal(safeNavigationHref("https://example.test", "/records"), "/records");
});

test("auth and Add helpers keep a safe origin while falling back conservatively", () => {
  const origin = "/records/inventory/cards/target-1?kind=cards&page=2&copy=copy-1";
  assert.equal(loginHref(origin), `/login?next=${encodeURIComponent(origin)}`);
  assert.equal(loginHref("//example.test"), "/login");
  assert.equal(addTaskHref("/records/new/sale", origin), `/records/new/sale?origin=${encodeURIComponent(origin)}`);
  assert.equal(taskReturnHref(origin), origin);
  assert.equal(taskReturnHref("/feature-ideas"), "/records");

  const current = currentNavigationHref("/", new URLSearchParams("status=wishlist&page=3"));
  assert.equal(current?.href, "/?status=wishlist&page=3");
});

test("a stale session-cookie handoff retains Proxy's exact safe return intent", () => {
  const destination = "/records/inventory/cards/target-1?kind=cards&rarity=Ultra+Rare&page=3&copy=copy-1";
  assert.equal(
    protectedLoginHref(destination, "/records"),
    `/login?next=${encodeURIComponent(destination)}`,
  );
  assert.equal(protectedLoginHref("https://example.test", "/records"), "/login?next=%2Frecords");
  assert.equal(protectedLoginHref(null, "/records"), "/login?next=%2Frecords");
});

test("Review Sale uses only a bounded, non-control record ID", () => {
  assert.deepEqual(parseSaleReviewIntent("sale-123"), { recordId: "sale-123" });
  assert.equal(reviewSaleHref("sale-123"), "/records/history?record=sale-123");
  assert.equal(parseSaleReviewIntent(""), null);
  assert.equal(parseSaleReviewIntent("sale\u0000id"), null);
  assert.equal(reviewSaleHref(""), "/records/history");
});

test("History edit links return each Record to its full-page entry route", () => {
  assert.equal(recordEditHref({ id: "purchase-1", type: "purchase" }), "/records/new/purchase?edit=purchase-1&origin=%2Frecords%2Fhistory");
  assert.equal(recordEditHref({ id: "import-1", type: "imported-acquisition" }), "/records/new/purchase?edit=import-1&origin=%2Frecords%2Fhistory");
  assert.equal(recordEditHref({ id: "opening-1", type: "pack-opening" }), "/records/new/opening?edit=opening-1&origin=%2Frecords%2Fhistory");
  assert.equal(recordEditHref({ id: "sale-1", type: "sale" }), "/records/new/sale?edit=sale-1&origin=%2Frecords%2Fhistory");
});

test("paid eBay Sale review carries one bounded exact Listing and Copy", () => {
  const href = paidEbaySaleReviewHref(
    { copyId: "copy-123", listingId: "listing-456" },
    "/records/listings/listing-456?lifecycle=paid&page=2",
  );
  const url = new URL(href, "https://collection-hub.invalid");
  assert.equal(url.pathname, "/records/new/sale");
  assert.deepEqual(parsePaidEbaySaleReviewIntent(url.searchParams), {
    copyId: "copy-123",
    listingId: "listing-456",
  });
  assert.equal(
    url.searchParams.get("origin"),
    "/records/listings/listing-456?lifecycle=paid&page=2",
  );

  for (const query of [
    "",
    "intent=paid-ebay-sale&copyId=copy-1",
    "intent=paid-ebay-sale&listingId=listing-1",
    "intent=other&copyId=copy-1&listingId=listing-1",
    "intent=paid-ebay-sale&copyId=copy-1&copyId=copy-2&listingId=listing-1",
    `intent=paid-ebay-sale&copyId=${"c".repeat(161)}&listingId=listing-1`,
    "intent=paid-ebay-sale&copyId=copy%00one&listingId=listing-1",
  ]) {
    assert.equal(parsePaidEbaySaleReviewIntent(new URLSearchParams(query)), null, query);
  }
  assert.equal(
    paidEbaySaleReviewHref({ copyId: "", listingId: "listing-1" }),
    "/records/new/sale?intent=paid-ebay-sale",
  );
});

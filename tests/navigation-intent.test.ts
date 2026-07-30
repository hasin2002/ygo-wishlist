import assert from "node:assert/strict";
import test from "node:test";
import {
  addTaskHref,
  currentNavigationHref,
  loginHref,
  parseNavigationIntent,
  parseSaleReviewIntent,
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

test("Review Sale uses only a bounded, non-control record ID", () => {
  assert.deepEqual(parseSaleReviewIntent("sale-123"), { recordId: "sale-123" });
  assert.equal(reviewSaleHref("sale-123"), "/records/history?record=sale-123");
  assert.equal(parseSaleReviewIntent(""), null);
  assert.equal(parseSaleReviewIntent("sale\u0000id"), null);
  assert.equal(reviewSaleHref(""), "/records/history");
});

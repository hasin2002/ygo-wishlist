import assert from "node:assert/strict";
import test from "node:test";
import { ebayTokenFailureKind } from "../src/lib/ebay-token-failure.ts";

test("only a rejected seller credential requires reconnecting eBay", () => {
  assert.equal(ebayTokenFailureKind(400, "seller_refresh"), "authorization");
  assert.equal(ebayTokenFailureKind(401, "seller_refresh"), "authorization");
  assert.equal(ebayTokenFailureKind(403, "seller_refresh"), "authorization");
});

test("rate limits and upstream failures are retryable without replacing a connection", () => {
  assert.equal(ebayTokenFailureKind(429, "seller_refresh"), "temporary");
  assert.equal(ebayTokenFailureKind(500, "seller_refresh"), "temporary");
  assert.equal(ebayTokenFailureKind(503, "seller_refresh"), "temporary");
});

test("rejected app credentials are reported as configuration, not seller reconnects", () => {
  assert.equal(ebayTokenFailureKind(401, "application"), "configuration");
});

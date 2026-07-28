import assert from "node:assert/strict";
import test from "node:test";
import {
  deserializeQueryCache,
  legacyQueryCacheStorageKey,
  queryCacheBuster,
  queryCacheStorageKey,
  serializeQueryCache,
} from "../src/lib/query-cache-persistence.ts";

test("persisted query data keeps Dates as Dates across a browser-cache round trip", () => {
  const checkedAt = new Date("2026-07-28T10:30:00.000Z");
  const restored = deserializeQueryCache<{ queries: Array<{ state: { data: { checkedAt: Date } } }> }>(
    serializeQueryCache({ queries: [{ state: { data: { checkedAt } } }] }),
  );

  assert.equal(restored.queries[0]?.state.data.checkedAt instanceof Date, true);
  assert.equal(restored.queries[0]?.state.data.checkedAt.toISOString(), checkedAt.toISOString());
});

test("the incompatible JSON cache has a new storage key and buster", () => {
  assert.equal(legacyQueryCacheStorageKey, "ygo-wishlist:query-cache:v1");
  assert.equal(queryCacheStorageKey, "ygo-wishlist:query-cache:v2");
  assert.equal(queryCacheBuster, "v2");
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  deserializeQueryCache,
  legacyQueryCacheStorageKey,
  queryCacheBuster,
  queryCacheStorageKey,
  serializeQueryCache,
  collectionQueryPath,
  hasFailedActiveCollectionQuery,
} from "../src/lib/query-cache-persistence.ts";

test("persisted query data keeps Dates as Dates across a browser-cache round trip", () => {
  const checkedAt = new Date("2026-07-28T10:30:00.000Z");
  const restored = deserializeQueryCache<{ queries: Array<{ state: { data: { checkedAt: Date } } }> }>(
    serializeQueryCache({ queries: [{ state: { data: { checkedAt } } }] }, 4),
  );

  assert.equal(restored.queries[0]?.state.data.checkedAt instanceof Date, true);
  assert.equal(restored.queries[0]?.state.data.checkedAt.toISOString(), checkedAt.toISOString());
});

test("a persisted collection snapshot older than the confirmed revision is discarded", () => {
  const restored = deserializeQueryCache<{ clientState: { queries: Array<{ queryKey: unknown }> } }>(
    serializeQueryCache({ clientState: { queries: [
      { queryKey: [["library", "list"]] },
      { queryKey: [["featureIdeas", "list"]] },
    ] } }, 2),
    3,
  );
  assert.deepEqual(restored.clientState.queries, [{ queryKey: [["featureIdeas", "list"]] }]);
});

test("an invalidated query is not persisted with a newer collection revision", () => {
  const restored = deserializeQueryCache<{ clientState: { queries: Array<{ queryKey: unknown }> } }>(
    serializeQueryCache({ clientState: { queries: [
      { queryKey: [["library", "list"]], state: { isInvalidated: true } },
      { queryKey: [["featureIdeas", "list"]], state: { isInvalidated: false } },
    ] } }, 9),
    9,
  );
  assert.deepEqual(restored.clientState.queries, [{ queryKey: [["featureIdeas", "list"]], state: { isInvalidated: false } }]);
});

test("an old tab cannot stamp old data with a newer shared revision", () => {
  const oldTabDataRevision = "7:tab-a:0" as const;
  const newerConfirmedRevision = "8:tab-b:0" as const;
  const serializedAfterOtherTabChanged = serializeQueryCache({ clientState: { queries: [
    { queryKey: [["records", "snapshot"]], state: { data: "old tab snapshot" } },
  ] } }, oldTabDataRevision);
  const restored = deserializeQueryCache<{ clientState: { queries: unknown[] } }>(serializedAfterOtherTabChanged, newerConfirmedRevision);
  assert.deepEqual(restored.clientState.queries, []);
});

test("collection query matching uses exact tRPC paths, not input substrings", () => {
  assert.equal(collectionQueryPath([["featureIdeas", "list"], { input: { query: "wheel" } }]), null);
  assert.equal(collectionQueryPath([["library", "list"], { input: { query: "wheel" } }]), "library.list");
  assert.equal(collectionQueryPath([["spend", "monthlyFavourites"], { input: { month: "wheel" } }]), "spend.monthlyFavourites");
  assert.equal(collectionQueryPath([["spend", "monthlyFavourite"], { input: null }]), null);
});

test("only an active failed affected projection makes a settled refresh fail", () => {
  const affected = new Set(["wheel.state"]);
  assert.equal(hasFailedActiveCollectionQuery([
    { queryKey: [["wheel", "state"]], observerCount: 1, status: "error" },
  ], affected), true);
  assert.equal(hasFailedActiveCollectionQuery([
    { queryKey: [["wheel", "state"]], observerCount: 0, status: "error" },
    { queryKey: [["featureIdeas", "list"], { input: { query: "wheel" } }], observerCount: 1, status: "error" },
  ], affected), false);
  assert.equal(hasFailedActiveCollectionQuery([
    { queryKey: [["wheel", "state"]], observerCount: 1, status: "success" },
  ], affected), false);
});

test("accepted persisted revisions update tab cache state, stale ones do not", () => {
  const accepted: string[] = [];
  const cache = { clientState: { queries: [{ queryKey: [["library", "list"]] }] } };
  deserializeQueryCache(serializeQueryCache(cache, "4:tab-a:0"), "4:tab-a:0", (revision) => accepted.push(revision));
  deserializeQueryCache(serializeQueryCache(cache, "3:tab-a:0"), "4:tab-a:0", (revision) => accepted.push(revision));
  assert.deepEqual(accepted, ["4:tab-a:0"]);
});

test("a same-kind concurrent change cannot let a lower revision restore stale collection data", () => {
  const stale = serializeQueryCache({ clientState: { queries: [
    { queryKey: [["library", "trackerPage"]], state: { data: "stale" } },
  ] } }, "50:tab-a:0");
  const restored = deserializeQueryCache<{ clientState: { queries: unknown[] } }>(stale, "50:tab-b:0");
  assert.deepEqual(restored.clientState.queries, []);
});

test("the incompatible cache has a new storage key and buster", () => {
  assert.equal(legacyQueryCacheStorageKey, "ygo-wishlist:query-cache:v1");
  assert.equal(queryCacheStorageKey, "ygo-wishlist:query-cache:v4");
  assert.equal(queryCacheBuster, "v4");
});

import assert from "node:assert/strict";
import test from "node:test";
import { createExpiringSingleFlightCache } from "../src/lib/expiring-single-flight-cache.ts";

test("an expiring cache shares a single in-flight refresh and isolates owners", async () => {
  let now = 1_000;
  const cache = createExpiringSingleFlightCache<string>(() => now);
  let ownerOneLoads = 0;
  let ownerTwoLoads = 0;

  const loadOwnerOne = async () => {
    ownerOneLoads += 1;
    return { expiresAt: now + 120_000, value: "owner-one-token" };
  };

  const [first, second, otherOwner] = await Promise.all([
    cache.get("owner-one", loadOwnerOne),
    cache.get("owner-one", loadOwnerOne),
    cache.get("owner-two", async () => {
      ownerTwoLoads += 1;
      return { expiresAt: now + 120_000, value: "owner-two-token" };
    }),
  ]);

  assert.equal(first, "owner-one-token");
  assert.equal(second, "owner-one-token");
  assert.equal(otherOwner, "owner-two-token");
  assert.equal(ownerOneLoads, 1);
  assert.equal(ownerTwoLoads, 1);

  now += 120_001;
  await cache.get("owner-one", loadOwnerOne);
  assert.equal(ownerOneLoads, 2);
});

test("invalidating a cache entry prevents an older in-flight token from being retained", async () => {
  const cache = createExpiringSingleFlightCache<string>();
  let resolveFirst: ((value: { expiresAt: number; value: string }) => void) | undefined;
  const first = cache.get("owner-one", () => new Promise((resolve) => { resolveFirst = resolve; }));

  cache.invalidate("owner-one");
  const current = await cache.get("owner-one", async () => ({
    expiresAt: Date.now() + 120_000,
    value: "current-token",
  }));
  resolveFirst?.({ expiresAt: Date.now() + 120_000, value: "stale-token" });
  await first;

  const retained = await cache.get("owner-one", async () => ({
    expiresAt: Date.now() + 120_000,
    value: "unexpected-token",
  }));
  assert.equal(current, "current-token");
  assert.equal(retained, "current-token");
});

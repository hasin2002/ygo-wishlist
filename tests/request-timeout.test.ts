import assert from "node:assert/strict";
import test from "node:test";
import { timeoutForRequest } from "../src/lib/request-timeout.ts";
test("owned saves, including batched calls, have a save deadline and safe recovery instructions", () => {
  for (const url of ["/api/trpc/records.addOwnedCards", "/api/trpc/records.snapshot,records.addOwnedCards?batch=1"]) {
    assert.equal(timeoutForRequest(url).milliseconds, 60_000);
    assert.match(timeoutForRequest(url).message, /list is preserved/);
    assert.match(timeoutForRequest(url).message, /not be duplicated/);
  }
  assert.equal(timeoutForRequest("/api/trpc/records.createPurchase").milliseconds, 60_000);
  assert.equal(timeoutForRequest("/api/trpc/records.createOpening").milliseconds, 60_000);
  assert.equal(timeoutForRequest("/api/trpc/cardCatalogue.search").milliseconds, 15_000);
});

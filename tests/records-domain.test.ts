import assert from "node:assert/strict";
import test from "node:test";
import { allocatePence, allocatePenceAt } from "../src/lib/records/allocation.ts";
import { getLibraryCardStatus } from "../src/lib/records/library-status.ts";

test("bulk allocation uses the full lot quantity, not only identified cards", () => {
  assert.equal(allocatePenceAt(2_000, 10, 0), 200);
  assert.equal(allocatePenceAt(2_000, 10, 1), 200);
});

test("bulk allocation preserves every penny deterministically", () => {
  const allocations = allocatePence(100, 3);
  assert.deepEqual(allocations, [34, 33, 33]);
  assert.equal(allocations.reduce((sum, value) => sum + value, 0), 100);
});

test("later itemization uses stable allocation indexes", () => {
  const initial = [0, 1].map((index) => allocatePenceAt(1_003, 10, index));
  const later = [2, 3, 4].map((index) => allocatePenceAt(1_003, 10, index));
  assert.deepEqual(initial, [101, 101]);
  assert.deepEqual(later, [101, 100, 100]);
});

test("Library status is computed from wanted and available Copy quantities", () => {
  assert.deepEqual(getLibraryCardStatus(2, 1), {
    status: "wishlist",
    ownedQuantity: 1,
    wantedQuantity: 2,
    wishlistRemainingQuantity: 1,
  });
  assert.deepEqual(getLibraryCardStatus(2, 2), {
    status: "owned",
    ownedQuantity: 2,
    wantedQuantity: 2,
    wishlistRemainingQuantity: 0,
  });
});

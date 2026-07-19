import assert from "node:assert/strict";
import test from "node:test";
import { allocatePence, allocatePenceAt } from "../src/lib/records/allocation.ts";
import { getLibraryCardStatus } from "../src/lib/records/library-status.ts";
import { recordImagePreviewsFor } from "../src/lib/records/record-images.ts";
import type { RecordsSnapshot } from "../src/lib/records/types.ts";

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

test("pack-opening records use the opened product image instead of pulled card images", () => {
  const opening = {
    id: "record-opening",
    type: "pack-opening" as const,
    status: "active" as const,
    date: "2026-07-19",
    title: "Set opening",
    source: "Collection",
    listingUrl: null,
    amountPence: 0,
    notes: "",
    revision: 1,
    createdAt: "2026-07-19T12:00:00.000Z",
    lines: [{
      id: "line-pull",
      kind: "card" as const,
      name: "Pulled card",
      quantity: 1,
      allocationPence: null,
      entityIds: ["copy-pull"],
      detail: null,
    }],
  };
  const snapshot: RecordsSnapshot = {
    version: 1,
    records: [opening],
    targets: [{
      id: "target-pull",
      name: "Pulled card",
      rarity: "Secret Rare",
      edition: "1st Edition",
      desiredQuantity: 1,
      imageUrl: "https://example.com/pulled-card.jpg",
      tcgplayerUrl: null,
      marketPricePence: null,
    }],
    printings: [{
      id: "printing-pull",
      targetId: "target-pull",
      setName: "Example Set",
      setCode: "EX-001",
      tcgplayerUrl: null,
      imageUrl: "https://example.com/pulled-card.jpg",
    }],
    copies: [{
      id: "copy-pull",
      printingId: "printing-pull",
      acquiredRecordId: opening.id,
      soldRecordId: null,
      bulkLotId: null,
      allocationIndex: null,
      allocationPence: null,
      status: "available",
      condition: "Near Mint",
    }],
    sealedUnits: [{
      id: "sealed-set",
      name: "Example Booster Set",
      quantity: 1,
      imageUrl: "https://example.com/booster-set.jpg",
      status: "opened",
      acquiredRecordId: "record-purchase",
      openedRecordId: opening.id,
    }],
    bulkLots: [],
    supplies: [],
    attention: [],
  };

  assert.deepEqual(recordImagePreviewsFor(opening, snapshot), [{
    id: "sealed-set",
    imageUrl: "https://example.com/booster-set.jpg",
    kind: "sealed",
    name: "Example Booster Set",
  }]);
});

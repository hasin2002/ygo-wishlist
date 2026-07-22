import assert from "node:assert/strict";
import test from "node:test";
import { allocatePence, allocatePenceAt } from "../src/lib/records/allocation.ts";
import { getLibraryCardStatus } from "../src/lib/records/library-status.ts";
import { recordImagePreviewsFor } from "../src/lib/records/record-images.ts";
import { createPreviewSnapshot, removeCardCopy, replaceRecordCards, updateCardCopy } from "../src/lib/records/preview-data.ts";
import type { RecordsSnapshot } from "../src/lib/records/types.ts";

function twoCopyPurchase(): RecordsSnapshot {
  return {
    version: 1,
    records: [{
      id: "record-purchase",
      type: "purchase",
      status: "active",
      date: "2026-07-20",
      title: "Two copies",
      source: "eBay",
      listingUrl: null,
      amountPence: 101,
      notes: "",
      revision: 1,
      createdAt: "2026-07-20T12:00:00.000Z",
      lines: [{
        id: "line-card",
        kind: "card",
        name: "Ash Blossom & Joyous Spring",
        quantity: 2,
        allocationPence: 101,
        entityIds: ["copy-one", "copy-two"],
        detail: "RA01-EN008 · 1st Edition · Super Rare",
      }],
    }],
    targets: [{
      id: "target-ash",
      name: "Ash Blossom & Joyous Spring",
      rarity: "Super Rare",
      edition: "1st Edition",
      desiredQuantity: 2,
      imageUrl: null,
      tcgplayerUrl: "https://www.tcgplayer.com/product/1/example",
      marketPricePence: null,
    }],
    printings: [{
      id: "printing-ash",
      targetId: "target-ash",
      setName: "25th Anniversary Rarity Collection",
      setCode: "RA01-EN008",
      tcgplayerUrl: "https://www.tcgplayer.com/product/1/example",
      imageUrl: null,
    }],
    copies: ["one", "two"].map((suffix, index) => ({
      id: `copy-${suffix}`,
      printingId: "printing-ash",
      acquiredRecordId: "record-purchase",
      soldRecordId: null,
      bulkLotId: null,
      allocationIndex: null,
      allocationPence: index === 0 ? 51 : 50,
      status: "available" as const,
      condition: "Near Mint",
      location: null,
      stickerNumber: null,
      privateNote: "",
      createdAt: `2026-07-20T12:00:0${index}.000Z`,
    })),
    sealedUnits: [],
    bulkLots: [],
    supplies: [],
    attention: [],
  };
}

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

test("removing a physical Copy removes that exact Copy and rebases its purchase allocation", () => {
  const result = removeCardCopy(twoCopyPurchase(), "copy-two");
  assert.equal(result.result.ok, true);
  assert.deepEqual(result.next.copies.map((copy) => copy.id), ["copy-one"]);
  assert.equal(result.next.copies[0]?.allocationPence, 101);
  assert.deepEqual(result.next.records[0]?.lines[0]?.entityIds, ["copy-one"]);
  assert.equal(result.next.records[0]?.lines[0]?.quantity, 1);
});

test("copy details are edited independently", () => {
  const result = updateCardCopy(twoCopyPurchase(), "copy-two", {
    condition: "Lightly Played",
    location: "Binder 2 · Page 7 · Slot 3",
    stickerNumber: "00042",
    privateNote: "  Small mark on the back  ",
  });
  assert.equal(result.result.ok, true);
  assert.equal(result.next.copies[0]?.condition, "Near Mint");
  assert.equal(result.next.copies[1]?.condition, "Lightly Played");
  assert.equal(result.next.copies[1]?.location, "Binder 2 · Page 7 · Slot 3");
  assert.equal(result.next.copies[1]?.stickerNumber, "00042");
  assert.equal(result.next.copies[1]?.privateNote, "Small mark on the back");

  const cleared = updateCardCopy(result.next, "copy-two", {
    condition: "Near Mint",
    location: "   ",
    stickerNumber: "",
    privateNote: "",
  });
  assert.equal(cleared.next.copies[1]?.location, null);
  assert.equal(cleared.next.copies[1]?.stickerNumber, null);
});

test("copy sticker numbers stay unique within preview inventory", () => {
  const first = updateCardCopy(twoCopyPurchase(), "copy-one", {
    condition: "Near Mint",
    location: "Binder 1",
    stickerNumber: "00042",
    privateNote: "",
  });
  const duplicate = updateCardCopy(first.next, "copy-two", {
    condition: "Near Mint",
    location: "Binder 2",
    stickerNumber: "00042",
    privateNote: "",
  });

  assert.equal(duplicate.result.ok, false);
  if (!duplicate.result.ok) assert.match(duplicate.result.message, /already assigned/i);
  assert.equal(duplicate.next.copies[1]?.stickerNumber, null);
});

test("legacy preview Copies keep an unknown condition until the user chooses a grade", () => {
  const snapshot = createPreviewSnapshot([{
    id: 99,
    name: "Legacy card",
    url: null,
    source: "manual",
    imageUrl: null,
    priceText: null,
    marketPriceText: null,
    paidPriceText: null,
    purchaseMonth: null,
    rarity: null,
    status: "owned",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
  }]);

  const legacyCopy = snapshot.copies.find((copy) => copy.id === "copy-legacy-99");
  assert.equal(legacyCopy?.condition, "Unknown");
});

test("source-record editing cannot implicitly remove an arbitrary physical Copy", () => {
  const snapshot = twoCopyPurchase();
  const result = replaceRecordCards(snapshot, "record-purchase", [{
    id: "line-card",
    selectedTargetId: "target-ash",
    tcgplayerUrl: "https://www.tcgplayer.com/product/1/example",
    name: "Ash Blossom & Joyous Spring",
    imageUrl: null,
    edition: "1st Edition",
    rarity: "Super Rare",
    setName: "25th Anniversary Rarity Collection",
    setCode: "RA01-EN008",
    metadataNeedsAttention: false,
    quantity: 1,
  }]);
  assert.equal(result.result.ok, false);
  if (!result.result.ok) assert.match(result.result.message, /exact physical Copy/i);
  assert.equal(result.next.copies.length, 2);
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
    location: null,
    stickerNumber: null,
    privateNote: "",
    createdAt: "2026-07-01T00:00:00.000Z",
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

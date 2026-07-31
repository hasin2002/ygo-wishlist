import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { allocatePence, allocatePenceAt } from "../src/lib/records/allocation.ts";
import { paidCostSummary } from "../src/lib/records/paid-cost-summary.ts";
import { ordinaryPurchaseCopyAllocations } from "../src/lib/records/purchase-accounting.ts";
import { getLibraryCardStatus } from "../src/lib/records/library-status.ts";
import { recordImagePreviewsFor } from "../src/lib/records/record-images.ts";
import { applyOpening, applyPurchase, changeRecordStatus, createPreviewSnapshot, deleteWishlistTarget, removeCardCopy, replaceRecordCards, updateCardCopy, updateRecordDetails, updateRecordLine } from "../src/lib/records/preview-data.ts";
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
    copyEbayExposures: [],
    sealedUnits: [],
    bulkLots: [],
    supplies: [],
    attention: [],
  };
}

function sourceFile(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
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

test("ordinary Purchase allocation keeps known £0 distinct from unknown", () => {
  assert.deepEqual(ordinaryPurchaseCopyAllocations({ amountKnown: true, amountPence: 0, copyCount: 2 }), [0, 0]);
  assert.deepEqual(ordinaryPurchaseCopyAllocations({ amountKnown: true, amountPence: 101, copyCount: 2 }), [51, 50]);
  assert.deepEqual(ordinaryPurchaseCopyAllocations({ amountKnown: false, amountPence: 0, copyCount: 2 }), [null, null]);
  assert.throws(() => ordinaryPurchaseCopyAllocations({ amountKnown: true, amountPence: 1, copyCount: 0 }), /at least one physical Copy/i);
});

test("Library paid summary labels partial totals and preserves intentional zero", () => {
  assert.equal(
    paidCostSummary({ formattedKnownTotal: "£12.00", knownCopyCount: 2, unknownCopyCount: 1 }),
    "Known paid £12.00 · 1 cost unknown",
  );
  assert.equal(
    paidCostSummary({ formattedKnownTotal: "£0.00", knownCopyCount: 1, unknownCopyCount: 0 }),
    "Paid £0.00",
  );
  assert.equal(
    paidCostSummary({ formattedKnownTotal: "£0.00", knownCopyCount: 0, unknownCopyCount: 2 }),
    "2 costs unknown",
  );
});

test("amount entry keeps £0 separate from blank and malformed values", () => {
  const entryUi = sourceFile("src/components/records/entry-form-ui.tsx");
  assert.match(entryUi, /if \(!\/\^\\d\+\(\?:\\\.\\d\{1,2\}\)\?\$\/\.test\(normalized\)\) return null;/);
  assert.match(entryUi, /export function parsePoundsToPence/);
});

test("preview rejects a crafted multi-line ordinary Purchase edit without changing the snapshot", () => {
  const snapshot = twoCopyPurchase();
  snapshot.records[0]!.lines.push({
    id: "crafted-line", kind: "card", name: "Crafted", quantity: 1,
    allocationPence: 101, entityIds: [], detail: null,
  });
  const result = updateRecordDetails(snapshot, "record-purchase", {
    title: "Should not save", date: "2026-07-20", source: "eBay", listingUrl: null,
    amountPence: 200, amountKnown: true, notes: "",
  });
  assert.equal(result.result.ok, false);
  assert.equal(result.next, snapshot);
  assert.equal(snapshot.records[0]?.amountPence, 101);
});

test("preview preserves an omitted unknown imported-acquisition amount and reconciles its source line", () => {
  const snapshot = twoCopyPurchase();
  const record = snapshot.records[0]!;
  record.type = "imported-acquisition";
  record.amountPence = 0;
  record.amountKnown = false;
  record.lines[0]!.allocationPence = null;
  for (const copy of snapshot.copies) copy.allocationPence = null;

  const updated = updateRecordDetails(snapshot, record.id, {
    title: record.title,
    date: record.date,
    source: record.source,
    listingUrl: record.listingUrl,
    amountPence: 500,
    notes: "Amount remains unknown until the user explicitly records it.",
  });

  assert.equal(updated.result.ok, true);
  assert.equal(updated.next.records[0]?.amountKnown, false);
  assert.equal(updated.next.records[0]?.amountPence, 0);
  assert.equal(updated.next.records[0]?.lines[0]?.allocationPence, null);
});

test("preview bulk edits and Copy removal do not turn an unknown cost into £0", () => {
  const created = applyPurchase(createPreviewSnapshot([]), {
    kind: "bulk",
    recordName: "Unknown bulk",
    date: "2026-07-29",
    source: "Card shop",
    listingUrl: "",
    totalPence: 0,
    amountKnown: false,
    notes: "",
    totalCardCount: 4,
    cards: [{
      id: "unknown-bulk-card",
      selectedTargetId: null,
      tcgplayerUrl: "https://www.tcgplayer.com/product/1/example",
      name: "Dark Magician",
      imageUrl: null,
      edition: "1st Edition",
      rarity: "Ultra Rare",
      setName: "Legend of Blue Eyes White Dragon",
      setCode: "LOB-005",
      metadataNeedsAttention: false,
      quantity: 2,
    }],
  });
  assert.equal(created.result.ok, true);
  const record = created.next.records[0]!;
  const bulkLine = record.lines.find((line) => line.kind === "bulk")!;
  const cardLine = record.lines.find((line) => line.kind === "card")!;
  const resized = updateRecordLine(created.next, record.id, bulkLine.id, {
    name: bulkLine.name,
    quantity: 1,
    detail: bulkLine.detail ?? "",
    totalQuantity: 5,
  });
  assert.equal(resized.result.ok, true);
  assert.deepEqual(resized.next.copies.filter((copy) => copy.acquiredRecordId === record.id).map((copy) => copy.allocationPence), [null, null]);
  assert.equal(resized.next.records.find((item) => item.id === record.id)?.lines.find((line) => line.id === cardLine.id)?.allocationPence, null);

  const removed = removeCardCopy(resized.next, resized.next.copies.find((copy) => copy.acquiredRecordId === record.id)!.id);
  assert.equal(removed.result.ok, true);
  assert.equal(removed.next.records.find((item) => item.id === record.id)?.lines.find((line) => line.id === cardLine.id)?.allocationPence, null);
});

test("preview sealed Purchase edits preserve exact-unit cost history", () => {
  const created = applyPurchase(createPreviewSnapshot([]), {
    kind: "sealed",
    recordName: "Three sealed units",
    date: "2026-07-29",
    source: "Card shop",
    listingUrl: "",
    totalPence: 100,
    amountKnown: true,
    notes: "",
    product: {
      tcgplayerUrl: "https://www.tcgplayer.com/product/1/example",
      name: "Example sealed product",
      imageUrl: null,
      edition: "1st Edition",
      rarity: "Ultra Rare",
      setName: "Example set",
      setCode: "EX-001",
      metadataNeedsAttention: false,
      quantity: 3,
    },
  });
  assert.equal(created.result.ok, true);
  const purchase = created.next.records[0]!;
  const line = purchase.lines[0]!;

  const resized = updateRecordLine(created.next, purchase.id, line.id, {
    name: line.name, quantity: 2, detail: line.detail ?? "", edition: "1st Edition",
  });
  assert.equal(resized.result.ok, true);
  const resizedUnits = resized.next.sealedUnits.filter((unit) => unit.acquiredRecordId === purchase.id);
  assert.equal(resizedUnits.reduce((sum, unit) => sum + (unit.allocationPence ?? 0), 0), 100);
  assert.deepEqual(resizedUnits.map((unit) => unit.allocationMode), ["equal", "equal"]);
  assert.deepEqual(resizedUnits.map((unit) => unit.allocationPence).sort((left, right) => (left ?? 0) - (right ?? 0)), [50, 50]);

  const opened = applyOpening(resized.next, {
    useTrackedStock: true,
    sealedUnitId: resizedUnits[0]!.id,
    recordName: "Opened one",
    date: "2026-07-30",
    source: "Collection",
    amountKnown: true,
    totalPence: 0,
    notes: "",
    product: {
      tcgplayerUrl: "https://www.tcgplayer.com/product/1/example",
      name: "Example sealed product",
      imageUrl: null,
      edition: "1st Edition",
      rarity: "Ultra Rare",
      setName: "Example set",
      setCode: "EX-001",
      metadataNeedsAttention: false,
    },
    pulls: [],
  });
  assert.equal(opened.result.ok, true);
  const blockedQuantity = updateRecordLine(opened.next, purchase.id, line.id, {
    name: line.name, quantity: 3, detail: line.detail ?? "", edition: "1st Edition",
  });
  assert.equal(blockedQuantity.result.ok, false);
  assert.equal(blockedQuantity.next, opened.next);
  const blockedIdentity = updateRecordLine(opened.next, purchase.id, line.id, {
    name: "Different product", quantity: 2, detail: line.detail ?? "", edition: "1st Edition",
  });
  assert.equal(blockedIdentity.result.ok, false);
  const blockedCost = updateRecordDetails(opened.next, purchase.id, {
    title: purchase.title, date: purchase.date, source: purchase.source, listingUrl: null,
    amountPence: 101, amountKnown: true, notes: purchase.notes,
  });
  assert.equal(blockedCost.result.ok, false);
  assert.equal(blockedCost.next, opened.next);
});

test("sold Copy provenance keeps its Purchase allocation through an edit and Sale void/restore", () => {
  const snapshot = twoCopyPurchase();
  snapshot.copies[0]!.status = "sold";
  snapshot.copies[0]!.soldRecordId = "sale-1";
  snapshot.records.push({ id: "sale-1", type: "sale", status: "active", date: "2026-07-21", title: "Sale", source: "eBay", listingUrl: null, amountPence: 100, notes: "", revision: 1, createdAt: "2026-07-21T00:00:00Z", lines: [{ id: "sale-line", kind: "card", name: "Ash", quantity: 1, allocationPence: null, entityIds: ["copy-one"], detail: null }] });
  const edited = updateRecordDetails(snapshot, "record-purchase", { title: "Two copies", date: "2026-07-20", source: "eBay", listingUrl: null, amountPence: 200, amountKnown: true, notes: "" });
  assert.deepEqual(edited.next.copies.map((copy) => copy.allocationPence), [100, 100]);
  const voided = changeRecordStatus(edited.next, "sale-1", "void");
  assert.equal(voided.next.copies[0]?.status, "available");
  const restored = changeRecordStatus(voided.next, "sale-1", "active");
  assert.equal(restored.next.copies[0]?.status, "sold");
  assert.equal(restored.next.copies[0]?.allocationPence, 100);
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

test("preview cannot remove a Copy with eBay listing history", () => {
  const snapshot = createPreviewSnapshot([]);
  const before = snapshot.copyEbayExposures.find((state) => (
    state.copyId === "copy-preview-dark-2"
  ));
  const result = removeCardCopy(snapshot, "copy-preview-dark-2");

  assert.equal(result.result.ok, false);
  if (!result.result.ok) assert.match(result.result.message, /eBay listing history/i);
  assert.ok(result.next.copies.some((copy) => copy.id === "copy-preview-dark-2"));
  assert.deepEqual(
    result.next.copyEbayExposures.find((state) => state.copyId === "copy-preview-dark-2"),
    before,
  );
});

test("preview Sale void and restore update linked paid-offer exposure", () => {
  const snapshot = createPreviewSnapshot([]);
  const initial = snapshot.copyEbayExposures.find((state) => state.copyId === "copy-preview-ash");
  assert.equal(initial?.aggregateState, "paid_sale_recorded");

  const voided = changeRecordStatus(snapshot, "record-preview-sale", "void");
  assert.equal(voided.result.ok, true);
  const voidedCopy = voided.next.copies.find((copy) => copy.id === "copy-preview-ash");
  const voidedExposure = voided.next.copyEbayExposures.find((state) => (
    state.copyId === "copy-preview-ash"
  ));
  assert.equal(voidedCopy?.status, "available");
  assert.equal(voidedCopy?.soldRecordId, null);
  assert.equal(voidedExposure?.physical.state, "owned");
  assert.equal(voidedExposure?.aggregateState, "needs_attention");
  assert.equal(voidedExposure?.offers[0]?.saleState, "needs_review");
  assert.equal(voidedExposure?.offers[0]?.saleRecordId, "record-preview-sale");

  const restored = changeRecordStatus(voided.next, "record-preview-sale", "active");
  assert.equal(restored.result.ok, true);
  const restoredCopy = restored.next.copies.find((copy) => copy.id === "copy-preview-ash");
  const restoredExposure = restored.next.copyEbayExposures.find((state) => (
    state.copyId === "copy-preview-ash"
  ));
  assert.equal(restoredCopy?.status, "sold");
  assert.equal(restoredCopy?.soldRecordId, "record-preview-sale");
  assert.equal(restoredExposure?.physical.state, "sold");
  assert.equal(restoredExposure?.aggregateState, "paid_sale_recorded");
  assert.equal(restoredExposure?.offers[0]?.saleState, "paid");
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
  assert.deepEqual(getLibraryCardStatus(0, 2), {
    status: "owned",
    ownedQuantity: 2,
    wantedQuantity: 0,
    wishlistRemainingQuantity: 0,
  });
});

test("removing wishlist demand keeps owned Copies and their Record history", () => {
  const snapshot = twoCopyPurchase();
  snapshot.targets[0]!.desiredQuantity = 3;

  const removed = deleteWishlistTarget(snapshot, "target-ash");

  assert.equal(removed.result.ok, true);
  if (removed.result.ok) {
    assert.match(removed.result.warning ?? "", /owned Copies and their Record history were kept/i);
  }
  assert.equal(snapshot.targets[0]?.desiredQuantity, 3);
  assert.equal(removed.next.targets[0]?.desiredQuantity, 0);
  assert.equal(removed.next.copies.length, 2);
  assert.equal(removed.next.records.length, 1);
  assert.equal(getLibraryCardStatus(removed.next.targets[0]!.desiredQuantity, 2).status, "owned");
});

test("removing a pure wishlist target deletes it when no Copy history exists", () => {
  const snapshot = twoCopyPurchase();
  snapshot.records = [];
  snapshot.copies = [];

  const removed = deleteWishlistTarget(snapshot, "target-ash");

  assert.equal(removed.result.ok, true);
  assert.equal(removed.next.targets.length, 0);
  assert.equal(removed.next.printings.length, 0);
});

test("wishlist removal clears fulfilled and historical-only demand without discarding history", () => {
  const fulfilled = twoCopyPurchase();
  const fulfilledRemoval = deleteWishlistTarget(fulfilled, "target-ash");
  assert.equal(fulfilledRemoval.result.ok, true);
  assert.equal(fulfilledRemoval.next.targets[0]?.desiredQuantity, 0);
  assert.equal(fulfilledRemoval.next.copies.length, fulfilled.copies.length);
  assert.equal(fulfilledRemoval.next.records.length, fulfilled.records.length);

  const repeatedRemoval = deleteWishlistTarget(fulfilledRemoval.next, "target-ash");
  assert.equal(repeatedRemoval.result.ok, false);
  if (!repeatedRemoval.result.ok) {
    assert.match(repeatedRemoval.result.message, /not currently on your wishlist/i);
  }

  for (const historicalStatus of ["sold", "void"] as const) {
    const historical = twoCopyPurchase();
    historical.targets[0]!.desiredQuantity = 3;
    for (const copy of historical.copies) copy.status = historicalStatus;
    const historicalRemoval = deleteWishlistTarget(historical, "target-ash");
    assert.equal(historicalRemoval.result.ok, true);
    assert.equal(historicalRemoval.next.targets[0]?.desiredQuantity, 0);
    assert.equal(historicalRemoval.next.copies.length, historical.copies.length);
    assert.equal(historicalRemoval.next.records.length, historical.records.length);
  }
});

test("only Records may write physical Copy ownership or legacy card state", () => {
  const root = sourceFile("src/server/root.ts");
  const legacyCards = sourceFile("src/server/routers/cards.ts");
  const library = sourceFile("src/server/routers/library.ts");
  const wheel = sourceFile("src/components/wheel-app.tsx");
  const nonRecordsRouters = readdirSync(
    new URL("../src/server/routers/", import.meta.url),
  ).filter((file) => file.endsWith(".ts") && file !== "records.ts")
    .map((file) => ({ file, source: sourceFile(`src/server/routers/${file}`) }));
  const libraryClients = [
    "src/components/assign-chase-app.tsx",
    "src/components/binder-v2-app.tsx",
    "src/components/spend-app.tsx",
    "src/components/wishlist-app.tsx",
  ].map(sourceFile);

  assert.doesNotMatch(root, /\bcards:\s*libraryRouter/);
  assert.match(root, /\blegacyCards:\s*legacyCardsReadRouter/);
  assert.match(legacyCards, /read-only migration adapter/);
  assert.doesNotMatch(legacyCards, /\.(?:insert|update|delete)\(cards\)/);
  assert.doesNotMatch(legacyCards, /\b(?:markOwned|setStatus|setPaidPrice)\b/);
  assert.doesNotMatch(library, /\bmarkOwned\b/);
  assert.doesNotMatch(library, /\.(?:insert|update|delete)\(cardCopies\)/);
  for (const router of nonRecordsRouters) {
    assert.doesNotMatch(
      router.source,
      /\.(?:insert|update|delete)\(cardCopies\)/,
      `${router.file} must not become a second Copy ownership writer`,
    );
  }
  assert.doesNotMatch(wheel, /\b(?:trpc|utils)\.cards\b|\bmarkOwned\b/);
  for (const client of libraryClients) {
    assert.doesNotMatch(client, /\b(?:trpc|utils)\.cards\b/);
    assert.match(client, /\b(?:trpc|utils)\.library\b/);
  }
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
    copyEbayExposures: [],
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

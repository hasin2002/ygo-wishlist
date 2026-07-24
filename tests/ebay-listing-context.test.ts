import assert from "node:assert/strict";
import test from "node:test";
import { resolveEbayListingContext } from "../src/lib/records/ebay-listing-context.ts";
import type { RecordsSnapshot } from "../src/lib/records/types.ts";

function sellableSnapshot(): RecordsSnapshot {
  return {
    attention: [],
    bulkLots: [],
    copies: [{
      acquiredRecordId: "record-1",
      allocationIndex: null,
      allocationPence: 500,
      bulkLotId: null,
      condition: "Near Mint",
      createdAt: "2026-07-20T12:00:00.000Z",
      id: "copy-1",
      location: null,
      printingId: "printing-1",
      privateNote: "",
      soldRecordId: null,
      status: "available",
      stickerNumber: null,
    }],
    printings: [{
      id: "printing-1",
      imageUrl: null,
      setCode: "RA01-EN008",
      setName: "25th Anniversary Rarity Collection",
      targetId: "target-1",
      tcgplayerUrl: null,
    }],
    records: [{
      amountPence: 500,
      createdAt: "2026-07-20T12:00:00.000Z",
      date: "2026-07-20",
      id: "record-1",
      lines: [],
      listingUrl: null,
      notes: "",
      revision: 1,
      source: "eBay",
      status: "active",
      title: "Ash Blossom",
      type: "purchase",
    }],
    sealedUnits: [],
    supplies: [],
    targets: [{
      desiredQuantity: 1,
      edition: "1st Edition",
      id: "target-1",
      imageUrl: null,
      marketPricePence: 650,
      name: "Ash Blossom & Joyous Spring",
      rarity: "Super Rare",
      tcgplayerUrl: null,
    }],
    version: 1,
  };
}

test("Listing context resolves the exact target, Copy, printing, and source Record", () => {
  const snapshot = sellableSnapshot();
  const result = resolveEbayListingContext(snapshot, "target-1", "copy-1");

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.target, snapshot.targets[0]);
  assert.equal(result.copy, snapshot.copies[0]);
  assert.equal(result.printing, snapshot.printings[0]);
  assert.equal(result.sourceRecord, snapshot.records[0]);
});

test("Listing context reports missing and mismatched inventory relationships precisely", () => {
  const missingTarget = resolveEbayListingContext(sellableSnapshot(), "missing", "copy-1");
  assert.deepEqual(missingTarget, {
    message: "That inventory card could not be found.",
    ok: false,
    reason: "target-not-found",
  });

  const missingCopy = resolveEbayListingContext(sellableSnapshot(), "target-1", "missing");
  assert.equal(missingCopy.ok ? null : missingCopy.reason, "copy-not-found");

  const missingPrintingSnapshot = sellableSnapshot();
  missingPrintingSnapshot.printings = [];
  const missingPrinting = resolveEbayListingContext(
    missingPrintingSnapshot,
    "target-1",
    "copy-1",
  );
  assert.equal(missingPrinting.ok ? null : missingPrinting.reason, "printing-not-found");

  const mismatchedTargetSnapshot = sellableSnapshot();
  mismatchedTargetSnapshot.printings[0] = {
    ...mismatchedTargetSnapshot.printings[0],
    targetId: "another-target",
  };
  const mismatchedTarget = resolveEbayListingContext(
    mismatchedTargetSnapshot,
    "target-1",
    "copy-1",
  );
  assert.equal(mismatchedTarget.ok ? null : mismatchedTarget.reason, "copy-target-mismatch");

  const missingSourceSnapshot = sellableSnapshot();
  missingSourceSnapshot.records = [];
  const missingSource = resolveEbayListingContext(
    missingSourceSnapshot,
    "target-1",
    "copy-1",
  );
  assert.equal(missingSource.ok ? null : missingSource.reason, "source-record-not-found");
});

test("Listing context distinguishes sold, void, and source-void Copies", () => {
  const soldSnapshot = sellableSnapshot();
  soldSnapshot.copies[0] = { ...soldSnapshot.copies[0], status: "sold" };
  const sold = resolveEbayListingContext(soldSnapshot, "target-1", "copy-1");
  assert.equal(sold.ok ? null : sold.reason, "copy-sold");

  const voidCopySnapshot = sellableSnapshot();
  voidCopySnapshot.copies[0] = { ...voidCopySnapshot.copies[0], status: "void" };
  const voidCopy = resolveEbayListingContext(voidCopySnapshot, "target-1", "copy-1");
  assert.equal(voidCopy.ok ? null : voidCopy.reason, "copy-void");

  const voidSourceSnapshot = sellableSnapshot();
  voidSourceSnapshot.records[0] = { ...voidSourceSnapshot.records[0], status: "void" };
  const voidSource = resolveEbayListingContext(voidSourceSnapshot, "target-1", "copy-1");
  assert.equal(voidSource.ok ? null : voidSource.reason, "source-record-void");
});

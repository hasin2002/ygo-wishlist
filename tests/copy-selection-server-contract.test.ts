import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Sale locks owner-scoped Copies before authoritative eBay membership/exposure checks", async () => {
  const [selection, records] = await Promise.all([
    readFile(new URL("../src/server/records/copy-selection.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/server/routers/records.ts", import.meta.url), "utf8"),
  ]);
  assert.match(selection, /and\(eq\(cardCopies\.ownerId, ownerId\), inArray\(cardCopies\.id, uniqueCopyIds\)\)/);
  assert.match(selection, /orderBy\(asc\(cardCopies\.id\)\)[\s\S]*\.for\("update"\)/);
  assert.match(selection, /missing or does not belong to this collection/);
  const sale = records.slice(records.indexOf("createSale:"), records.indexOf("replaceSaleCopies:"));
  assert.match(sale, /lockReconciledCopies\(tx, ownerId, input\.copyIds\)[\s\S]*lockListingsForCopies\(/);
  const listingLocks = records.slice(
    records.indexOf("async function lockListingsForCopies"),
    records.indexOf("const productEditionSchema"),
  );
  assert.match(listingLocks, /from\(ebayListingMembers\)[\s\S]*\.for\("update"\)[\s\S]*from\(ebayListings\)[\s\S]*\.for\("update"\)/);
  assert.match(sale, /ebayListingStatusSummary\(listing\)\.relistAllowed/);
  assert.match(sale, /live, pending, or uncertain eBay listing/);
});

test("both selector forms expose the same condition and eBay-status filtering contract", async () => {
  const [sale, lot] = await Promise.all([
    readFile(new URL("../src/components/records/sale-form.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/records/ebay-lot-listing.tsx", import.meta.url), "utf8"),
  ]);
  for (const source of [sale, lot]) {
    assert.match(source, /Condition[\s\S]*All conditions/);
    assert.match(source, /filterCopySelectionCandidates\([\s\S]*condition[\s\S]*searchTerms:/);
    assert.match(source, /ebayExposurePresentation[\s\S]*ebayExposureSummary/);
  }
});

test("stale photo anchors can move safely after the old Copy disappears", async () => {
  const source = await readFile(
    new URL("../src/server/ebay-listing.ts", import.meta.url),
    "utf8",
  );
  const transfer = source.slice(
    source.indexOf("export async function transferEbayListingImageDraft"),
    source.indexOf("async function listingCopyMetadata"),
  );
  assert.match(transfer, /loadOwnedCopy\(ownerId, toCopyId\)/);
  assert.doesNotMatch(transfer, /loadOwnedCopy\(ownerId, fromCopyId\)/);
  assert.match(transfer, /transferListingImageDraft\(\{ fromCopyId, key: archiveKey, ownerId, toCopyId \}\)/);
});

test("eBay reconciliation follows the same Copy, membership, listing lock order", async () => {
  const source = await readFile(
    new URL("../src/server/ebay-listing-reconciliation.ts", import.meta.url),
    "utf8",
  );
  const transaction = source.slice(
    source.indexOf("return db.transaction(async (tx) =>"),
    source.indexOf("const normalized = await persistRemoteOrderLines"),
  );
  const copyLock = transaction.indexOf("from(cardCopies)");
  const memberLock = transaction.indexOf("from(ebayListingMembers)");
  const listingLock = transaction.indexOf("from(ebayListings)");
  assert.ok(copyLock >= 0);
  assert.ok(copyLock < memberLock);
  assert.ok(memberLock < listingLock);
  assert.match(transaction, /orderBy\(asc\(cardCopies\.id\)\)\.for\("update"\)/);
});

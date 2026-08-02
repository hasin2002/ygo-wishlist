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

test("paid Sale review keeps deterministic Copy, membership, Listing, and order-data locks", async () => {
  const source = await readFile(
    new URL("../src/server/records/paid-ebay-sale-review.ts", import.meta.url),
    "utf8",
  );
  const copyLock = source.indexOf("from(cardCopies)");
  const memberLock = source.indexOf("from(ebayListingMembers)");
  const listingLock = source.indexOf("from(ebayListings)");
  const orderLineLock = source.indexOf("from(ebayOrderLines)");
  const allocationLock = source.indexOf("from(ebayOrderLineAllocations)");
  assert.ok(copyLock >= 0);
  assert.ok(copyLock < memberLock);
  assert.ok(memberLock < listingLock);
  assert.ok(listingLock < orderLineLock);
  assert.ok(orderLineLock < allocationLock);
  assert.match(source, /eq\(cardCopies\.ownerId, ownerId\)/);
  assert.match(source, /eq\(ebayListingMembers\.ownerId, ownerId\)/);
  assert.match(source, /eq\(ebayListings\.ownerId, ownerId\)/);
  assert.match(source, /eq\(ebayOrderLines\.ownerId, ownerId\)/);
  assert.match(source, /eq\(ebayOrderLineAllocations\.ownerId, ownerId\)/);
});

test("Sale, Sale editing, and mixed lots render one shared Copy picker contract", async () => {
  const [sale, lot, records, picker] = await Promise.all([
    readFile(new URL("../src/components/records/sale-form.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/records/ebay-lot-listing.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/records/records-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/records/copy-selection-picker.tsx", import.meta.url), "utf8"),
  ]);
  for (const source of [sale, lot, records]) {
    assert.match(source, /<CopySelectionPicker/);
  }
  assert.match(picker, /copySelectionPickerPageSize = 4/);
  assert.match(picker, /grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4/);
  assert.match(picker, /Condition[\s\S]*All conditions/);
  assert.match(picker, /filterCopySelectionCandidates\([\s\S]*condition[\s\S]*searchTerms:/);
  assert.match(picker, /ebayExposurePresentation[\s\S]*ebayExposureSummary/);
  assert.match(picker, /aria-label="Copy result pages"/);
  assert.match(picker, /Page \{currentPage\} of \{pageCount\}/);
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

test("mixed-lot Details and Review cannot reuse validation after reconciliation changes", async () => {
  const source = await readFile(
    new URL("../src/components/records/ebay-lot-listing.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /function stepProblem\(\) \{\s+if \(selection\.issues\.length\)/);
  assert.match(source, /currentValidationFingerprint[\s\S]*validationIsCurrent/);
  assert.match(source, /if \(!validationIsCurrent \|\| publishActionRef\.current\)/);
  assert.match(source, /confirmDisabled=\{!validationIsCurrent\}/);
  assert.match(source, /nextDisabled=\{\s+!selection\.valid/);
  assert.match(source, /Your title, description, price, and staged photos are still saved/);
  assert.match(source, /Review Copy selection/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/server/records/ebay-listings-workspace.ts", import.meta.url), "utf8");
const uiSource = readFileSync(new URL("../src/components/records/ebay-listings-workspace.tsx", import.meta.url), "utf8");

test("Listings query scopes parent and every detail relation to the owner", () => {
  assert.match(source, /eq\(ebayListings\.ownerId, ownerId\)/);
  assert.match(source, /eq\(ebayListingMembers\.ownerId, ownerId\)/);
  assert.match(source, /eq\(ebayOrderLines\.ownerId, ownerId\)/);
  assert.match(source, /eq\(cardCopies\.ownerId, ebayListingMembers\.ownerId\)/);
  assert.match(source, /eq\(cardPrintings\.ownerId, cardCopies\.ownerId\)/);
  assert.match(source, /eq\(cardTargets\.ownerId, cardPrintings\.ownerId\)/);
});

test("Listings query paginates deterministic parent IDs before bounded detail loads", () => {
  assert.match(source, /orderBy\(desc\(ebayListings\.createdAt\), desc\(ebayListings\.id\)\)/);
  assert.match(source, /limit\(pageSize\)[\s\S]*?\.offset/);
  assert.match(source, /inArray\(ebayListingMembers\.listingId, listingIds\)/);
  assert.match(source, /inArray\(ebayOrderLines\.listingId, listingIds\)/);
  assert.match(source, /Math\.min\(Math\.max\(1, input\.page\), pageCount\)/);
  assert.match(source, /const memberRows = input\.listingId \? await db\.select/);
  assert.match(source, /const orderLines = input\.listingId \? await db\.select/);
  assert.match(source, /memberCountByListing/);
  assert.match(source, /overlapCountByListing/);
});

test("Listings workspace exposes lifecycle recovery and uses exact listing refresh", () => {
  assert.match(source, /hasEbayCompositionSchema/);
  assert.match(uiSource, /recoveryMessage/);
  assert.match(uiSource, /refreshListingStatusById/);
  assert.match(uiSource, /isStale/);
  assert.match(uiSource, /Remote listing state/);
  assert.match(uiSource, /Remote order state/);
  assert.match(source, /case "ended": return and/);
  assert.match(source, /interval '24 hours'/);
});

test("Listings index makes title navigation and unfamiliar terms explicit without duplicate actions", () => {
  assert.match(uiSource, /aria-label=\{`View listing details for \$\{listing\.title\}`\}/);
  assert.match(uiSource, /underline-offset-4/);
  assert.match(uiSource, /<ChevronRight aria-hidden="true"/);
  assert.doesNotMatch(uiSource, />View listing</);
  assert.doesNotMatch(uiSource, />Open Inventory Copy</);
  assert.match(uiSource, /Offer type ·/);
  assert.match(uiSource, /Offer type ·/);
  assert.match(uiSource, /eBay order events/);
  assert.doesNotMatch(uiSource, /What does offer type mean\?/);
  assert.doesNotMatch(uiSource, /What are eBay order events\?/);
  assert.doesNotMatch(uiSource, /<details/);
  assert.match(uiSource, /<div className="grid gap-4">/);
  assert.match(uiSource, /rounded-lg border border-zinc-300 bg-white p-4 shadow-sm/);
  assert.doesNotMatch(uiSource, /md:gap-0 md:divide-y/);
  assert.doesNotMatch(uiSource, /md:rounded-none md:border-0 md:shadow-none/);
});

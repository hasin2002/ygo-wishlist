import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../src/components/wishlist-app.tsx", import.meta.url),
  "utf8",
);
const appHeaderSource = readFileSync(
  new URL("../src/components/app-header.tsx", import.meta.url),
  "utf8",
);
const rarityGuideSource = readFileSync(
  new URL("../src/components/rarity-guide-popover.tsx", import.meta.url),
  "utf8",
);
const addWishlistPageSource = readFileSync(
  new URL("../src/app/wishlist/new/page.tsx", import.meta.url),
  "utf8",
);
const recordsWorkspaceSource = readFileSync(
  new URL("../src/components/records/records-workspace.tsx", import.meta.url),
  "utf8",
);
const listingsSource = readFileSync(
  new URL("../src/components/records/ebay-listings-workspace.tsx", import.meta.url),
  "utf8",
);
const recordEntrySource = readFileSync(
  new URL("../src/components/records/record-entry-app.tsx", import.meta.url),
  "utf8",
);
const ebayListingActionSource = readFileSync(
  new URL("../src/components/records/ebay-listing-action.tsx", import.meta.url),
  "utf8",
);
const ebayLotListingSource = readFileSync(
  new URL("../src/components/records/ebay-lot-listing.tsx", import.meta.url),
  "utf8",
);
const purchaseOpeningSource = readFileSync(
  new URL("../src/components/records/purchase-opening-forms.tsx", import.meta.url),
  "utf8",
);
const libraryRouterSource = readFileSync(
  new URL("../src/server/routers/library.ts", import.meta.url),
  "utf8",
);

test("Library results use compact phone rows and add columns as more screen width becomes available", () => {
  assert.match(source, /const pageSize = 10/);
  assert.match(libraryRouterSource, /pageSize: z\.number\(\)\.int\(\)\.min\(1\)\.max\(50\)\.default\(10\)/);
  assert.match(source, /data-library-results/);
  assert.match(source, /grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5/);
  assert.doesNotMatch(source, /2xl:grid-cols-6/);
  assert.match(source, /data-library-card/);
  assert.match(source, /sm:h-full sm:flex-col/);
  assert.match(source, /data-library-media-column/);
  assert.match(source, /grid h-36[\s\S]*?sm:aspect-\[4\/5\]/);
});

test("Library image and external actions keep accessible touch targets in the compact layout", () => {
  assert.match(source, /aria-label=\{`Open larger image of \$\{card\.name\}`\}/);
  assert.match(source, /data-library-media/);
  assert.match(source, /className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md/);
  assert.match(source, /className="inline-flex size-11 items-center justify-center rounded-md/);
  assert.match(source, /className="line-clamp-2 min-h-11 min-w-11 text-left/);
  assert.match(source, /className="absolute right-0 top-0 z-10 grid size-11/);
});

test("Library results expose Wanted and Owned below the image without a Deficit field", () => {
  assert.match(source, /data-library-quantity-summary/);
  assert.match(source, /grid grid-cols-2/);
  assert.match(source, /\["Wanted", card\.desiredQuantity\]/);
  assert.match(source, /\["Owned", card\.ownedQuantity\]/);
  assert.doesNotMatch(source, /\["Deficit", deficit\]/);
  assert.match(source, /data-library-media-column[\s\S]*?data-library-media[\s\S]*?<CollectionQuantitySummary card=\{card\} \/>/);
  assert.match(source, /Market estimate unknown/);
  assert.doesNotMatch(source, /Show full details for/);
  assert.match(source, /function CardImagePreviewDialog/);
  assert.match(source, /aria-label=\{`Larger image of \$\{card\.name\}`\}/);
  assert.match(source, /data-library-image-preview/);
  assert.match(source, /return createPortal\(/);
  assert.match(source, /document\.body/);
  assert.match(source, /event\.key !== "Tab"/);
  assert.match(source, /returnFocusTo\?\.isConnected/);
  assert.doesNotMatch(source, /Open physical cards/);
  assert.doesNotMatch(source, /canOpenInventory/);
  assert.match(source, /text-\[10px\][\s\S]*?text-lg/);
  assert.match(source, /w-32 shrink-0 flex-col/);
});

test("Library cards keep a visible Wishlist or Owned identifier without a redundant paid label", () => {
  assert.match(source, /\{card\.status === "owned" \? "Owned" : "Wishlist"\}/);
  assert.match(source, /paidCostSummary\(\{ formattedKnownTotal: card\.paidPriceText !== null \? normalizePaidPrice\(card\.paidPriceText\)/);
  assert.doesNotMatch(source, /`Known paid \$\{normalizePaidPrice\(card\.paidPriceText\)\}`/);
  assert.match(source, /data-library-metadata/);
  assert.match(source, /inline-flex h-7 items-center whitespace-nowrap[\s\S]*?text-xs font-black tabular-nums text-emerald-800/);
});

test("Library summary separates counts, estimated values, and recorded purchase cost", () => {
  assert.match(source, /aria-label="Library summary"/);
  assert.match(source, /data-library-summary/);
  assert.match(source, />Tracked cards</);
  assert.match(source, />Wishlist market estimate</);
  assert.match(source, />Owned market estimate</);
  assert.match(source, />Known purchase subtotal</);
  assert.match(source, /paidCompleteness\.unknownCopyCount[\s\S]*?cost[\s\S]*?unknown/);
  assert.doesNotMatch(source, /Known paid/);
});

test("Library icon controls share the same accessible target size", () => {
  assert.match(rarityGuideSource, /aria-label="View rarity abbreviation guide"[\s\S]*?size-11/);
  assert.match(rarityGuideSource, /aria-label="Close rarity guide"[\s\S]*?size-11/);
  assert.match(source, /aria-label="Refresh current UK eBay estimates for all cards"[\s\S]*?size-11/);
});

test("Add to wishlist is a global Add destination backed by a page form", () => {
  assert.match(appHeaderSource, /href: "\/wishlist\/new"[\s\S]*?label: "Add to wishlist"/);
  assert.match(addWishlistPageSource, /import \{ protectedLoginHref \} from "@\/server\/protected-login"/);
  assert.match(addWishlistPageSource, /redirect\(await protectedLoginHref\("\/wishlist\/new"\)\)/);
  assert.match(addWishlistPageSource, /<AddWishlistApp \/>/);
  assert.match(source, /export function AddWishlistApp\(\)/);
  assert.match(source, /<AppHeader title="Add to wishlist" \/>/);
  assert.match(source, /Back to Library/);
  assert.doesNotMatch(source, /setAddFormOpen/);
  assert.doesNotMatch(source, />\s*Add target\s*</);
  assert.doesNotMatch(source, />Wishlist Target<\/p>/);
  assert.doesNotMatch(source, /Adding here records what you want/);
  assert.match(source, /grid gap-3 sm:grid-cols-2 xl:grid-cols-4/);
});

test("Edit card uses a focused viewport dialog with wishlist removal at the bottom", () => {
  assert.match(source, /function EditCardModal[\s\S]*?return createPortal\(/);
  assert.match(source, /aria-labelledby="edit-card-title"/);
  assert.match(source, /max-h-dvh[\s\S]*?sm:max-w-4xl/);
  assert.match(source, /overflow-y-auto p-4 sm:p-5/);
  assert.match(source, /<footer[\s\S]*?Remove from wishlist[\s\S]*?Save changes/);
  assert.match(source, /event\.key === "Escape"/);
  assert.match(source, /event\.key !== "Tab"/);
  assert.doesNotMatch(source, />Library state</);
  assert.doesNotMatch(source, /Owned from Records/);
});

test("wishlist removal preserves owned Copies and only deletes a pure target", () => {
  assert.match(libraryRouterSource, /availableCopyCount = copies\.filter\(\(copy\) => copy\.status === "available"\)\.length/);
  assert.match(libraryRouterSource, /desiredQuantity: 0/);
  assert.match(libraryRouterSource, /db\.delete\(targetWheelEntries\)/);
  assert.match(libraryRouterSource, /Owned Copies and their Record history were kept/);
  assert.match(source, /form\.desiredQuantity > 0[\s\S]*?Remove from wishlist/);
  assert.match(source, /will no longer be wanted/);
  assert.match(source, /owned[\s\S]*?Copies[\s\S]*?every Record remain unchanged/);
  assert.match(source, /saved catalogue details will be deleted/);
  assert.doesNotMatch(source, /will be deleted because there are no owned physical Copies to keep/);
  assert.match(source, /function RemoveWishlistDialog[\s\S]*?return createPortal\(/);
  assert.match(source, /aria-describedby="remove-wishlist-description"/);
  assert.match(source, /z-\[60\]/);
  assert.match(source, /if \(pendingRef\.current\) return/);
});

test("The shared header has one compact title row without decorative duplicate labels", () => {
  assert.match(appHeaderSource, /id="page-title"/);
  assert.match(appHeaderSource, /text-2xl[\s\S]*?sm:text-3xl/);
  assert.doesNotMatch(appHeaderSource, /eyebrow/);
  assert.doesNotMatch(appHeaderSource, /Signed in as administrator/);
  assert.doesNotMatch(appHeaderSource, /Public read-only view/);
});

test("Records uses the route-specific title and form pages share the wide page shell", () => {
  assert.match(recordsWorkspaceSource, /pathname === "\/records\/listings"[\s\S]*?"Listings"/);
  assert.match(recordsWorkspaceSource, /\{pageTitle \? <AppHeader title=\{pageTitle\} \/> : null\}/);
  assert.doesNotMatch(listingsSource, />Records<\/p><h1/);
  assert.match(listingsSource, /aria-labelledby="page-title"/);
  assert.match(recordEntrySource, /max-w-7xl/);
  assert.doesNotMatch(recordEntrySource, /max-w-4xl/);
  assert.match(recordEntrySource, /Unfinished work is kept in this browser tab\./);
  assert.match(ebayListingActionSource, /Unfinished work is kept in this browser tab\./);
  assert.match(ebayLotListingSource, /Unfinished work is kept in this browser tab\./);
  assert.doesNotMatch(ebayListingActionSource, /eBay seller workspace/);
  assert.doesNotMatch(ebayLotListingSource, /Add eBay listing/);
});

test("Purchase type options use one compact row on wide desktop", () => {
  assert.match(purchaseOpeningSource, /data-purchase-kind-options/);
  assert.match(purchaseOpeningSource, /sm:grid-cols-2 xl:grid-cols-4/);
  assert.doesNotMatch(purchaseOpeningSource, /min-h-32 cursor-pointer/);
});

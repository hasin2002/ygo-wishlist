import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const saleFormSource = readFileSync(new URL("../src/components/records/sale-form.tsx", import.meta.url), "utf8");
const copySelectionPickerSource = readFileSync(new URL("../src/components/records/copy-selection-picker.tsx", import.meta.url), "utf8");
const exposureSource = readFileSync(new URL("../src/components/records/ebay-copy-exposure.tsx", import.meta.url), "utf8");
const listingActionSource = readFileSync(new URL("../src/components/records/ebay-listing-action.tsx", import.meta.url), "utf8");
const recordsAppSource = readFileSync(new URL("../src/components/records/records-app.tsx", import.meta.url), "utf8");
const unavailableActionSource = readFileSync(new URL("../src/components/unavailable-action.tsx", import.meta.url), "utf8");
const cardImagesSource = readFileSync(new URL("../src/components/records/card-inventory-images.tsx", import.meta.url), "utf8");
const photoManagerSource = readFileSync(new URL("../src/components/records/card-photo-manager.tsx", import.meta.url), "utf8");
const listingStatusSource = readFileSync(new URL("../src/components/records/ebay-listing-status.tsx", import.meta.url), "utf8");
const listingsWorkspaceSource = readFileSync(new URL("../src/components/records/ebay-listings-workspace.tsx", import.meta.url), "utf8");
const draftConflictSource = readFileSync(new URL("../src/components/records/form-draft-ui.tsx", import.meta.url), "utf8");
const paidSaleDialogSource = readFileSync(new URL("../src/components/records/paid-ebay-sale-review-dialog.tsx", import.meta.url), "utf8");

test("Sale Copy selectors expose physical and eBay status in visible and accessible text", () => {
  assert.match(saleFormSource, /<CopySelectionPicker/);
  assert.match(copySelectionPickerSource, /Physical · \{item\.exposure \? physicalCopyStateLabel/);
  assert.match(copySelectionPickerSource, /eBay exposure · \{exposurePresentation\?\.label/);
  assert.match(copySelectionPickerSource, /aria-label=\{`Select \$\{copyExposureSelectorLabel/);
  assert.match(copySelectionPickerSource, /eBay status \$\{exposurePresentation\?\.label/);
});

test("changing Sale selection and result counts use a polite atomic live region", () => {
  assert.match(saleFormSource, /aria-atomic="true" aria-live="polite"/);
});

test("offer history opens in an accessible dialog with named links", () => {
  assert.doesNotMatch(exposureSource, /<details/);
  assert.match(exposureSource, /aria-haspopup="dialog"/);
  assert.match(exposureSource, /aria-modal="true"/);
  assert.match(exposureSource, /role="dialog"/);
  assert.match(exposureSource, /Close related eBay offers/);
  assert.match(exposureSource, /window\.addEventListener\("keydown", closeOnEscape\)/);
  assert.match(exposureSource, /Open offer/);
  assert.match(exposureSource, /opens in a new tab/);
});

test("listing history disables Copy removal with a touch-accessible explanation", () => {
  assert.doesNotMatch(recordsAppSource, /Remove Copy unavailable/);
  assert.match(recordsAppSource, /<UnavailableAction icon=\{Trash2\} label="Remove Copy"/);
  assert.match(unavailableActionSource, /aria-controls=\{reasonId\}/);
  assert.match(unavailableActionSource, /aria-expanded=\{reasonOpen\}/);
  assert.match(unavailableActionSource, /hidden=\{!reasonOpen\}/);
  assert.doesNotMatch(unavailableActionSource, /group-hover:opacity-100/);
  assert.doesNotMatch(recordsAppSource, /removalReasonCopyId/);
  assert.match(recordsAppSource, /selectedCopyRemoval\.reason/);
});

test("Copy actions stack at full width on mobile and keep the help control inside Remove Copy", () => {
  assert.match(recordsAppSource, /flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end/);
  assert.match(unavailableActionSource, /group relative min-w-0 w-full sm:w-auto/);
  assert.match(unavailableActionSource, /min-h-11 w-full cursor-not-allowed items-center justify-center gap-2 rounded-md border border-zinc-300 bg-zinc-100/);
  assert.match(listingActionSource, /min-h-11 w-full items-center justify-center gap-2 rounded-md border border-zinc-300 bg-zinc-100/);
});

test("the Copy picker is one searchable, keyboard-accessible combobox", () => {
  assert.match(recordsAppSource, /function PhysicalCopyCombobox/);
  assert.match(recordsAppSource, /role="combobox"/);
  assert.match(recordsAppSource, /role="listbox"/);
  assert.match(recordsAppSource, /role="option"/);
  assert.match(recordsAppSource, /aria-activedescendant/);
  assert.match(recordsAppSource, /placeholder="Search by Copy number, set, or sticker"/);
  assert.match(recordsAppSource, /const copyNumber = copies\.findIndex\(\(item\) => item\.id === copy\.id\) \+ 1/);
  assert.match(recordsAppSource, /searchText: \[`Copy \$\{copyNumber\}`, copyShortReference\(copy\.id\), printing\.setCode, copy\.stickerNumber\]/);
  assert.match(recordsAppSource, /min-w-0 flex-1 truncate/);
  assert.doesNotMatch(recordsAppSource, /Find a Copy/);
  assert.doesNotMatch(recordsAppSource, /<select aria-label="Physical Copy"/);
  assert.doesNotMatch(recordsAppSource, /PhysicalCopyPickerDialog/);
});

test("preview Copy photos explain the limitation and retain phone-camera capture in live records", () => {
  assert.match(cardImagesSource, /if \(isPreview\)/);
  assert.match(cardImagesSource, /This preview does not store photos/);
  assert.match(photoManagerSource, /capture="environment"/);
  assert.match(photoManagerSource, /Take photo on phone/);
});

test("the preview shows where a live Copy's Sell on eBay action will appear", () => {
  assert.match(listingActionSource, /if \(!enabled\)/);
  assert.match(listingActionSource, /Sell on eBay/);
});

test("paid unlinked eBay actions open the compact exact-Copy Sale review", () => {
  assert.match(listingActionSource, /setPaidReview\(\{ copyId: context\.copy\.id, listingId: listing\.id \}\)/);
  assert.match(listingActionSource, /listing\.saleState === "paid" && !listing\.saleRecordId/);
  assert.match(listingActionSource, /<PaidEbaySaleReviewDialog intent=\{paidReview\}/);
  assert.match(listingsWorkspaceSource, /canReviewPaidSale[\s\S]*listing\.kind === "individual"/);
  assert.match(listingsWorkspaceSource, /setPaidReview\(\{ copyId: member\.copyId, listingId: listing\.id \}\)/);
  assert.match(listingsWorkspaceSource, />Review Sale record<\/button>/);
  assert.match(paidSaleDialogSource, /createPortal\(/);
  assert.match(paidSaleDialogSource, /aria-modal="true"/);
  assert.match(paidSaleDialogSource, /Record name/);
  assert.match(paidSaleDialogSource, /Net proceeds \(£\)/);
  assert.match(paidSaleDialogSource, /copyIds: \[intent\.copyId\]/);
  assert.match(paidSaleDialogSource, /paidEbayReview: intent/);
  assert.match(paidSaleDialogSource, /source: "eBay"/);
  assert.match(paidSaleDialogSource, /aria-expanded=\{detailsOpen\}/);
  assert.match(paidSaleDialogSource, /notes \? "Edit notes" : "Add notes"/);
  assert.doesNotMatch(paidSaleDialogSource, /type="date"/);
  assert.match(paidSaleDialogSource, /Notes <span[^>]*>\(optional\)<\/span>/);
  assert.match(paidSaleDialogSource, /date,/);
  assert.match(paidSaleDialogSource, /notes,/);
});

test("the compact paid Sale dialog rejects stale cached inspection shapes before rendering card details", () => {
  assert.match(paidSaleDialogSource, /responseVersion: 2/);
  assert.match(paidSaleDialogSource, /function hasCompactInspectionDetails/);
  assert.match(paidSaleDialogSource, /const inspected = hasCompactInspectionDetails\(inspection\.data\)/);
  assert.match(paidSaleDialogSource, /invalidSuccessResponse/);
});

test("Sale draft conflicts compare compact physical card summaries and keep the requested action order", () => {
  assert.match(saleFormSource, /incomingItem=\{incomingConflictItem\}/);
  assert.match(saleFormSource, /previousItem=\{previousConflictItem\}/);
  assert.match(draftConflictSource, /item\.rarity\} · \{item\.condition/);
  assert.match(draftConflictSource, /title=\{item\.identifier\}/);
  assert.ok(draftConflictSource.indexOf(">Cancel</") < draftConflictSource.indexOf(">Resume previous draft</"));
  assert.ok(draftConflictSource.indexOf(">Resume previous draft</") < draftConflictSource.indexOf(">Start new with this item</"));
});

test("the listing workspace keeps navigation above the header and photo actions above the upload area", () => {
  assert.match(listingActionSource, /<nav aria-label="Listing breadcrumb"[^>]*>/);
  assert.match(listingActionSource, /<\/nav>\s*<header/);
  assert.ok(photoManagerSource.indexOf("secondaryAction ? (") < photoManagerSource.indexOf("onDragEnter"));
});

test("the listing workspace uses the same complete card image treatment as inventory", () => {
  assert.match(listingActionSource, /const catalogueImage = target\.imageUrl \?\? printing\.imageUrl/);
  assert.match(listingActionSource, /aspect-\[59\/86\] w-24 shrink-0/);
});

test("inventory cards keep long names compact and centre their thumbnails", () => {
  assert.match(recordsAppSource, /h-24 w-16 shrink-0 self-center place-items-center/);
  assert.match(recordsAppSource, /min-w-0 flex-1 truncate font-bold leading-5/);
  assert.doesNotMatch(recordsAppSource, /line-clamp-2 font-bold leading-5/);
});

test("inventory type is a single-choice filter in the modal rather than a persistent tab row", () => {
  assert.match(recordsAppSource, /<span className="text-sm font-medium text-zinc-700">Inventory type<\/span>/);
  assert.match(recordsAppSource, /onUpdate\(\{ kind: tab\.value, page: 1 \}\)/);
  assert.match(recordsAppSource, /\(listState\.kind === "cards" \? 0 : 1\)/);
  assert.doesNotMatch(recordsAppSource, /<nav aria-label="Inventory type"/);
});

test("needs-takedown review opens the related eBay-offers dialog instead of the sell workspace", () => {
  assert.match(exposureSource, /ebayOffersDialogEventName/);
  assert.match(listingActionSource, /window\.dispatchEvent\(new Event\(ebayOffersDialogEventName\(copy\.id\)\)\)/);
  assert.match(listingActionSource, /Review live offers/);
});

test("eBay data-safety failures do not misleadingly suggest reconnecting", () => {
  assert.match(listingStatusSource, /This is a data-safety check, not a connection problem/);
  assert.match(listingStatusSource, /Sale data needs review/);
  assert.match(listingStatusSource, /isEbayListingDataReviewMessage/);
  assert.match(listingActionSource, /await collectionChanged\("listing"\)/);
});

test("the overview keeps missing eBay Copy links in the central attention queue", () => {
  assert.match(recordsAppSource, /Confirm Copy link/);
  assert.match(recordsAppSource, /Review eBay status/);
  assert.match(recordsAppSource, /Confirm physical Copy/);
  assert.match(recordsAppSource, /Open this Copy in Inventory/);
  assert.match(recordsAppSource, /inventoryCardDetailHref\(target\.id, defaultInventoryListState, copy\.id\)/);
  assert.match(recordsAppSource, /const attentionCount = snapshot\.attention\.length/);
  assert.match(recordsAppSource, /item\.field === "ebay_copy_link" \|\| item\.field === "ebay_status"/);
  assert.match(recordsAppSource, /snapshot\.attention\.map/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { linkedOfferAvailability, linkedOfferCompatibilityKey, linkedOfferFingerprint, linkedOfferOperations, linkedOfferPlanProblem, linkedOfferPricePrefill, linkedOfferQuantities, linkedOfferVariantAvailability, photoPolicy, planLinkedOfferChanges, protectLinkedOfferWishlistCopies, recoverLinkedOfferPublication, restoreLinkedOfferDraft, selectLinkedOfferCopies } from "../src/lib/records/ebay-linked-offers.ts";
import { linkedOfferDescription, linkedOfferTitle } from "../src/lib/records/linked-offer-copy.ts";

test("linked offers keep compatibility strict and select exact Copies oldest first", () => {
  assert.notEqual(linkedOfferCompatibilityKey({ printingId: "a", edition: "1st", condition: "Near Mint" }), linkedOfferCompatibilityKey({ printingId: "a", edition: "1st", condition: "Lightly Played" }));
  assert.deepEqual(selectLinkedOfferCopies([{ copyId: "b", acquiredAt: "2026-01-01", printingId: "a", edition: "1st", condition: "Near Mint" }, { copyId: "a", acquiredAt: "2026-01-01", printingId: "a", edition: "1st", condition: "Near Mint" }, { copyId: "c", acquiredAt: "2025-12-31", printingId: "a", edition: "1st", condition: "Near Mint" }], 2).map((copy) => copy.copyId), ["c", "a"]);
});

test("drafts retain exact pools and operation identity safely recovers partial publication", () => {
  assert.deepEqual(restoreLinkedOfferDraft({ copyIds: ["a"], listKeptCopies: true, offers: [{ id: "individual", kind: "individual", publicationState: "reviewed" }] }, ["a"]), { ok: true, draft: { copyIds: ["a"], listKeptCopies: true, offers: [{ id: "individual", kind: "individual", publicationState: "reviewed" }] } });
  assert.equal(restoreLinkedOfferDraft({ copyIds: ["a"], listKeptCopies: false, offers: [] }, []).ok, false);
  assert.equal(linkedOfferFingerprint({ b: 1, a: ["x"] }), linkedOfferFingerprint({ a: ["x"], b: 1 }));
  assert.equal(recoverLinkedOfferPublication([{ publicationUuid: "id", state: "failed" }], "id", null).retryable, true);
  assert.equal(recoverLinkedOfferPublication([{ publicationUuid: "id", state: "published" }], "id", "123").state, "already_published");
});

test("saved listing photos are reusable for the same variant and offer type", () => {
  assert.equal(photoPolicy({ hasMatchingReusablePhotos: true, kind: "x3" }).mayReuse, true);
  assert.equal(photoPolicy({ hasMatchingReusablePhotos: false, kind: "individual" }).requiresPhotos, true);
});

test("generated titles keep the offer difference and descriptions stay buyer-facing", () => {
  const identity = { condition: "Near Mint", edition: "1st Edition", name: "A Very Long Yu-Gi-Oh Card Name Used To Exercise The Title Limit", rarity: "Quarter Century Secret Rare", setCode: "MP24-EN001", setName: "25th Anniversary Tin: Dueling Mirrors" };
  const individualTitle = linkedOfferTitle("individual", identity);
  const setTitle = linkedOfferTitle("x3", identity);
  assert.ok(individualTitle.length <= 80);
  assert.ok(setTitle.length <= 80);
  assert.match(individualTitle, /^Yu-Gi-Oh! /);
  assert.doesNotMatch(individualTitle, /Single Card/);
  assert.match(setTitle, /^Yu-Gi-Oh! 3-Card Set - /);
  assert.doesNotMatch(setTitle, /\s1 - 3-Card Set$/);
  const blueEyesSetTitle = linkedOfferTitle("x2", { ...identity, name: "Blue-Eyes White Dragon", setCode: "MP24" });
  assert.equal(blueEyesSetTitle, "Yu-Gi-Oh! 2-Card Set - Blue-Eyes White Dragon MP24 Quarter Century Secret Rare");
  const individual = linkedOfferDescription("individual", identity);
  const set = linkedOfferDescription("x3", identity);
  for (const description of [individual, set]) {
    assert.match(description, /Set: 25th Anniversary Tin: Dueling Mirrors \(MP24-EN001\)/);
    assert.match(description, /Condition: Near Mint on every Copy/);
    assert.match(description, /please send me a message/);
    assert.doesNotMatch(description, /One listing with quantity|eBay quantity|Photos show the current matching stock/);
  }
  assert.match(individual, /exact physical Copy you receive may differ/);
  assert.match(set, /Set size: 3 matching Copies/);
});

test("set price keeps a comparable prior per-card rate without inventing a discount", () => {
  assert.equal(linkedOfferPricePrefill("x3", 500), 1500);
  assert.equal(linkedOfferPricePrefill("x3", 500, [{ kind: "x2", pricePence: 900 }]), 1350);
  assert.equal(linkedOfferPricePrefill("individual", 500, [{ kind: "x2", pricePence: 900 }]), 500);
});

test("target-wide hold and safe offer quantities follow the agreed examples", () => {
  assert.deepEqual(linkedOfferAvailability(3, 1), { owned: 3, kept: 1, toList: 2, otherwiseEligible: 3 });
  assert.deepEqual([1, 2, 3, 6].map(linkedOfferQuantities), [{ individual: 1, set: null }, { individual: 2, set: { kind: "x2", quantity: 1 } }, { individual: 3, set: { kind: "x3", quantity: 1 } }, { individual: 6, set: { kind: "x3", quantity: 2 } }]);
  assert.deepEqual(linkedOfferAvailability(5, 0, 2), { owned: 5, kept: 0, toList: 3, otherwiseEligible: 3 });
  assert.deepEqual(linkedOfferAvailability(2, 5), { owned: 2, kept: 2, toList: 0, otherwiseEligible: 2 });
  assert.deepEqual(linkedOfferQuantities(5), { individual: 5, set: { kind: "x3", quantity: 1 } });
});

test("target-wide Wishlist protection keeps the best-condition exact Copies first", () => {
  const copies = protectLinkedOfferWishlistCopies([
    ...Array.from({ length: 6 }, (_, index) => ({ copyId: `nm-${index + 1}`, acquiredAt: `2026-01-0${index + 1}`, printingId: "a", edition: "1st", condition: "Near Mint" })),
    { copyId: "lp-1", acquiredAt: "2026-01-07", printingId: "a", edition: "1st", condition: "Lightly Played" },
  ], 1);
  const nearMint = copies.filter((copy) => copy.condition === "Near Mint");
  const lightlyPlayed = copies.filter((copy) => copy.condition === "Lightly Played");
  assert.deepEqual(linkedOfferVariantAvailability(nearMint), { owned: 6, kept: 1, toList: 5, otherwiseEligible: 6 });
  assert.deepEqual(linkedOfferVariantAvailability(lightlyPlayed), { owned: 1, kept: 0, toList: 1, otherwiseEligible: 1 });
  assert.deepEqual(selectLinkedOfferCopies(nearMint, 5).map((copy) => copy.copyId), ["nm-1", "nm-2", "nm-3", "nm-4", "nm-5"]);
  assert.deepEqual(selectLinkedOfferCopies(nearMint, 6).map((copy) => copy.copyId), ["nm-1", "nm-2", "nm-3", "nm-4", "nm-5", "nm-6"]);
});

test("Wishlist protection falls through LP, MP, then HP when better conditions are absent", () => {
  const copies = protectLinkedOfferWishlistCopies([
    { copyId: "hp", acquiredAt: "2026-01-01", printingId: "a", edition: "1st", condition: "Heavily Played" },
    { copyId: "lp", acquiredAt: "2026-01-02", printingId: "a", edition: "1st", condition: "Lightly Played" },
    { copyId: "mp", acquiredAt: "2026-01-03", printingId: "a", edition: "1st", condition: "Moderately Played" },
  ], 2);
  assert.deepEqual(copies.filter((copy) => copy.wishlistProtected).map((copy) => copy.copyId).sort(), ["lp", "mp"]);
  assert.deepEqual(selectLinkedOfferCopies(copies, 1).map((copy) => copy.copyId), ["hp"]);
});

test("preview ends x2 before x3 and preserves an unchanged x3", () => {
  assert.deepEqual(planLinkedOfferChanges([{ kind: "individual", quantity: 2, state: "active" }, { kind: "x2", quantity: 1, state: "active" }], 3).map((change) => change.action), ["Increase individual quantity", "End x2 offer", "Create x3 offer"]);
  assert.deepEqual(planLinkedOfferChanges([{ kind: "individual", quantity: 3, state: "active" }, { kind: "x3", quantity: 1, state: "active" }], 4).map((change) => change.action), ["Increase individual quantity", "No change"]);
  assert.equal(linkedOfferPlanProblem([{ kind: "x2", quantity: 1, state: "active" }, { kind: "x3", quantity: 1, state: "active" }]), "x2 and x3 offers cannot be active together.");
});

test("durable operations end linked sets in individual-only mode and treat unknown remote state as active", () => {
  assert.deepEqual(linkedOfferOperations([
    { kind: "individual", listingId: "one", quantity: 2, state: "unknown" },
    { kind: "x2", listingId: "two", quantity: 1, state: "active" },
  ], 3, "individual"), [
    { action: "update", desiredQuantity: 3, kind: "individual", listingId: "one" },
    { action: "end", desiredQuantity: 0, kind: "x2", listingId: "two" },
  ]);
});

test("the 2, 3, 4, and 6-Copy previews state every keep, increase, end, and create action", () => {
  assert.deepEqual(planLinkedOfferChanges([{ kind: "individual", quantity: 1, state: "active" }], 2).map((change) => change.action), ["Increase individual quantity", "Create x2 offer"]);
  assert.deepEqual(planLinkedOfferChanges([{ kind: "individual", quantity: 2, state: "active" }, { kind: "x2", quantity: 1, state: "active" }], 3).map((change) => change.action), ["Increase individual quantity", "End x2 offer", "Create x3 offer"]);
  assert.deepEqual(planLinkedOfferChanges([{ kind: "individual", quantity: 3, state: "active" }, { kind: "x3", quantity: 1, state: "active" }], 4).map((change) => change.action), ["Increase individual quantity", "No change"]);
  assert.deepEqual(planLinkedOfferChanges([], 6).map((change) => change.action), ["Create individual offer", "Create x3 offer"]);
});

test("the grouped UI retires Copy-led and mixed-lot entry points", () => {
  const header = readFileSync(new URL("../src/components/app-header.tsx", import.meta.url), "utf8");
  const inventory = readFileSync(new URL("../src/components/records/records-app.tsx", import.meta.url), "utf8");
  const grouped = readFileSync(new URL("../src/components/records/linked-offer-listing.tsx", import.meta.url), "utf8");
  const newListingPage = readFileSync(new URL("../src/app/records/(workspace)/listings/new/page.tsx", import.meta.url), "utf8");
  const legacySellRoute = readFileSync(new URL("../src/app/records/(workspace)/inventory/cards/[targetId]/copies/[copyId]/sell/page.tsx", import.meta.url), "utf8");
  const legacyLotRoute = readFileSync(new URL("../src/app/records/(workspace)/listings/new-lot/page.tsx", import.meta.url), "utf8");
  assert.match(header, /label: "Create listing"/);
  assert.doesNotMatch(header, /label: "Mixed card lot"/);
  assert.doesNotMatch(inventory, /EbayListingAction/);
  assert.match(inventory, /linkedListingHref\(target\.id, selectedDetail\.printing\.id, selectedDetail\.copy\.condition\)/);
  assert.match(grouped, /Sell cards individually/);
  assert.match(grouped, /Create linked listings/);
  assert.match(grouped, /aria-label="Listing breadcrumb"[\s\S]*href="\/records\/listings"[\s\S]*Back to Listings/);
  assert.match(grouped, /Active now/);
  assert.match(grouped, /After this change/);
  assert.match(grouped, /Exact selected Copies/);
  assert.match(grouped, /Temporary warning: linked listings can oversell/);
  assert.match(grouped, />Wanted<\/dt>/);
  assert.match(grouped, /Your Wishlist protects the best-condition Copies first\./);
  assert.match(grouped, /Include wanted Copies/);
  assert.match(grouped, /This card is on your Wishlist\. Including this many Copies may sell one you want to keep\./);
  assert.match(grouped, /<ListingPhotoSetManager/);
  assert.match(grouped, /<ListingPhotoSetManager[\s\S]*?surface="card"/);
  assert.doesNotMatch(grouped, />Kept<\/dt>|List kept copies/);
  assert.match(grouped, /group\.printing\.imageUrl \|\| group\.target\.imageUrl/);
  assert.match(grouped, /object-cover object-center opacity-\[0\.06\]/);
  assert.match(grouped, /View card image for \$\{group\.target\.name\}/);
  assert.match(grouped, /<CardImagePreviewDialog/);
  assert.match(grouped, /Upfront eBay fee/);
  assert.match(grouped, /Buyer receives/);
  assert.match(grouped, /const deliveryMarkupPence = 40/);
  assert.match(grouped, /shippingCost: service \? suggestedDeliveryCharge\(service\) : current\.shippingCost, shippingService/);
  assert.match(grouped, /suggested cost plus 40p/);
  assert.match(grouped, /Ready to publish/);
  assert.match(grouped, /Every offer passed its independent eBay Review\./);
  assert.match(grouped, /fixed bottom-4 right-4 z-\[100\][\s\S]*bg-emerald-700[\s\S]*role="status"/);
  assert.doesNotMatch(grouped, /eBay fees: \{result\.review\.fees\.map/);
  assert.match(grouped, /A previous listing attempt needs attention/);
  assert.match(grouped, /Resume failed listing/);
  assert.match(grouped, /Continue fresh/);
  assert.match(grouped, /listing has.*ended/);
  assert.doesNotMatch(grouped, /already published/);
  assert.match(grouped, /Delete unfinished.*draft/);
  assert.match(grouped, /It won&apos;t remove ended listings, inventory history, or saved photos/);
  assert.match(grouped, /<DiscardDraftDialog/);
  assert.match(grouped, /createPortal\(/);
  assert.match(grouped, /useViewportOverlay/);
  assert.match(grouped, /resumeFamilyId !== family\.id/);
  assert.match(grouped, /router\.replace\(resumeHref\(saved\.familyId\), \{ scroll: false \}\)/);
  assert.match(newListingPage, /resume\?: string/);
  assert.match(newListingPage, /initialResumeFamilyId=\{resume\}/);
  assert.doesNotMatch(grouped, /anchor Copy|Keep anchor only|Move up|Move down/);
  assert.match(legacySellRoute, /redirect\(`\/records\/listings\/new\?target=/);
  assert.match(legacyLotRoute, /redirect\("\/records\/listings\/new"\)/);
});

test("the card target picker searches a bounded list with full keyboard support", () => {
  const grouped = readFileSync(new URL("../src/components/records/linked-offer-listing.tsx", import.meta.url), "utf8");
  const picker = readFileSync(new URL("../src/components/records/searchable-picklist.tsx", import.meta.url), "utf8");
  assert.match(grouped, /label="Card target"[\s\S]*placeholder="Search owned cards"/);
  assert.match(grouped, /copy\.status !== "available" \|\| !isCardCondition\(copy\.condition\)/);
  assert.match(grouped, /No owned cards match that search/);
  assert.match(grouped, /label="Printing and condition"[\s\S]*placeholder="Search Printing or condition"/);
  assert.match(grouped, /Copies are grouped by Printing and condition so every card in the listing matches/);
  assert.match(grouped, /visibleRows=\{3\}/);
  assert.doesNotMatch(grouped, /Card target<select/);
  assert.match(picker, /role="combobox"/);
  assert.match(picker, /role="listbox"/);
  assert.match(picker, /event\.key === "ArrowDown"/);
  assert.match(picker, /event\.key === "Enter"/);
  assert.match(picker, /event\.key === "Escape"/);
  assert.match(picker, /if \(optionPointerDownRef\.current\) return/);
  assert.match(picker, /event\.pointerType !== "touch"[\s\S]*selectOption\(option\)/);
  assert.match(picker, /Math\.hypot\([\s\S]*> 10/);
  assert.match(picker, /Showing \{maxResults\} of \{filteredOptions\.length\} matches/);
});

test("Inventory preloads photo sets and switches them without remounting", () => {
  const photoManager = readFileSync(new URL("../src/components/records/card-photo-manager.tsx", import.meta.url), "utf8");
  const photoSets = readFileSync(new URL("../src/components/records/listing-photo-set-manager.tsx", import.meta.url), "utf8");
  assert.match(photoSets, /const listingPhotoKinds = \["individual", "x2", "x3"\]/);
  assert.match(photoSets, /listingPhotoKinds\.map\(\(candidate\) => \{/);
  assert.match(photoSets, /<ListingPhotoSetManager \{\.\.\.props\} kind=\{candidate\} \/>/);
  assert.doesNotMatch(photoSets, /<ListingPhotoSetManager \{\.\.\.props\} key=\{kind\} kind=\{kind\}/);
  assert.match(photoSets, /role="tablist"/);
  assert.match(photoSets, /role="tabpanel"/);
  assert.match(photoSets, /col-start-1 row-start-1 h-full min-w-0/);
  assert.match(photoSets, /inert=\{!active\}/);
  assert.match(photoSets, /transition-opacity duration-150/);
  assert.match(photoSets, /pointer-events-none invisible opacity-0/);
  assert.match(photoManager, /const canArrange = canManage && !loading && images\.length > 1 && !reordering/);
  assert.match(photoManager, /surface = "card"/);
  assert.match(photoManager, /surface === "card" \? "rounded-xl border border-zinc-300 bg-white p-4 shadow-sm" : "bg-transparent"/);
  assert.match(photoManager, /descriptionDisplay = "inline"/);
  assert.match(photoManager, /headingDisplay = "visible"/);
  assert.match(photoManager, /positionDescriptionPopover[\s\S]*?trigger\.closest\("section"\)[\s\S]*?boundaryLeft[\s\S]*?triggerBounds\.left[\s\S]*?boundaryRight - width/);
  assert.match(photoManager, /popover\.style\.width = `\$\{width\}px`[\s\S]*?popover\?\.offsetHeight/);
  assert.match(photoManager, /descriptionDisplay === "tooltip"[\s\S]*?aria-describedby=\{descriptionOpen \? descriptionId : undefined\}[\s\S]*?onMouseEnter=\{keepDescriptionOpenOnHover\}/);
  assert.match(photoManager, /window\.matchMedia\("\(hover: hover\)"\)\.matches/);
  assert.match(photoManager, /descriptionDisplay === "tooltip" && descriptionOpen \? createPortal\([\s\S]*?fixed z-\[90\][\s\S]*?document\.body/);
  assert.match(photoManager, /descriptionDisplay === "inline" \? <p className="mt-1 text-sm font-medium text-zinc-600"/);
  assert.match(photoManager, /headingDisplay === "visible" \? "mt-3 " : ""/);
  assert.match(photoManager, /<div className="flex min-h-11 items-center gap-2">[\s\S]*?Arrange photos[\s\S]*?\{secondaryAction \? \(/);
  assert.match(photoManager, /flex min-h-40 flex-1 items-center justify-center rounded-md border border-dashed/);
  assert.match(photoManager, /min-w-40 items-center justify-center/);
  assert.match(photoManager, /aria-disabled=\{!canArrange\}/);
  assert.match(photoManager, /Add at least two photos first, then you can arrange them\./);
  assert.match(photoManager, /fixed bottom-4 right-4 z-50[\s\S]*role="alert"/);
  assert.match(photoManager, /createPortal\([\s\S]*?aria-modal="true"[\s\S]*?Close remove photo confirmation/);
  assert.match(photoManager, /document\.body\.style\.overflow = "hidden"/);
  assert.match(photoManager, /window\.addEventListener\("keydown", closeOnEscape\)/);
  assert.match(photoManager, /removalTriggerRef\.current\?\.focus\(\)/);
  assert.match(photoSets, /surface = "plain"/);
  assert.match(photoSets, /surface=\{surface\}/);
  assert.match(photoSets, /descriptionDisplay="tooltip"/);
  assert.match(photoSets, /secondaryAction=\{kind === "individual" && sourceCopyIds\.length \? \{/);
  assert.match(photoSets, /className="grid min-w-0 border-t border-zinc-200 p-4 sm:p-5"/);
});

test("the persisted plan and server workflow keep exact stock and recoverable offer identities", () => {
  const migration = readFileSync("drizzle/0007_ebay_linked_listing_families.sql", "utf8");
  const server = readFileSync(new URL("../src/server/records/ebay-linked-offers.ts", import.meta.url), "utf8");
  const router = readFileSync(new URL("../src/server/routers/ebay.ts", import.meta.url), "utf8");
  const actions = readFileSync(new URL("../src/server/records/actions.ts", import.meta.url), "utf8");
  assert.match(migration, /CREATE TABLE "ebay_listing_families"/);
  assert.match(migration, /CREATE TABLE "ebay_listing_family_offers"/);
  assert.match(migration, /DROP INDEX "ebay_listings_owner_copy_open_unique"/);
  assert.match(migration, /ebay_listing_family_offers_owner_uuid_unique/);
  assert.match(server, /selectLinkedOfferCopies[\s\S]*stable oldest-first exact Copy pool/);
  assert.match(server, /publicationUuid[\s\S]*requestFingerprint/);
  assert.match(server, /<MessageID>\$\{offer\.publicationUuid\}<\/MessageID>/);
  assert.match(server, /offerSetSize\(offer\.kind\)/);
  assert.match(server, /duplicateEbayItemId/);
  assert.match(server, /\["end", "update", "create", "no_change"\]/);
  assert.match(server, /remoteAttempted \? "uncertain" : "failed"/);
  assert.match(server, /filter\(\(fee\) => Number\.isFinite\(fee\.amount\) && fee\.amount !== 0\)/);
  assert.match(server, /const hasUpfrontFee = fees\.some\(\(fee\) => fee\.amount > 0\)/);
  assert.match(server, /readyToPublish: !hasUpfrontFee/);
  assert.match(server, /currentListingState: offer\.listingId/);
  assert.match(server, /export async function discardLinkedOfferDraft/);
  assert.match(server, /offer\.state !== "published"/);
  assert.match(server, /ne\(ebayListingFamilyOffers\.state, "published"\)/);
  assert.match(server, /draft: \{\}/);
  assert.match(router, /discardLinkedOfferDraft/);
  assert.match(router, /reviewLinkedOfferPlan[\s\S]*requireEbayExternalCapability/);
  assert.match(router, /publishLinkedOfferPlan[\s\S]*requireEbayExternalCapability/);
  assert.match(actions, /\["failed", "uncertain", "publishing"\]/);
});

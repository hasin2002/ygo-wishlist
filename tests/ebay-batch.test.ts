import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ebayBatchOfferFingerprint,
  ebayBatchOfferIsReady,
  ebayBatchOverlaps,
  ebayBatchPublicationBlock,
  ebayCrossListingPlanProblem,
  effectiveEbayBatchDefaults,
  planEbayCrossListingOfferSeeds,
  type EbayBatchOffer,
  type EbayBatchSharedDefaults,
} from "../src/lib/records/ebay-batch.ts";

const shared: EbayBatchSharedDefaults = {
  dispatchTimeMax: "3",
  language: "English",
  location: "Surrey",
  postalCode: "GU21 6DE",
  reusableDescription: "Shared seller notes",
  shippingCost: "1.55",
  shippingService: "UK_RoyalMailSecondClassStandard",
};

function offer(
  id: string,
  copyIds: string[],
  kind: EbayBatchOffer["kind"] = copyIds.length > 1 ? "quantity" : "individual",
): EbayBatchOffer {
  return {
    copyIds,
    description: "A sufficiently detailed card description.",
    id,
    itemSpecifics: {
      cardNumber: "LOB-001",
      cardSize: "Japanese",
      features: "1st Edition",
      game: "Yu-Gi-Oh! TCG",
      manufacturer: "Konami",
      rarity: "Ultra Rare",
      setName: "Legend of Blue Eyes White Dragon",
    },
    kind,
    overrideDefaults: null,
    photos: [{ archiveKey: "draft/photo.jpg", ebayUrl: "https://i.ebayimg.com/photo.jpg", previewUrl: "/preview/photo.jpg" }],
    price: "12.00",
    publicationId: "A".repeat(32),
    publishedItemId: null,
    publishedUrl: null,
    status: "draft",
    statusMessage: null,
    title: "Blue-Eyes White Dragon LOB-001",
    validatedFingerprint: null,
    verification: null,
  };
}

test("the planner creates one full lot plus policy-safe standalone offers", () => {
  assert.deepEqual(planEbayCrossListingOfferSeeds([
    { condition: "Near Mint", copyId: "copy-a", edition: "1st Edition", printingId: "printing-a" },
    { condition: "Near Mint", copyId: "copy-b", edition: "1st Edition", printingId: "printing-a" },
    { condition: "Lightly Played", copyId: "copy-c", edition: "1st Edition", printingId: "printing-a" },
    { condition: "Near Mint", copyId: "copy-d", edition: "Unlimited Edition", printingId: "printing-a" },
  ]), [
    { copyIds: ["copy-a", "copy-b", "copy-c", "copy-d"], kind: "bundle" },
    { copyIds: ["copy-a", "copy-b"], kind: "quantity" },
    { copyIds: ["copy-c"], kind: "individual" },
    { copyIds: ["copy-d"], kind: "individual" },
  ]);
});

test("per-offer defaults inherit shared values without mutating the batch defaults", () => {
  const effective = effectiveEbayBatchDefaults(shared, {
    dispatchTimeMax: shared.dispatchTimeMax,
    shippingCost: "0.00",
    shippingService: shared.shippingService,
  });
  assert.equal(effective.shippingCost, "0.00");
  assert.equal(effective.language, "English");
  assert.equal(effective.location, "Surrey");
  assert.equal(shared.shippingCost, "1.55");
});

test("a reviewed offer becomes stale whenever its publishing inputs change", () => {
  const draft = offer("offer-a", ["copy-a"]);
  const fingerprint = ebayBatchOfferFingerprint(draft, shared);
  const reviewed: EbayBatchOffer = {
    ...draft,
    status: "ready",
    validatedFingerprint: fingerprint,
    verification: { errors: [], fees: [], readyToPublish: true },
  };
  assert.equal(ebayBatchOfferIsReady(reviewed, shared), true);
  assert.equal(ebayBatchOfferIsReady({ ...reviewed, price: "13.00" }, shared), false);
  assert.equal(ebayBatchOfferIsReady(reviewed, { ...shared, postalCode: "GU2 2BB" }), false);
});

test("intentional lot-to-standalone overlap is required instead of blocked", () => {
  const offers = [
    offer("lot", ["copy-a", "copy-b"], "bundle"),
    offer("single-a", ["copy-a"], "individual"),
    offer("single-b", ["copy-b"], "individual"),
  ];
  assert.equal(ebayCrossListingPlanProblem(offers), null);
  assert.equal(ebayBatchPublicationBlock(offers), "3 offers need an independent eBay review before publishing.");
  assert.deepEqual(ebayBatchOverlaps(offers), [
    { copyId: "copy-a", offerIds: ["lot", "single-a"] },
    { copyId: "copy-b", offerIds: ["lot", "single-b"] },
  ]);
  assert.match(
    ebayCrossListingPlanProblem([
      ...offers,
      offer("duplicate-a", ["copy-a"], "individual"),
    ]) ?? "",
    /only one standalone offer/,
  );
  assert.match(
    ebayCrossListingPlanProblem([
      offer("lot", ["copy-a", "copy-b"], "bundle"),
      offer("quantity", ["copy-a", "copy-b"], "quantity"),
    ]) ?? "",
    /at least two distinct standalone groups/,
  );
});

test("the batch endpoint rechecks the one-card policy-safe plan on the server", () => {
  const router = readFileSync(new URL("../src/server/routers/ebay.ts", import.meta.url), "utf8");
  const listing = readFileSync(new URL("../src/server/ebay-listing.ts", import.meta.url), "utf8");
  assert.match(router, /publishBatchOffer:[\s\S]*await assertBatchPublicationPlan\(ctx\.collectionOwnerId, input\)/);
  assert.match(router, /new Set\(rows\.map\(\(row\) => row\.normalizedName\)\)\.size !== 1/);
  assert.match(router, /planEbayCrossListingOfferSeeds[\s\S]*Standalone offers must group identical Printing/);
  assert.match(listing, /planFingerprint[\s\S]*different membership plan/);
  assert.match(listing, /blockingRelatedListings[\s\S]*publication\?\.batchId/);
});

test("the publication migration persists the cross-list group and permits shared active membership", () => {
  const migration = readFileSync("drizzle/0005_ebay_cross_listing_publications.sql", "utf8");
  assert.match(migration, /CREATE TABLE "ebay_listing_publication_groups"/);
  assert.match(migration, /CREATE TABLE "ebay_listing_publications"/);
  assert.match(migration, /DROP INDEX "ebay_listings_owner_copy_open_unique"/);
  assert.match(migration, /owner_group_fk/);
  assert.match(migration, /owner_batch_offer_unique/);
  assert.match(migration, /owner_uuid_unique/);
  assert.match(migration, /publication_uuid[\s\S]*\^\[A-F0-9\]\{32\}\$/);
});

test("the UI describes one full lot plus standalones and requires manual sale protection", () => {
  const client = readFileSync(new URL("../src/components/records/ebay-batch-planner.tsx", import.meta.url), "utf8");
  const header = readFileSync(new URL("../src/components/app-header.tsx", import.meta.url), "utf8");
  const listings = readFileSync(new URL("../src/components/records/ebay-listings-workspace.tsx", import.meta.url), "utf8");
  assert.match(client, /Create the full lot and its standalone offers/);
  assert.match(client, /planEbayCrossListingOfferSeeds/);
  assert.match(client, /Manual sale protection required for now/);
  assert.match(client, /Standalone offers publish first and the full lot publishes last/);
  assert.match(client, /aria-controls=\{editorId\} aria-expanded=\{expanded\}/);
  assert.match(client, /\{children\}\s*<\/article>/);
  assert.match(client, /Close details/);
  assert.match(client, /One linked cross-list set/);
  assert.doesNotMatch(client, /Standalone buying options|Primary listing/);
  assert.match(client, /rarityAbbreviation\(rarity\)/);
  assert.match(client, /postalCode: "GU21 6DE"/);
  assert.doesNotMatch(client, />Item location<|>Language<|>Postcode</);
  assert.doesNotMatch(client, /editingOfferId \? \(\(\) =>/);
  assert.doesNotMatch(client, /FormDraftStatus/);
  assert.doesNotMatch(client, /Preview overlap|Move selected to one lot|onSplit/);
  assert.match(header, /label: "List card multiple ways"/);
  assert.match(header, /Create a full lot plus separate single or quantity eBay listings/);
  assert.doesNotMatch(listings, /href="\/records\/listings\/new-batch"/);
});

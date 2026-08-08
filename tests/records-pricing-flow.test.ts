import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { cardPricingIdentityKey } from "../src/lib/records/card-pricing.ts";
import {
  ebayPricingSearchTerms,
  ebayTitleMatchesSetCode,
} from "../src/lib/records/ebay-pricing-search.ts";

test("Records pricing separates exact Printings and conditions", () => {
  assert.equal(
    cardPricingIdentityKey({ condition: " Near Mint ", name: " Blue-Eyes   White Dragon ", setCode: " LOB-001 " }),
    cardPricingIdentityKey({ condition: "near mint", name: "blue-eyes white dragon", setCode: "lob-001" }),
  );
  assert.notEqual(
    cardPricingIdentityKey({ condition: "Near Mint", name: "Blue-Eyes White Dragon", setCode: "LOB-001" }),
    cardPricingIdentityKey({ condition: "Near Mint", name: "Blue-Eyes White Dragon", setCode: "SDK-001" }),
  );
  assert.notEqual(
    cardPricingIdentityKey({ condition: "Near Mint", name: "Blue-Eyes White Dragon", setCode: "LOB-001" }),
    cardPricingIdentityKey({ condition: "Lightly Played", name: "Blue-Eyes White Dragon", setCode: "LOB-001" }),
  );
  assert.equal(cardPricingIdentityKey({ condition: "Near Mint", name: "Ignored", printingId: "printing-1", setCode: "Ignored" }), "printing-1::near mint");
});

test("eBay queries retain set code while listings may omit it", () => {
  const card = { condition: "Near Mint", name: "Blue-Eyes White Dragon", setCode: "LOB-001" };
  assert.equal(ebayPricingSearchTerms(card, true), "Blue-Eyes White Dragon LOB-001 Near Mint english");
  assert.equal(ebayPricingSearchTerms(card, false), "Blue-Eyes White Dragon LOB-001 english");
  assert.equal(ebayTitleMatchesSetCode("Blue-Eyes White Dragon LOB-001 Near Mint", "LOB-001"), true);
  assert.equal(ebayTitleMatchesSetCode("Blue-Eyes White Dragon Near Mint Yu-Gi-Oh!", "LOB-001"), true);
  assert.equal(ebayTitleMatchesSetCode("Blue-Eyes White Dragon SDK-001 Near Mint", "LOB-001"), false);
});

test("entry forms start estimates during card completion and carry results into saves", () => {
  const forms = fs.readFileSync("src/components/records/purchase-opening-forms.tsx", "utf8");
  const editor = fs.readFileSync("src/components/records/card-contents-editor.tsx", "utf8");
  const records = fs.readFileSync("src/server/routers/records.ts", "utf8");
  assert.match(editor, /onFinishCard\?\.\(completed\)/);
  assert.match(forms, /onFinishCard=\{source\.mode === "live" \? cardPricing\.requestPricing : undefined\}/);
  assert.match(forms, /if \(step === 3 && source\.mode === "live"\)/);
  assert.match(forms, /pricing: completedPricing/);
  assert.match(forms, /cardPricingIdentityKey\(current\.card\) === pricing\.identityKey/);
  assert.match(records, /const estimatedPricePence = input\.pricing\.estimatedPricePence/);
  assert.match(records, /insert\(cardPricingEstimates\)/);
});

test("History uses full-page edits, variant refresh, and card-detail navigation", () => {
  const history = fs.readFileSync("src/components/records/records-app.tsx", "utf8");
  const entry = fs.readFileSync("src/components/records/record-entry-app.tsx", "utf8");
  assert.match(history, /href=\{recordEditHref\(record\)\}/);
  assert.match(history, /RecordPricingRefreshButton/);
  assert.match(history, /recordPricingVariants/);
  assert.match(history, /\/viewdbentries\?record=/);
  assert.match(history, /<SuccessToast[\s\S]*title="Pricing refreshed"/);
  assert.match(history, /<DestructiveToast[\s\S]*title="Pricing refresh incomplete"/);
  assert.match(history, /Refresh estimates \(\{variants\.length\}\)/);
  assert.doesNotMatch(history, /\{running \? `\$\{progress\.completed\}\/\$\{progress\.total\}`/);
  assert.doesNotMatch(history, /aria-label=\{`Edit \$\{record\.title\}`\}[\s\S]{0,300}setEditingRecordId/);
  assert.match(entry, /<PurchaseForm edit=\{\{ record: editingRecord, snapshot: editSource\.snapshot \}\}/);
  assert.match(entry, /<OpeningForm edit=\{\{ record: editingRecord, snapshot: editSource\.snapshot \}\}/);
  assert.match(entry, /editRecordId = searchParams\.get\("edit"\)/);
});

test("Record card viewer exposes listing state and an over-£5 unlisted opportunity filter", () => {
  const viewer = fs.readFileSync("src/app/viewdbentries/view-db-entries-client.tsx", "utf8");
  assert.match(viewer, /snapshot\.copyEbayExposures/);
  assert.match(viewer, /listingOpportunityMinimumPence = 500/);
  assert.match(viewer, /entry\.estimatedPricePence > listingOpportunityMinimumPence/);
  assert.match(viewer, /!hasCurrentListing/);
  assert.match(viewer, /Suggested to list \(&gt;£5\)/);
  assert.match(viewer, /Has associated listing/);
  assert.match(viewer, /No active listing/);
  assert.match(viewer, /linkedListingHref\(entry\.selectedTargetId/);
  assert.match(viewer, /useViewportOverlay<HTMLElement>/);
  assert.match(viewer, /aria-modal="true"/);
  assert.match(viewer, /createPortal\(/);
  assert.match(viewer, /function EntryCard\(/);
  assert.doesNotMatch(viewer, /<table/);
  assert.match(viewer, /aria-label=\{`Create listing for \$\{entry\.name\}`\}/);
  assert.match(viewer, />Suggested to list · over £5<\/Link>/);
  assert.doesNotMatch(viewer, />Create listing<\/Link>/);
});

test("Records estimates persist by Printing and condition and eBay fallback retains set code", () => {
  const schema = fs.readFileSync("src/db/schema.ts", "utf8");
  const records = fs.readFileSync("src/server/routers/records.ts", "utf8");
  const ebay = fs.readFileSync("src/server/ebay-pricing.ts", "utf8");
  const ebaySearch = fs.readFileSync("src/lib/records/ebay-pricing-search.ts", "utf8");
  const library = fs.readFileSync("src/components/wishlist-app.tsx", "utf8");
  assert.match(schema, /card_pricing_estimates_owner_variant_unique/);
  assert.match(schema, /table\.ownerId,[\s\S]*table\.printingId,[\s\S]*table\.condition/);
  assert.match(records, /cardPricingEstimates\.printingId/);
  assert.match(records, /cardPricingEstimates\.condition/);
  assert.match(ebay, /prices\.length < minimumConditionSampleSize/);
  assert.match(ebay, /ebayPricingSearchTerms\(card, includeCondition\)/);
  assert.match(ebaySearch, /explicitCodes\.length === 0/);
  assert.match(library, /recordPricingCandidates/);
  assert.match(library, /refreshRecordPricing\.mutateAsync/);
});

test("Purchase and Pack Opening edits open on card details with a three-step progress flow", () => {
  const forms = fs.readFileSync("src/components/records/purchase-opening-forms.tsx", "utf8");
  assert.match(forms, /const \[step, setStep\] = useState\(\(\) => edit \? 3 : 1\)/);
  assert.match(forms, /\? \["Purchase", "Item details", "Review"\]\s+: \["Item type", "Purchase", "Item details", "Review"\]/);
  assert.match(forms, /\? \["Product", "Pulled cards", "Review"\]\s+: \["Opening type", "Product", "Pulled cards", "Review"\]/);
  assert.match(forms, /const firstVisibleStep = edit \? 2 : 1/);
  assert.match(forms, /Math\.max\(firstVisibleStep, current - 1\)/);
  assert.match(forms, /step=\{wizardStep\} totalSteps=\{wizardTotalSteps\}/);
  assert.match(forms, /finalLabel=\{edit \? "Update purchase"/);
  assert.match(forms, /finalLabel=\{edit \? "Update opening"/);
  assert.match(forms, /source\.replaceRecordCards\(\s*edit\.record\.id/);
  assert.match(forms, /bulkTotalQuantity: draft\.kind === "bulk"/);
  assert.match(forms, /details: detailsUpdate/);
  assert.match(forms, /Your draft is still saved in this tab/);
  assert.doesNotMatch(forms, /Some item changes were already saved/);
});

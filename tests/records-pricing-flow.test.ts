import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { cardPricingIdentityKey } from "../src/lib/records/card-pricing.ts";

test("pricing deduplicates shared Targets while separating rarity and edition", () => {
  assert.equal(cardPricingIdentityKey({ selectedTargetId: "target-blue-eyes", name: "Blue-Eyes White Dragon", rarity: "Ultra Rare", edition: "1st Edition" }), "target-blue-eyes");
  assert.equal(
    cardPricingIdentityKey({ name: " Blue-Eyes   White Dragon ", rarity: "Ultra Rare", edition: "1st Edition" }),
    cardPricingIdentityKey({ name: "blue-eyes white dragon", rarity: " ultra rare ", edition: "1st edition" }),
  );
  assert.notEqual(
    cardPricingIdentityKey({ name: "Blue-Eyes White Dragon", rarity: "Ultra Rare", edition: "1st Edition" }),
    cardPricingIdentityKey({ name: "Blue-Eyes White Dragon", rarity: "Secret Rare", edition: "1st Edition" }),
  );
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
  assert.match(records, /estimatedPricePence: input\.pricing\.estimatedPricePence/);
});

test("History uses full-page edits and offers per-Record estimate refresh", () => {
  const history = fs.readFileSync("src/components/records/records-app.tsx", "utf8");
  const entry = fs.readFileSync("src/components/records/record-entry-app.tsx", "utf8");
  assert.match(history, /href=\{recordEditHref\(record\)\}/);
  assert.match(history, /RecordPricingRefreshButton/);
  assert.doesNotMatch(history, /aria-label=\{`Edit \$\{record\.title\}`\}[\s\S]{0,300}setEditingRecordId/);
  assert.match(entry, /<PurchaseForm edit=\{\{ record: editingRecord, snapshot: editSource\.snapshot \}\}/);
  assert.match(entry, /<OpeningForm edit=\{\{ record: editingRecord, snapshot: editSource\.snapshot \}\}/);
  assert.match(entry, /editRecordId = searchParams\.get\("edit"\)/);
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
  assert.match(forms, /source\.replaceRecordCards\(edit\.record\.id/);
  assert.match(forms, /source\.updateRecordDetails\(edit\.record\.id/);
});

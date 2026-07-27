import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const saleFormSource = readFileSync(new URL("../src/components/records/sale-form.tsx", import.meta.url), "utf8");
const exposureSource = readFileSync(new URL("../src/components/records/ebay-copy-exposure.tsx", import.meta.url), "utf8");
const listingActionSource = readFileSync(new URL("../src/components/records/ebay-listing-action.tsx", import.meta.url), "utf8");
const recordsAppSource = readFileSync(new URL("../src/components/records/records-app.tsx", import.meta.url), "utf8");

test("Sale Copy selectors expose physical and eBay status in visible and accessible text", () => {
  assert.match(saleFormSource, /Physical · \{item\.exposure \? physicalCopyStateLabel/);
  assert.match(saleFormSource, /eBay exposure · \{exposurePresentation\?\.label/);
  assert.match(saleFormSource, /aria-label=\{`Select \$\{copyExposureSelectorLabel/);
  assert.match(saleFormSource, /eBay status \$\{exposurePresentation\?\.label/);
});

test("changing Sale selection and result counts use a polite atomic live region", () => {
  assert.match(saleFormSource, /aria-atomic="true" aria-live="polite"/);
});

test("offer history remains a native keyboard disclosure with named links", () => {
  assert.match(exposureSource, /<details/);
  assert.match(exposureSource, /<summary/);
  assert.match(exposureSource, /Open offer/);
  assert.match(exposureSource, /opens in a new tab/);
});

test("listing history disables Copy removal with an associated plain reason", () => {
  assert.match(recordsAppSource, /Remove Copy unavailable/);
  assert.match(recordsAppSource, /aria-describedby=\{`remove-copy-reason-/);
  assert.match(recordsAppSource, /selectedCopyRemoval\.reason/);
});

test("needs-takedown review links to the related live offers instead of the sell workspace", () => {
  assert.match(exposureSource, /id=\{`ebay-exposure-panel-\$\{exposure\.copyId\}`\}/);
  assert.match(listingActionSource, /href=\{`#ebay-exposure-panel-\$\{copy\.id\}`\}/);
  assert.match(listingActionSource, /Review live offers below/);
});

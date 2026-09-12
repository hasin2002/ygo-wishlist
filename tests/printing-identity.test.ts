import assert from "node:assert/strict";
import test from "node:test";
import {
  compatiblePrintingIdentity,
  compatibleCataloguePrintingIdentity,
  tcgplayerProductId,
  conflictsWithPrintingIdentity,
} from "../src/server/printing-identity.ts";

const printing = (overrides: Partial<{
  canonicalTcgplayerUrl: string | null;
  normalizedSetName: string;
  normalizedSetCode: string;
}> = {}) => ({
  canonicalTcgplayerUrl: null,
  normalizedSetName: "lob",
  normalizedSetCode: "lob-001",
  ...overrides,
});

test("different complete set/code Printings without product URLs coexist", () => {
  const first = printing({ canonicalTcgplayerUrl: null, normalizedSetCode: "lob-001" });
  const second = printing({ canonicalTcgplayerUrl: "   ", normalizedSetCode: "lob-005" });
  assert.equal(compatiblePrintingIdentity(first, second), false);
  assert.equal(conflictsWithPrintingIdentity(first, second), false);
});

test("matching set/code with contradictory product URLs is a human-review conflict", () => {
  const first = printing({ canonicalTcgplayerUrl: "tcgplayer.com/product/1" });
  const second = printing({ canonicalTcgplayerUrl: "tcgplayer.com/product/2" });
  assert.equal(conflictsWithPrintingIdentity(first, second), true);
});

test("catalogue identity accepts URL slugs and a legacy set prefix but rejects different products and full codes", () => {
  const old = printing({ canonicalTcgplayerUrl: "tcgplayer.com/product/123/card-title?Language=all", normalizedSetCode: "dune" });
  const current = printing({ canonicalTcgplayerUrl: "https://www.tcgplayer.com/product/123", normalizedSetCode: "dune-en095" });
  assert.equal(tcgplayerProductId(old.canonicalTcgplayerUrl), "123");
  assert.equal(compatibleCataloguePrintingIdentity(old, current), true);
  assert.equal(compatibleCataloguePrintingIdentity({ ...old, normalizedSetCode: "dune-en096" }, current), false);
  assert.equal(compatibleCataloguePrintingIdentity({ ...old, canonicalTcgplayerUrl: "tcgplayer.com/product/124" }, current), false);
  assert.equal(tcgplayerProductId("https://example.com/product/123"), null);
});

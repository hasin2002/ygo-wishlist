import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildEbayLotDescription,
  buildEbayLotTitle,
  ebayLotXmlContract,
  estimateEbayLotValue,
  moveEbayLotMember,
  planEbayLotSavedPhotoImports,
} from "../src/lib/records/ebay-lot.ts";
import { ebaySoldListingsUrl } from "../src/lib/records/ebay-sold-listings.ts";

const members = [
  { condition: "Near Mint", copyId: "copy-abcdef", edition: "1st Edition", name: "Blue-Eyes White Dragon", printing: "LOB-001", rarity: "Ultra Rare" },
  { condition: "Lightly Played", copyId: "copy-123456", edition: "Unlimited Edition", name: "Dark Magician", printing: "SDY-006", rarity: "Ultra Rare" },
];

test("lot wording includes buyer-useful card details and quantities without internal Copy references", () => {
  const description = buildEbayLotDescription(members);
  assert.match(description, /receive every physical/i);
  assert.match(description, /2 cards total/);
  assert.match(
    description,
    /1\. Blue-Eyes White Dragon — LOB-001; Ultra Rare; 1st Edition; Near Mint; Quantity 1/,
  );
  assert.match(
    description,
    /2\. Dark Magician — SDY-006; Ultra Rare; Unlimited Edition; Lightly Played; Quantity 1/,
  );
  assert.doesNotMatch(description, /Copy ref/i);
  assert.doesNotMatch(description, /copy-abcdef|copy-123456/);
});

test("lot wording uses singular total quantity and useful fallbacks for missing card details", () => {
  const description = buildEbayLotDescription([{
    condition: "",
    copyId: "internal-copy-id",
    edition: "",
    name: "Kuriboh",
    printing: "",
    rarity: "",
  }]);
  assert.match(description, /1 card total/);
  assert.match(
    description,
    /Kuriboh — Printing not specified; Rarity not specified; Edition not specified; Condition not specified; Quantity 1/,
  );
  assert.doesNotMatch(description, /internal-copy-id/);
});

test("lot membership moves deterministically without changing other members", () => {
  assert.deepEqual(moveEbayLotMember(["a", "b", "c"], "b", -1), ["b", "a", "c"]);
  assert.deepEqual(moveEbayLotMember(["a", "b", "c"], "a", -1), ["a", "b", "c"]);
});

test("lot XML contract matches the #14-proven heterogeneous lot shape", () => {
  assert.deepEqual(ebayLotXmlContract(3), {
    categoryId: "183455",
    categoryMappingAllowed: false,
    conditionXml: "<ConditionID>3000</ConditionID>",
    quantityXml: "<Quantity>1</Quantity>",
    lotSizeXml: "<LotSize>3</LotSize>",
  });
});

test("lot title is seller-editable-safe and limited to eBay's 80 characters", () => {
  assert.match(buildEbayLotTitle(members), /2 Card Lot/);
  assert.ok(buildEbayLotTitle([{ ...members[0], name: "A".repeat(200) }]).length <= 80);
});

test("lot estimate totals every priced physical Copy and keeps missing values explicit", () => {
  assert.deepEqual(estimateEbayLotValue([1250, null, 1250, undefined, 99]), {
    pricedCopyCount: 3,
    totalPence: 2599,
    unpricedCopyCount: 2,
  });
});

test("sold-listing research stays scoped to one card printing", () => {
  const url = new URL(ebaySoldListingsUrl({
    edition: "1st Edition",
    name: "Blue-Eyes White Dragon",
    rarity: "Ultra Rare",
    setCode: "LOB-001",
  }));
  assert.equal(url.hostname, "www.ebay.co.uk");
  assert.equal(url.searchParams.get("LH_Complete"), "1");
  assert.equal(url.searchParams.get("LH_Sold"), "1");
  assert.match(url.searchParams.get("_nkw") ?? "", /LOB-001/);
});

test("saved Copy photos are planned in manifest order, deduplicated, and capped at 12 listing photos", () => {
  const imagesByCopy = {
    "copy-a": [
      { key: "a-secondary", position: 1 },
      { key: "a-primary", position: 0 },
    ],
    "copy-b": Array.from({ length: 12 }, (_, index) => ({
      key: `b-${index}`,
      position: index,
    })),
  };
  const planned = planEbayLotSavedPhotoImports({
    copyIds: ["copy-a", "copy-b"],
    existingPhotos: [{
      sourceInventoryCopyId: "copy-a",
      sourceInventoryKey: "a-primary",
    }],
    imagesByCopy,
  });

  assert.equal(planned.length, 11);
  assert.deepEqual(planned[0], {
    copyId: "copy-a",
    key: "a-secondary",
    position: 1,
  });
  assert.equal(planned.at(-1)?.key, "b-9");
  assert.deepEqual(
    planEbayLotSavedPhotoImports({
      copyIds: ["copy-a"],
      existingPhotos: Array.from({ length: 12 }, () => ({})),
      imagesByCopy,
    }),
    [],
  );
});

test("lot sold-listing research opens in the shared viewport modal", async () => {
  const source = await readFile(
    new URL("../src/components/records/ebay-lot-listing.tsx", import.meta.url),
    "utf8",
  );
  const research = source.slice(
    source.indexOf("function SoldListingResearch"),
    source.indexOf("function EbayLotForm"),
  );
  assert.match(research, /id="sold-listing-research-dialog"/);
  assert.match(research, /aria-haspopup="dialog"/);
  assert.match(research, /<LotDialog/);
  assert.match(research, /target="_blank"/);
  assert.match(source, /createPortal/);
  assert.match(source, /document\.body/);
  assert.match(source, /place-items-center bg-black\/30/);
  assert.match(source, /max-h-\[88dvh\] w-full max-w-2xl/);
  assert.doesNotMatch(source, /backdrop-blur/);
});

test("lot UI keeps focused actions in dialogs and automatically checks selected Copies for saved photos", async () => {
  const source = await readFile(
    new URL("../src/components/records/ebay-lot-listing.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /id="selected-manifest-dialog"/);
  assert.match(source, /id="saved-copy-photo-picker-dialog"/);
  assert.match(source, /aria-modal="true"/);
  assert.match(source, /aria-haspopup="dialog"/);
  assert.match(source, /document\.body\.style\.overflow = "hidden"/);
  assert.match(source, /\(trigger \?\? previouslyFocused\)\?\.focus\(\)/);
  assert.match(source, /Choose saved Copy photos/);
  assert.match(source, /autoImportSavedCopyPhotos/);
  assert.match(source, /Pulling through saved Copy photos/);
  assert.match(source, /body\.append\("stageOnly", "true"\)/);
  assert.match(source, /preparePhotosForEbay/);
  assert.match(source, /href="\/ebay"[\s\S]*Reconnect eBay/);
  assert.match(source, /sticky=\{false\}/);
  assert.match(source, /sourceInventoryKey/);
  assert.match(source, /Clear all/);
  assert.match(source, /Select 2–100 physical Copies/);
  assert.match(source, /Condition[\s\S]*All conditions/);
  assert.match(source, /setCondition\("all"\)/);
  assert.match(source, /fromCopyId: copyId[\s\S]*toCopyId: replacementCopyId/);
  assert.match(source, /method: "PATCH"/);
  assert.match(source, /Your staged lot photos are being kept safe/);
});

test("batch inventory-photo response includes every ordered photo for the picker", async () => {
  const source = await readFile(
    new URL("../src/app/api/inventory/card-images/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /imagesByCopy/);
  assert.match(source, /position: image\.position/);
  assert.match(source, /configured: false,\s+imagesByCopy: \{\}/);
});

test("saved Copy photos can be staged before eBay authentication succeeds", async () => {
  const route = await readFile(
    new URL("../src/app/api/ebay/image/route.ts", import.meta.url),
    "utf8",
  );
  const operation = await readFile(
    new URL("../src/lib/records/ebay-image-operation.ts", import.meta.url),
    "utf8",
  );
  const server = await readFile(
    new URL("../src/server/ebay-listing.ts", import.meta.url),
    "utf8",
  );
  assert.match(operation, /stageOnly/);
  assert.match(route, /archiveInventoryImageDraft/);
  assert.match(route, /uploadArchivedEbayImage/);
  assert.match(server, /export async function archiveInventoryImageDraft/);
  assert.match(server, /export async function uploadArchivedEbayImage/);
  assert.match(route, /localInventoryStage/);
  assert.match(route, /capability\.canManageListingPhotoDrafts/);
  assert.match(route, /capability\.ebay\.allowed/);
});

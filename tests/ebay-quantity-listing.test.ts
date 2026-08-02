import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildHomogeneousQuantityDescription,
  buildHomogeneousQuantityTitle,
  ebayQuantityXmlContract,
  homogeneousQuantityIncompatibilities,
  moveHomogeneousQuantityMember,
  planHomogeneousQuantitySavedPhotos,
  validateHomogeneousQuantityMembers,
} from "../src/lib/records/ebay-quantity-listing.ts";

const listingCopy = {
  condition: "Near Mint",
  edition: "1st Edition",
  name: "Blue-Eyes White Dragon",
  quantity: 3,
  rarity: "Ultra Rare",
  setCode: "LOB-001",
  setName: "Legend of Blue Eyes White Dragon",
};

function member({
  condition = "Near Mint",
  copyId = "copy-a",
  edition = "1st Edition",
  printingId = "printing-a",
} = {}) {
  return {
    copy: { condition, id: copyId, printingId },
    printing: { id: printingId, targetId: `target-${edition}` },
    target: { edition, id: `target-${edition}` },
  };
}

test("homogeneous quantity compatibility explains printing, edition, and condition separately", () => {
  const anchor = member();
  assert.deepEqual(homogeneousQuantityIncompatibilities(anchor, member({ copyId: "copy-b" })), []);
  assert.deepEqual(
    homogeneousQuantityIncompatibilities(anchor, member({
      condition: "Lightly Played",
      copyId: "copy-b",
      edition: "Unlimited Edition",
      printingId: "printing-b",
    })).map((issue) => issue.code),
    ["printing", "edition", "condition"],
  );
  assert.match(
    homogeneousQuantityIncompatibilities(anchor, member({ printingId: "printing-b" }))[0]!.message,
    /exact same printing/i,
  );
});

test("member validation retains the incompatible exact Copy ID", () => {
  assert.deepEqual(
    validateHomogeneousQuantityMembers([
      member(),
      member({ condition: "Lightly Played", copyId: "copy-b" }),
    ]).map(({ code, copyId }) => ({ code, copyId })),
    [{ code: "condition", copyId: "copy-b" }],
  );
});

test("keyboard reorder helpers preserve an exact deterministic fulfilment order", () => {
  assert.deepEqual(moveHomogeneousQuantityMember(["a", "b", "c"], "b", -1), ["b", "a", "c"]);
  assert.deepEqual(moveHomogeneousQuantityMember(["a", "b", "c"], "b", 1), ["a", "c", "b"]);
  const unchanged = ["a", "b"];
  assert.equal(moveHomogeneousQuantityMember(unchanged, "a", -1), unchanged);
});

test("saved-photo aggregation takes one photo from every Copy before filling remaining slots", () => {
  assert.deepEqual(planHomogeneousQuantitySavedPhotos({
    copyIds: ["copy-a", "copy-b", "copy-c"],
    existingPhotos: [],
    imagesByCopy: {
      "copy-a": [{ key: "a-2", position: 2 }, { key: "a-1", position: 1 }],
      "copy-b": [{ key: "b-1", position: 1 }],
      "copy-c": [{ key: "c-1", position: 1 }],
    },
    maxPhotos: 4,
  }), [
    { copyId: "copy-a", key: "a-1", position: 1 },
    { copyId: "copy-b", key: "b-1", position: 1 },
    { copyId: "copy-c", key: "c-1", position: 1 },
    { copyId: "copy-a", key: "a-2", position: 2 },
  ]);
});

test("quantity serialization uses the exact member count and rejects quantity one", () => {
  assert.equal(ebayQuantityXmlContract(3).quantityXml, "<Quantity>3</Quantity>");
  assert.throws(() => ebayQuantityXmlContract(1), /requires 2 to 100/i);
});

test("generated listing copy makes quantity and per-unit meaning explicit", () => {
  const title = buildHomogeneousQuantityTitle(listingCopy);
  const description = buildHomogeneousQuantityDescription(listingCopy);
  assert.match(title, /Blue-Eyes White Dragon x3 LOB-001/);
  assert.ok(title.length <= 80);
  assert.match(description, /quantity 3/i);
  assert.match(description, /3 identical physical copies/i);
  assert.match(description, /price is per card/i);
  assert.match(description, /exact physical copies/i);
  assert.doesNotMatch(buildHomogeneousQuantityTitle({ ...listingCopy, quantity: 1 }), /x1/);
});

test("quantity publication rechecks locked members and persists ordered exact membership", () => {
  const server = readFileSync(new URL("../src/server/ebay-listing.ts", import.meta.url), "utf8");
  const router = readFileSync(new URL("../src/server/routers/ebay.ts", import.meta.url), "utf8");
  const client = readFileSync(new URL("../src/components/records/ebay-listing-action.tsx", import.meta.url), "utf8");
  const publishSource = server.slice(
    server.indexOf("export async function publishEbayQuantityListing"),
    server.indexOf("function assertLotCopyIds"),
  );

  assert.match(publishSource, /lockHomogeneousQuantityMembers\(tx, ownerId, details\)[\s\S]*assertQuantityMembersHaveNoBlockingExposure\(tx, ownerId, details\.copyIds\)[\s\S]*tradingCall\(ownerId, "AddItem"/);
  assert.match(publishSource, /kind: "quantity"/);
  assert.match(publishSource, /details\.copyIds\.map\([\s\S]*\(copyId, fulfilmentPosition\)[\s\S]*copyId,[\s\S]*fulfilmentPosition/);
  assert.match(router, /validateQuantity:[\s\S]*verifyEbayQuantityListing/);
  assert.match(router, /publishQuantity:[\s\S]*publishEbayQuantityListing/);
  assert.match(client, /copyIds: \[copy\.id\]/);
  assert.match(client, /aria-label={`Move Copy \$\{copyShortReference\(item\.copy\.id\)\} up`}/);
  assert.match(client, /Future eBay orders allocate exact Copies from position 1 downward/);
  assert.match(client, /WizardProgress labels=\{\["Choose Copies", "Listing & Photos", "Review"\]\}/);
  assert.match(client, /const copyPageSize = 2/);
  assert.match(client, /Page \{currentCopyPage\} of \{copyPageCount\}/);
  assert.match(client, />Previous</);
  assert.match(client, />Next</);
  assert.match(client, /Search physical Copies/);
  assert.match(client, /copyNumberLabels\.get\(candidate\.copy\.id\)/);
  assert.match(client, /\{copyNumberLabel\(candidate\.copy\.id\)\}/);
  assert.match(client, /Ref #\{copyShortReference\(candidate\.copy\.id\)\}/);
  assert.match(client, /Select all/);
  assert.match(client, /Regenerate quantity title & description/);
  assert.match(client, /validateQuantity\.mutateAsync/);
  assert.match(client, /publishQuantity\.mutateAsync/);
  assert.match(client, /selection\.selectedIds\.length !== form\.copyIds\.length[\s\S]*setValidation\(null\)[\s\S]*exact Copy selection changed/);
  assert.match(client, /reviewedForm = \{ \.\.\.form, copyIds: form\.copyIds \}/);
});

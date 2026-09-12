import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCatalogueProduct, parseCatalogueQuery } from "../src/lib/card-catalogue.ts";

test("search extracts longest rarity phrase, abbreviations and code tokens", () => {
  assert.deepEqual(parseCatalogueQuery("RA02-EN001 quarter century secret rare"), {searchText:"ra02 en001", detectedRarity:"Quarter Century Secret Rare",tokens:["ra02","en001"]});
  assert.equal(parseCatalogueQuery("Blue-Eyes qcsr").detectedRarity, "Quarter Century Secret Rare");
  assert.equal(parseCatalogueQuery("Ash Blossom UR").searchText, "ash blossom");
  assert.equal(parseCatalogueQuery("Rarefish").detectedRarity, null);
  assert.equal(parseCatalogueQuery("Collector’s Rare").detectedRarity, "Collector's Rare");
});
const group = {groupId:23416,name:"25th Anniversary Rarity Collection II",abbreviation:"RA02"};
const single = {productId:550001,categoryId:2,groupId:23416,name:"Blue-Eyes White Dragon",imageUrl:"https://tcgplayer-cdn.tcgplayer.com/product/550001_200w.jpg",extendedData:[{name:"Number",value:"RA02-EN001"},{name:"Rarity",value:"Ultra Rare"}]};
test("single retains exact product printing and supports compact or split codes", () => {
  const result = normalizeCatalogueProduct(single,group)!;
  assert.equal(result.productId,550001);
  assert.equal(result.setCode,"RA02-EN001");
  assert.equal(result.rarity,"Ultra Rare");
  assert.match(result.searchText,/ra02 en001 ra02en001/);
  assert.equal(result.tcgplayerUrl,"https://www.tcgplayer.com/product/550001");
});
test("sealed, wrong game/group and invalid metadata cannot enter catalogue", () => {
  assert.equal(normalizeCatalogueProduct({...single,extendedData:[{name:"Description",value:"Booster box"}]},group),null);
  assert.equal(normalizeCatalogueProduct({...single,categoryId:3},group),null);
  assert.equal(normalizeCatalogueProduct({...single,groupId:1},group),null);
  assert.equal(normalizeCatalogueProduct({...single,productId:-1},group),null);
  assert.equal(normalizeCatalogueProduct({...single,imageUrl:"https://untrusted.example/image"},group)?.imageUrl,null);
});


test("rarity words inside actual card names remain searchable", () => {
  assert.equal(parseCatalogueQuery("Rare Metal Dragon").detectedRarity, null);
  assert.equal(parseCatalogueQuery("Common Charity").detectedRarity, null);
  assert.equal(parseCatalogueQuery("Blue Eyes common").detectedRarity, "Common");
});

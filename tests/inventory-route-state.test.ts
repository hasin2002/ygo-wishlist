import assert from "node:assert/strict";
import test from "node:test";
import {
  inventoryCardDetailHref,
  inventoryListHref,
  parseInventoryListState,
  serializeInventoryListState,
} from "../src/lib/records/inventory-route-state.ts";

test("Inventory list state parses valid filters and safely normalizes invalid values", () => {
  assert.deepEqual(parseInventoryListState(new URLSearchParams("kind=cards&card=Blue-Eyes&copies=multiple&status=owned&rarity=Ultra+Rare&edition=1st+Edition&page=3")), {
    kind: "cards",
    card: "Blue-Eyes",
    copyQuantity: "multiple",
    status: "owned",
    rarity: "Ultra Rare",
    edition: "1st Edition",
    page: 3,
  });
  assert.deepEqual(parseInventoryListState(new URLSearchParams("kind=nope&status=nope&page=2junk")), {
    kind: "cards",
    card: "",
    copyQuantity: "all",
    status: "all",
    rarity: "all",
    edition: "all",
    page: 1,
  });
});

test("Inventory URLs preserve list state and add an optional selected physical Copy", () => {
  const state = parseInventoryListState(new URLSearchParams("kind=cards&card=Ash+Blossom&copies=multiple&status=wishlist&rarity=Super+Rare&edition=1st+Edition&page=2"));
  assert.equal(serializeInventoryListState(state).toString(), "kind=cards&card=Ash+Blossom&copies=multiple&status=wishlist&rarity=Super+Rare&edition=1st+Edition&page=2");
  assert.equal(inventoryListHref(state), "/records/inventory?kind=cards&card=Ash+Blossom&copies=multiple&status=wishlist&rarity=Super+Rare&edition=1st+Edition&page=2");
  assert.equal(inventoryCardDetailHref("target ash", state, "copy-2"), "/records/inventory/cards/target%20ash?kind=cards&card=Ash+Blossom&copies=multiple&status=wishlist&rarity=Super+Rare&edition=1st+Edition&page=2&copy=copy-2");
});

import assert from "node:assert/strict";
import test from "node:test";
import { addOwnedCardsSchema, collapseOwnedCards, matchingOwnedCardCopies, type AddOwnedCardsDraft } from "../src/lib/records/owned-cards.ts";
import { applyOwnedCards } from "../src/lib/records/preview-data.ts";
import type { RecordsSnapshot } from "../src/lib/records/types.ts";

const card = { productId: 123, name: "Blue-Eyes White Dragon", setCode: "LOB-001", setName: "Legend of Blue Eyes White Dragon", rarity: "Ultra Rare", imageUrl: null, tcgplayerUrl: "https://www.tcgplayer.com/product/123", condition: "Near Mint" as const, edition: "1st Edition" as const, quantity: 2 };
const input: AddOwnedCardsDraft = { operationId: "b82b6358-3ad2-4c70-9243-aed262822bc9", date: "2026-09-12", source: "", notes: "", cards: [card] };
const empty: RecordsSnapshot = { version: 1, targets: [], printings: [], records: [], copies: [], copyEbayExposures: [], sealedUnits: [], bulkLots: [], supplies: [], attention: [] };

test("identical variants collapse while printing, condition and edition keep separate rows", () => {
  const grouped = collapseOwnedCards([card, card, { ...card, productId: 124 }, { ...card, condition: "Lightly Played" as const }, { ...card, edition: "Unlimited Edition" as const }]);
  assert.equal(grouped.length, 4);
  assert.equal(grouped[0].quantity, 4);
  assert.equal(card.quantity, 2);
});

test("input bounds reject fractional quantities, invalid dates and excessive batches", () => {
  assert.equal(addOwnedCardsSchema.safeParse(input).success, true);
  assert.equal(addOwnedCardsSchema.safeParse({ ...input, date: "2026-02-30" }).success, false);
  assert.equal(addOwnedCardsSchema.safeParse({ ...input, cards: [{ ...card, quantity: 1.5 }] }).success, false);
  assert.equal(addOwnedCardsSchema.safeParse({ ...input, cards: [{ ...card, quantity: 600 }, { ...card, quantity: 600 }] }).success, false);
});

test("preview saves exact physical IDs with unknown costs, no bulk container and safe retries", () => {
  const first = applyOwnedCards(empty, { ...input, cards: [card, card] });
  assert.equal(first.next.records[0].type, "imported-acquisition");
  assert.equal(first.next.records[0].lines.length, 1);
  assert.equal(first.next.records[0].lines[0].quantity, 4);
  assert.equal(new Set(first.next.copies.map((copy) => copy.id)).size, 4);
  assert(first.next.copies.every((copy) => copy.status === "available" && copy.allocationPence === null && copy.bulkLotId === null));
  assert.equal(first.next.targets[0].desiredQuantity, 0);
  assert.equal(first.next.bulkLots.length, 0);
  assert.equal(applyOwnedCards(first.next, input).next.copies.length, 4);
});

test("existing quantity matches exact product, edition and condition, excluding sold or void copies", () => {
  const snapshot = applyOwnedCards(empty, input).next;
  assert.equal(matchingOwnedCardCopies(snapshot, card).length, 2);
  assert.equal(matchingOwnedCardCopies(snapshot, { ...card, condition: "Lightly Played" }).length, 0);
  assert.equal(matchingOwnedCardCopies(snapshot, { ...card, edition: "Unlimited Edition" }).length, 0);
  assert.equal(matchingOwnedCardCopies(snapshot, { ...card, rarity: "Secret Rare" }).length, 0);
  assert.equal(matchingOwnedCardCopies(snapshot, { ...card, productId: 456 }).length, 0);
  snapshot.copies[0].status = "sold";
  assert.equal(matchingOwnedCardCopies(snapshot, card).length, 1);
  snapshot.records[0].status = "void";
  assert.equal(matchingOwnedCardCopies(snapshot, card).length, 0);
});

test("legacy stock without a product URL matches complete set identity", () => {
  const snapshot = applyOwnedCards(empty, input).next;
  snapshot.printings[0].tcgplayerUrl = null;
  assert.equal(matchingOwnedCardCopies(snapshot, card).length, 2);
  assert.equal(matchingOwnedCardCopies(snapshot, { ...card, setCode: "OTHER-001" }).length, 0);
});

test("mixed-condition legacy product URLs count six NM plus one LP without merging conditions", () => {
  const snapshot = applyOwnedCards(empty, { ...input, cards: [{ ...card, quantity: 6 }, { ...card, condition: "Lightly Played", quantity: 1 }] }).next;
  snapshot.printings[0].tcgplayerUrl = "https://www.tcgplayer.com/product/123/blue-eyes-white-dragon?Language=all";
  snapshot.printings[0].setCode = "LOB";
  const selected = { ...card, name: "Blue-Eyes White Dragon (Ultra Rare)" };
  assert.equal(matchingOwnedCardCopies(snapshot, selected).length, 6);
  assert.equal(matchingOwnedCardCopies(snapshot, { ...selected, condition: "Lightly Played" }).length, 1);
  assert.equal(matchingOwnedCardCopies(snapshot, { ...selected, condition: undefined }).length, 7);
});

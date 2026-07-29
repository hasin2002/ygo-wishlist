import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db/index.ts";
import { cardCopies, recordEntries, recordLines, users } from "../src/db/schema.ts";
import { libraryRouter } from "../src/server/routers/library.ts";
import { recordsRouter } from "../src/server/routers/records.ts";
import { spendRouter } from "../src/server/routers/spend.ts";

const ownerId = "records-transaction-test-owner";
const context = {
  collectionOwnerId: ownerId,
  session: {
    session: { id: "records-transaction-session" },
    user: { id: ownerId, role: "admin" },
  },
} as never;
const records = recordsRouter.createCaller(context);
const library = libraryRouter.createCaller(context);
const spend = spendRouter.createCaller(context);

const card = (quantity = 1) => ({
  id: `card-${quantity}`,
  imageUrl: null,
  name: "Dark Magician",
  edition: "1st Edition" as const,
  metadataNeedsAttention: false,
  quantity,
  rarity: "Ultra Rare",
  selectedTargetId: null,
  setCode: "LOB-005",
  setName: "Legend of Blue Eyes White Dragon",
  tcgplayerUrl: "https://www.tcgplayer.com/product/12345/dark-magician",
});

async function seedOwner() {
  const now = new Date();
  await db.insert(users).values({
    id: ownerId,
    name: "Records transaction test owner",
    email: "records-transaction-test@example.test",
    emailVerified: true,
    username: "records-transaction-test-owner",
    displayUsername: "records-transaction-test-owner",
    role: "admin",
    publicCollection: false,
    createdAt: now,
    updatedAt: now,
  });
}

test.before(async () => { await seedOwner(); });

test("authenticated purchase commits exact Copies and projects the same money into Inventory and Library", async () => {
  const result = await records.createPurchase({
    kind: "card",
    recordName: "Two Dark Magicians",
    date: "2026-07-29",
    source: "Local card shop",
    listingUrl: "",
    notes: "transaction coverage",
    totalPence: 101,
    card: card(2),
  });

  const snapshot = await records.snapshot();
  const purchase = snapshot.records.find((record) => record.id === result.id);
  assert.ok(purchase);
  assert.equal(purchase.amountPence, 101);
  assert.equal(purchase.amountKnown, true);
  const copies = snapshot.copies.filter((copy) => copy.acquiredRecordId === result.id);
  assert.equal(copies.length, 2);
  assert.equal(new Set(copies.map((copy) => copy.id)).size, 2, "every allocation retains an exact Copy id");
  const allocations = copies.map((copy) => {
    if (copy.allocationPence === null) throw new Error("Card Purchase Copy allocation must be known.");
    return copy.allocationPence;
  });
  assert.deepEqual(allocations.sort((a, b) => a - b), [50, 51]);

  const cards = await library.list({ query: "Dark Magician", status: "all" });
  assert.equal(cards.length, 1);
  assert.equal(cards[0]?.ownedQuantity, 2);
  assert.equal(cards[0]?.paidPriceText, "£1.01");
});

test("invalid purchase rolls back the record, line, target, printing, and every Copy", async () => {
  const before = await records.snapshot();
  await assert.rejects(
    records.createPurchase({
      kind: "bulk",
      recordName: "Impossible bulk lot",
      date: "2026-07-29",
      source: "Local card shop",
      listingUrl: "",
      notes: "must not write",
      totalPence: 250,
      totalCardCount: 1,
      cards: [card(2)],
    }),
    /Total cards in the lot cannot be less than the identified physical Copies/,
  );
  const after = await records.snapshot();
  assert.equal(after.records.length, before.records.length);
  assert.equal(after.copies.length, before.copies.length);
  assert.equal(after.targets.length, before.targets.length);
  assert.equal(after.printings.length, before.printings.length);
});

test("sale changes only the selected exact Copy and does not partially write when a Copy is unavailable", async () => {
  const snapshot = await records.snapshot();
  const sourceCopies = snapshot.copies.filter((copy) => copy.status === "available").slice(0, 2);
  assert.equal(sourceCopies.length, 2);
  const sale = await records.createSale({
    recordName: "One exact Dark Magician",
    date: "2026-07-29",
    source: "eBay",
    netProceedsPence: 75,
    notes: "one copy only",
    copyIds: [sourceCopies[0]!.id],
  });
  assert.ok(sale.id);
  const afterSale = await records.snapshot();
  assert.equal(afterSale.copies.find((copy) => copy.id === sourceCopies[0]!.id)?.status, "sold");
  assert.equal(afterSale.copies.find((copy) => copy.id === sourceCopies[1]!.id)?.status, "available");
  const recordsBeforeFailure = afterSale.records.length;
  await assert.rejects(
    records.createSale({
      recordName: "Bad duplicate sale",
      date: "2026-07-29",
      source: "eBay",
      netProceedsPence: 75,
      notes: "must not partially write",
      copyIds: [sourceCopies[0]!.id, sourceCopies[1]!.id],
    }),
    /no longer available/i,
  );
  const afterFailure = await records.snapshot();
  assert.equal(afterFailure.records.length, recordsBeforeFailure);
  assert.equal(afterFailure.copies.find((copy) => copy.id === sourceCopies[1]!.id)?.status, "available");
});

test("unknown acquisition cost remains distinct from an intentional £0 gift", async () => {
  const now = new Date();
  await db.insert(recordEntries).values({
    id: "unknown-cost-record",
    ownerId,
    type: "imported-acquisition",
    status: "active",
    occurredOn: "2026-07-29",
    title: "Unknown cost import",
    titleGenerated: false,
    source: "Import",
    listingUrl: null,
    amountPence: 0,
    amountKnown: false,
    notes: "unknown",
    revision: 1,
    createdAt: now,
    updatedAt: now,
  });
  const gifted = await records.createOpening({
    recordName: "Gift opening",
    date: "2026-07-29",
    source: "Gift",
    totalPence: 0,
    useTrackedStock: false,
    sealedUnitId: null,
    notes: "intentional free gift",
    product: {
      imageUrl: null,
      name: "Gift booster",
      edition: "",
      metadataNeedsAttention: false,
      rarity: "",
      selectedTargetId: null,
      setCode: "",
      setName: "",
      tcgplayerUrl: "https://www.tcgplayer.com/product/98765/gift-booster",
    },
    pulls: [card(1)],
  });
  assert.ok(gifted.id);
  const rows = await db.select().from(recordEntries).where(eq(recordEntries.ownerId, ownerId));
  assert.equal(rows.find((row) => row.id === "unknown-cost-record")?.amountKnown, false);
  const giftAcquisition = rows.find((row) => row.type === "imported-acquisition" && row.notes === "Gifted sealed product.");
  assert.equal(giftAcquisition?.amountPence, 0);
  assert.equal(giftAcquisition?.amountKnown, true);
  const currentMonth = await spend.currentMonth();
  assert.equal(currentMonth.total, 1.01, "the unknown amount is excluded while the intentional £0 remains a known acquisition");
});

test.after(async () => {
  const allCopies = await db.select().from(cardCopies).where(eq(cardCopies.ownerId, ownerId));
  const allLines = await db.select().from(recordLines).where(eq(recordLines.ownerId, ownerId));
  assert.ok(allCopies.length > 0);
  assert.ok(allLines.length > 0);
});

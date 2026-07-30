import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db/index.ts";
import {
  cardCopies,
  cardCopyImages,
  cardPrintings,
  cardTargets,
  ebayConnections,
  ebayListings,
  recordEntries,
  recordLines,
  sessions,
  targetWheelEntries,
  users,
} from "../src/db/schema.ts";
import {
  DELETE as deleteInventoryPhoto,
  GET as getInventoryPhotos,
  PATCH as reorderInventoryPhotos,
  POST as uploadInventoryPhoto,
} from "../src/app/api/inventory/card-images/route.ts";
import { ebayRouter } from "../src/server/routers/ebay.ts";
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
const nonSellerContext = {
  collectionOwnerId: ownerId,
  session: {
    session: { id: "records-transaction-non-seller-session" },
    user: { id: ownerId, role: "user" },
  },
} as never;
const nonSellerRecords = recordsRouter.createCaller(nonSellerContext);
const nonSellerEbay = ebayRouter.createCaller(nonSellerContext);
const secondOwnerId = "records-photo-test-second-owner";
const secondOwnerContext = {
  collectionOwnerId: secondOwnerId,
  session: {
    session: { id: "records-photo-test-second-session" },
    user: { id: secondOwnerId, role: "user" },
  },
} as never;
const secondOwnerRecords = recordsRouter.createCaller(secondOwnerContext);
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
  await db.insert(users).values({
    id: secondOwnerId,
    name: "Second Records photo owner",
    email: "records-photo-second@example.test",
    emailVerified: true,
    username: "records-photo-second-owner",
    displayUsername: "records-photo-second-owner",
    role: "user",
    publicCollection: false,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(sessions).values([
    {
      createdAt: now,
      expiresAt: new Date(now.getTime() + 60 * 60_000),
      id: "records-owner-http-session",
      token: "records-owner-http-token",
      updatedAt: now,
      userId: ownerId,
    },
    {
      createdAt: now,
      expiresAt: new Date(now.getTime() + 60 * 60_000),
      id: "records-second-http-session",
      token: "records-second-http-token",
      updatedAt: now,
      userId: secondOwnerId,
    },
  ]);
}

function authHeaders(token: string) {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("The isolated auth secret is missing.");
  const signature = createHmac("sha256", secret).update(token).digest("base64");
  return {
    cookie: `better-auth.session_token=${token}.${signature}`,
    host: "localhost:3000",
    origin: "http://localhost:3000",
  };
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

test("wishlist removal deletes a pure target but preserves owned Copies and Records", async () => {
  const now = new Date();
  await db.insert(cardTargets).values({
    chaseLevel: 3,
    createdAt: now,
    desiredQuantity: 1,
    edition: "1st Edition",
    id: "target-pure-wishlist-removal",
    name: "Pure Wishlist Removal",
    normalizedEdition: "1st edition",
    normalizedName: "pure wishlist removal",
    normalizedRarity: "ultra rare",
    notes: "",
    ownerId,
    rarity: "Ultra Rare",
    updatedAt: now,
  });
  await db.insert(cardPrintings).values({
    createdAt: now,
    id: "printing-pure-wishlist-removal",
    imageUrl: null,
    metadataNeedsAttention: false,
    normalizedSetCode: "pwr-001",
    normalizedSetName: "pure wishlist removal",
    ownerId,
    setCode: "PWR-001",
    setName: "Pure Wishlist Removal",
    targetId: "target-pure-wishlist-removal",
    tcgplayerUrl: null,
    updatedAt: now,
  });

  const deleted = await library.delete({ id: "target-pure-wishlist-removal" });
  assert.equal(deleted.retainedOwned, false);
  assert.equal(
    (await db.select().from(cardTargets).where(eq(cardTargets.id, "target-pure-wishlist-removal"))).length,
    0,
  );
  assert.equal(
    (await db.select().from(cardPrintings).where(eq(cardPrintings.id, "printing-pure-wishlist-removal"))).length,
    0,
  );

  const purchase = await records.createPurchase({
    kind: "card",
    recordName: "Partially fulfilled wishlist",
    date: "2026-07-30",
    source: "Local card shop",
    listingUrl: "",
    notes: "wishlist removal must keep this",
    totalPence: 250,
    card: {
      ...card(2),
      id: "card-partial-wishlist-removal",
      name: "Partially Fulfilled Wishlist Removal",
      tcgplayerUrl: "https://www.tcgplayer.com/product/777771/partial-wishlist-removal",
    },
  });
  const before = await records.snapshot();
  const target = before.targets.find((candidate) => candidate.name === "Partially Fulfilled Wishlist Removal");
  assert.ok(target);
  const ownedCopies = before.copies.filter((copy) => copy.acquiredRecordId === purchase.id);
  assert.equal(ownedCopies.length, 2);
  await db.update(cardTargets).set({ desiredQuantity: 3 }).where(eq(cardTargets.id, target.id));
  await db.insert(targetWheelEntries).values({
    createdAt: now,
    ownerId,
    sortOrder: 999,
    targetId: target.id,
    updatedAt: now,
  });

  const retained = await library.delete({ id: target.id });
  assert.equal(retained.retainedOwned, true);
  assert.match(retained.warning ?? "", /owned Copies and their Record history were kept/i);
  const [retainedTarget] = await db.select().from(cardTargets).where(eq(cardTargets.id, target.id));
  assert.equal(retainedTarget?.desiredQuantity, 0);
  const after = await records.snapshot();
  assert.deepEqual(
    after.copies.filter((copy) => copy.acquiredRecordId === purchase.id).map((copy) => copy.id).sort(),
    ownedCopies.map((copy) => copy.id).sort(),
  );
  assert.ok(after.records.some((record) => record.id === purchase.id));
  assert.equal(
    (await db.select().from(targetWheelEntries).where(eq(targetWheelEntries.targetId, target.id))).length,
    0,
  );
  await assert.rejects(library.delete({ id: target.id }), /not currently on your wishlist/i);

  await db.update(cardTargets).set({ desiredQuantity: 1 }).where(eq(cardTargets.id, target.id));
  const fulfilled = await library.delete({ id: target.id });
  assert.equal(fulfilled.retainedOwned, true, "two owned Copies and one wanted Copy can still leave the wishlist");
  assert.equal(
    (await db.select().from(cardTargets).where(eq(cardTargets.id, target.id)))[0]?.desiredQuantity,
    0,
  );

  await db.update(cardCopies).set({ status: "sold" }).where(eq(cardCopies.acquiredRecordId, purchase.id));
  await db.update(cardTargets).set({ desiredQuantity: 3 }).where(eq(cardTargets.id, target.id));
  const historical = await library.delete({ id: target.id });
  assert.equal(historical.retainedOwned, false);
  assert.equal(
    (await db.select().from(cardTargets).where(eq(cardTargets.id, target.id)))[0]?.desiredQuantity,
    0,
  );
  assert.equal(
    (await records.snapshot()).copies.filter((copy) => copy.acquiredRecordId === purchase.id).length,
    2,
  );
  await db.update(cardCopies).set({ status: "available" }).where(eq(cardCopies.acquiredRecordId, purchase.id));
  await db.update(cardTargets).set({ desiredQuantity: 1 }).where(eq(cardTargets.id, target.id));
});

test("ordinary Purchase edits preserve exact Copy identities, deterministically reallocate, and reject stale revisions", async () => {
  const created = await records.createPurchase({
    kind: "card",
    recordName: "Three deterministic Copies",
    date: "2026-07-29",
    source: "Local card shop",
    listingUrl: "",
    notes: "allocation edit coverage",
    totalPence: 1,
    card: card(3),
  });
  const before = await records.snapshot();
  const original = before.records.find((record) => record.id === created.id)!;
  const originalAllocations = new Map(before.copies
    .filter((copy) => copy.acquiredRecordId === created.id)
    .map((copy) => [copy.id, copy.allocationPence]));

  await records.updateRecordDetails({
    recordId: created.id,
    expectedRevision: original.revision,
    update: {
      title: original.title,
      date: original.date,
      source: original.source,
      listingUrl: original.listingUrl,
      amountPence: 1,
      amountKnown: true,
      notes: "same amount, exact Copy allocation must stay stable",
    },
  });
  const stable = await records.snapshot();
  assert.deepEqual(
    new Map(stable.copies.filter((copy) => copy.acquiredRecordId === created.id).map((copy) => [copy.id, copy.allocationPence])),
    originalAllocations,
  );
  const stableRecord = stable.records.find((record) => record.id === created.id)!;
  await assert.rejects(
    records.updateRecordDetails({
      recordId: created.id,
      expectedRevision: original.revision,
      update: { title: "Stale", date: original.date, source: original.source, listingUrl: "", amountPence: 300, amountKnown: true, notes: "" },
    }),
    /changed elsewhere/i,
  );
  await records.updateRecordDetails({
    recordId: created.id,
    expectedRevision: stableRecord.revision,
    update: { title: stableRecord.title, date: stableRecord.date, source: stableRecord.source, listingUrl: "", amountPence: 300, amountKnown: true, notes: stableRecord.notes },
  });
  const reallocated = await records.snapshot();
  const purchase = reallocated.records.find((record) => record.id === created.id)!;
  const lines = purchase.lines.filter((line) => line.kind === "card");
  const allocations = reallocated.copies.filter((copy) => copy.acquiredRecordId === created.id).map((copy) => copy.allocationPence);
  assert.equal(purchase.amountPence, 300);
  assert.equal(lines[0]?.allocationPence, 300);
  assert.deepEqual(allocations, [100, 100, 100]);
});

test("unknown cost remains unknown until explicitly changed to a known £0", async () => {
  const created = await records.createPurchase({
    kind: "card",
    recordName: "Unknown cost cards",
    date: "2026-07-29",
    source: "Private seller",
    listingUrl: "",
    notes: "unknown means unknown",
    totalPence: 0,
    amountKnown: false,
    card: card(2),
  });
  const unknown = await records.snapshot();
  const record = unknown.records.find((item) => item.id === created.id)!;
  assert.equal(record.amountKnown, false);
  assert.equal(record.lines[0]?.allocationPence, null);
  assert.deepEqual(unknown.copies.filter((copy) => copy.acquiredRecordId === created.id).map((copy) => copy.allocationPence), [null, null]);

  await records.updateRecordDetails({
    recordId: created.id,
    expectedRevision: record.revision,
    update: { title: record.title, date: record.date, source: record.source, listingUrl: "", amountPence: 0, amountKnown: true, notes: record.notes },
  });
  const knownZero = await records.snapshot();
  const zeroRecord = knownZero.records.find((item) => item.id === created.id)!;
  assert.equal(zeroRecord.amountKnown, true);
  assert.equal(zeroRecord.lines[0]?.allocationPence, 0);
  assert.deepEqual(knownZero.copies.filter((copy) => copy.acquiredRecordId === created.id).map((copy) => copy.allocationPence), [0, 0]);
});

test("unknown bulk cost stays unknown when its total changes or an identified Copy is removed", async () => {
  const created = await records.createPurchase({
    kind: "bulk",
    recordName: "Unknown-cost bulk",
    date: "2026-07-29",
    source: "Private seller",
    listingUrl: "",
    notes: "must never become a known zero",
    totalPence: 0,
    amountKnown: false,
    totalCardCount: 4,
    cards: [card(2)],
  });
  const before = await records.snapshot();
  const record = before.records.find((item) => item.id === created.id)!;
  const bulkLine = record.lines.find((line) => line.kind === "bulk")!;
  const cardLine = record.lines.find((line) => line.kind === "card")!;
  await records.updateRecordLine({
    recordId: record.id,
    expectedRevision: record.revision,
    lineId: bulkLine.id,
    update: { name: bulkLine.name, quantity: 1, detail: bulkLine.detail ?? "", totalQuantity: 5 },
  });
  const resized = await records.snapshot();
  assert.deepEqual(resized.copies.filter((copy) => copy.acquiredRecordId === record.id).map((copy) => copy.allocationPence), [null, null]);
  assert.equal(resized.records.find((item) => item.id === record.id)?.lines.find((line) => line.id === cardLine.id)?.allocationPence, null);

  await records.removeCardCopy({ copyId: resized.copies.find((copy) => copy.acquiredRecordId === record.id)!.id });
  const removed = await records.snapshot();
  assert.equal(removed.records.find((item) => item.id === record.id)?.lines.find((line) => line.id === cardLine.id)?.allocationPence, null);
});

test("two simultaneous same-revision Purchase edits allow exactly one winner", async () => {
  const created = await records.createPurchase({ kind: "card", recordName: "Concurrent", date: "2026-07-29", source: "Local card shop", listingUrl: "", notes: "", totalPence: 30, card: card(3) });
  const record = (await records.snapshot()).records.find((item) => item.id === created.id)!;
  const edit = (amountPence: number) => records.updateRecordDetails({
    recordId: created.id, expectedRevision: record.revision,
    update: { title: record.title, date: record.date, source: record.source, listingUrl: "", amountPence, amountKnown: true, notes: "" },
  });
  const outcomes = await Promise.allSettled([edit(60), edit(90)]);
  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter((outcome) => outcome.status === "rejected").length, 1);
  const updated = (await records.snapshot()).records.find((item) => item.id === created.id)!;
  assert.ok(updated.amountPence === 60 || updated.amountPence === 90);
});

test("crafted multi-line ordinary Purchase edit is rejected before changing its Record total", async () => {
  const created = await records.createPurchase({
    kind: "card",
    recordName: "Guarded purchase",
    date: "2026-07-29",
    source: "Local card shop",
    listingUrl: "",
    notes: "must not change",
    totalPence: 75,
    card: card(3),
  });
  const snapshot = await records.snapshot();
  const record = snapshot.records.find((item) => item.id === created.id)!;
  const now = new Date();
  await db.insert(recordLines).values({
    id: "crafted-extra-line",
    ownerId,
    recordId: created.id,
    position: 99,
    kind: "card",
    name: "Crafted extra line",
    quantity: 1,
    allocationPence: 75,
    detail: null,
    createdAt: now,
    updatedAt: now,
  });
  const beforeRows = {
    copies: await db.select().from(cardCopies).where(eq(cardCopies.acquiredRecordId, created.id)),
    lines: await db.select().from(recordLines).where(eq(recordLines.recordId, created.id)),
    record: await db.select().from(recordEntries).where(eq(recordEntries.id, created.id)),
  };
  await assert.rejects(
    records.updateRecordDetails({
      recordId: created.id,
      expectedRevision: record.revision,
      update: { title: "This must not persist", date: record.date, source: record.source, listingUrl: "", amountPence: 90, amountKnown: true, notes: "bad payload" },
    }),
    /one card line only/i,
  );
  const afterRows = {
    copies: await db.select().from(cardCopies).where(eq(cardCopies.acquiredRecordId, created.id)),
    lines: await db.select().from(recordLines).where(eq(recordLines.recordId, created.id)),
    record: await db.select().from(recordEntries).where(eq(recordEntries.id, created.id)),
  };
  assert.deepEqual(afterRows, beforeRows, "shape rejection must leave Record, lines, and Copies unchanged");
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
  const beforeGiftOpening = await spend.currentMonth();
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
  assert.equal(currentMonth.total, beforeGiftOpening.total, "the unknown amount is excluded while the intentional £0 remains a known acquisition");
});

test("untracked pack opening can retain an unknown imported acquisition cost", async () => {
  const opening = await records.createOpening({
    recordName: "Unknown-cost opening",
    date: "2026-07-29",
    source: "Cardmarket",
    totalPence: 0,
    amountKnown: false,
    useTrackedStock: false,
    sealedUnitId: null,
    notes: "",
    product: {
      imageUrl: null,
      name: "Unknown-cost booster",
      edition: "",
      metadataNeedsAttention: false,
      rarity: "",
      selectedTargetId: null,
      setCode: "",
      setName: "",
      tcgplayerUrl: "https://www.tcgplayer.com/product/87654/unknown-cost-booster",
    },
    pulls: [card(1)],
  });
  assert.ok(opening.id);
  const snapshot = await records.snapshot();
  const imported = snapshot.records.find((record) => (
    record.type === "imported-acquisition" && record.title === "Untracked Unknown-cost booster"
  ));
  assert.equal(imported?.amountKnown, false);
  assert.equal(imported?.lines[0]?.allocationPence, null);
});

test("non-seller status is capability-only and listing history remains private", async () => {
  const status = await nonSellerEbay.status();
  assert.deepEqual(Object.keys(status), ["capability"]);
  assert.equal(status.capability.ebay.code, "seller_role_required");
  await assert.rejects(
    nonSellerRecords.listEbayListings({ composition: "all", lifecycle: "all", page: 1, query: "" }),
    /Administrator access is required/i,
  );
});

test("inventory-photo HTTP handlers scope GET, POST, PATCH and DELETE to the signed-in exact-Copy owner without eBay", async () => {
  await secondOwnerRecords.createPurchase({
    kind: "card",
    recordName: "Second owner card",
    date: "2026-07-30",
    source: "Local shop",
    listingUrl: "",
    notes: "photo ownership coverage",
    totalPence: 100,
    card: card(1),
  });
  const firstOwnerCopy = (await records.snapshot()).copies[0];
  const secondOwnerCopy = (await secondOwnerRecords.snapshot()).copies[0];
  assert.ok(firstOwnerCopy);
  assert.ok(secondOwnerCopy);
  const firstHeaders = authHeaders("records-owner-http-token");
  const secondHeaders = authHeaders("records-second-http-token");

  const ownGet = await getInventoryPhotos(new Request(
    `http://localhost:3000/api/inventory/card-images?copyId=${encodeURIComponent(firstOwnerCopy.id)}`,
    { headers: firstHeaders },
  ));
  assert.equal(ownGet.status, 200);
  assert.deepEqual(await ownGet.json(), { configured: false, images: [] });

  const wrongGet = await getInventoryPhotos(new Request(
    `http://localhost:3000/api/inventory/card-images?copyId=${encodeURIComponent(firstOwnerCopy.id)}`,
    { headers: secondHeaders },
  ));
  assert.equal(wrongGet.status, 404);

  const wrongUploadForm = new FormData();
  wrongUploadForm.set("copyId", firstOwnerCopy.id);
  wrongUploadForm.set("image", new File([new Uint8Array([0xff, 0xd8, 0xff])], "card.jpg", { type: "image/jpeg" }));
  const wrongUpload = await uploadInventoryPhoto(new Request(
    "http://localhost:3000/api/inventory/card-images",
    { body: wrongUploadForm, headers: secondHeaders, method: "POST" },
  ));
  assert.equal(wrongUpload.status, 404, "wrong-owner POST fails before the storage seam");

  const ownUploadForm = new FormData();
  ownUploadForm.set("copyId", firstOwnerCopy.id);
  ownUploadForm.set("image", new File([new Uint8Array([0xff, 0xd8, 0xff])], "card.jpg", { type: "image/jpeg" }));
  const ownUpload = await uploadInventoryPhoto(new Request(
    "http://localhost:3000/api/inventory/card-images",
    { body: ownUploadForm, headers: firstHeaders, method: "POST" },
  ));
  assert.equal(ownUpload.status, 502, "a disconnected owner reaches local storage configuration, not an eBay check");
  assert.match(String((await ownUpload.json() as { message: string }).message), /archived/i);

  const imageKey = `images/inventory-cards/${ownerId}/${firstOwnerCopy.id}/test.jpg`;
  await db.insert(cardCopyImages).values({
    copyId: firstOwnerCopy.id,
    createdAt: new Date(),
    id: "inventory-photo-http-test",
    objectKey: imageKey,
    ownerId,
    position: 0,
  });
  const wrongPatch = await reorderInventoryPhotos(new Request(
    "http://localhost:3000/api/inventory/card-images",
    {
      body: JSON.stringify({ copyId: firstOwnerCopy.id, keys: [imageKey] }),
      headers: { ...secondHeaders, "content-type": "application/json" },
      method: "PATCH",
    },
  ));
  assert.equal(wrongPatch.status, 404);
  const ownPatch = await reorderInventoryPhotos(new Request(
    "http://localhost:3000/api/inventory/card-images",
    {
      body: JSON.stringify({ copyId: firstOwnerCopy.id, keys: [imageKey] }),
      headers: { ...firstHeaders, "content-type": "application/json" },
      method: "PATCH",
    },
  ));
  assert.equal(ownPatch.status, 200);

  const wrongDelete = await deleteInventoryPhoto(new Request(
    "http://localhost:3000/api/inventory/card-images",
    {
      body: JSON.stringify({ copyId: firstOwnerCopy.id, key: imageKey }),
      headers: { ...secondHeaders, "content-type": "application/json" },
      method: "DELETE",
    },
  ));
  assert.equal(wrongDelete.status, 404);
  const ownDelete = await deleteInventoryPhoto(new Request(
    "http://localhost:3000/api/inventory/card-images",
    {
      body: JSON.stringify({ copyId: firstOwnerCopy.id, key: imageKey }),
      headers: { ...firstHeaders, "content-type": "application/json" },
      method: "DELETE",
    },
  ));
  assert.equal(ownDelete.status, 200);
  assert.deepEqual(await ownDelete.json(), { removed: true });
});

test("an ordinary unlisted manual Sale remains available to an authenticated owner", async () => {
  const snapshot = await nonSellerRecords.snapshot();
  const copy = snapshot.copies.find((candidate) => candidate.status === "available");
  assert.ok(copy);
  const sale = await nonSellerRecords.createSale({
    copyIds: [copy.id],
    date: "2026-07-30",
    netProceedsPence: 125,
    notes: "ordinary owner sale",
    recordName: "Local manual sale",
    source: "Local buyer",
  });
  assert.ok(sale.id);
});

test("non-sellers and preview mode cannot repair eBay membership directly", async () => {
  await assert.rejects(
    nonSellerRecords.resolveEbayCopyLinkAttention({ listingId: "crafted-listing" }),
    /seller permission/i,
  );
  const previousPreview = process.env.NEXT_PUBLIC_RECORDS_UI_PREVIEW;
  process.env.NEXT_PUBLIC_RECORDS_UI_PREVIEW = "1";
  try {
    await assert.rejects(
      records.resolveEbayCopyLinkAttention({ listingId: "crafted-listing" }),
      /preview mode/i,
    );
  } finally {
    if (previousPreview === undefined) delete process.env.NEXT_PUBLIC_RECORDS_UI_PREVIEW;
    else process.env.NEXT_PUBLIC_RECORDS_UI_PREVIEW = previousPreview;
  }
});

test("disconnected and missing-scope sellers receive exact remedies before an eBay-linked Records mutation", async () => {
  await assert.rejects(
    records.resolveEbayCopyLinkAttention({ listingId: "crafted-listing" }),
    /No eBay seller account is connected.*Connect eBay/i,
  );
  const now = new Date();
  await db.insert(ebayConnections).values({
    createdAt: now,
    ownerId,
    refreshTokenCiphertext: "not-used",
    refreshTokenExpiresAt: new Date(now.getTime() + 60 * 60_000),
    refreshTokenIv: "not-used",
    refreshTokenTag: "not-used",
    scopes: "https://api.ebay.com/oauth/api_scope",
    updatedAt: now,
  });
  await assert.rejects(
    records.resolveEbayCopyLinkAttention({ listingId: "crafted-listing" }),
    /missing permissions.*Reconnect eBay/i,
  );
  await db.delete(ebayConnections).where(eq(ebayConnections.ownerId, ownerId));
});

test("tracked-Sale reconciliation and linked Sale lifecycle updates require seller capability", async () => {
  const snapshot = await records.snapshot();
  const available = snapshot.copies.find((candidate) => candidate.status === "available");
  assert.ok(available);
  const now = new Date();
  await db.insert(ebayListings).values({
    copyId: available.id,
    createdAt: now,
    id: "capability-active-listing",
    itemId: "capability-item-active",
    listingState: "active",
    listingUrl: "https://www.ebay.co.uk/itm/capability-item-active",
    ownerId,
    saleState: "none",
    status: "active",
    title: "Capability active listing",
    updatedAt: now,
  });
  await assert.rejects(
    nonSellerRecords.createSale({
      copyIds: [available.id],
      date: "2026-07-30",
      netProceedsPence: 200,
      notes: "must not reconcile",
      recordName: "Crafted listed sale",
      source: "eBay",
    }),
    /seller permission/i,
  );

  const soldCopy = (await records.snapshot()).copies.find((candidate) => candidate.status === "sold");
  assert.ok(soldCopy?.soldRecordId);
  await db.insert(ebayListings).values({
    copyId: soldCopy.id,
    createdAt: now,
    id: "capability-linked-listing",
    itemId: "capability-item-linked",
    listingState: "ended",
    listingUrl: "https://www.ebay.co.uk/itm/capability-item-linked",
    ownerId,
    saleRecordId: soldCopy.soldRecordId,
    saleState: "paid",
    status: "ended",
    title: "Capability linked listing",
    updatedAt: now,
  });
  const saleRecord = (await records.snapshot()).records.find((record) => record.id === soldCopy.soldRecordId);
  assert.ok(saleRecord);
  await assert.rejects(
    nonSellerRecords.changeStatus({ expectedRevision: saleRecord.revision, recordId: saleRecord.id, status: "void" }),
    /seller permission/i,
  );
});

test.after(async () => {
  const allCopies = await db.select().from(cardCopies).where(eq(cardCopies.ownerId, ownerId));
  const allLines = await db.select().from(recordLines).where(eq(recordLines.ownerId, ownerId));
  assert.ok(allCopies.length > 0);
  assert.ok(allLines.length > 0);
});

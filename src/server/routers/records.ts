import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  bulkLots,
  cardCopies,
  cardPrintings,
  cardTargets,
  recordEntries,
  recordLineCopies,
  recordLines,
  sealedUnits,
  supplyItems,
} from "@/db/schema";
import { allocatePenceAt } from "@/lib/records/allocation";
import { compactRecordName, generatedSaleRecordName } from "@/lib/records/record-name";
import type {
  PreviewAttentionItem,
  RecordLine,
  RecordsSnapshot,
} from "@/lib/records/types";
import { authenticatedProcedure, router } from "@/server/trpc";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const productEditionSchema = z.enum(["1st Edition", "Unlimited Edition", "Limited Edition"]);
const supplyCategorySchema = z.enum(["sleeves", "binder", "storage", "playmat", "other"]);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const cardInputSchema = z.object({
  id: z.string().min(1),
  selectedTargetId: z.string().min(1).nullable().optional(),
  tcgplayerUrl: z.string().url().regex(/tcgplayer\.com\/product\/\d+/i),
  name: z.string().trim().min(1).max(160),
  imageUrl: z.string().url().nullable(),
  edition: productEditionSchema,
  rarity: z.string().trim().min(1).max(80),
  setName: z.string().trim().max(160),
  setCode: z.string().trim().max(80),
  metadataNeedsAttention: z.boolean(),
  quantity: z.number().int().positive().max(10_000),
});
const productInputSchema = cardInputSchema.omit({ id: true, quantity: true }).extend({
  rarity: z.string().trim().max(80),
});
const commonRecordSchema = z.object({
  recordName: z.string().trim().min(1).max(80),
  date: dateSchema,
  source: z.string().trim().min(1).max(120),
  notes: z.string().trim().max(4_000),
});
const purchaseSchema = z.discriminatedUnion("kind", [
  commonRecordSchema.extend({
    kind: z.literal("card"),
    listingUrl: z.string().trim().url().or(z.literal("")),
    totalPence: z.number().int().nonnegative(),
    card: cardInputSchema,
  }),
  commonRecordSchema.extend({
    kind: z.literal("sealed"),
    listingUrl: z.string().trim().url().or(z.literal("")),
    totalPence: z.number().int().nonnegative(),
    product: productInputSchema.extend({ quantity: z.number().int().positive().max(10_000) }),
  }),
  commonRecordSchema.extend({
    kind: z.literal("bulk"),
    listingUrl: z.string().trim().url().or(z.literal("")),
    totalPence: z.number().int().nonnegative(),
    cards: z.array(cardInputSchema).min(1),
    totalCardCount: z.number().int().positive().max(1_000_000),
  }),
  commonRecordSchema.extend({
    kind: z.literal("supply"),
    listingUrl: z.string().trim().url().or(z.literal("")),
    totalPence: z.number().int().nonnegative(),
    category: supplyCategorySchema,
    otherName: z.string().trim().max(160),
    quantity: z.number().int().positive().max(1_000_000),
  }),
]);
const openingSchema = commonRecordSchema.omit({ source: true }).extend({
  source: z.string().trim().min(1).max(120),
  product: productInputSchema,
  sealedUnitId: z.string().nullable(),
  pulls: z.array(cardInputSchema).min(1),
});
const saleSchema = z.object({
  recordName: z.string().trim().max(80),
  date: dateSchema,
  source: z.string().trim().min(1).max(120),
  netProceedsPence: z.number().int().nonnegative(),
  notes: z.string().trim().max(4_000),
  copyIds: z.array(z.string().min(1)).min(1),
});
const recordMutationIdentitySchema = z.object({
  recordId: z.string().min(1),
  expectedRevision: z.number().int().positive(),
});
const updateRecordDetailsSchema = recordMutationIdentitySchema.extend({
  update: z.object({
    title: z.string().trim().min(1).max(80),
    date: dateSchema,
    source: z.string().trim().min(1).max(120),
    listingUrl: z.string().trim().url().nullable().or(z.literal("")),
    amountPence: z.number().int().nonnegative(),
    notes: z.string().trim().max(4_000),
  }),
});
const resolveCardAttentionSchema = z.object({
  targetId: z.string().min(1),
  printingId: z.string().min(1).nullable().optional(),
  name: z.string().trim().min(1).max(160),
  rarity: z.string().trim().min(1).max(80),
  edition: productEditionSchema,
  tcgplayerUrl: z.string().url().regex(/tcgplayer\.com\/product\/\d+/i),
  setName: z.string().trim().min(1).max(160),
  setCode: z.string().trim().min(1).max(80),
  imageUrl: z.string().url().nullable(),
});
const replaceRecordCardsSchema = recordMutationIdentitySchema.extend({
  cards: z.array(cardInputSchema),
});
const replaceSaleCopiesSchema = recordMutationIdentitySchema.extend({
  copyIds: z.array(z.string().min(1)).min(1),
});
const updateRecordLineSchema = recordMutationIdentitySchema.extend({
  lineId: z.string().min(1),
  update: z.object({
    name: z.string().trim().min(1).max(160),
    quantity: z.number().int().positive().max(1_000_000),
    detail: z.string().trim().max(1_000),
    edition: productEditionSchema.optional(),
    category: supplyCategorySchema.optional(),
    totalQuantity: z.number().int().positive().max(1_000_000).optional(),
  }),
});

async function lockRecord(
  tx: Transaction,
  ownerId: string,
  recordId: string,
  expectedRevision: number,
) {
  const [record] = await tx.select().from(recordEntries).where(and(
    eq(recordEntries.id, recordId),
    eq(recordEntries.ownerId, ownerId),
  )).for("update").limit(1);
  if (!record) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found." });
  if (record.revision !== expectedRevision) {
    conflict("This Record changed elsewhere. Refresh it, review the latest values, and try again.");
  }
  return record;
}

async function bumpRecord(
  tx: Transaction,
  ownerId: string,
  recordId: string,
  revision: number,
  now: Date,
) {
  await tx.update(recordEntries).set({
    revision: revision + 1,
    updatedAt: now,
  }).where(and(
    eq(recordEntries.id, recordId),
    eq(recordEntries.ownerId, ownerId),
    eq(recordEntries.revision, revision),
  ));
}

function id(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function normalize(value: string) {
  return value.trim().toLocaleLowerCase("en-GB").replace(/\s+/g, " ");
}

function normalizeEdition(value: string) {
  const normalized = normalize(value);
  return normalized === "unlimited" ? "unlimited edition" : normalized;
}

function canonicalProductUrl(value: string | null | undefined) {
  if (!value) return "";
  try {
    const url = new URL(value);
    return `${url.hostname.replace(/^www\./, "").toLowerCase()}${url.pathname.replace(/\/$/, "")}`;
  } catch {
    return normalize(value);
  }
}

function conflict(message: string): never {
  throw new TRPCError({ code: "CONFLICT", message });
}

async function findOrCreatePrinting(
  tx: Transaction,
  ownerId: string,
  input: z.infer<typeof cardInputSchema>,
  now: Date,
) {
  const normalizedName = normalize(input.name);
  const normalizedRarity = normalize(input.rarity);
  const normalizedEditionValue = normalizeEdition(input.edition);
  let target = input.selectedTargetId
    ? (await tx.select().from(cardTargets).where(and(
        eq(cardTargets.id, input.selectedTargetId),
        eq(cardTargets.ownerId, ownerId),
      )).for("update").limit(1))[0]
    : undefined;

  if (!target) {
    [target] = await tx
      .select()
      .from(cardTargets)
      .where(and(
        eq(cardTargets.ownerId, ownerId),
        eq(cardTargets.normalizedName, normalizedName),
        eq(cardTargets.normalizedRarity, normalizedRarity),
        eq(cardTargets.normalizedEdition, normalizedEditionValue),
      ))
      .limit(1);
  }

  if (!target) {
    const targetId = id("target");
    [target] = await tx.insert(cardTargets).values({
      id: targetId,
      ownerId,
      name: input.name,
      normalizedName,
      rarity: input.rarity,
      normalizedRarity,
      edition: input.edition,
      normalizedEdition: normalizedEditionValue,
      desiredQuantity: 1,
      imageUrl: input.imageUrl,
      tcgplayerUrl: input.tcgplayerUrl,
      createdAt: now,
      updatedAt: now,
    }).returning();
  } else if (input.selectedTargetId) {
    const identityChanged = target.normalizedName !== normalizedName
      || target.normalizedRarity !== normalizedRarity
      || target.normalizedEdition !== normalizedEditionValue;
    if (identityChanged) {
      const [duplicate] = await tx.select({ id: cardTargets.id }).from(cardTargets).where(and(
        eq(cardTargets.ownerId, ownerId),
        eq(cardTargets.normalizedName, normalizedName),
        eq(cardTargets.normalizedRarity, normalizedRarity),
        eq(cardTargets.normalizedEdition, normalizedEditionValue),
      )).limit(1);
      if (duplicate && duplicate.id !== target.id) {
        conflict("This corrected card already exists in your Library. Select that existing card instead so the two Targets are not merged unexpectedly.");
      }
    }
    [target] = await tx.update(cardTargets).set({
      name: input.name,
      normalizedName,
      rarity: input.rarity,
      normalizedRarity,
      edition: input.edition,
      normalizedEdition: normalizedEditionValue,
      imageUrl: input.imageUrl || target.imageUrl,
      tcgplayerUrl: input.tcgplayerUrl || target.tcgplayerUrl,
      updatedAt: now,
    }).where(and(
      eq(cardTargets.id, target.id),
      eq(cardTargets.ownerId, ownerId),
    )).returning();
  } else {
    const updates = {
      imageUrl: target.imageUrl || input.imageUrl,
      tcgplayerUrl: target.tcgplayerUrl || input.tcgplayerUrl,
      updatedAt: now,
    };
    [target] = await tx.update(cardTargets).set(updates).where(and(
      eq(cardTargets.id, target.id),
      eq(cardTargets.ownerId, ownerId),
    )).returning();
  }

  const canonicalUrl = canonicalProductUrl(input.tcgplayerUrl);
  const normalizedSetName = normalize(input.setName || "Unknown set");
  const normalizedSetCode = normalize(input.setCode || "Unknown code");
  let [printing] = await tx.select().from(cardPrintings).where(and(
    eq(cardPrintings.ownerId, ownerId),
    eq(cardPrintings.targetId, target.id),
    eq(cardPrintings.canonicalTcgplayerUrl, canonicalUrl),
  )).limit(1);

  printing ??= (await tx.select().from(cardPrintings).where(and(
    eq(cardPrintings.ownerId, ownerId),
    eq(cardPrintings.targetId, target.id),
    eq(cardPrintings.normalizedSetName, normalizedSetName),
    eq(cardPrintings.normalizedSetCode, normalizedSetCode),
  )).limit(1))[0];

  if (!printing) {
    [printing] = await tx.insert(cardPrintings).values({
      id: id("printing"),
      ownerId,
      targetId: target.id,
      setName: input.setName || "Unknown set",
      normalizedSetName,
      setCode: input.setCode || "Unknown code",
      normalizedSetCode,
      tcgplayerUrl: input.tcgplayerUrl,
      canonicalTcgplayerUrl: canonicalUrl,
      imageUrl: input.imageUrl,
      metadataNeedsAttention: input.metadataNeedsAttention,
      createdAt: now,
      updatedAt: now,
    }).returning();
  }

  return { printing, target };
}

async function insertRecord(
  tx: Transaction,
  values: typeof recordEntries.$inferInsert,
) {
  await tx.insert(recordEntries).values(values);
  return values.id;
}

async function insertLine(
  tx: Transaction,
  values: typeof recordLines.$inferInsert,
) {
  await tx.insert(recordLines).values(values);
  return values.id;
}

async function loadSnapshot(ownerId: string): Promise<RecordsSnapshot> {
  const [records, lines, targets, printings, copies, lineCopyLinks, sealed, lots, supplies] = await Promise.all([
    db.select().from(recordEntries).where(eq(recordEntries.ownerId, ownerId)).orderBy(desc(recordEntries.occurredOn), desc(recordEntries.createdAt)),
    db.select().from(recordLines).where(eq(recordLines.ownerId, ownerId)).orderBy(asc(recordLines.position)),
    db.select().from(cardTargets).where(eq(cardTargets.ownerId, ownerId)).orderBy(asc(cardTargets.name)),
    db.select().from(cardPrintings).where(eq(cardPrintings.ownerId, ownerId)),
    db.select().from(cardCopies).where(eq(cardCopies.ownerId, ownerId)),
    db.select().from(recordLineCopies).where(eq(recordLineCopies.ownerId, ownerId)),
    db.select().from(sealedUnits).where(eq(sealedUnits.ownerId, ownerId)),
    db.select().from(bulkLots).where(eq(bulkLots.ownerId, ownerId)),
    db.select().from(supplyItems).where(eq(supplyItems.ownerId, ownerId)),
  ]);

  const entityIdsByLine = new Map<string, string[]>();
  const addEntity = (lineId: string | null, entityId: string) => {
    if (!lineId) return;
    entityIdsByLine.set(lineId, [...(entityIdsByLine.get(lineId) ?? []), entityId]);
  };
  for (const copy of copies) {
    addEntity(copy.acquiredLineId, copy.id);
  }
  for (const link of lineCopyLinks) addEntity(link.lineId, link.copyId);
  for (const unit of sealed) addEntity(unit.acquiredLineId, unit.id);
  for (const lot of lots) addEntity(lot.acquiredLineId, lot.id);
  for (const supply of supplies) addEntity(supply.acquiredLineId, supply.id);

  const linesByRecord = new Map<string, RecordLine[]>();
  for (const line of lines) {
    const serialized: RecordLine = {
      id: line.id,
      kind: line.kind,
      name: line.name,
      quantity: line.quantity,
      allocationPence: line.allocationPence,
      entityIds: entityIdsByLine.get(line.id) ?? [],
      detail: line.detail,
    };
    linesByRecord.set(line.recordId, [...(linesByRecord.get(line.recordId) ?? []), serialized]);
  }

  const attention: PreviewAttentionItem[] = [];
  for (const target of targets) {
    if (normalizeEdition(target.edition) === "unknown edition") {
      attention.push({
        id: `attention-edition-${target.id}`,
        targetId: target.id,
        label: target.name,
        detail: "Edition was not available in the legacy data and needs confirmation.",
        field: "edition",
      });
    }
    if (!target.tcgplayerUrl) {
      attention.push({
        id: `attention-tcgplayer-${target.id}`,
        targetId: target.id,
        label: target.name,
        detail: "Add the exact TCGplayer product link for this Target.",
        field: "tcgplayer",
      });
    }
  }
  for (const printing of printings.filter((item) => item.metadataNeedsAttention)) {
    const target = targets.find((item) => item.id === printing.targetId);
    attention.push({
      id: `attention-printing-${printing.id}`,
      targetId: printing.targetId,
      printingId: printing.id,
      label: target?.name ?? "Card metadata",
      detail: "Printing metadata needs confirmation.",
      field: "tcgplayer",
    });
  }
  for (const record of records.filter((item) => (
    item.type === "imported-acquisition" && !item.amountKnown
  ))) {
    attention.push({
      id: `attention-cost-${record.id}`,
      targetId: null,
      label: record.title,
      detail: "Imported acquisition cost is unknown and can be updated from History.",
      field: "cost",
    });
  }

  return {
    version: 1,
    records: records.map((record) => ({
      id: record.id,
      type: record.type,
      status: record.status,
      date: record.occurredOn,
      title: record.title,
      titleGenerated: record.titleGenerated,
      source: record.source,
      listingUrl: record.listingUrl,
      amountPence: record.amountPence,
      amountKnown: record.amountKnown,
      notes: record.notes,
      lines: linesByRecord.get(record.id) ?? [],
      revision: record.revision,
      createdAt: record.createdAt.toISOString(),
    })),
    targets: targets.map((target) => ({
      id: target.id,
      name: target.name,
      rarity: target.rarity,
      edition: target.edition,
      desiredQuantity: target.desiredQuantity,
      imageUrl: target.imageUrl,
      tcgplayerUrl: target.tcgplayerUrl,
      marketPricePence: target.marketPricePence,
    })),
    printings: printings.map((printing) => ({
      id: printing.id,
      targetId: printing.targetId,
      setName: printing.setName,
      setCode: printing.setCode,
      tcgplayerUrl: printing.tcgplayerUrl,
      imageUrl: printing.imageUrl,
    })),
    copies: copies.map((copy) => ({
      id: copy.id,
      printingId: copy.printingId,
      acquiredRecordId: copy.acquiredRecordId,
      soldRecordId: copy.soldRecordId,
      bulkLotId: copy.bulkLotId,
      allocationIndex: copy.allocationIndex,
      allocationPence: copy.allocationPence,
      status: copy.status,
      condition: copy.condition,
    })),
    sealedUnits: sealed.map((unit) => ({
      id: unit.id,
      name: unit.name,
      edition: unit.edition as "1st Edition" | "Unlimited Edition" | "Limited Edition" | null,
      quantity: 1,
      tcgplayerUrl: unit.tcgplayerUrl,
      imageUrl: unit.imageUrl,
      status: unit.status,
      acquiredRecordId: unit.acquiredRecordId,
      openedRecordId: unit.openedRecordId,
    })),
    bulkLots: lots.map((lot) => ({
      id: lot.id,
      name: lot.name,
      totalQuantity: lot.totalQuantity,
      itemizedQuantity: lot.itemizedQuantity,
      acquiredRecordId: lot.acquiredRecordId,
      status: lot.status,
    })),
    supplies: supplies.map((supply) => ({
      id: supply.id,
      name: supply.name,
      category: supply.category,
      quantity: supply.quantity,
      acquiredRecordId: supply.acquiredRecordId,
      status: supply.status,
    })),
    attention,
  };
}

export const recordsRouter = router({
  snapshot: authenticatedProcedure.query(({ ctx }) => loadSnapshot(ctx.collectionOwnerId)),

  resolveCardAttention: authenticatedProcedure.input(resolveCardAttentionSchema).mutation(async ({ ctx, input }) => {
    const now = new Date();
    const [target] = await db.select().from(cardTargets).where(and(
      eq(cardTargets.id, input.targetId),
      eq(cardTargets.ownerId, ctx.collectionOwnerId),
    )).limit(1);
    if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "Card Target not found." });

    const printing = input.printingId
      ? (await db.select().from(cardPrintings).where(and(
          eq(cardPrintings.id, input.printingId),
          eq(cardPrintings.targetId, target.id),
          eq(cardPrintings.ownerId, ctx.collectionOwnerId),
        )).limit(1))[0]
      : (await db.select().from(cardPrintings).where(and(
          eq(cardPrintings.targetId, target.id),
          eq(cardPrintings.ownerId, ctx.collectionOwnerId),
        )).limit(1))[0];
    if (!printing) throw new TRPCError({ code: "NOT_FOUND", message: "Card printing not found." });
    const relatedCopies = await db.select({ acquiredLineId: cardCopies.acquiredLineId }).from(cardCopies).where(and(
      eq(cardCopies.ownerId, ctx.collectionOwnerId),
      eq(cardCopies.printingId, printing.id),
    ));
    const relatedLineIds = Array.from(new Set(relatedCopies.map((copy) => copy.acquiredLineId).filter((id): id is string => Boolean(id))));

    await db.transaction(async (tx) => {
      await tx.update(cardTargets).set({
        name: input.name,
        normalizedName: normalize(input.name),
        rarity: input.rarity,
        normalizedRarity: normalize(input.rarity),
        edition: input.edition,
        normalizedEdition: normalizeEdition(input.edition),
        tcgplayerUrl: input.tcgplayerUrl,
        imageUrl: input.imageUrl,
        updatedAt: now,
      }).where(and(eq(cardTargets.id, target.id), eq(cardTargets.ownerId, ctx.collectionOwnerId)));
      await tx.update(cardPrintings).set({
        setName: input.setName,
        normalizedSetName: normalize(input.setName),
        setCode: input.setCode,
        normalizedSetCode: normalize(input.setCode),
        tcgplayerUrl: input.tcgplayerUrl,
        canonicalTcgplayerUrl: canonicalProductUrl(input.tcgplayerUrl),
        imageUrl: input.imageUrl,
        metadataNeedsAttention: false,
        updatedAt: now,
      }).where(and(eq(cardPrintings.id, printing.id), eq(cardPrintings.ownerId, ctx.collectionOwnerId)));
      if (relatedLineIds.length) {
        await tx.update(recordLines).set({
          name: input.name,
          detail: `${input.setCode} · ${input.edition} · ${input.rarity}`,
          updatedAt: now,
        }).where(and(
          eq(recordLines.ownerId, ctx.collectionOwnerId),
          inArray(recordLines.id, relatedLineIds),
        ));
      }
    });
    return { id: target.id };
  }),

  createPurchase: authenticatedProcedure.input(purchaseSchema).mutation(async ({ ctx, input }) => {
    const ownerId = ctx.collectionOwnerId;
    const recordId = id("record");
    const now = new Date();
    const identifiedCount = input.kind === "bulk"
      ? input.cards.reduce((sum, card) => sum + card.quantity, 0)
      : 0;
    if (input.kind === "bulk" && identifiedCount > input.totalCardCount) {
      conflict("Total cards in the lot cannot be less than the identified physical Copies.");
    }

    await db.transaction(async (tx) => {
      await insertRecord(tx, {
        id: recordId,
        ownerId,
        type: "purchase",
        status: "active",
        occurredOn: input.date,
        title: input.recordName,
        titleGenerated: false,
        source: input.source,
        listingUrl: input.listingUrl || null,
        amountPence: input.totalPence,
        amountKnown: true,
        notes: input.notes,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      });

      if (input.kind === "card") {
        const lineId = id("line");
        const { printing } = await findOrCreatePrinting(tx, ownerId, input.card, now);
        await insertLine(tx, {
          id: lineId, ownerId, recordId, position: 0, kind: "card", name: input.card.name,
          quantity: input.card.quantity, allocationPence: input.totalPence,
          detail: `${input.card.setCode || "Unknown code"} · ${input.card.edition} · ${input.card.rarity}`,
          createdAt: now, updatedAt: now,
        });
        await tx.insert(cardCopies).values(Array.from({ length: input.card.quantity }, (_, index) => ({
          id: id("copy"), ownerId, printingId: printing.id, acquiredRecordId: recordId,
          acquiredLineId: lineId, allocationPence: allocatePenceAt(input.totalPence, input.card.quantity, index),
          status: "available" as const, condition: "Near Mint", createdAt: now, updatedAt: now,
        })));
      } else if (input.kind === "sealed") {
        const lineId = id("line");
        await insertLine(tx, {
          id: lineId, ownerId, recordId, position: 0, kind: "sealed", name: input.product.name,
          quantity: input.product.quantity, allocationPence: input.totalPence,
          detail: input.product.edition, createdAt: now, updatedAt: now,
        });
        const canonicalUrl = canonicalProductUrl(input.product.tcgplayerUrl);
        await tx.insert(sealedUnits).values(Array.from({ length: input.product.quantity }, () => ({
          id: id("sealed"), ownerId, acquiredRecordId: recordId, acquiredLineId: lineId,
          name: input.product.name, edition: input.product.edition, tcgplayerUrl: input.product.tcgplayerUrl,
          canonicalTcgplayerUrl: canonicalUrl, imageUrl: input.product.imageUrl, status: "sealed" as const,
          createdAt: now, updatedAt: now,
        })));
      } else if (input.kind === "bulk") {
        const lotId = id("bulk");
        const lotLineId = id("line");
        const lotName = `Bulk lot · ${input.cards.length} card ${input.cards.length === 1 ? "type" : "types"}`;
        await insertLine(tx, {
          id: lotLineId, ownerId, recordId, position: 0, kind: "bulk", name: lotName,
          quantity: 1, detail: `${identifiedCount} identified of ${input.totalCardCount} total cards`,
          createdAt: now, updatedAt: now,
        });
        await tx.insert(bulkLots).values({
          id: lotId, ownerId, acquiredRecordId: recordId, acquiredLineId: lotLineId,
          name: lotName, totalQuantity: input.totalCardCount, itemizedQuantity: identifiedCount,
          status: identifiedCount >= input.totalCardCount ? "itemized" : "open", createdAt: now, updatedAt: now,
        });
        let allocationIndex = 0;
        for (const [position, card] of input.cards.entries()) {
          const lineId = id("line");
          const { printing } = await findOrCreatePrinting(tx, ownerId, card, now);
          const allocations = Array.from({ length: card.quantity }, (_, offset) => (
            allocatePenceAt(input.totalPence, input.totalCardCount, allocationIndex + offset)
          ));
          await insertLine(tx, {
            id: lineId, ownerId, recordId, position: position + 1, kind: "card", name: card.name,
            quantity: card.quantity, allocationPence: allocations.reduce((sum, value) => sum + value, 0),
            detail: `${card.setCode || "Unknown code"} · ${card.edition} · from ${lotName}`,
            createdAt: now, updatedAt: now,
          });
          await tx.insert(cardCopies).values(allocations.map((allocationPence, offset) => ({
            id: id("copy"), ownerId, printingId: printing.id, acquiredRecordId: recordId,
            acquiredLineId: lineId, bulkLotId: lotId, allocationIndex: allocationIndex + offset,
            allocationPence, status: "available" as const, condition: "Near Mint", createdAt: now, updatedAt: now,
          })));
          allocationIndex += card.quantity;
        }
      } else {
        const lineId = id("line");
        const name = input.category === "other"
          ? input.otherName
          : input.category.charAt(0).toUpperCase() + input.category.slice(1);
        if (!name) conflict("Name the other supply or extra.");
        await insertLine(tx, {
          id: lineId, ownerId, recordId, position: 0, kind: "supply", name,
          quantity: input.quantity, allocationPence: input.totalPence, detail: "Supply or extra",
          createdAt: now, updatedAt: now,
        });
        await tx.insert(supplyItems).values({
          id: id("supply"), ownerId, acquiredRecordId: recordId, acquiredLineId: lineId,
          name, category: input.category, quantity: input.quantity, status: "held",
          createdAt: now, updatedAt: now,
        });
      }
    });
    return { id: recordId };
  }),

  createOpening: authenticatedProcedure.input(openingSchema).mutation(async ({ ctx, input }) => {
    const ownerId = ctx.collectionOwnerId;
    const openingId = id("record");
    const now = new Date();
    await db.transaction(async (tx) => {
      const canonicalUrl = canonicalProductUrl(input.product.tcgplayerUrl);
      let sealed = input.sealedUnitId
        ? (await tx.select().from(sealedUnits).where(and(
            eq(sealedUnits.id, input.sealedUnitId), eq(sealedUnits.ownerId, ownerId),
            eq(sealedUnits.status, "sealed"), isNull(sealedUnits.openedRecordId),
          )).limit(1))[0]
        : undefined;
      sealed ??= (await tx.select().from(sealedUnits).where(and(
        eq(sealedUnits.ownerId, ownerId), eq(sealedUnits.status, "sealed"),
        eq(sealedUnits.canonicalTcgplayerUrl, canonicalUrl), isNull(sealedUnits.openedRecordId),
      )).limit(1))[0];

      if (!sealed) {
        const importedId = id("record");
        const importedLineId = id("line");
        const sealedId = id("sealed");
        const isGift = normalize(input.source) === "gift";
        await insertRecord(tx, {
          id: importedId, ownerId, type: "imported-acquisition", status: "active", occurredOn: input.date,
          title: compactRecordName(`Imported ${input.product.name}`, "Imported sealed product"), titleGenerated: true,
          source: input.source, amountPence: 0, amountKnown: isGift,
          notes: isGift ? "Gifted sealed product." : "Historical cost is unknown and excluded from known spend.",
          revision: 1, createdAt: now, updatedAt: now,
        });
        await insertLine(tx, {
          id: importedLineId, ownerId, recordId: importedId, position: 0, kind: "sealed",
          name: input.product.name, quantity: 1, allocationPence: isGift ? 0 : null,
          detail: `${isGift ? "Gift · £0" : "Unknown historical cost"} · ${input.product.edition}`,
          createdAt: now, updatedAt: now,
        });
        [sealed] = await tx.insert(sealedUnits).values({
          id: sealedId, ownerId, acquiredRecordId: importedId, acquiredLineId: importedLineId,
          name: input.product.name, edition: input.product.edition, tcgplayerUrl: input.product.tcgplayerUrl,
          canonicalTcgplayerUrl: canonicalUrl, imageUrl: input.product.imageUrl, status: "sealed",
          createdAt: now, updatedAt: now,
        }).returning();
      }

      await insertRecord(tx, {
        id: openingId, ownerId, type: "pack-opening", status: "active", occurredOn: input.date,
        title: input.recordName, titleGenerated: false, source: input.source, amountPence: 0,
        amountKnown: true, notes: input.notes, revision: 1, createdAt: now, updatedAt: now,
      });
      for (const [position, pull] of input.pulls.entries()) {
        const lineId = id("line");
        const { printing } = await findOrCreatePrinting(tx, ownerId, pull, now);
        await insertLine(tx, {
          id: lineId, ownerId, recordId: openingId, position, kind: "card", name: pull.name,
          quantity: pull.quantity, detail: `${pull.setCode || "Unknown code"} · ${pull.edition} · ${pull.rarity} · pulled`,
          createdAt: now, updatedAt: now,
        });
        await tx.insert(cardCopies).values(Array.from({ length: pull.quantity }, () => ({
          id: id("copy"), ownerId, printingId: printing.id, acquiredRecordId: openingId,
          acquiredLineId: lineId, status: "available" as const, condition: "Near Mint",
          createdAt: now, updatedAt: now,
        })));
      }
      const updated = await tx.update(sealedUnits).set({
        status: "opened", openedRecordId: openingId, updatedAt: now,
      }).where(and(
        eq(sealedUnits.id, sealed.id), eq(sealedUnits.ownerId, ownerId),
        eq(sealedUnits.status, "sealed"), isNull(sealedUnits.openedRecordId),
      )).returning({ id: sealedUnits.id });
      if (!updated.length) conflict("That sealed product was opened elsewhere. Refresh and try again.");
    });
    return { id: openingId };
  }),

  createSale: authenticatedProcedure.input(saleSchema).mutation(async ({ ctx, input }) => {
    const ownerId = ctx.collectionOwnerId;
    const uniqueCopyIds = Array.from(new Set(input.copyIds));
    const saleId = id("record");
    const now = new Date();
    await db.transaction(async (tx) => {
      const copies = await tx.select().from(cardCopies).where(and(
        eq(cardCopies.ownerId, ownerId), inArray(cardCopies.id, uniqueCopyIds),
      )).for("update");
      if (copies.length !== uniqueCopyIds.length || copies.some((copy) => (
        copy.status !== "available" || copy.soldRecordId !== null
      ))) {
        conflict("One or more selected Copies are no longer available. Refresh and review the Sale.");
      }
      const printingIds = Array.from(new Set(copies.map((copy) => copy.printingId)));
      const printingRows = await tx.select().from(cardPrintings).where(and(
        eq(cardPrintings.ownerId, ownerId), inArray(cardPrintings.id, printingIds),
      ));
      const targetIds = Array.from(new Set(printingRows.map((printing) => printing.targetId)));
      const targetRows = await tx.select().from(cardTargets).where(and(
        eq(cardTargets.ownerId, ownerId), inArray(cardTargets.id, targetIds),
      ));
      const printingById = new Map(printingRows.map((printing) => [printing.id, printing]));
      const targetById = new Map(targetRows.map((target) => [target.id, target]));
      const names = copies.map((copy) => {
        const printing = printingById.get(copy.printingId);
        return printing ? targetById.get(printing.targetId)?.name ?? "Card" : "Card";
      });
      await insertRecord(tx, {
        id: saleId, ownerId, type: "sale", status: "active", occurredOn: input.date,
        title: compactRecordName(input.recordName, generatedSaleRecordName(names)),
        titleGenerated: !input.recordName, source: input.source, amountPence: input.netProceedsPence,
        amountKnown: true, notes: input.notes, revision: 1, createdAt: now, updatedAt: now,
      });
      const grouped = new Map<string, typeof copies>();
      for (const copy of copies) {
        grouped.set(copy.printingId, [...(grouped.get(copy.printingId) ?? []), copy]);
      }
      let position = 0;
      for (const [printingId, group] of grouped) {
        const printing = printingById.get(printingId);
        const target = printing ? targetById.get(printing.targetId) : undefined;
        if (!printing || !target) conflict("A selected Copy has incomplete owner-scoped printing data.");
        const lineId = id("line");
        await insertLine(tx, {
          id: lineId, ownerId, recordId: saleId, position, kind: "card", name: target.name,
          quantity: group.length, detail: `${printing.setCode} · ${group[0].condition}`,
          createdAt: now, updatedAt: now,
        });
        const updated = await tx.update(cardCopies).set({
          status: "sold", soldRecordId: saleId, soldLineId: lineId, updatedAt: now,
        }).where(and(
          eq(cardCopies.ownerId, ownerId), inArray(cardCopies.id, group.map((copy) => copy.id)),
          eq(cardCopies.status, "available"),
        )).returning({ id: cardCopies.id });
        if (updated.length !== group.length) conflict("A selected Copy changed while the Sale was being saved.");
        await tx.insert(recordLineCopies).values(group.map((copy) => ({
          id: id("line-copy"), ownerId, recordId: saleId, lineId, copyId: copy.id,
          role: "sale" as const, createdAt: now,
        })));
        position += 1;
      }
    });
    return { id: saleId };
  }),

  updateRecordDetails: authenticatedProcedure.input(updateRecordDetailsSchema).mutation(async ({ ctx, input }) => {
    const ownerId = ctx.collectionOwnerId;
    const now = new Date();
    await db.transaction(async (tx) => {
      const record = await lockRecord(tx, ownerId, input.recordId, input.expectedRevision);
      if (record.status === "void") conflict("Restore this Record before editing it.");
      await tx.update(recordEntries).set({
        title: input.update.title,
        titleGenerated: false,
        occurredOn: input.update.date,
        source: input.update.source,
        listingUrl: input.update.listingUrl || null,
        amountPence: input.update.amountPence,
        notes: input.update.notes,
        updatedAt: now,
      }).where(and(eq(recordEntries.id, record.id), eq(recordEntries.ownerId, ownerId)));

      const [lot] = await tx.select().from(bulkLots).where(and(
        eq(bulkLots.ownerId, ownerId), eq(bulkLots.acquiredRecordId, record.id),
      )).limit(1);
      if (lot && record.amountPence !== input.update.amountPence) {
        const copies = await tx.select().from(cardCopies).where(and(
          eq(cardCopies.ownerId, ownerId), eq(cardCopies.bulkLotId, lot.id),
        ));
        for (const copy of copies) {
          if (copy.allocationIndex === null) continue;
          await tx.update(cardCopies).set({
            allocationPence: allocatePenceAt(input.update.amountPence, lot.totalQuantity, copy.allocationIndex),
            updatedAt: now,
          }).where(and(eq(cardCopies.id, copy.id), eq(cardCopies.ownerId, ownerId)));
        }
        const lines = await tx.select().from(recordLines).where(and(
          eq(recordLines.ownerId, ownerId), eq(recordLines.recordId, record.id), eq(recordLines.kind, "card"),
        ));
        for (const line of lines) {
          const lineCopies = copies.filter((copy) => copy.acquiredLineId === line.id);
          await tx.update(recordLines).set({
            allocationPence: lineCopies.reduce((sum, copy) => (
              sum + (copy.allocationIndex === null
                ? 0
                : allocatePenceAt(input.update.amountPence, lot.totalQuantity, copy.allocationIndex))
            ), 0),
            updatedAt: now,
          }).where(and(eq(recordLines.id, line.id), eq(recordLines.ownerId, ownerId)));
        }
      }
      await bumpRecord(tx, ownerId, record.id, record.revision, now);
    });
    return { id: input.recordId };
  }),

  replaceRecordCards: authenticatedProcedure.input(replaceRecordCardsSchema).mutation(async ({ ctx, input }) => {
    const ownerId = ctx.collectionOwnerId;
    const now = new Date();
    await db.transaction(async (tx) => {
      const record = await lockRecord(tx, ownerId, input.recordId, input.expectedRevision);
      if (record.status === "void") conflict("Restore this Record before editing its items.");
      if (record.type === "sale") conflict("Use exact Copy selection to edit a Sale.");

      const existingLines = await tx.select().from(recordLines).where(and(
        eq(recordLines.ownerId, ownerId),
        eq(recordLines.recordId, record.id),
        eq(recordLines.kind, "card"),
      )).orderBy(asc(recordLines.position));
      const [bulkLot] = await tx.select().from(bulkLots).where(and(
        eq(bulkLots.ownerId, ownerId), eq(bulkLots.acquiredRecordId, record.id),
      )).limit(1);
      if (!existingLines.length && !bulkLot) {
        conflict("This Record does not contain editable card items.");
      }
      if (!input.cards.length && !bulkLot && record.type !== "pack-opening") {
        conflict("Keep at least one card item, or void the whole Record.");
      }

      const requestedCount = input.cards.reduce((sum, card) => sum + card.quantity, 0);
      if (bulkLot && requestedCount > bulkLot.totalQuantity) {
        conflict(
          `This Bulk Lot contains ${bulkLot.totalQuantity} cards in total. Reduce the identified quantities or update the lot total first.`,
        );
      }

      const existingLineById = new Map(existingLines.map((line) => [line.id, line]));
      const retainedExistingIds = new Set(
        input.cards.filter((card) => existingLineById.has(card.id)).map((card) => card.id),
      );
      const acquiredCopies = await tx.select().from(cardCopies).where(and(
        eq(cardCopies.ownerId, ownerId), eq(cardCopies.acquiredRecordId, record.id),
      )).for("update");
      const copyIds = acquiredCopies.map((copy) => copy.id);
      const historyLinks = copyIds.length
        ? await tx.select().from(recordLineCopies).where(and(
            eq(recordLineCopies.ownerId, ownerId),
            eq(recordLineCopies.role, "sale"),
            inArray(recordLineCopies.copyId, copyIds),
          ))
        : [];
      const copyIdsWithSaleHistory = new Set(historyLinks.map((link) => link.copyId));
      const copiesByLine = new Map<string, typeof acquiredCopies>();
      for (const copy of acquiredCopies) {
        copiesByLine.set(copy.acquiredLineId, [...(copiesByLine.get(copy.acquiredLineId) ?? []), copy]);
      }

      for (const line of existingLines.filter((item) => !retainedExistingIds.has(item.id))) {
        const lineCopies = copiesByLine.get(line.id) ?? [];
        if (lineCopies.some((copy) => copyIdsWithSaleHistory.has(copy.id))) {
          conflict(`“${line.name}” has later Sale history and cannot be deleted.`);
        }
      }

      const existingPrintingIds = Array.from(new Set(acquiredCopies.map((copy) => copy.printingId)));
      const existingPrintings = existingPrintingIds.length
        ? await tx.select().from(cardPrintings).where(and(
            eq(cardPrintings.ownerId, ownerId), inArray(cardPrintings.id, existingPrintingIds),
          ))
        : [];
      const existingTargetIds = Array.from(new Set(existingPrintings.map((printing) => printing.targetId)));
      const existingTargets = existingTargetIds.length
        ? await tx.select().from(cardTargets).where(and(
            eq(cardTargets.ownerId, ownerId), inArray(cardTargets.id, existingTargetIds),
          ))
        : [];
      const printingById = new Map(existingPrintings.map((printing) => [printing.id, printing]));
      const targetById = new Map(existingTargets.map((target) => [target.id, target]));

      type PlannedCard = {
        input: z.infer<typeof cardInputSchema>;
        existingLine: (typeof existingLines)[number] | undefined;
        retainedCopies: typeof acquiredCopies;
        removeCopies: typeof acquiredCopies;
        addQuantity: number;
        printingId: string;
      };
      const plans: PlannedCard[] = [];
      for (const card of input.cards) {
        const existingLine = existingLineById.get(card.id);
        const currentCopies = existingLine ? copiesByLine.get(existingLine.id) ?? [] : [];
        const firstCopy = currentCopies[0];
        const currentPrinting = firstCopy ? printingById.get(firstCopy.printingId) : undefined;
        const currentTarget = currentPrinting ? targetById.get(currentPrinting.targetId) : undefined;
        const identityChanged = Boolean(existingLine) && (
          !currentTarget
          || !currentPrinting
          || normalize(currentTarget.name) !== normalize(card.name)
          || normalize(currentTarget.rarity) !== normalize(card.rarity)
          || normalizeEdition(currentTarget.edition) !== normalizeEdition(card.edition)
          || normalize(currentPrinting.setName) !== normalize(card.setName || "Unknown set")
          || normalize(currentPrinting.setCode) !== normalize(card.setCode || "Unknown code")
          || canonicalProductUrl(currentPrinting.tcgplayerUrl) !== canonicalProductUrl(card.tcgplayerUrl)
        );
        const hasSaleHistory = currentCopies.some((copy) => copyIdsWithSaleHistory.has(copy.id));
        if (identityChanged && hasSaleHistory) {
          conflict(`“${existingLine?.name ?? card.name}” has later Sale history, so its printing identity cannot be changed.`);
        }
        if (
          record.type === "purchase"
          && !bulkLot
          && existingLine
          && card.quantity !== currentCopies.length
          && hasSaleHistory
        ) {
          conflict(`“${existingLine.name}” has later Sale history, so its purchase allocation cannot be rebased.`);
        }

        const removeCount = Math.max(0, currentCopies.length - card.quantity);
        const removable = currentCopies
          .filter((copy) => copy.status === "available" && !copyIdsWithSaleHistory.has(copy.id))
          .slice(0, removeCount);
        if (removable.length !== removeCount) {
          conflict(`“${existingLine?.name ?? card.name}” has dependent Copies, so its quantity cannot be reduced that far.`);
        }
        const removedIds = new Set(removable.map((copy) => copy.id));
        const { printing } = identityChanged || !existingLine
          ? await findOrCreatePrinting(tx, ownerId, card, now)
          : { printing: currentPrinting! };
        plans.push({
          input: card,
          existingLine,
          retainedCopies: currentCopies.filter((copy) => !removedIds.has(copy.id)),
          removeCopies: removable,
          addQuantity: Math.max(0, card.quantity - currentCopies.length),
          printingId: printing.id,
        });
      }

      // Free the stable display positions before applying inserts/reordering so
      // the unique (Record, position) constraint never observes a transient clash.
      for (const [index, line] of existingLines.entries()) {
        await tx.update(recordLines).set({ position: -(index + 1), updatedAt: now }).where(and(
          eq(recordLines.id, line.id), eq(recordLines.ownerId, ownerId),
        ));
      }

      const removedLineIds = existingLines
        .filter((line) => !retainedExistingIds.has(line.id))
        .map((line) => line.id);
      const removedLineCopyIds = removedLineIds.flatMap((lineId) => (
        (copiesByLine.get(lineId) ?? []).map((copy) => copy.id)
      ));
      const reducedCopyIds = plans.flatMap((plan) => plan.removeCopies.map((copy) => copy.id));
      const copyIdsToDelete = [...removedLineCopyIds, ...reducedCopyIds];
      if (copyIdsToDelete.length) {
        await tx.delete(cardCopies).where(and(
          eq(cardCopies.ownerId, ownerId), inArray(cardCopies.id, copyIdsToDelete),
        ));
      }
      if (removedLineIds.length) {
        await tx.delete(recordLines).where(and(
          eq(recordLines.ownerId, ownerId), inArray(recordLines.id, removedLineIds),
        ));
      }

      const usedBulkIndexes = new Set(
        acquiredCopies
          .filter((copy) => copy.bulkLotId === bulkLot?.id && !copyIdsToDelete.includes(copy.id))
          .flatMap((copy) => copy.allocationIndex === null ? [] : [copy.allocationIndex]),
      );
      const takeBulkIndexes = (quantity: number) => {
        if (!bulkLot) return [];
        const available = Array.from({ length: bulkLot.totalQuantity }, (_, index) => index)
          .filter((index) => !usedBulkIndexes.has(index))
          .slice(0, quantity);
        if (available.length !== quantity) conflict("The Bulk Lot total has no unallocated card positions left.");
        for (const index of available) usedBulkIndexes.add(index);
        return available;
      };

      for (const [index, plan] of plans.entries()) {
        const lineId = plan.existingLine?.id ?? id("line");
        const addedBulkIndexes = takeBulkIndexes(plan.addQuantity);
        const addedCopies = Array.from({ length: plan.addQuantity }, (_, offset) => {
          const allocationIndex = bulkLot ? addedBulkIndexes[offset] : null;
          return {
            id: id("copy"), ownerId, printingId: plan.printingId, acquiredRecordId: record.id,
            acquiredLineId: lineId, bulkLotId: bulkLot?.id ?? null, allocationIndex,
            allocationPence: bulkLot && allocationIndex !== null
              ? allocatePenceAt(record.amountPence, bulkLot.totalQuantity, allocationIndex)
              : null,
            status: "available" as const, condition: "Near Mint", createdAt: now, updatedAt: now,
          };
        });
        if (addedCopies.length) await tx.insert(cardCopies).values(addedCopies);
        if (plan.retainedCopies.length) {
          await tx.update(cardCopies).set({ printingId: plan.printingId, updatedAt: now }).where(and(
            eq(cardCopies.ownerId, ownerId),
            inArray(cardCopies.id, plan.retainedCopies.map((copy) => copy.id)),
          ));
        }
        const resultingCopies = [
          ...plan.retainedCopies.map((copy) => ({ ...copy, printingId: plan.printingId })),
          ...addedCopies,
        ];
        if (record.type === "purchase" && !bulkLot) {
          for (const [allocationIndex, copy] of resultingCopies.entries()) {
            await tx.update(cardCopies).set({
              allocationPence: allocatePenceAt(record.amountPence, resultingCopies.length, allocationIndex),
              updatedAt: now,
            }).where(and(eq(cardCopies.id, copy.id), eq(cardCopies.ownerId, ownerId)));
          }
        }
        const allocationPence = bulkLot
          ? resultingCopies.reduce((sum, copy) => sum + (
              copy.allocationIndex === null
                ? 0
                : allocatePenceAt(record.amountPence, bulkLot.totalQuantity, copy.allocationIndex)
            ), 0)
          : record.type === "purchase" ? record.amountPence : null;
        const lineValues = {
          position: bulkLot ? index + 1 : index,
          name: plan.input.name,
          quantity: plan.input.quantity,
          allocationPence,
          detail: `${plan.input.setCode || "Unknown code"} · ${plan.input.edition} · ${plan.input.rarity}${record.type === "pack-opening" ? " · pulled" : ""}`,
          updatedAt: now,
        };
        if (plan.existingLine) {
          await tx.update(recordLines).set(lineValues).where(and(
            eq(recordLines.id, lineId), eq(recordLines.ownerId, ownerId),
          ));
        } else {
          await insertLine(tx, {
            id: lineId, ownerId, recordId: record.id, kind: "card", ...lineValues, createdAt: now,
          });
        }
      }

      if (bulkLot) {
        await tx.update(bulkLots).set({
          itemizedQuantity: requestedCount,
          status: requestedCount >= bulkLot.totalQuantity ? "itemized" : "open",
          updatedAt: now,
        }).where(and(eq(bulkLots.id, bulkLot.id), eq(bulkLots.ownerId, ownerId)));
        await tx.update(recordLines).set({
          detail: `${requestedCount} identified of ${bulkLot.totalQuantity} total cards`, updatedAt: now,
        }).where(and(
          eq(recordLines.id, bulkLot.acquiredLineId), eq(recordLines.ownerId, ownerId),
        ));
      }
      await bumpRecord(tx, ownerId, record.id, record.revision, now);
    });
    return { id: input.recordId };
  }),

  replaceSaleCopies: authenticatedProcedure.input(replaceSaleCopiesSchema).mutation(async ({ ctx, input }) => {
    const ownerId = ctx.collectionOwnerId;
    const now = new Date();
    const uniqueCopyIds = Array.from(new Set(input.copyIds));
    await db.transaction(async (tx) => {
      const record = await lockRecord(tx, ownerId, input.recordId, input.expectedRevision);
      if (record.type !== "sale") conflict("Only a Sale can edit sold Copies.");
      if (record.status === "void") conflict("Restore this Sale before editing its sold Copies.");

      const currentCopies = await tx.select().from(cardCopies).where(and(
        eq(cardCopies.ownerId, ownerId), eq(cardCopies.soldRecordId, record.id),
      )).for("update");
      const selectedCopies = await tx.select().from(cardCopies).where(and(
        eq(cardCopies.ownerId, ownerId), inArray(cardCopies.id, uniqueCopyIds),
      )).for("update");
      const currentIds = new Set(currentCopies.map((copy) => copy.id));
      if (
        selectedCopies.length !== uniqueCopyIds.length
        || selectedCopies.some((copy) => copy.status !== "available" && !currentIds.has(copy.id))
      ) {
        conflict("One or more selected Copies are no longer available.");
      }

      await tx.update(cardCopies).set({
        status: "available", soldRecordId: null, soldLineId: null, updatedAt: now,
      }).where(and(eq(cardCopies.ownerId, ownerId), eq(cardCopies.soldRecordId, record.id)));
      await tx.delete(recordLineCopies).where(and(
        eq(recordLineCopies.ownerId, ownerId), eq(recordLineCopies.recordId, record.id),
      ));
      await tx.delete(recordLines).where(and(
        eq(recordLines.ownerId, ownerId), eq(recordLines.recordId, record.id),
      ));

      const printingIds = Array.from(new Set(selectedCopies.map((copy) => copy.printingId)));
      const printingRows = await tx.select().from(cardPrintings).where(and(
        eq(cardPrintings.ownerId, ownerId), inArray(cardPrintings.id, printingIds),
      ));
      const targetIds = Array.from(new Set(printingRows.map((printing) => printing.targetId)));
      const targetRows = await tx.select().from(cardTargets).where(and(
        eq(cardTargets.ownerId, ownerId), inArray(cardTargets.id, targetIds),
      ));
      const printingById = new Map(printingRows.map((printing) => [printing.id, printing]));
      const targetById = new Map(targetRows.map((target) => [target.id, target]));
      const grouped = new Map<string, typeof selectedCopies>();
      for (const copy of selectedCopies) grouped.set(copy.printingId, [...(grouped.get(copy.printingId) ?? []), copy]);
      const names: string[] = [];
      let position = 0;
      for (const [printingId, group] of grouped) {
        const printing = printingById.get(printingId);
        const target = printing ? targetById.get(printing.targetId) : undefined;
        if (!printing || !target) conflict("A selected Copy has incomplete printing data.");
        names.push(target.name);
        const lineId = id("line");
        await insertLine(tx, {
          id: lineId, ownerId, recordId: record.id, position, kind: "card", name: target.name,
          quantity: group.length, detail: `${printing.setCode} · ${group[0].condition}`,
          createdAt: now, updatedAt: now,
        });
        await tx.update(cardCopies).set({
          status: "sold", soldRecordId: record.id, soldLineId: lineId, updatedAt: now,
        }).where(and(eq(cardCopies.ownerId, ownerId), inArray(cardCopies.id, group.map((copy) => copy.id))));
        await tx.insert(recordLineCopies).values(group.map((copy) => ({
          id: id("line-copy"), ownerId, recordId: record.id, lineId, copyId: copy.id,
          role: "sale" as const, createdAt: now,
        })));
        position += 1;
      }
      if (record.titleGenerated) {
        await tx.update(recordEntries).set({
          title: compactRecordName("", generatedSaleRecordName(names)), updatedAt: now,
        }).where(and(eq(recordEntries.id, record.id), eq(recordEntries.ownerId, ownerId)));
      }
      await bumpRecord(tx, ownerId, record.id, record.revision, now);
    });
    return { id: input.recordId };
  }),

  updateRecordLine: authenticatedProcedure.input(updateRecordLineSchema).mutation(async ({ ctx, input }) => {
    const ownerId = ctx.collectionOwnerId;
    const now = new Date();
    await db.transaction(async (tx) => {
      const record = await lockRecord(tx, ownerId, input.recordId, input.expectedRevision);
      if (record.status === "void") conflict("Restore this Record before editing its items.");
      const [line] = await tx.select().from(recordLines).where(and(
        eq(recordLines.id, input.lineId),
        eq(recordLines.ownerId, ownerId),
        eq(recordLines.recordId, record.id),
      )).for("update").limit(1);
      if (!line) throw new TRPCError({ code: "NOT_FOUND", message: "Record item not found." });
      if (line.kind === "card") conflict("Use the card editor for this item.");

      if (line.kind === "sealed") {
        const units = await tx.select().from(sealedUnits).where(and(
          eq(sealedUnits.ownerId, ownerId), eq(sealedUnits.acquiredLineId, line.id),
        )).for("update");
        if (!units.length) conflict("The sealed item data is incomplete.");
        const identityChanged = input.update.name !== line.name
          || Boolean(input.update.edition && units.some((unit) => unit.edition !== input.update.edition));
        if (units.some((unit) => unit.openedRecordId) && (
          identityChanged || input.update.quantity < units.length
        )) {
          conflict(`“${line.name}” has already been opened, so its identity or quantity cannot be reduced.`);
        }
        if (input.update.quantity < units.length) {
          const removeCount = units.length - input.update.quantity;
          const removable = units.filter((unit) => !unit.openedRecordId).slice(0, removeCount);
          if (removable.length !== removeCount) conflict("Opened units cannot be deleted.");
          await tx.delete(sealedUnits).where(and(
            eq(sealedUnits.ownerId, ownerId), inArray(sealedUnits.id, removable.map((unit) => unit.id)),
          ));
        } else if (input.update.quantity > units.length) {
          const base = units[0];
          await tx.insert(sealedUnits).values(Array.from(
            { length: input.update.quantity - units.length },
            () => ({
              id: id("sealed"), ownerId, acquiredRecordId: record.id, acquiredLineId: line.id,
              name: input.update.name, edition: input.update.edition ?? base.edition,
              tcgplayerUrl: base.tcgplayerUrl, canonicalTcgplayerUrl: base.canonicalTcgplayerUrl,
              imageUrl: base.imageUrl, status: "sealed" as const, createdAt: now, updatedAt: now,
            }),
          ));
        }
        await tx.update(sealedUnits).set({
          name: input.update.name,
          edition: input.update.edition,
          updatedAt: now,
        }).where(and(
          eq(sealedUnits.ownerId, ownerId), eq(sealedUnits.acquiredLineId, line.id),
        ));
        await tx.update(recordLines).set({
          name: input.update.name,
          quantity: input.update.quantity,
          detail: input.update.edition ?? line.detail,
          updatedAt: now,
        }).where(and(eq(recordLines.id, line.id), eq(recordLines.ownerId, ownerId)));
      } else if (line.kind === "supply") {
        const [supply] = await tx.select().from(supplyItems).where(and(
          eq(supplyItems.ownerId, ownerId), eq(supplyItems.acquiredLineId, line.id),
        )).for("update").limit(1);
        if (!supply) conflict("The supply item data is incomplete.");
        const category = input.update.category ?? supply.category;
        await tx.update(supplyItems).set({
          name: input.update.name, category, quantity: input.update.quantity, updatedAt: now,
        }).where(and(eq(supplyItems.id, supply.id), eq(supplyItems.ownerId, ownerId)));
        await tx.update(recordLines).set({
          name: input.update.name,
          quantity: input.update.quantity,
          detail: category === "other"
            ? "Other supply or extra"
            : `${category.charAt(0).toUpperCase()}${category.slice(1)}`,
          updatedAt: now,
        }).where(and(eq(recordLines.id, line.id), eq(recordLines.ownerId, ownerId)));
      } else {
        const [lot] = await tx.select().from(bulkLots).where(and(
          eq(bulkLots.ownerId, ownerId), eq(bulkLots.acquiredLineId, line.id),
        )).for("update").limit(1);
        if (!lot) conflict("The Bulk Lot data is incomplete.");
        const nextTotal = input.update.totalQuantity ?? lot.totalQuantity;
        if (nextTotal < lot.itemizedQuantity) {
          conflict(`Total cards cannot be less than the ${lot.itemizedQuantity} identified Copies.`);
        }
        const lotCopies = await tx.select().from(cardCopies).where(and(
          eq(cardCopies.ownerId, ownerId), eq(cardCopies.bulkLotId, lot.id),
        )).for("update");
        if (nextTotal !== lot.totalQuantity && lotCopies.length) {
          const links = await tx.select().from(recordLineCopies).where(and(
            eq(recordLineCopies.ownerId, ownerId),
            eq(recordLineCopies.role, "sale"),
            inArray(recordLineCopies.copyId, lotCopies.map((copy) => copy.id)),
          ));
          if (links.length) {
            conflict("The lot total cannot change after one of its Copies has Sale history.");
          }
        }
        for (const copy of lotCopies) {
          if (copy.allocationIndex === null) continue;
          await tx.update(cardCopies).set({
            allocationPence: allocatePenceAt(record.amountPence, nextTotal, copy.allocationIndex),
            updatedAt: now,
          }).where(and(eq(cardCopies.id, copy.id), eq(cardCopies.ownerId, ownerId)));
        }
        const cardLines = await tx.select().from(recordLines).where(and(
          eq(recordLines.ownerId, ownerId),
          eq(recordLines.recordId, record.id),
          eq(recordLines.kind, "card"),
        ));
        for (const cardLine of cardLines) {
          const lineCopies = lotCopies.filter((copy) => copy.acquiredLineId === cardLine.id);
          await tx.update(recordLines).set({
            allocationPence: lineCopies.reduce((sum, copy) => (
              sum + (copy.allocationIndex === null
                ? 0
                : allocatePenceAt(record.amountPence, nextTotal, copy.allocationIndex))
            ), 0),
            updatedAt: now,
          }).where(and(eq(recordLines.id, cardLine.id), eq(recordLines.ownerId, ownerId)));
        }
        await tx.update(bulkLots).set({
          name: input.update.name,
          totalQuantity: nextTotal,
          status: lot.itemizedQuantity >= nextTotal ? "itemized" : "open",
          updatedAt: now,
        }).where(and(eq(bulkLots.id, lot.id), eq(bulkLots.ownerId, ownerId)));
        await tx.update(recordLines).set({
          name: input.update.name,
          quantity: 1,
          detail: `${lot.itemizedQuantity} identified of ${nextTotal} total cards`,
          updatedAt: now,
        }).where(and(eq(recordLines.id, line.id), eq(recordLines.ownerId, ownerId)));
      }
      await bumpRecord(tx, ownerId, record.id, record.revision, now);
    });
    return { id: input.recordId };
  }),

  changeStatus: authenticatedProcedure.input(recordMutationIdentitySchema.extend({
    status: z.enum(["active", "void"]),
  })).mutation(async ({ ctx, input }) => {
    const ownerId = ctx.collectionOwnerId;
    const now = new Date();
    await db.transaction(async (tx) => {
      const record = await lockRecord(tx, ownerId, input.recordId, input.expectedRevision);
      if (record.status === input.status) conflict(`Record is already ${input.status}.`);

      if (record.type === "sale") {
        const links = await tx.select().from(recordLineCopies).where(and(
          eq(recordLineCopies.ownerId, ownerId), eq(recordLineCopies.recordId, record.id), eq(recordLineCopies.role, "sale"),
        ));
        const copyIds = links.map((link) => link.copyId);
        if (input.status === "void") {
          await tx.update(cardCopies).set({
            status: "available", soldRecordId: null, soldLineId: null, updatedAt: now,
          }).where(and(
            eq(cardCopies.ownerId, ownerId), eq(cardCopies.soldRecordId, record.id),
          ));
        } else if (copyIds.length) {
          const copies = await tx.select().from(cardCopies).where(and(
            eq(cardCopies.ownerId, ownerId), inArray(cardCopies.id, copyIds),
          )).for("update");
          if (copies.length !== copyIds.length || copies.some((copy) => copy.status !== "available" || copy.soldRecordId)) {
            conflict("A Copy from this Sale has since been used elsewhere, so the Sale cannot be restored.");
          }
          const lineByCopy = new Map(links.map((link) => [link.copyId, link.lineId]));
          for (const copy of copies) {
            await tx.update(cardCopies).set({
              status: "sold", soldRecordId: record.id, soldLineId: lineByCopy.get(copy.id), updatedAt: now,
            }).where(and(eq(cardCopies.id, copy.id), eq(cardCopies.ownerId, ownerId)));
          }
        }
      } else if (record.type === "pack-opening") {
        const openingCopies = await tx.select().from(cardCopies).where(and(
          eq(cardCopies.ownerId, ownerId), eq(cardCopies.acquiredRecordId, record.id),
        )).for("update");
        const openedUnits = await tx.select().from(sealedUnits).where(and(
          eq(sealedUnits.ownerId, ownerId), eq(sealedUnits.openedRecordId, record.id),
        )).for("update");
        if (input.status === "void" && openingCopies.some((copy) => copy.soldRecordId)) {
          conflict("Void the dependent Sale before voiding this Pack Opening.");
        }
        if (input.status === "active" && (
          !openedUnits.length || openedUnits.some((unit) => unit.status !== "sealed")
        )) {
          conflict("Restore the sealed product's acquisition before restoring this Pack Opening.");
        }
        await tx.update(cardCopies).set({
          status: input.status === "void" ? "void" : "available", updatedAt: now,
        }).where(and(eq(cardCopies.ownerId, ownerId), eq(cardCopies.acquiredRecordId, record.id)));
        await tx.update(sealedUnits).set({
          status: input.status === "void" ? "sealed" : "opened", updatedAt: now,
        }).where(and(eq(sealedUnits.ownerId, ownerId), eq(sealedUnits.openedRecordId, record.id)));
      } else {
        const acquiredCopies = await tx.select().from(cardCopies).where(and(
          eq(cardCopies.ownerId, ownerId), eq(cardCopies.acquiredRecordId, record.id),
        )).for("update");
        const acquiredSealed = await tx.select().from(sealedUnits).where(and(
          eq(sealedUnits.ownerId, ownerId), eq(sealedUnits.acquiredRecordId, record.id),
        )).for("update");
        const openedRecordIds = Array.from(new Set(
          acquiredSealed.flatMap((unit) => unit.openedRecordId ? [unit.openedRecordId] : []),
        ));
        const activeOpenings = openedRecordIds.length
          ? await tx.select({ id: recordEntries.id }).from(recordEntries).where(and(
              eq(recordEntries.ownerId, ownerId),
              eq(recordEntries.status, "active"),
              inArray(recordEntries.id, openedRecordIds),
            ))
          : [];
        if (input.status === "void" && (
          acquiredCopies.some((copy) => copy.soldRecordId)
          || activeOpenings.length > 0
        )) {
          conflict("Void the dependent Sale or Pack Opening before voiding this acquisition.");
        }
        await tx.update(cardCopies).set({
          status: input.status === "void" ? "void" : "available", updatedAt: now,
        }).where(and(eq(cardCopies.ownerId, ownerId), eq(cardCopies.acquiredRecordId, record.id)));
        await tx.update(sealedUnits).set({
          status: input.status === "void" ? "void" : "sealed", updatedAt: now,
        }).where(and(eq(sealedUnits.ownerId, ownerId), eq(sealedUnits.acquiredRecordId, record.id)));
        await tx.update(supplyItems).set({
          status: input.status === "void" ? "void" : "held", updatedAt: now,
        }).where(and(eq(supplyItems.ownerId, ownerId), eq(supplyItems.acquiredRecordId, record.id)));
        const [lot] = await tx.select().from(bulkLots).where(and(
          eq(bulkLots.ownerId, ownerId), eq(bulkLots.acquiredRecordId, record.id),
        )).limit(1);
        if (lot) {
          await tx.update(bulkLots).set({
            status: input.status === "void"
              ? "void"
              : lot.itemizedQuantity >= lot.totalQuantity ? "itemized" : "open",
            updatedAt: now,
          }).where(and(eq(bulkLots.id, lot.id), eq(bulkLots.ownerId, ownerId)));
        }
      }
      await tx.update(recordEntries).set({
        status: input.status, revision: record.revision + 1, updatedAt: now,
      }).where(and(eq(recordEntries.id, record.id), eq(recordEntries.ownerId, ownerId)));
    });
    return { id: input.recordId };
  }),
});

import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, isNotNull, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  cardCopies,
  cardPrintings,
  cardTargets,
  targetWheelEntries,
} from "@/db/schema";
import { authenticatedProcedure, router } from "@/server/trpc";

const chaseWeights: Record<number, number> = { 1: 1, 2: 1.7, 3: 2.7, 4: 4, 5: 6 };
const chaseFilterSchema = z.union([z.literal("unset"), z.number().int().min(1).max(5)]);

function marketValue(target: typeof cardTargets.$inferSelect) {
  const pence = target.marketPricePence ?? target.estimatedPricePence;
  return pence === null ? null : pence / 100;
}

function wheelWeight(target: typeof cardTargets.$inferSelect) {
  const chaseWeight = chaseWeights[target.chaseLevel ?? 2] ?? chaseWeights[2];
  const price = marketValue(target);
  const priceFactor = price ? 1 / (1 + Math.sqrt(price) / 35) : 1;
  return Number((chaseWeight * priceFactor).toFixed(3));
}

function matchesChaseFilter(
  target: typeof cardTargets.$inferSelect,
  chaseLevels: z.infer<typeof chaseFilterSchema>[],
) {
  if (!chaseLevels.length) return true;
  return target.chaseLevel
    ? chaseLevels.includes(target.chaseLevel)
    : chaseLevels.includes("unset");
}

function matchesPriceFilter(
  target: typeof cardTargets.$inferSelect,
  minPrice?: number,
  maxPrice?: number,
) {
  if (minPrice === undefined && maxPrice === undefined) return true;
  const price = marketValue(target);
  return price !== null
    && (minPrice === undefined || price >= minPrice)
    && (maxPrice === undefined || price <= maxPrice);
}

function serializeTarget(target: typeof cardTargets.$inferSelect) {
  return {
    chaseLevel: target.chaseLevel,
    ebaySearchUrl: target.ebaySearchUrl,
    id: target.id,
    imageUrl: target.imageUrl,
    name: target.name,
    notes: target.notes,
    rarity: target.rarity,
    url: target.tcgplayerUrl,
  };
}

function serializeWheelItem({
  target,
  entry,
}: {
  target: typeof cardTargets.$inferSelect;
  entry: typeof targetWheelEntries.$inferSelect;
}) {
  const { ownerId, targetId, ...serializedEntry } = entry;
  void ownerId;
  return {
    card: serializeTarget(target),
    entry: {
      ...serializedEntry,
      cardId: targetId,
      createdAt: entry.createdAt.toISOString(),
      selectedAt: entry.selectedAt?.toISOString() ?? null,
      updatedAt: entry.updatedAt.toISOString(),
    },
    priceValue: marketValue(target),
    weight: wheelWeight(target),
  };
}

async function wishlistTargetIds(ownerId: string) {
  const [targets, printings, copies] = await Promise.all([
    db.select().from(cardTargets).where(eq(cardTargets.ownerId, ownerId)),
    db.select().from(cardPrintings).where(eq(cardPrintings.ownerId, ownerId)),
    db.select().from(cardCopies).where(and(
      eq(cardCopies.ownerId, ownerId), eq(cardCopies.status, "available"),
    )),
  ]);
  const targetIdByPrintingId = new Map(printings.map((printing) => [printing.id, printing.targetId]));
  const ownedCount = new Map<string, number>();
  for (const copy of copies) {
    const targetId = targetIdByPrintingId.get(copy.printingId);
    if (targetId) ownedCount.set(targetId, (ownedCount.get(targetId) ?? 0) + 1);
  }
  return targets
    .filter((target) => (ownedCount.get(target.id) ?? 0) < target.desiredQuantity)
    .map((target) => target.id);
}

async function syncWishlistEntries(ownerId: string) {
  const wishlistIds = await wishlistTargetIds(ownerId);
  if (!wishlistIds.length) return;
  const targets = await db.select().from(cardTargets).where(and(
    eq(cardTargets.ownerId, ownerId), inArray(cardTargets.id, wishlistIds),
  )).orderBy(asc(cardTargets.name));
  const existing = await db.select().from(targetWheelEntries).where(
    eq(targetWheelEntries.ownerId, ownerId),
  );
  const existingIds = new Set(existing.map((entry) => entry.targetId));
  const nextSortOrder = existing.reduce((highest, entry) => Math.max(highest, entry.sortOrder), -1) + 1;
  const missing = targets.filter((target) => !existingIds.has(target.id));
  if (!missing.length) return;
  const now = new Date();
  await db.insert(targetWheelEntries).values(missing.map((target, index) => ({
    ownerId, targetId: target.id, sortOrder: nextSortOrder + index, createdAt: now, updatedAt: now,
  })));
}

async function wheelRows(ownerId: string) {
  const wishlistIds = new Set(await wishlistTargetIds(ownerId));
  const rows = await db.select({ target: cardTargets, entry: targetWheelEntries })
    .from(targetWheelEntries)
    .innerJoin(cardTargets, eq(targetWheelEntries.targetId, cardTargets.id))
    .where(and(
      eq(cardTargets.ownerId, ownerId), eq(targetWheelEntries.ownerId, ownerId),
    ))
    .orderBy(asc(targetWheelEntries.sortOrder));
  return rows.filter(({ target }) => wishlistIds.has(target.id));
}

export const wheelRouter = router({
  state: authenticatedProcedure.query(async ({ ctx }) => {
    await syncWishlistEntries(ctx.collectionOwnerId);
    const rows = await wheelRows(ctx.collectionOwnerId);
    return {
      active: rows.filter(({ entry }) => !entry.selectedAt).map(serializeWheelItem),
      history: rows.filter(({ entry }) => entry.selectedAt)
        .sort((left, right) => (left.entry.selectedOrder ?? 0) - (right.entry.selectedOrder ?? 0))
        .map(serializeWheelItem),
    };
  }),

  spin: authenticatedProcedure.input(z.object({
    chaseLevels: z.array(chaseFilterSchema).default([]),
    maxPrice: z.number().min(0).optional(),
    minPrice: z.number().min(0).optional(),
  }).optional()).mutation(async ({ ctx, input }) => {
    await syncWishlistEntries(ctx.collectionOwnerId);
    const activeRows = (await wheelRows(ctx.collectionOwnerId)).filter(({ target, entry }) => (
      !entry.selectedAt
      && matchesChaseFilter(target, input?.chaseLevels ?? [])
      && matchesPriceFilter(target, input?.minPrice, input?.maxPrice)
    ));
    if (!activeRows.length) {
      const hasFilters = Boolean(input?.chaseLevels?.length)
        || input?.minPrice !== undefined || input?.maxPrice !== undefined;
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: hasFilters ? "No cards match the current wheel filters." : "No wishlist cards left on the wheel.",
      });
    }
    const weighted = activeRows.map((row) => ({ ...row, weight: wheelWeight(row.target) }));
    let draw = Math.random() * weighted.reduce((sum, row) => sum + row.weight, 0);
    const selected = weighted.find((row) => {
      draw -= row.weight;
      return draw <= 0;
    }) ?? weighted[weighted.length - 1];
    const selectedRows = await db.select().from(targetWheelEntries).where(and(
      eq(targetWheelEntries.ownerId, ctx.collectionOwnerId),
      isNotNull(targetWheelEntries.selectedAt),
    )).orderBy(desc(targetWheelEntries.selectedOrder));
    const [updated] = await db.update(targetWheelEntries).set({
      selectedAt: new Date(), selectedOrder: (selectedRows[0]?.selectedOrder ?? 0) + 1,
      updatedAt: new Date(),
    }).where(and(
      eq(targetWheelEntries.id, selected.entry.id),
      eq(targetWheelEntries.ownerId, ctx.collectionOwnerId),
    )).returning();
    return { selected: serializeWheelItem({ target: selected.target, entry: updated }) };
  }),

  reset: authenticatedProcedure.mutation(async ({ ctx }) => {
    await syncWishlistEntries(ctx.collectionOwnerId);
    const wishlistIds = await wishlistTargetIds(ctx.collectionOwnerId);
    if (!wishlistIds.length) return { ok: true, resetCount: 0 };
    const resettable = await db.select({ id: targetWheelEntries.id }).from(targetWheelEntries).where(and(
      eq(targetWheelEntries.ownerId, ctx.collectionOwnerId),
      inArray(targetWheelEntries.targetId, wishlistIds),
      or(isNotNull(targetWheelEntries.selectedAt), isNotNull(targetWheelEntries.selectedOrder)),
    ));
    if (!resettable.length) return { ok: true, resetCount: 0 };
    const updated = await db.update(targetWheelEntries).set({
      selectedAt: null, selectedOrder: null, updatedAt: new Date(),
    }).where(and(
      eq(targetWheelEntries.ownerId, ctx.collectionOwnerId),
      inArray(targetWheelEntries.id, resettable.map((entry) => entry.id)),
    )).returning({ id: targetWheelEntries.id });
    return { ok: true, resetCount: updated.length };
  }),
});

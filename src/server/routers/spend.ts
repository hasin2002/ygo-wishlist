import { TRPCError } from "@trpc/server";
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  cardCopies,
  cardPrintings,
  cardTargets,
  recordEntries,
  targetMonthlyFavorites,
} from "@/db/schema";
import { authenticatedProcedure, router } from "@/server/trpc";

function currentMonthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric" })
    .format(new Date(year, month - 1, 1));
}

export const spendRouter = router({
  currentMonth: authenticatedProcedure.query(async ({ ctx }) => {
    const month = currentMonthKey();
    const rows = await db.select().from(recordEntries).where(and(
      eq(recordEntries.ownerId, ctx.collectionOwnerId),
      eq(recordEntries.status, "active"),
      eq(recordEntries.amountKnown, true),
      gte(recordEntries.occurredOn, `${month}-01`),
      lte(recordEntries.occurredOn, `${month}-31`),
    ));
    const acquisitions = rows.filter((record) => (
      record.type === "purchase" || record.type === "imported-acquisition"
    ));
    return {
      count: acquisitions.length,
      label: monthLabel(month),
      month,
      total: acquisitions.reduce((sum, record) => sum + record.amountPence, 0) / 100,
    };
  }),

  monthlyFavourites: authenticatedProcedure.query(async ({ ctx }) => {
    const rows = await db.select().from(targetMonthlyFavorites).where(
      eq(targetMonthlyFavorites.ownerId, ctx.collectionOwnerId),
    );
    return rows.map((row) => ({
      cardId: row.targetId,
      createdAt: row.createdAt.toISOString(),
      id: row.id,
      month: row.month,
      updatedAt: row.updatedAt.toISOString(),
    }));
  }),

  setMonthlyFavourite: authenticatedProcedure.input(z.object({
    cardId: z.string().min(1).nullable(),
    month: z.string().regex(/^\d{4}-\d{2}$/),
  })).mutation(async ({ ctx, input }) => {
    if (input.cardId === null) {
      await db.delete(targetMonthlyFavorites).where(and(
        eq(targetMonthlyFavorites.month, input.month),
        eq(targetMonthlyFavorites.ownerId, ctx.collectionOwnerId),
      ));
      return { ok: true };
    }
    const [target] = await db.select().from(cardTargets).where(and(
      eq(cardTargets.id, input.cardId), eq(cardTargets.ownerId, ctx.collectionOwnerId),
    )).limit(1);
    if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "Wishlist Target not found." });
    const printings = await db.select({ id: cardPrintings.id }).from(cardPrintings).where(and(
      eq(cardPrintings.ownerId, ctx.collectionOwnerId), eq(cardPrintings.targetId, target.id),
    ));
    const copies = printings.length ? await db.select().from(cardCopies).where(and(
      eq(cardCopies.ownerId, ctx.collectionOwnerId),
      inArray(cardCopies.printingId, printings.map((printing) => printing.id)),
    )) : [];
    const acquisitionIds = Array.from(new Set(copies.map((copy) => copy.acquiredRecordId)));
    const acquisitions = acquisitionIds.length ? await db.select().from(recordEntries).where(and(
      eq(recordEntries.ownerId, ctx.collectionOwnerId),
      inArray(recordEntries.id, acquisitionIds),
      gte(recordEntries.occurredOn, `${input.month}-01`),
      lte(recordEntries.occurredOn, `${input.month}-31`),
    )) : [];
    if (!acquisitions.length) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Favourite buys must have an acquisition Record in that month.",
      });
    }
    const now = new Date();
    const [existing] = await db.select().from(targetMonthlyFavorites).where(and(
      eq(targetMonthlyFavorites.month, input.month),
      eq(targetMonthlyFavorites.ownerId, ctx.collectionOwnerId),
    )).limit(1);
    if (existing) {
      await db.update(targetMonthlyFavorites).set({ targetId: target.id, updatedAt: now }).where(and(
        eq(targetMonthlyFavorites.id, existing.id),
        eq(targetMonthlyFavorites.ownerId, ctx.collectionOwnerId),
      ));
    } else {
      await db.insert(targetMonthlyFavorites).values({
        ownerId: ctx.collectionOwnerId, month: input.month, targetId: target.id,
        createdAt: now, updatedAt: now,
      });
    }
    return { ok: true };
  }),
});

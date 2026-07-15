import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { db } from "@/db";
import { cards, monthlyFavorites } from "@/db/schema";
import { authenticatedProcedure, router } from "@/server/trpc";

function currentMonthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);

  return new Intl.DateTimeFormat("en-GB", {
    month: "short",
    year: "numeric",
  }).format(new Date(year, month - 1, 1));
}

function priceValue(priceText: string | null) {
  const match = priceText?.match(/\d+(?:[,.]\d{1,2})?/);
  return match ? Number(match[0].replace(",", "")) : null;
}

export const spendRouter = router({
  currentMonth: authenticatedProcedure.query(async ({ ctx }) => {
    const month = currentMonthKey();
    const rows = await db
      .select()
      .from(cards)
      .where(
        and(
          eq(cards.ownerId, ctx.collectionOwnerId),
          eq(cards.status, "owned"),
          eq(cards.purchaseMonth, month),
        ),
      );
    const spendRows = rows
      .map((card) => priceValue(card.paidPriceText))
      .filter((value): value is number => value !== null);

    return {
      count: spendRows.length,
      label: monthLabel(month),
      month,
      total: spendRows.reduce((sum, value) => sum + value, 0),
    };
  }),

  monthlyFavourites: authenticatedProcedure.query(async ({ ctx }) => {
    const rows = await db
      .select()
      .from(monthlyFavorites)
      .where(eq(monthlyFavorites.ownerId, ctx.collectionOwnerId));

    return rows.map((row) => ({
      cardId: row.cardId,
      createdAt: row.createdAt.toISOString(),
      id: row.id,
      month: row.month,
      updatedAt: row.updatedAt.toISOString(),
    }));
  }),

  setMonthlyFavourite: authenticatedProcedure
    .input(
      z.object({
        cardId: z.number().int().positive().nullable(),
        month: z.string().regex(/^\d{4}-\d{2}$/),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.cardId === null) {
        await db
          .delete(monthlyFavorites)
          .where(
            and(
              eq(monthlyFavorites.month, input.month),
              eq(monthlyFavorites.ownerId, ctx.collectionOwnerId),
            ),
          );
        return { ok: true };
      }

      const [card] = await db
        .select()
        .from(cards)
        .where(and(eq(cards.id, input.cardId), eq(cards.ownerId, ctx.collectionOwnerId)));

      if (!card) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Card not found." });
      }

      if (card.status !== "owned" || card.purchaseMonth !== input.month) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Favourite buys must be owned cards bought in that month.",
        });
      }

      const now = new Date();
      const [existing] = await db
        .select()
        .from(monthlyFavorites)
        .where(
          and(
            eq(monthlyFavorites.month, input.month),
            eq(monthlyFavorites.ownerId, ctx.collectionOwnerId),
          ),
        );

      if (existing) {
        await db
          .update(monthlyFavorites)
          .set({ cardId: input.cardId, updatedAt: now })
          .where(
            and(
              eq(monthlyFavorites.month, input.month),
              eq(monthlyFavorites.ownerId, ctx.collectionOwnerId),
            ),
          );
      } else {
        await db
          .insert(monthlyFavorites)
          .values({
            cardId: input.cardId,
            createdAt: now,
            month: input.month,
            ownerId: ctx.collectionOwnerId,
            updatedAt: now,
          });
      }

      return { ok: true };
    }),
});

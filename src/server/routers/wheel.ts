import { TRPCError } from "@trpc/server";
import { asc, desc, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { cards, wheelEntries } from "@/db/schema";
import { publicProcedure, router } from "@/server/trpc";

const chaseWeights: Record<number, number> = {
  1: 1,
  2: 1.7,
  3: 2.7,
  4: 4,
  5: 6,
};
const chaseFilterSchema = z.union([
  z.literal("unset"),
  z.number().int().min(1).max(5),
]);

function priceValue(priceText: string | null) {
  const match = priceText?.match(/\d+(?:[,.]\d{1,2})?/);
  return match ? Number(match[0].replace(",", "")) : null;
}

function marketValue(card: typeof cards.$inferSelect) {
  return priceValue(card.marketPriceText) ?? priceValue(card.priceText);
}

function wheelWeight(card: typeof cards.$inferSelect) {
  const chaseWeight = chaseWeights[card.chaseLevel ?? 2] ?? chaseWeights[2];
  const price = marketValue(card);
  const priceFactor = price ? 1 / (1 + Math.sqrt(price) / 35) : 1;

  return Number((chaseWeight * priceFactor).toFixed(3));
}

function matchesChaseFilter(
  card: typeof cards.$inferSelect,
  chaseLevels: z.infer<typeof chaseFilterSchema>[],
) {
  if (!chaseLevels.length) {
    return true;
  }

  if (!card.chaseLevel) {
    return chaseLevels.includes("unset");
  }

  return chaseLevels.includes(card.chaseLevel);
}

function matchesPriceFilter(
  card: typeof cards.$inferSelect,
  minPrice?: number,
  maxPrice?: number,
) {
  if (minPrice === undefined && maxPrice === undefined) {
    return true;
  }

  const price = marketValue(card);

  if (price === null) {
    return false;
  }

  if (minPrice !== undefined && price < minPrice) {
    return false;
  }

  if (maxPrice !== undefined && price > maxPrice) {
    return false;
  }

  return true;
}

function serializeCard(card: typeof cards.$inferSelect) {
  return {
    chaseLevel: card.chaseLevel,
    ebaySearchUrl: card.ebaySearchUrl,
    id: card.id,
    imageUrl: card.imageUrl,
    name: card.name,
    notes: card.notes,
    rarity: card.rarity,
    url: card.url,
  };
}

function serializeWheelItem({
  card,
  entry,
}: {
  card: typeof cards.$inferSelect;
  entry: typeof wheelEntries.$inferSelect;
}) {
  return {
    card: serializeCard(card),
    entry: {
      ...entry,
      createdAt: entry.createdAt.toISOString(),
      selectedAt: entry.selectedAt?.toISOString() ?? null,
      updatedAt: entry.updatedAt.toISOString(),
    },
    priceValue: marketValue(card),
    weight: wheelWeight(card),
  };
}

async function syncWishlistEntries() {
  const wishlistCards = await db
    .select()
    .from(cards)
    .where(eq(cards.status, "wishlist"))
    .orderBy(asc(cards.name));
  const existingEntries = await db.select().from(wheelEntries);
  const existingIds = new Set(existingEntries.map((entry) => entry.cardId));
  let nextSortOrder =
    existingEntries.reduce(
      (highest, entry) => Math.max(highest, entry.sortOrder),
      -1,
    ) + 1;

  const missingCards = wishlistCards.filter((card) => !existingIds.has(card.id));

  if (!missingCards.length) {
    return;
  }

  const now = new Date();

  await db.transaction(async (tx) => {
    for (const card of missingCards) {
      await tx
        .insert(wheelEntries)
        .values({
          cardId: card.id,
          sortOrder: nextSortOrder,
          createdAt: now,
          updatedAt: now,
        });
      nextSortOrder += 1;
    }
  });
}

function wheelRows() {
  return db
    .select({ card: cards, entry: wheelEntries })
    .from(wheelEntries)
    .innerJoin(cards, eq(wheelEntries.cardId, cards.id))
    .where(eq(cards.status, "wishlist"))
    .orderBy(asc(wheelEntries.sortOrder));
}

export const wheelRouter = router({
  state: publicProcedure.query(async () => {
    await syncWishlistEntries();

    const rows = await wheelRows();

    return {
      active: rows
        .filter(({ entry }) => !entry.selectedAt)
        .map(serializeWheelItem),
      history: rows
        .filter(({ entry }) => entry.selectedAt)
        .sort(
          (a, b) => (a.entry.selectedOrder ?? 0) - (b.entry.selectedOrder ?? 0),
        )
        .map(serializeWheelItem),
    };
  }),

  spin: publicProcedure
    .input(
      z
        .object({
          chaseLevels: z.array(chaseFilterSchema).default([]),
          maxPrice: z.number().min(0).optional(),
          minPrice: z.number().min(0).optional(),
        })
        .optional(),
    )
    .mutation(async ({ input }) => {
      await syncWishlistEntries();

      const activeRows = (
        await db
          .select({ card: cards, entry: wheelEntries })
          .from(wheelEntries)
          .innerJoin(cards, eq(wheelEntries.cardId, cards.id))
          .where(eq(cards.status, "wishlist"))
          .orderBy(asc(wheelEntries.sortOrder))
      ).filter(
        ({ card, entry }) =>
          !entry.selectedAt &&
          matchesChaseFilter(card, input?.chaseLevels ?? []) &&
          matchesPriceFilter(card, input?.minPrice, input?.maxPrice),
      );

      if (!activeRows.length) {
        const hasFilters =
          Boolean(input?.chaseLevels?.length) ||
          input?.minPrice !== undefined ||
          input?.maxPrice !== undefined;

        throw new TRPCError({
          code: "BAD_REQUEST",
          message: hasFilters
            ? "No cards match the current wheel filters."
            : "No wishlist cards left on the wheel.",
        });
      }

      const weightedRows = activeRows.map((row) => ({
        ...row,
        weight: wheelWeight(row.card),
      }));
      const totalWeight = weightedRows.reduce(
        (total, row) => total + row.weight,
        0,
      );
      let target = Math.random() * totalWeight;
      const selected =
        weightedRows.find((row) => {
          target -= row.weight;
          return target <= 0;
        }) ?? weightedRows[weightedRows.length - 1];

      const selectedRows = await db
        .select()
        .from(wheelEntries)
        .where(isNotNull(wheelEntries.selectedAt))
        .orderBy(desc(wheelEntries.selectedOrder));
      const selectedOrder = (selectedRows[0]?.selectedOrder ?? 0) + 1;

      const [updated] = await db
        .update(wheelEntries)
        .set({
          selectedAt: new Date(),
          selectedOrder,
          updatedAt: new Date(),
        })
        .where(eq(wheelEntries.id, selected.entry.id))
        .returning();

      return {
        selected: serializeWheelItem({ card: selected.card, entry: updated }),
      };
    }),

  reset: publicProcedure.mutation(async () => {
    await syncWishlistEntries();

    const wishlistRows = await db
      .select({ entry: wheelEntries })
      .from(wheelEntries)
      .innerJoin(cards, eq(wheelEntries.cardId, cards.id))
      .where(eq(cards.status, "wishlist"));
    const now = new Date();

    await db.transaction(async (tx) => {
      for (const { entry } of wishlistRows) {
        await tx
          .update(wheelEntries)
          .set({
            selectedAt: null,
            selectedOrder: null,
            updatedAt: now,
          })
          .where(eq(wheelEntries.id, entry.id));
      }
    });

    return { ok: true };
  }),
});

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
    ...card,
    createdAt: card.createdAt.toISOString(),
    updatedAt: card.updatedAt.toISOString(),
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

function syncWishlistEntries() {
  const wishlistCards = db
    .select()
    .from(cards)
    .where(eq(cards.status, "wishlist"))
    .orderBy(asc(cards.name))
    .all();
  const existingEntries = db.select().from(wheelEntries).all();
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

  db.transaction((tx) => {
    for (const card of missingCards) {
      tx.insert(wheelEntries)
        .values({
          cardId: card.id,
          sortOrder: nextSortOrder,
          createdAt: now,
          updatedAt: now,
        })
        .run();
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
    .orderBy(asc(wheelEntries.sortOrder))
    .all();
}

export const wheelRouter = router({
  state: publicProcedure.query(() => {
    syncWishlistEntries();

    const rows = wheelRows();

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
    .mutation(({ input }) => {
    syncWishlistEntries();

    const activeRows = db
      .select({ card: cards, entry: wheelEntries })
      .from(wheelEntries)
      .innerJoin(cards, eq(wheelEntries.cardId, cards.id))
      .where(eq(cards.status, "wishlist"))
      .orderBy(asc(wheelEntries.sortOrder))
      .all()
      .filter(
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
    const totalWeight = weightedRows.reduce((total, row) => total + row.weight, 0);
    let target = Math.random() * totalWeight;
    const selected =
      weightedRows.find((row) => {
        target -= row.weight;
        return target <= 0;
      }) ?? weightedRows[weightedRows.length - 1];

    const selectedRows = db
      .select()
      .from(wheelEntries)
      .where(isNotNull(wheelEntries.selectedAt))
      .orderBy(desc(wheelEntries.selectedOrder))
      .all();
    const selectedOrder = (selectedRows[0]?.selectedOrder ?? 0) + 1;

    const updated = db
      .update(wheelEntries)
      .set({
        selectedAt: new Date(),
        selectedOrder,
        updatedAt: new Date(),
      })
      .where(eq(wheelEntries.id, selected.entry.id))
      .returning()
      .get();

    return {
      selected: serializeWheelItem({ card: selected.card, entry: updated }),
    };
  }),

  reset: publicProcedure.mutation(() => {
    syncWishlistEntries();

    const wishlistRows = db
      .select({ entry: wheelEntries })
      .from(wheelEntries)
      .innerJoin(cards, eq(wheelEntries.cardId, cards.id))
      .where(eq(cards.status, "wishlist"))
      .all();
    const now = new Date();

    db.transaction((tx) => {
      for (const { entry } of wishlistRows) {
        tx.update(wheelEntries)
          .set({
            selectedAt: null,
            selectedOrder: null,
            updatedAt: now,
          })
          .where(eq(wheelEntries.id, entry.id))
          .run();
      }
    });

    return { ok: true };
  }),
});

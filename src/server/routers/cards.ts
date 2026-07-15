import { TRPCError } from "@trpc/server";
import { and, desc, eq, isNull, like, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { cards } from "@/db/schema";
import { refreshEbayPricing } from "@/server/ebay-pricing";
import {
  fetchLinkMetadata,
  normalizeUrl,
  ygoCardDetailsByName,
} from "@/server/metadata";
import { publicProcedure, router } from "@/server/trpc";

const statusSchema = z.enum(["wishlist", "owned"]);
const statusFilterSchema = z.enum(["all", "wishlist", "owned"]);
const chaseLevelSchema = z.number().int().min(1).max(5).nullable().optional();
const trackerSortSchema = z.enum([
  "updated",
  "name",
  "price-high",
  "price-low",
  "chase-next",
  "chase-relaxed",
  "rarity",
]);
const trackerPriceSignalSchema = z.enum(["estimated", "unpriced", "paid"]);
const trackerChaseFilterSchema = z.enum(["5", "4", "3", "2", "1", "unset"]);
const trackerCardTypeFilterSchema = z.enum([
  "monster",
  "normal",
  "effect",
  "fusion",
  "synchro",
  "xyz",
  "link",
  "ritual",
  "pendulum",
  "tuner",
  "spell",
  "trap",
  "token",
]);
const purchaseMonthSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}$/)
  .optional()
  .or(z.literal(""));

function currentMonthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

const createCardSchema = z.object({
  name: z.string().trim().optional(),
  url: z.string().trim().optional(),
  imageUrl: z.string().trim().url().optional().or(z.literal("")),
  priceText: z.string().trim().optional(),
  marketPriceText: z.string().trim().optional(),
  paidPriceText: z.string().trim().optional(),
  purchaseMonth: purchaseMonthSchema,
  ebaySearchUrl: z.string().trim().url().optional().or(z.literal("")),
  ebayListingUrl: z.string().trim().url().optional().or(z.literal("")),
  rarity: z.string().trim().optional(),
  chaseLevel: chaseLevelSchema,
  status: statusSchema.default("wishlist"),
  notes: z.string().trim().optional(),
});

const updateCardSchema = createCardSchema.extend({
  id: z.number().int().positive(),
});
const trackerPageSchema = z.object({
  chaseFilters: z.array(trackerChaseFilterSchema).default([]),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(48).default(8),
  priceMax: z.string().trim().default(""),
  priceMin: z.string().trim().default(""),
  priceSignalFilters: z.array(trackerPriceSignalSchema).default([]),
  query: z.string().trim().default(""),
  rarityFilters: z.array(z.string().trim().min(1)).default([]),
  sort: trackerSortSchema.default("updated"),
  status: statusFilterSchema.default("all"),
  typeFilters: z.array(trackerCardTypeFilterSchema).default([]),
});

function serializeCard(card: typeof cards.$inferSelect) {
  return {
    ...card,
    createdAt: card.createdAt.toISOString(),
    updatedAt: card.updatedAt.toISOString(),
  };
}

function serializeBinderCard(card: typeof cards.$inferSelect) {
  return {
    cardType: card.cardType,
    id: card.id,
    imageUrl: card.imageUrl,
    marketPriceText: card.marketPriceText,
    name: card.name,
    notes: card.notes,
    priceText: card.priceText,
    rarity: card.rarity,
    status: card.status,
  };
}

function serializeChaseQueueCard(card: typeof cards.$inferSelect) {
  return {
    chaseLevel: card.chaseLevel,
    ebaySearchUrl: card.ebaySearchUrl,
    id: card.id,
    imageUrl: card.imageUrl,
    name: card.name,
    rarity: card.rarity,
  };
}

type SerializedCard = ReturnType<typeof serializeCard>;

function queryFilters(query: string) {
  if (!query) {
    return [];
  }

  const pattern = `%${query}%`;
  return [
    or(
      like(cards.name, pattern),
      like(cards.notes, pattern),
      like(cards.priceText, pattern),
      like(cards.marketPriceText, pattern),
      like(cards.purchaseMonth, pattern),
      like(cards.rarity, pattern),
      like(cards.cardType, pattern),
      like(cards.ebayListingUrl, pattern),
    ),
  ];
}

function priceValue(priceText: string | null) {
  const match = priceText?.match(/\d+(?:[,.]\d{1,2})?/);
  return match ? Number(match[0].replace(",", "")) : null;
}

function marketValue(card: Pick<SerializedCard, "marketPriceText" | "priceText">) {
  return priceValue(card.marketPriceText) ?? priceValue(card.priceText);
}

function filterNumber(value: string) {
  if (!value.trim()) {
    return null;
  }

  const normalized = value.replace(/^£/, "").replace(/,/g, "").trim();
  const parsed = Number(normalized);

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function cardMatchesType(
  card: Pick<SerializedCard, "cardType">,
  typeFilter: z.infer<typeof trackerCardTypeFilterSchema>,
) {
  const type = card.cardType?.toLowerCase() ?? "";

  if (!type) {
    return false;
  }

  if (typeFilter === "monster") {
    return type.includes("monster");
  }

  if (typeFilter === "spell") {
    return type.includes("spell");
  }

  if (typeFilter === "trap") {
    return type.includes("trap");
  }

  return type.includes(typeFilter);
}

function filteredTrackerCards(
  allCards: SerializedCard[],
  input: z.infer<typeof trackerPageSchema>,
) {
  const minPrice = filterNumber(input.priceMin);
  const maxPrice = filterNumber(input.priceMax);

  return allCards.filter((card) => {
    const cardMarketValue = marketValue(card);

    if (input.status !== "all" && card.status !== input.status) {
      return false;
    }

    if (
      input.typeFilters.length &&
      !input.typeFilters.some((typeFilter) => cardMatchesType(card, typeFilter))
    ) {
      return false;
    }

    if (
      input.rarityFilters.length &&
      (!card.rarity || !input.rarityFilters.includes(card.rarity))
    ) {
      return false;
    }

    if (input.priceSignalFilters.length) {
      const matchesPriceSignal = input.priceSignalFilters.some((priceSignal) => {
        if (priceSignal === "estimated") {
          return cardMarketValue !== null;
        }

        if (priceSignal === "unpriced") {
          return cardMarketValue === null;
        }

        return Boolean(card.paidPriceText);
      });

      if (!matchesPriceSignal) {
        return false;
      }
    }

    if (minPrice !== null || maxPrice !== null) {
      if (cardMarketValue === null) {
        return false;
      }

      if (minPrice !== null && cardMarketValue < minPrice) {
        return false;
      }

      if (maxPrice !== null && cardMarketValue > maxPrice) {
        return false;
      }
    }

    if (input.chaseFilters.length) {
      const cardChase = card.chaseLevel
        ? (String(card.chaseLevel) as z.infer<typeof trackerChaseFilterSchema>)
        : "unset";

      if (!input.chaseFilters.includes(cardChase)) {
        return false;
      }
    }

    return true;
  });
}

function sortTrackerCards(
  filteredCards: SerializedCard[],
  sort: z.infer<typeof trackerSortSchema>,
) {
  return [...filteredCards].sort((a, b) => {
    if (sort === "name") {
      return a.name.localeCompare(b.name);
    }

    if (sort === "rarity") {
      return (a.rarity ?? "").localeCompare(b.rarity ?? "");
    }

    if (sort === "price-high" || sort === "price-low") {
      const aPrice = marketValue(a);
      const bPrice = marketValue(b);

      if (aPrice === null && bPrice === null) {
        return 0;
      }

      if (aPrice === null) {
        return 1;
      }

      if (bPrice === null) {
        return -1;
      }

      return sort === "price-high" ? bPrice - aPrice : aPrice - bPrice;
    }

    if (sort === "chase-next") {
      return (b.chaseLevel ?? 0) - (a.chaseLevel ?? 0);
    }

    if (sort === "chase-relaxed") {
      return (a.chaseLevel ?? 6) - (b.chaseLevel ?? 6);
    }

    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
}

function trackerStats(filteredCards: SerializedCard[]) {
  const wishlistCards = filteredCards.filter((card) => card.status === "wishlist");
  const ownedCards = filteredCards.filter((card) => card.status === "owned");

  return {
    counts: {
      owned: ownedCards.length,
      total: filteredCards.length,
      wishlist: wishlistCards.length,
    },
    values: {
      owned: ownedCards.reduce((sum, card) => sum + (marketValue(card) ?? 0), 0),
      paid: ownedCards.reduce(
        (sum, card) => sum + (priceValue(card.paidPriceText) ?? 0),
        0,
      ),
      wishlist: wishlistCards.reduce(
        (sum, card) => sum + (marketValue(card) ?? 0),
        0,
      ),
    },
  };
}

async function metadataFromUrl(url: string | undefined) {
  if (!url) {
    return null;
  }

  try {
    return await fetchLinkMetadata(url);
  } catch {
    return null;
  }
}

export const cardsRouter = router({
  list: publicProcedure
    .input(
      z.object({
        status: statusFilterSchema.default("all"),
        query: z.string().trim().default(""),
      }),
    )
    .query(async ({ input }) => {
      const filters = queryFilters(input.query);

      if (input.status !== "all") {
        filters.push(eq(cards.status, input.status));
      }

      const rows = await db
        .select()
        .from(cards)
        .where(filters.length ? and(...filters) : undefined)
        .orderBy(desc(cards.updatedAt));

      return rows.map(serializeCard);
    }),

  trackerPage: publicProcedure.input(trackerPageSchema).query(async ({ input }) => {
    const rows = await db
      .select()
      .from(cards)
      .where(queryFilters(input.query).length ? and(...queryFilters(input.query)) : undefined);
    const queryMatchedCards = rows.map(serializeCard);
    const rarityOptions = Array.from(
      new Set(
        queryMatchedCards
          .map((card) => card.rarity)
          .filter((rarity): rarity is string => Boolean(rarity)),
      ),
    ).sort((a, b) => a.localeCompare(b));
    const filteredCards = filteredTrackerCards(queryMatchedCards, input);
    const sortedCards = sortTrackerCards(filteredCards, input.sort);
    const safePage = Math.min(
      input.page,
      Math.max(1, Math.ceil(sortedCards.length / input.pageSize)),
    );
    const offset = (safePage - 1) * input.pageSize;

    return {
      items: sortedCards.slice(offset, offset + input.pageSize),
      page: safePage,
      pageSize: input.pageSize,
      rarityOptions,
      total: sortedCards.length,
      totalPages: Math.max(1, Math.ceil(sortedCards.length / input.pageSize)),
      ...trackerStats(sortedCards),
    };
  }),

  summary: publicProcedure.query(async () => {
    const rows = await db.select().from(cards);
    return trackerStats(rows.map(serializeCard));
  }),

  binderList: publicProcedure.query(async () => {
    const rows = await db.select().from(cards).orderBy(desc(cards.updatedAt));
    return rows.map(serializeBinderCard);
  }),

  chaseQueue: publicProcedure.query(async () => {
    const rows = await db
      .select()
      .from(cards)
      .where(and(eq(cards.status, "wishlist"), isNull(cards.chaseLevel)))
      .orderBy(desc(cards.updatedAt));

    return rows.map(serializeChaseQueueCard);
  }),

  create: publicProcedure.input(createCardSchema).mutation(async ({ input }) => {
    const now = new Date();
    const normalizedUrl = input.url ? normalizeUrl(input.url) : undefined;
    const metadata = await metadataFromUrl(normalizedUrl);
    const name = input.name || metadata?.title;

    if (!name) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Add a card name, or use a link that exposes a page title.",
      });
    }

    const ygoDetails = await ygoCardDetailsByName(name);

    const [created] = await db
      .insert(cards)
      .values({
        name,
        url: normalizedUrl,
        source: metadata?.source ?? (normalizedUrl ? "other" : "manual"),
        imageUrl: input.imageUrl || metadata?.imageUrl,
        priceText: input.priceText || metadata?.priceText,
        marketPriceText: input.marketPriceText || null,
        paidPriceText: input.paidPriceText,
        purchaseMonth:
          input.status === "owned" ? input.purchaseMonth || null : null,
        ebaySearchUrl: input.ebaySearchUrl || null,
        ebayListingUrl:
          input.status === "wishlist" ? input.ebayListingUrl || null : null,
        cardType: metadata?.cardType || ygoDetails.cardType,
        rarity: input.rarity || metadata?.rarity,
        chaseLevel: input.chaseLevel,
        status: input.status,
        notes: input.notes,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    try {
      const priced = await refreshEbayPricing(created);
      return serializeCard(priced ?? created);
    } catch {
      return serializeCard(created);
    }
  }),

  update: publicProcedure.input(updateCardSchema).mutation(async ({ input }) => {
    const now = new Date();
    const normalizedUrl = input.url ? normalizeUrl(input.url) : undefined;
    const [existing] = await db
      .select()
      .from(cards)
      .where(eq(cards.id, input.id));

    if (!existing) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Card not found." });
    }

    const ygoDetails = await ygoCardDetailsByName(input.name);

    const [updated] = await db
      .update(cards)
      .set({
        name: input.name,
        url: normalizedUrl,
        imageUrl: input.imageUrl || null,
        priceText: input.priceText || null,
        marketPriceText: input.marketPriceText || null,
        paidPriceText: input.paidPriceText || null,
        purchaseMonth:
          input.status === "owned" ? input.purchaseMonth || null : null,
        ebaySearchUrl:
          input.ebaySearchUrl === undefined
            ? existing.ebaySearchUrl
            : input.ebaySearchUrl || null,
        ebayListingUrl:
          input.status === "wishlist"
            ? input.ebayListingUrl === undefined
              ? existing.ebayListingUrl
              : input.ebayListingUrl || null
            : null,
        cardType: ygoDetails.cardType ?? existing.cardType,
        rarity: input.rarity || null,
        chaseLevel: input.status === "wishlist" ? input.chaseLevel ?? null : null,
        status: input.status,
        notes: input.notes || null,
        updatedAt: now,
      })
      .where(eq(cards.id, input.id))
      .returning();

    try {
      const priced = await refreshEbayPricing(updated);
      return serializeCard(priced ?? updated);
    } catch {
      return serializeCard(updated);
    }
  }),

  setStatus: publicProcedure
    .input(z.object({ id: z.number().int().positive(), status: statusSchema }))
    .mutation(async ({ input }) => {
      const [existing] = await db
        .select()
        .from(cards)
        .where(eq(cards.id, input.id));

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Card not found." });
      }

      const [updated] = await db
        .update(cards)
        .set({
          status: input.status,
          chaseLevel: input.status === "owned" ? null : undefined,
          purchaseMonth:
            input.status === "owned"
              ? existing.purchaseMonth ?? currentMonthKey()
              : null,
          updatedAt: new Date(),
        })
        .where(eq(cards.id, input.id))
        .returning();

      return serializeCard(updated);
    }),

  markOwned: publicProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        paidPriceText: z.string().trim().optional(),
        purchaseMonth: purchaseMonthSchema,
      }),
    )
    .mutation(async ({ input }) => {
      const [existing] = await db
        .select()
        .from(cards)
        .where(eq(cards.id, input.id));

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Card not found." });
      }

      const [updated] = await db
        .update(cards)
        .set({
          chaseLevel: null,
          paidPriceText: input.paidPriceText || existing.paidPriceText,
          purchaseMonth:
            input.purchaseMonth || existing.purchaseMonth || currentMonthKey(),
          status: "owned",
          updatedAt: new Date(),
        })
        .where(eq(cards.id, input.id))
        .returning();

      return serializeCard(updated);
    }),

  setChaseLevel: publicProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        chaseLevel: chaseLevelSchema,
      }),
    )
    .mutation(async ({ input }) => {
      const [updated] = await db
        .update(cards)
        .set({ chaseLevel: input.chaseLevel ?? null, updatedAt: new Date() })
        .where(eq(cards.id, input.id))
        .returning();

      if (!updated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Card not found." });
      }

      return serializeCard(updated);
    }),

  setPaidPrice: publicProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        paidPriceText: z.string().trim().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const [existing] = await db
        .select()
        .from(cards)
        .where(eq(cards.id, input.id));

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Card not found." });
      }

      const [updated] = await db
        .update(cards)
        .set({
          paidPriceText: input.paidPriceText || null,
          purchaseMonth:
            existing.status === "owned" &&
            input.paidPriceText &&
            !existing.purchaseMonth
              ? currentMonthKey()
              : existing.purchaseMonth,
          updatedAt: new Date(),
        })
        .where(eq(cards.id, input.id))
        .returning();

      return serializeCard(updated);
    }),

  refreshMetadata: publicProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const [existing] = await db
        .select()
        .from(cards)
        .where(eq(cards.id, input.id));

      if (!existing?.url) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This card does not have a link to refresh.",
        });
      }

      const metadata = await fetchLinkMetadata(existing.url);
      const [updated] = await db
        .update(cards)
        .set({
          name: metadata.title || existing.name,
          source: metadata.source,
          imageUrl: metadata.imageUrl || existing.imageUrl,
          priceText: metadata.priceText || existing.priceText,
          ebayListingUrl: existing.ebayListingUrl,
          cardType:
            metadata.cardType ||
            (await ygoCardDetailsByName(metadata.title || existing.name)).cardType ||
            existing.cardType,
          rarity: metadata.rarity || existing.rarity,
          updatedAt: new Date(),
        })
        .where(eq(cards.id, input.id))
        .returning();

      return serializeCard(updated);
    }),

  refreshPricing: publicProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const [existing] = await db
        .select()
        .from(cards)
        .where(eq(cards.id, input.id));

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Card not found." });
      }

      const updated = await refreshEbayPricing(existing);
      return serializeCard(updated ?? existing);
    }),

  refreshAllPricing: publicProcedure.mutation(async () => {
    const allCards = await db.select().from(cards);
    let failed = 0;
    let refreshed = 0;

    for (let index = 0; index < allCards.length; index += 3) {
      const batch = allCards.slice(index, index + 3);
      const results = await Promise.allSettled(
        batch.map((card) => refreshEbayPricing(card)),
      );

      for (const result of results) {
        if (result.status === "fulfilled") {
          refreshed += 1;
        } else {
          failed += 1;
        }
      }
    }

    return { failed, refreshed };
  }),

  delete: publicProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      await db.delete(cards).where(eq(cards.id, input.id));
      return { ok: true };
    }),
});

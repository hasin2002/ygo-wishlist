import { TRPCError } from "@trpc/server";
import { and, desc, eq, like, or } from "drizzle-orm";
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
const chaseLevelSchema = z.number().int().min(1).max(5).nullable().optional();
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

function serializeCard(card: typeof cards.$inferSelect) {
  return {
    ...card,
    createdAt: card.createdAt.toISOString(),
    updatedAt: card.updatedAt.toISOString(),
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
        status: z.enum(["all", "wishlist", "owned"]).default("all"),
        query: z.string().trim().default(""),
      }),
    )
    .query(({ input }) => {
      const filters = [];

      if (input.status !== "all") {
        filters.push(eq(cards.status, input.status));
      }

      if (input.query) {
        const pattern = `%${input.query}%`;
        filters.push(
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
        );
      }

      const rows = db
        .select()
        .from(cards)
        .where(filters.length ? and(...filters) : undefined)
        .orderBy(desc(cards.updatedAt))
        .all();

      return rows.map(serializeCard);
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

    const created = db
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
      .returning()
      .get();

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
    const existing = db.select().from(cards).where(eq(cards.id, input.id)).get();

    if (!existing) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Card not found." });
    }

    const ygoDetails = await ygoCardDetailsByName(input.name);

    const updated = db
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
      .returning()
      .get();

    try {
      const priced = await refreshEbayPricing(updated);
      return serializeCard(priced ?? updated);
    } catch {
      return serializeCard(updated);
    }
  }),

  setStatus: publicProcedure
    .input(z.object({ id: z.number().int().positive(), status: statusSchema }))
    .mutation(({ input }) => {
      const existing = db.select().from(cards).where(eq(cards.id, input.id)).get();

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Card not found." });
      }

      const updated = db
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
        .returning()
        .get();

      return serializeCard(updated);
    }),

  setChaseLevel: publicProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        chaseLevel: chaseLevelSchema,
      }),
    )
    .mutation(({ input }) => {
      const updated = db
        .update(cards)
        .set({ chaseLevel: input.chaseLevel ?? null, updatedAt: new Date() })
        .where(eq(cards.id, input.id))
        .returning()
        .get();

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
    .mutation(({ input }) => {
      const existing = db.select().from(cards).where(eq(cards.id, input.id)).get();

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Card not found." });
      }

      const updated = db
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
        .returning()
        .get();

      return serializeCard(updated);
    }),

  refreshMetadata: publicProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const existing = db.select().from(cards).where(eq(cards.id, input.id)).get();

      if (!existing?.url) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This card does not have a link to refresh.",
        });
      }

      const metadata = await fetchLinkMetadata(existing.url);
      const updated = db
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
        .returning()
        .get();

      return serializeCard(updated);
    }),

  refreshPricing: publicProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const existing = db.select().from(cards).where(eq(cards.id, input.id)).get();

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Card not found." });
      }

      const updated = await refreshEbayPricing(existing);
      return serializeCard(updated ?? existing);
    }),

  delete: publicProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(({ input }) => {
      db.delete(cards).where(eq(cards.id, input.id)).run();
      return { ok: true };
    }),
});

import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  cardCopies,
  cardPrintings,
  cardTargets,
  pricingRefreshStates,
  recordEntries,
} from "@/db/schema";
import { getLibraryCardStatus } from "@/lib/records/library-status";
import { fetchEbayPricing } from "@/server/ebay-pricing";
import { fetchLinkMetadata, normalizeUrl, ygoCardDetailsByName } from "@/server/metadata";
import { recordPricingRefresh } from "@/server/pricing-refresh-state";
import { authenticatedProcedure, publicProcedure, router } from "@/server/trpc";

const statusSchema = z.enum(["wishlist", "owned"]);
const statusFilterSchema = z.enum(["all", "wishlist", "owned"]);
const editionSchema = z.enum(["1st Edition", "Unlimited Edition", "Limited Edition"]);
const chaseLevelSchema = z.number().int().min(1).max(5).nullable().optional();
const trackerSortSchema = z.enum([
  "updated", "name", "price-high", "price-low", "chase-next", "chase-relaxed", "rarity",
]);
const trackerPriceSignalSchema = z.enum(["estimated", "unpriced", "paid"]);
const trackerChaseFilterSchema = z.enum(["5", "4", "3", "2", "1", "unset"]);
const trackerCardTypeFilterSchema = z.enum([
  "monster", "normal", "effect", "fusion", "synchro", "xyz", "link", "ritual",
  "pendulum", "tuner", "spell", "trap", "token",
]);
const targetInputSchema = z.object({
  name: z.string().trim().optional(),
  url: z.string().trim().optional(),
  imageUrl: z.string().trim().url().optional().or(z.literal("")),
  priceText: z.string().trim().optional(),
  marketPriceText: z.string().trim().optional(),
  paidPriceText: z.string().trim().optional(),
  purchaseMonth: z.string().trim().optional(),
  ebaySearchUrl: z.string().trim().url().optional().or(z.literal("")),
  ebayListingUrl: z.string().trim().url().optional().or(z.literal("")),
  rarity: z.string().trim().optional(),
  edition: editionSchema.optional(),
  chaseLevel: chaseLevelSchema,
  status: statusSchema.default("wishlist"),
  notes: z.string().trim().optional(),
});
const updateTargetSchema = targetInputSchema.extend({ id: z.string().min(1) });
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

function id(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function normalize(value: string) {
  return value.trim().toLocaleLowerCase("en-GB").replace(/\s+/g, " ");
}

function canonicalProductUrl(value: string) {
  const url = new URL(value);
  return `${url.hostname.replace(/^www\./, "").toLowerCase()}${url.pathname.replace(/\/$/, "")}`;
}

function requireTcgplayerProductUrl(value: string | undefined) {
  if (!value) throw new TRPCError({ code: "BAD_REQUEST", message: "Add a complete TCGplayer product link." });
  const normalized = normalizeUrl(value);
  const parsed = new URL(normalized);
  const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
  if (
    (host !== "tcgplayer.com" && !host.endsWith(".tcgplayer.com"))
    || !/\/product\/\d+(?:\/|$)/.test(parsed.pathname)
  ) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Use a complete TCGplayer product link containing a product ID." });
  }
  return normalized;
}

function penceFromText(value: string | null | undefined) {
  const match = value?.match(/\d+(?:[,.]\d{1,2})?/);
  if (!match) return null;
  const amount = Number(match[0].replace(",", ""));
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) : null;
}

function currency(pence: number | null) {
  return pence === null ? null : `£${(pence / 100).toFixed(2)}`;
}

type LibraryCard = Awaited<ReturnType<typeof loadLibraryCards>>[number];

async function loadLibraryCards(ownerId: string, includeSpend = true) {
  const recordsPromise = includeSpend
    ? db.select().from(recordEntries).where(eq(recordEntries.ownerId, ownerId))
    : Promise.resolve([] as (typeof recordEntries.$inferSelect)[]);
  const [targets, printings, copies, records] = await Promise.all([
    db.select().from(cardTargets).where(eq(cardTargets.ownerId, ownerId)).orderBy(desc(cardTargets.updatedAt)),
    db.select().from(cardPrintings).where(eq(cardPrintings.ownerId, ownerId)),
    db.select().from(cardCopies).where(eq(cardCopies.ownerId, ownerId)),
    recordsPromise,
  ]);
  const targetIdByPrintingId = new Map(printings.map((printing) => [printing.id, printing.targetId]));
  const recordById = new Map(records.map((record) => [record.id, record]));
  const availableQuantityByTarget = new Map<string, number>();
  const paidPenceByTarget = new Map<string, number>();
  const latestAcquisitionByTarget = new Map<string, typeof recordEntries.$inferSelect>();

  for (const copy of copies) {
    const targetId = targetIdByPrintingId.get(copy.printingId);
    if (!targetId) continue;

    if (copy.status === "available") {
      availableQuantityByTarget.set(
        targetId,
        (availableQuantityByTarget.get(targetId) ?? 0) + 1,
      );
    }

    if (!includeSpend) continue;

    const record = recordById.get(copy.acquiredRecordId);
    if (!record) continue;

    paidPenceByTarget.set(
      targetId,
      (paidPenceByTarget.get(targetId) ?? 0) + (copy.allocationPence ?? 0),
    );
    const latest = latestAcquisitionByTarget.get(targetId);
    if (!latest || record.occurredOn > latest.occurredOn) {
      latestAcquisitionByTarget.set(targetId, record);
    }
  }

  return targets.map((target) => {
    const availableQuantity = availableQuantityByTarget.get(target.id) ?? 0;
    const paidPence = paidPenceByTarget.get(target.id) ?? 0;
    const latestAcquisition = latestAcquisitionByTarget.get(target.id);
    const status = getLibraryCardStatus(target.desiredQuantity, availableQuantity).status;
    return {
      id: target.id,
      name: target.name,
      url: target.tcgplayerUrl,
      source: "tcgplayer" as const,
      imageUrl: target.imageUrl,
      priceText: target.estimatedPricePence === null
        ? null
        : `${currency(target.estimatedPricePence)} estimate`,
      marketPriceText: currency(target.marketPricePence),
      paidPriceText: includeSpend && paidPence > 0 ? currency(paidPence) : null,
      purchaseMonth: includeSpend ? latestAcquisition?.occurredOn.slice(0, 7) ?? null : null,
      ebaySearchUrl: target.ebaySearchUrl,
      ebayListingUrl: target.ebayListingUrl,
      rarity: target.rarity,
      edition: target.edition,
      cardType: target.cardType,
      chaseLevel: target.chaseLevel,
      status,
      notes: target.notes,
      desiredQuantity: target.desiredQuantity,
      ownedQuantity: availableQuantity,
      createdAt: target.createdAt.toISOString(),
      updatedAt: target.updatedAt.toISOString(),
    };
  });
}

function marketValue(card: LibraryCard) {
  return penceFromText(card.marketPriceText) ?? penceFromText(card.priceText);
}

function filterNumber(value: string) {
  if (!value.trim()) return null;
  const parsed = Number(value.replace(/^£/, "").replace(/,/g, "").trim());
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) : null;
}

function cardMatchesType(card: LibraryCard, filter: z.infer<typeof trackerCardTypeFilterSchema>) {
  const type = card.cardType?.toLowerCase() ?? "";
  if (filter === "monster") return type.includes("monster");
  return type.includes(filter);
}

function filterCards(cards: LibraryCard[], input: z.infer<typeof trackerPageSchema>, includeSpend: boolean) {
  const search = input.query.toLowerCase();
  const min = filterNumber(input.priceMin);
  const max = filterNumber(input.priceMax);
  return cards.filter((card) => {
    if (search && ![
      card.name, card.notes, card.rarity, card.cardType, card.ebayListingUrl,
    ].join(" ").toLowerCase().includes(search)) return false;
    if (input.status !== "all" && card.status !== input.status) return false;
    if (input.rarityFilters.length && !input.rarityFilters.includes(card.rarity)) return false;
    if (input.typeFilters.length && !input.typeFilters.some((filter) => cardMatchesType(card, filter))) return false;
    if (input.chaseFilters.length) {
      const value = card.chaseLevel ? String(card.chaseLevel) : "unset";
      if (!input.chaseFilters.includes(value as z.infer<typeof trackerChaseFilterSchema>)) return false;
    }
    const price = marketValue(card);
    if ((min !== null || max !== null) && (price === null || (min !== null && price < min) || (max !== null && price > max))) return false;
    if (input.priceSignalFilters.length && !input.priceSignalFilters.some((signal) => (
      signal === "estimated" ? price !== null : signal === "unpriced" ? price === null : includeSpend && Boolean(card.paidPriceText)
    ))) return false;
    return true;
  });
}

function sortCards(cards: LibraryCard[], sort: z.infer<typeof trackerSortSchema>) {
  return [...cards].sort((left, right) => {
    if (sort === "name") return left.name.localeCompare(right.name);
    if (sort === "rarity") return left.rarity.localeCompare(right.rarity);
    if (sort === "price-high" || sort === "price-low") {
      const a = marketValue(left);
      const b = marketValue(right);
      if (a === null) return 1;
      if (b === null) return -1;
      return sort === "price-high" ? b - a : a - b;
    }
    if (sort === "chase-next") return (right.chaseLevel ?? 0) - (left.chaseLevel ?? 0);
    if (sort === "chase-relaxed") return (left.chaseLevel ?? 6) - (right.chaseLevel ?? 6);
    return right.updatedAt.localeCompare(left.updatedAt);
  });
}

function stats(cards: LibraryCard[], includeSpend: boolean) {
  const wishlist = cards.filter((card) => card.status === "wishlist");
  const owned = cards.filter((card) => card.status === "owned");
  return {
    counts: { owned: owned.length, total: cards.length, wishlist: wishlist.length },
    values: {
      owned: owned.reduce((sum, card) => sum + (marketValue(card) ?? 0), 0) / 100,
      paid: includeSpend
        ? owned.reduce((sum, card) => sum + (penceFromText(card.paidPriceText) ?? 0), 0) / 100
        : 0,
      wishlist: wishlist.reduce((sum, card) => sum + (marketValue(card) ?? 0), 0) / 100,
    },
  };
}

async function upsertTargetPrinting(
  ownerId: string,
  input: z.infer<typeof targetInputSchema>,
  targetId?: string,
) {
  const url = requireTcgplayerProductUrl(input.url);
  const metadata = await fetchLinkMetadata(url);
  const name = input.name || metadata.title;
  const rarity = input.rarity || metadata.rarity;
  const edition = input.edition || metadata.edition || "1st Edition";
  if (!name || !rarity) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Fetch or enter the card name and rarity." });
  }
  const ygoDetails = await ygoCardDetailsByName(name);
  const now = new Date();
  const values = {
    name,
    normalizedName: normalize(name),
    rarity,
    normalizedRarity: normalize(rarity),
    edition,
    normalizedEdition: normalize(edition),
    imageUrl: input.imageUrl || metadata.imageUrl || null,
    tcgplayerUrl: url,
    estimatedPricePence: penceFromText(input.priceText || metadata.priceText),
    marketPricePence: penceFromText(input.marketPriceText),
    ebaySearchUrl: input.ebaySearchUrl || null,
    ebayListingUrl: input.ebayListingUrl || null,
    cardType: metadata.cardType || ygoDetails.cardType,
    notes: input.notes || "",
    chaseLevel: input.chaseLevel ?? null,
    updatedAt: now,
  };
  let target;
  if (targetId) {
    [target] = await db.update(cardTargets).set(values).where(and(
      eq(cardTargets.id, targetId), eq(cardTargets.ownerId, ownerId),
    )).returning();
  } else {
    [target] = await db.insert(cardTargets).values({
      id: id("target"), ownerId, desiredQuantity: 1, ...values, createdAt: now,
    }).returning();
  }
  if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "Wishlist Target not found." });

  const setName = metadata.setName || "Unknown set";
  const setCode = metadata.setCode || "Unknown code";
  const canonicalUrl = canonicalProductUrl(url);
  const [printing] = await db.select().from(cardPrintings).where(and(
    eq(cardPrintings.ownerId, ownerId),
    eq(cardPrintings.targetId, target.id),
    eq(cardPrintings.canonicalTcgplayerUrl, canonicalUrl),
  )).limit(1);
  if (printing) {
    await db.update(cardPrintings).set({
      setName, normalizedSetName: normalize(setName), setCode, normalizedSetCode: normalize(setCode),
      tcgplayerUrl: url, imageUrl: target.imageUrl, metadataNeedsAttention: !metadata.setCode,
      updatedAt: now,
    }).where(and(eq(cardPrintings.id, printing.id), eq(cardPrintings.ownerId, ownerId)));
  } else {
    await db.insert(cardPrintings).values({
      id: id("printing"), ownerId, targetId: target.id,
      setName, normalizedSetName: normalize(setName), setCode, normalizedSetCode: normalize(setCode),
      tcgplayerUrl: url, canonicalTcgplayerUrl: canonicalUrl, imageUrl: target.imageUrl,
      metadataNeedsAttention: !metadata.setCode, createdAt: now, updatedAt: now,
    });
  }
  return target;
}

export const libraryRouter = router({
  list: authenticatedProcedure.input(z.object({
    status: statusFilterSchema.default("all"), query: z.string().trim().default(""),
  })).query(async ({ ctx, input }) => {
    const cards = await loadLibraryCards(ctx.collectionOwnerId);
    const search = input.query.toLowerCase();
    return cards.filter((card) => (
      (input.status === "all" || card.status === input.status)
      && (!search || [card.name, card.notes, card.rarity].join(" ").toLowerCase().includes(search))
    ));
  }),

  trackerPage: publicProcedure.input(trackerPageSchema).query(async ({ ctx, input }) => {
    if (!ctx.collectionOwnerId) return {
      canEdit: false, items: [], page: 1, pageSize: input.pageSize, rarityOptions: [], total: 0,
      totalPages: 1, values: { owned: 0, paid: 0, wishlist: 0 }, counts: { owned: 0, total: 0, wishlist: 0 },
    };
    const includeSpend = Boolean(ctx.session);
    const allCards = await loadLibraryCards(ctx.collectionOwnerId, includeSpend);
    const rarityOptions = Array.from(new Set(allCards.map((card) => card.rarity))).sort();
    const filtered = filterCards(allCards, input, includeSpend);
    const sorted = sortCards(filtered, input.sort);
    const page = Math.min(input.page, Math.max(1, Math.ceil(sorted.length / input.pageSize)));
    return {
      canEdit: includeSpend,
      items: sorted.slice((page - 1) * input.pageSize, page * input.pageSize),
      page, pageSize: input.pageSize, rarityOptions, total: sorted.length,
      totalPages: Math.max(1, Math.ceil(sorted.length / input.pageSize)),
      ...stats(sorted, includeSpend),
    };
  }),

  summary: authenticatedProcedure.query(async ({ ctx }) => stats(
    await loadLibraryCards(ctx.collectionOwnerId), true,
  )),

  binderList: publicProcedure.query(async ({ ctx }) => {
    if (!ctx.collectionOwnerId) return [];
    return (await loadLibraryCards(ctx.collectionOwnerId, false)).map((card) => ({
      cardType: card.cardType, id: card.id, imageUrl: card.imageUrl,
      marketPriceText: card.marketPriceText, name: card.name, notes: card.notes,
      priceText: card.priceText, rarity: card.rarity, status: card.status,
    }));
  }),

  chaseQueue: authenticatedProcedure.query(async ({ ctx }) => (
    await loadLibraryCards(ctx.collectionOwnerId, false)
  ).filter((card) => card.status === "wishlist" && !card.chaseLevel).map((card) => ({
    chaseLevel: card.chaseLevel, ebaySearchUrl: card.ebaySearchUrl,
    id: card.id, imageUrl: card.imageUrl, name: card.name, rarity: card.rarity,
  }))),

  create: authenticatedProcedure.input(targetInputSchema).mutation(async ({ ctx, input }) => {
    if (input.status === "owned") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Create the Wishlist Target here, then use Record acquisition to add owned Copies." });
    }
    const target = await upsertTargetPrinting(ctx.collectionOwnerId, input);
    return (await loadLibraryCards(ctx.collectionOwnerId)).find((card) => card.id === target.id)!;
  }),

  update: authenticatedProcedure.input(updateTargetSchema).mutation(async ({ ctx, input }) => {
    const [existing] = await db.select().from(cardTargets).where(and(
      eq(cardTargets.id, input.id), eq(cardTargets.ownerId, ctx.collectionOwnerId),
    )).limit(1);
    if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Wishlist Target not found." });
    const printings = await db.select({ id: cardPrintings.id }).from(cardPrintings).where(and(
      eq(cardPrintings.ownerId, ctx.collectionOwnerId), eq(cardPrintings.targetId, existing.id),
    ));
    const copies = printings.length ? await db.select({ id: cardCopies.id }).from(cardCopies).where(and(
      eq(cardCopies.ownerId, ctx.collectionOwnerId),
      inArray(cardCopies.printingId, printings.map((printing) => printing.id)),
    )) : [];
    const nextName = input.name || existing.name;
    const nextRarity = input.rarity || existing.rarity;
    const nextEdition = input.edition || existing.edition;
    if (copies.length && (
      normalize(nextName) !== existing.normalizedName
      || normalize(nextRarity) !== existing.normalizedRarity
      || normalize(nextEdition) !== existing.normalizedEdition
      || (input.url && canonicalProductUrl(input.url) !== canonicalProductUrl(existing.tcgplayerUrl || input.url))
    )) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "This Target has physical Copies. Edit their source Record so Library and history stay in sync.",
      });
    }
    const target = await upsertTargetPrinting(ctx.collectionOwnerId, {
      ...input,
      name: nextName,
      rarity: nextRarity,
      edition: nextEdition as "1st Edition" | "Unlimited Edition" | "Limited Edition",
      url: input.url || existing.tcgplayerUrl || undefined,
    }, existing.id);
    return (await loadLibraryCards(ctx.collectionOwnerId)).find((card) => card.id === target.id)!;
  }),

  setChaseLevel: authenticatedProcedure.input(z.object({
    id: z.string().min(1), chaseLevel: chaseLevelSchema,
  })).mutation(async ({ ctx, input }) => {
    const [updated] = await db.update(cardTargets).set({
      chaseLevel: input.chaseLevel ?? null, updatedAt: new Date(),
    }).where(and(eq(cardTargets.id, input.id), eq(cardTargets.ownerId, ctx.collectionOwnerId))).returning();
    if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Wishlist Target not found." });
    return (await loadLibraryCards(ctx.collectionOwnerId)).find((card) => card.id === updated.id)!;
  }),

  markOwned: authenticatedProcedure.input(z.object({
    id: z.string().min(1),
    paidPriceText: z.string().trim().optional(),
    purchaseMonth: z.string().trim().optional(),
  })).mutation(() => {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Ownership cannot be changed directly. Use Record acquisition so the Copy and its history are created together.",
    });
  }),

  refreshMetadata: authenticatedProcedure.input(z.object({ id: z.string().min(1) })).mutation(async ({ ctx, input }) => {
    const cards = await loadLibraryCards(ctx.collectionOwnerId);
    const card = cards.find((item) => item.id === input.id);
    if (!card) throw new TRPCError({ code: "NOT_FOUND", message: "Wishlist Target not found." });
    await upsertTargetPrinting(ctx.collectionOwnerId, {
      name: card.name, url: card.url || undefined, rarity: card.rarity, edition: card.edition as "1st Edition" | "Unlimited Edition" | "Limited Edition",
      imageUrl: card.imageUrl || undefined, priceText: card.priceText || undefined,
      marketPriceText: card.marketPriceText || undefined, ebaySearchUrl: card.ebaySearchUrl || undefined,
      ebayListingUrl: card.ebayListingUrl || undefined, chaseLevel: card.chaseLevel,
      status: card.status, notes: card.notes,
    }, card.id);
    return (await loadLibraryCards(ctx.collectionOwnerId)).find((item) => item.id === card.id)!;
  }),

  refreshPricing: authenticatedProcedure.input(z.object({ id: z.string().min(1) })).mutation(async ({ ctx, input }) => {
    const [target] = await db.select().from(cardTargets).where(and(
      eq(cardTargets.id, input.id), eq(cardTargets.ownerId, ctx.collectionOwnerId),
    )).limit(1);
    if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "Wishlist Target not found." });
    const pricing = await fetchEbayPricing(target);
    await db.update(cardTargets).set({
      estimatedPricePence: pricing.estimatedPricePence,
      ebaySearchUrl: pricing.ebaySearchUrl,
      updatedAt: new Date(),
    }).where(and(eq(cardTargets.id, target.id), eq(cardTargets.ownerId, ctx.collectionOwnerId)));
    return {
      estimatedPricePence: pricing.estimatedPricePence,
      id: target.id,
      sampleSize: pricing.sampleSize,
    };
  }),

  pricingCandidates: authenticatedProcedure.query(async ({ ctx }) => (
    db.select({ id: cardTargets.id })
      .from(cardTargets)
      .where(eq(cardTargets.ownerId, ctx.collectionOwnerId))
      .orderBy(asc(cardTargets.name))
  )),

  lastPricingRefresh: authenticatedProcedure.query(async ({ ctx }) => {
    const [state] = await db
      .select({ lastRefreshedAt: pricingRefreshStates.lastRefreshedAt })
      .from(pricingRefreshStates)
      .where(eq(pricingRefreshStates.ownerId, ctx.collectionOwnerId))
      .limit(1);

    return state?.lastRefreshedAt ?? null;
  }),

  recordPricingRefresh: authenticatedProcedure.mutation(async ({ ctx }) => (
    recordPricingRefresh(ctx.collectionOwnerId)
  )),

  refreshAllPricing: authenticatedProcedure.mutation(async ({ ctx }) => {
    const targets = await db.select().from(cardTargets).where(eq(cardTargets.ownerId, ctx.collectionOwnerId));
    let failed = 0;
    let refreshed = 0;
    for (let index = 0; index < targets.length; index += 3) {
      const results = await Promise.allSettled(targets.slice(index, index + 3).map(async (target) => {
        const pricing = await fetchEbayPricing(target);
        await db.update(cardTargets).set({
          estimatedPricePence: pricing.estimatedPricePence,
          ebaySearchUrl: pricing.ebaySearchUrl,
          updatedAt: new Date(),
        }).where(and(eq(cardTargets.id, target.id), eq(cardTargets.ownerId, ctx.collectionOwnerId)));
      }));
      for (const result of results) {
        if (result.status === "fulfilled") refreshed += 1;
        else failed += 1;
      }
      if (index + 3 < targets.length) {
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    }
    const completedAt = await recordPricingRefresh(ctx.collectionOwnerId);
    return { completedAt, failed, refreshed };
  }),

  delete: authenticatedProcedure.input(z.object({ id: z.string().min(1) })).mutation(async ({ ctx, input }) => {
    const printings = await db.select({ id: cardPrintings.id }).from(cardPrintings).where(and(
      eq(cardPrintings.ownerId, ctx.collectionOwnerId), eq(cardPrintings.targetId, input.id),
    ));
    const copies = printings.length ? await db.select({ id: cardCopies.id }).from(cardCopies).where(and(
      eq(cardCopies.ownerId, ctx.collectionOwnerId),
      inArray(cardCopies.printingId, printings.map((printing) => printing.id)),
    )) : [];
    if (copies.length) {
      throw new TRPCError({ code: "CONFLICT", message: "This Target has Copy history and cannot be deleted. Void the relevant Records instead." });
    }
    await db.delete(cardTargets).where(and(
      eq(cardTargets.id, input.id), eq(cardTargets.ownerId, ctx.collectionOwnerId),
    ));
    return { ok: true };
  }),
});

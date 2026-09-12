import { TRPCError } from "@trpc/server";
import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { cardCatalogueProducts as products, cardCatalogueSync } from "@/db/schema";
import { normalizeCatalogueText, parseCatalogueQuery } from "@/lib/card-catalogue";
import { authenticatedProcedure, router } from "@/server/trpc";

export async function getCatalogueProducts(productIds: number[], executor: Pick<typeof db, "select"> = db) {
  return productIds.length ? executor.select().from(products).where(inArray(products.productId, productIds)) : [];
}

async function boundedSearch<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new TRPCError({ code: "TIMEOUT", message: "Card search took too long. Please retry or use a more specific set code." })), 20_000);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

export const cardCatalogueRouter = router({
  search: authenticatedProcedure.input(z.object({
    query: z.string().max(200), rarity: z.string().max(100).nullable().optional(), page: z.number().int().min(1).max(1000).default(1),
  })).query(async ({input}) => {
    const parsed = parseCatalogueQuery(input.query);
    const rarity = input.rarity === undefined ? parsed.detectedRarity : input.rarity;
    const tokens = parsed.tokens.map((token) => `${token}:*`).join(" & ");
    const where = and(tokens ? sql`to_tsvector('simple', ${products.searchText}) @@ to_tsquery('simple', ${tokens})` : undefined,
      rarity ? sql`lower(${products.rarity}) = lower(${rarity})` : undefined);
    const [rows, totals, syncRows, rarityRows] = await boundedSearch(Promise.all([
      db.select().from(products).where(where).orderBy(
        sql`case when regexp_replace(lower(${products.setCode}), '[^a-z0-9]', '', 'g') = ${normalizeCatalogueText(parsed.searchText).replace(/ /g, "")} then 0 else 1 end`,
        sql`case when trim(regexp_replace(lower(${products.name}), '[^a-z0-9]+', ' ', 'g')) = ${normalizeCatalogueText(parsed.searchText)} then 0
          when ${tokens || "nomatch"} <> 'nomatch' and to_tsvector('simple', regexp_replace(lower(${products.name}), '[^a-z0-9]+', ' ', 'g')) @@ to_tsquery('simple', ${tokens || "nomatch"}) then 1 else 2 end`,
        asc(products.name), asc(products.setCode), asc(products.rarity), asc(products.productId),
      ).limit(30).offset((input.page - 1) * 30),
      db.select({total: count()}).from(products).where(where),
      db.select().from(cardCatalogueSync).where(eq(cardCatalogueSync.id, "yugioh")).limit(1),
      db.selectDistinct({rarity: products.rarity}).from(products).orderBy(asc(products.rarity)),
    ]));
    const sync = syncRows[0];
    const total = totals[0]?.total ?? 0;
    return { products: rows, total, page: input.page, pageCount: Math.ceil(total / 30), detectedRarity: parsed.detectedRarity, searchText: parsed.searchText,
      rarities: rarityRows.map((row) => row.rarity),
      status: {ready: (sync?.productCount ?? 0) > 0, stale: !sync?.updatedAt || Date.now() - sync.updatedAt.getTime() > 3 * 86400_000,
        updatedAt: sync?.updatedAt ?? null, productCount: sync?.productCount ?? 0, syncing: sync?.syncing ?? false},
    };
  }),
});

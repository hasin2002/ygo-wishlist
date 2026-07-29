import { and, desc, eq, ilike, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { cards } from "@/db/schema";
import { authenticatedProcedure, router } from "@/server/trpc";

const legacyCardStatusSchema = z.enum(["wishlist", "owned"]);
let legacyReadWarningIssued = false;

function warnLegacyRead() {
  if (legacyReadWarningIssued) return;
  legacyReadWarningIssued = true;
  console.warn(
    "[deprecated] legacyCards is a read-only migration adapter for the Records preview. Remove it after all legacy cards rows have been migrated.",
  );
}

function serializeLegacyCard(card: typeof cards.$inferSelect) {
  const { ownerId, ...serializedCard } = card;
  void ownerId;
  return {
    ...serializedCard,
    createdAt: card.createdAt.toISOString(),
    updatedAt: card.updatedAt.toISOString(),
  };
}

/**
 * Temporary read-only migration input. The legacy `cards` table has no active
 * Library writer; Records consumes these rows only to seed a resettable local
 * preview until the collection has been migrated.
 */
export const legacyCardsReadRouter = router({
  list: authenticatedProcedure
    .input(z.object({
      status: z.union([z.literal("all"), legacyCardStatusSchema]).default("all"),
      query: z.string().trim().default(""),
    }))
    .query(async ({ ctx, input }) => {
      warnLegacyRead();
      const filters = [eq(cards.ownerId, ctx.collectionOwnerId)];
      if (input.status !== "all") filters.push(eq(cards.status, input.status));
      if (input.query) {
        const pattern = `%${input.query}%`;
        const searchFilter = or(
          ilike(cards.name, pattern),
          ilike(cards.notes, pattern),
          ilike(cards.rarity, pattern),
        );
        if (searchFilter) filters.push(searchFilter);
      }
      const rows = await db.select().from(cards)
        .where(and(...filters))
        .orderBy(desc(cards.updatedAt));
      return rows.map(serializeLegacyCard);
    }),
});

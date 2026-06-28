import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { binderSlots, cards } from "@/db/schema";
import { publicProcedure, router } from "@/server/trpc";

const maxPages = 40;
const slotsPerPage = 9;

const slotInput = z.object({
  pageIndex: z.number().int().min(0).max(maxPages - 1),
  slotIndex: z.number().int().min(0).max(slotsPerPage - 1),
});

function serializeSlot(slot: typeof binderSlots.$inferSelect) {
  return {
    ...slot,
    updatedAt: slot.updatedAt.toISOString(),
  };
}

export const binderRouter = router({
  layout: publicProcedure.query(() => {
    const rows = db.select().from(binderSlots).all();
    return rows.map(serializeSlot);
  }),

  setSlot: publicProcedure
    .input(
      slotInput.extend({
        cardId: z.number().int().positive(),
      }),
    )
    .mutation(({ input }) => {
      const card = db.select().from(cards).where(eq(cards.id, input.cardId)).get();

      if (!card) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Card not found." });
      }

      const now = new Date();
      const updated = db.transaction((tx) => {
        tx.delete(binderSlots).where(eq(binderSlots.cardId, input.cardId)).run();
        tx.delete(binderSlots)
          .where(
            and(
              eq(binderSlots.pageIndex, input.pageIndex),
              eq(binderSlots.slotIndex, input.slotIndex),
            ),
          )
          .run();

        return tx
          .insert(binderSlots)
          .values({
            cardId: input.cardId,
            pageIndex: input.pageIndex,
            slotIndex: input.slotIndex,
            updatedAt: now,
          })
          .returning()
          .get();
      });

      return serializeSlot(updated);
    }),

  clearSlot: publicProcedure.input(slotInput).mutation(({ input }) => {
    db.delete(binderSlots)
      .where(
        and(
          eq(binderSlots.pageIndex, input.pageIndex),
          eq(binderSlots.slotIndex, input.slotIndex),
        ),
      )
      .run();

    return { ok: true };
  }),

  clearCard: publicProcedure
    .input(z.object({ cardId: z.number().int().positive() }))
    .mutation(({ input }) => {
      db.delete(binderSlots).where(eq(binderSlots.cardId, input.cardId)).run();
      return { ok: true };
    }),

  clearAll: publicProcedure.mutation(() => {
    db.delete(binderSlots).run();
    return { ok: true };
  }),
});

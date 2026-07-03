import { TRPCError } from "@trpc/server";
import { and, eq, inArray } from "drizzle-orm";
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

const swapPagesInput = z
  .object({
    sourcePageIndex: z.number().int().min(0).max(maxPages - 1),
    targetPageIndex: z.number().int().min(0).max(maxPages - 1),
  })
  .refine((input) => input.sourcePageIndex !== input.targetPageIndex, {
    message: "Choose two different pages.",
    path: ["targetPageIndex"],
  });

function serializeSlot(slot: typeof binderSlots.$inferSelect) {
  return {
    ...slot,
    updatedAt: slot.updatedAt.toISOString(),
  };
}

export const binderRouter = router({
  layout: publicProcedure.query(async () => {
    const rows = await db.select().from(binderSlots);
    return rows.map(serializeSlot);
  }),

  setSlot: publicProcedure
    .input(
      slotInput.extend({
        cardId: z.number().int().positive(),
      }),
    )
    .mutation(async ({ input }) => {
      const [card] = await db
        .select()
        .from(cards)
        .where(eq(cards.id, input.cardId));

      if (!card) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Card not found." });
      }

      const now = new Date();
      const updated = await db.transaction(async (tx) => {
        await tx.delete(binderSlots).where(eq(binderSlots.cardId, input.cardId));
        await tx
          .delete(binderSlots)
          .where(
            and(
              eq(binderSlots.pageIndex, input.pageIndex),
              eq(binderSlots.slotIndex, input.slotIndex),
            ),
          );

        const [slot] = await tx
          .insert(binderSlots)
          .values({
            cardId: input.cardId,
            pageIndex: input.pageIndex,
            slotIndex: input.slotIndex,
            updatedAt: now,
          })
          .returning();

        return slot;
      });

      return serializeSlot(updated);
    }),

  clearSlot: publicProcedure.input(slotInput).mutation(async ({ input }) => {
    await db
      .delete(binderSlots)
      .where(
        and(
          eq(binderSlots.pageIndex, input.pageIndex),
          eq(binderSlots.slotIndex, input.slotIndex),
        ),
      );

    return { ok: true };
  }),

  clearCard: publicProcedure
    .input(z.object({ cardId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      await db.delete(binderSlots).where(eq(binderSlots.cardId, input.cardId));
      return { ok: true };
    }),

  swapPages: publicProcedure.input(swapPagesInput).mutation(async ({ input }) => {
    const now = new Date();
    const pagesToSwap = [input.sourcePageIndex, input.targetPageIndex];

    await db.transaction(async (tx) => {
      const slots = await tx
        .select()
        .from(binderSlots)
        .where(inArray(binderSlots.pageIndex, pagesToSwap));

      await tx
        .delete(binderSlots)
        .where(inArray(binderSlots.pageIndex, pagesToSwap));

      for (const slot of slots) {
        await tx
          .insert(binderSlots)
          .values({
            cardId: slot.cardId,
            pageIndex:
              slot.pageIndex === input.sourcePageIndex
                ? input.targetPageIndex
                : input.sourcePageIndex,
            slotIndex: slot.slotIndex,
            updatedAt: now,
          });
      }
    });

    return { ok: true };
  }),

  clearAll: publicProcedure.mutation(async () => {
    await db.delete(binderSlots);
    return { ok: true };
  }),
});

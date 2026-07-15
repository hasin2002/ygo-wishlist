import { TRPCError } from "@trpc/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { binderSlots, cards } from "@/db/schema";
import { authenticatedProcedure, publicProcedure, router } from "@/server/trpc";

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
  const { ownerId, ...serializedSlot } = slot;
  void ownerId;

  return {
    ...serializedSlot,
    updatedAt: slot.updatedAt.toISOString(),
  };
}

export const binderRouter = router({
  layout: publicProcedure.query(async ({ ctx }) => {
    if (!ctx.collectionOwnerId) {
      return [];
    }

    const rows = await db
      .select()
      .from(binderSlots)
      .where(eq(binderSlots.ownerId, ctx.collectionOwnerId));
    return rows.map(serializeSlot);
  }),

  setSlot: authenticatedProcedure
    .input(
      slotInput.extend({
        cardId: z.number().int().positive(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [card] = await db
        .select()
        .from(cards)
        .where(and(eq(cards.id, input.cardId), eq(cards.ownerId, ctx.collectionOwnerId)));

      if (!card) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Card not found." });
      }

      const now = new Date();
      const updated = await db.transaction(async (tx) => {
        await tx
          .delete(binderSlots)
          .where(
            and(
              eq(binderSlots.cardId, input.cardId),
              eq(binderSlots.ownerId, ctx.collectionOwnerId),
            ),
          );
        await tx
          .delete(binderSlots)
          .where(
            and(
              eq(binderSlots.pageIndex, input.pageIndex),
              eq(binderSlots.slotIndex, input.slotIndex),
              eq(binderSlots.ownerId, ctx.collectionOwnerId),
            ),
          );

        const [slot] = await tx
          .insert(binderSlots)
          .values({
            cardId: input.cardId,
            ownerId: ctx.collectionOwnerId,
            pageIndex: input.pageIndex,
            slotIndex: input.slotIndex,
            updatedAt: now,
          })
          .returning();

        return slot;
      });

      return serializeSlot(updated);
    }),

  clearSlot: authenticatedProcedure.input(slotInput).mutation(async ({ ctx, input }) => {
    await db
      .delete(binderSlots)
      .where(
        and(
          eq(binderSlots.pageIndex, input.pageIndex),
          eq(binderSlots.slotIndex, input.slotIndex),
          eq(binderSlots.ownerId, ctx.collectionOwnerId),
        ),
      );

    return { ok: true };
  }),

  clearCard: authenticatedProcedure
    .input(z.object({ cardId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      await db
        .delete(binderSlots)
        .where(
          and(
            eq(binderSlots.cardId, input.cardId),
            eq(binderSlots.ownerId, ctx.collectionOwnerId),
          ),
        );
      return { ok: true };
    }),

  swapPages: authenticatedProcedure.input(swapPagesInput).mutation(async ({ ctx, input }) => {
    const now = new Date();
    const pagesToSwap = [input.sourcePageIndex, input.targetPageIndex];

    await db.transaction(async (tx) => {
      const slots = await tx
        .select()
        .from(binderSlots)
        .where(
          and(
            inArray(binderSlots.pageIndex, pagesToSwap),
            eq(binderSlots.ownerId, ctx.collectionOwnerId),
          ),
        );

      await tx
        .delete(binderSlots)
        .where(
          and(
            inArray(binderSlots.pageIndex, pagesToSwap),
            eq(binderSlots.ownerId, ctx.collectionOwnerId),
          ),
        );

      for (const slot of slots) {
        await tx
          .insert(binderSlots)
          .values({
            cardId: slot.cardId,
            ownerId: ctx.collectionOwnerId,
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

  clearAll: authenticatedProcedure.mutation(async ({ ctx }) => {
    await db
      .delete(binderSlots)
      .where(eq(binderSlots.ownerId, ctx.collectionOwnerId));
    return { ok: true };
  }),
});

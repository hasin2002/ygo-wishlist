import { TRPCError } from "@trpc/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { cardTargets, targetBinderSlots } from "@/db/schema";
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

function serializeSlot(slot: typeof targetBinderSlots.$inferSelect) {
  const { ownerId, ...serializedSlot } = slot;
  void ownerId;

  return {
    ...serializedSlot,
    cardId: slot.targetId,
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
      .from(targetBinderSlots)
      .where(eq(targetBinderSlots.ownerId, ctx.collectionOwnerId));
    return rows.map(serializeSlot);
  }),

  setSlot: authenticatedProcedure
    .input(
      slotInput.extend({
        cardId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [card] = await db
        .select()
        .from(cardTargets)
        .where(and(eq(cardTargets.id, input.cardId), eq(cardTargets.ownerId, ctx.collectionOwnerId)));

      if (!card) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Card not found." });
      }

      const now = new Date();
      const updated = await db.transaction(async (tx) => {
        await tx
          .delete(targetBinderSlots)
          .where(
            and(
              eq(targetBinderSlots.targetId, input.cardId),
              eq(targetBinderSlots.ownerId, ctx.collectionOwnerId),
            ),
          );
        await tx
          .delete(targetBinderSlots)
          .where(
            and(
              eq(targetBinderSlots.pageIndex, input.pageIndex),
              eq(targetBinderSlots.slotIndex, input.slotIndex),
              eq(targetBinderSlots.ownerId, ctx.collectionOwnerId),
            ),
          );

        const [slot] = await tx
          .insert(targetBinderSlots)
          .values({
            targetId: input.cardId,
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
      .delete(targetBinderSlots)
      .where(
        and(
          eq(targetBinderSlots.pageIndex, input.pageIndex),
          eq(targetBinderSlots.slotIndex, input.slotIndex),
          eq(targetBinderSlots.ownerId, ctx.collectionOwnerId),
        ),
      );

    return { ok: true };
  }),

  clearCard: authenticatedProcedure
    .input(z.object({ cardId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await db
        .delete(targetBinderSlots)
        .where(
          and(
            eq(targetBinderSlots.targetId, input.cardId),
            eq(targetBinderSlots.ownerId, ctx.collectionOwnerId),
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
        .from(targetBinderSlots)
        .where(
          and(
            inArray(targetBinderSlots.pageIndex, pagesToSwap),
            eq(targetBinderSlots.ownerId, ctx.collectionOwnerId),
          ),
        );

      await tx
        .delete(targetBinderSlots)
        .where(
          and(
            inArray(targetBinderSlots.pageIndex, pagesToSwap),
            eq(targetBinderSlots.ownerId, ctx.collectionOwnerId),
          ),
        );

      for (const slot of slots) {
        await tx
          .insert(targetBinderSlots)
          .values({
            targetId: slot.targetId,
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
      .delete(targetBinderSlots)
      .where(eq(targetBinderSlots.ownerId, ctx.collectionOwnerId));
    return { ok: true };
  }),
});

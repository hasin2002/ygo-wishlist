import { TRPCError } from "@trpc/server";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { featureIdeaPages } from "@/db/schema";
import { adminProcedure, router } from "@/server/trpc";

const boardItemSchema = z.object({
  id: z.string().min(1).max(120),
  text: z.string().max(100_000),
  x: z.number().finite(),
  y: z.number().finite(),
});

const canvasSchema = z.object({
  canvasHeight: z.number().int().min(600).max(100_000),
  canvasWidth: z.number().int().min(800).max(100_000),
  connections: z.array(z.object({
    from: z.string().min(1).max(120),
    id: z.string().min(1).max(120),
    to: z.string().min(1).max(120),
    type: z.enum(["arrow", "line"]),
  })).max(1_000),
  freeTexts: z.array(boardItemSchema).max(500),
  ideas: z.array(boardItemSchema).max(500),
});

function serializePage(page: typeof featureIdeaPages.$inferSelect) {
  return {
    canvas: page.canvas,
    createdAt: page.createdAt.toISOString(),
    id: page.id,
    title: page.title,
    updatedAt: page.updatedAt.toISOString(),
  };
}

export const featureIdeasRouter = router({
  list: adminProcedure.query(async () => {
    const pages = await db.select().from(featureIdeaPages).orderBy(asc(featureIdeaPages.createdAt));
    return pages.map(serializePage);
  }),

  create: adminProcedure.input(z.object({
    canvas: canvasSchema,
    id: z.string().min(1).max(120),
    title: z.string().trim().min(1).max(160),
  })).mutation(async ({ ctx, input }) => {
    const now = new Date();
    const [page] = await db.insert(featureIdeaPages).values({
      ...input,
      createdAt: now,
      createdById: ctx.session.user.id,
      updatedAt: now,
    }).returning();
    return serializePage(page);
  }),

  update: adminProcedure.input(z.object({
    canvas: canvasSchema,
    id: z.string().min(1).max(120),
    title: z.string().trim().min(1).max(160),
  })).mutation(async ({ input }) => {
    const [page] = await db.update(featureIdeaPages).set({
      canvas: input.canvas,
      title: input.title,
      updatedAt: new Date(),
    }).where(eq(featureIdeaPages.id, input.id)).returning();

    if (!page) {
      throw new TRPCError({ code: "NOT_FOUND", message: "This idea page no longer exists." });
    }

    return serializePage(page);
  }),
});

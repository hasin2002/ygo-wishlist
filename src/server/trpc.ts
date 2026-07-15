import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { AuthSession } from "@/lib/auth";
import {
  getPublicCollectionOwnerId,
  getSessionFromHeaders,
} from "@/server/session";

export type TRPCContext = {
  collectionOwnerId: string | null;
  session: AuthSession | null;
};

export async function createTRPCContext(request: Request): Promise<TRPCContext> {
  const session = await getSessionFromHeaders(request.headers);

  return {
    collectionOwnerId: session?.user.id ?? (await getPublicCollectionOwnerId()),
    session,
  };
}

const t = initTRPC.context<TRPCContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;
export const authenticatedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Sign in to change this collection.",
    });
  }

  return next({
    ctx: {
      collectionOwnerId: ctx.session.user.id,
      session: ctx.session,
    },
  });
});

export const adminProcedure = authenticatedProcedure.use(({ ctx, next }) => {
  if (ctx.session.user.role !== "admin") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Administrator access is required.",
    });
  }

  return next({ ctx });
});

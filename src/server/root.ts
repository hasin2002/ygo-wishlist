import { binderRouter } from "@/server/routers/binder";
import { cardsRouter } from "@/server/routers/cards";
import { spendRouter } from "@/server/routers/spend";
import { wheelRouter } from "@/server/routers/wheel";
import { router } from "@/server/trpc";

export const appRouter = router({
  binder: binderRouter,
  cards: cardsRouter,
  spend: spendRouter,
  wheel: wheelRouter,
});

export type AppRouter = typeof appRouter;

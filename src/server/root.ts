import { binderRouter } from "@/server/routers/binder";
import { legacyCardsReadRouter } from "@/server/routers/cards";
import { featureIdeasRouter } from "@/server/routers/feature-ideas";
import { libraryRouter } from "@/server/routers/library";
import { recordsRouter } from "@/server/routers/records";
import { spendRouter } from "@/server/routers/spend";
import { wheelRouter } from "@/server/routers/wheel";
import { router } from "@/server/trpc";

export const appRouter = router({
  binder: binderRouter,
  // `cards` remains the compatibility namespace used by the existing Library
  // screens; Records uses the explicit `library` namespace for Target-only
  // operations such as deleting an unowned Wishlist Target.
  cards: libraryRouter,
  featureIdeas: featureIdeasRouter,
  library: libraryRouter,
  legacyCards: legacyCardsReadRouter,
  records: recordsRouter,
  spend: spendRouter,
  wheel: wheelRouter,
});

export type AppRouter = typeof appRouter;

import { binderRouter } from "@/server/routers/binder";
import { legacyCardsReadRouter } from "@/server/routers/cards";
import { ebayRouter } from "@/server/routers/ebay";
import { libraryRouter } from "@/server/routers/library";
import { recordsRouter } from "@/server/routers/records";
import { spendRouter } from "@/server/routers/spend";
import { wheelRouter } from "@/server/routers/wheel";
import { router } from "@/server/trpc";

export const appRouter = router({
  binder: binderRouter,
  ebay: ebayRouter,
  library: libraryRouter,
  // This temporary migration reader is deliberately separate from Library.
  // It exposes legacy rows only to seed the local Records preview and must not
  // regain mutations or become a Library compatibility namespace.
  legacyCards: legacyCardsReadRouter,
  records: recordsRouter,
  spend: spendRouter,
  wheel: wheelRouter,
});

export type AppRouter = typeof appRouter;

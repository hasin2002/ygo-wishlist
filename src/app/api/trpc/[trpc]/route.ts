import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "@/server/root";
import { createTRPCContext } from "@/server/trpc";

export const runtime = "nodejs";

const handler = (request: Request) =>
  fetchRequestHandler({
    allowMethodOverride: true,
    endpoint: "/api/trpc",
    req: request,
    router: appRouter,
    createContext: () => createTRPCContext(request),
  });

export { handler as GET, handler as POST };

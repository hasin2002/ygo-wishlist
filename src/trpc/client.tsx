"use client";

import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { httpBatchLink } from "@trpc/client";
import { createTRPCReact } from "@trpc/react-query";
import superjson from "superjson";
import type { AppRouter } from "@/server/root";
import { useState, type ReactNode } from "react";

export const trpc = createTRPCReact<AppRouter>();
const requestTimeoutMs = 15_000;
const queryCacheMaxAgeMs = 15 * 60 * 1_000;
export const queryCacheStorageKey = "ygo-wishlist:query-cache:v1";

export function clearPersistedQueryCache() {
  if (typeof window !== "undefined") {
    window.sessionStorage.removeItem(queryCacheStorageKey);
  }
}

function getBaseUrl() {
  if (typeof window !== "undefined") {
    return "";
  }

  return "http://localhost:3000";
}

export function TrpcProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            gcTime: queryCacheMaxAgeMs,
            retry: 1,
            staleTime: 10_000,
          },
        },
      }),
  );
  const [persister] = useState(() =>
    createSyncStoragePersister({
      key: queryCacheStorageKey,
      storage: typeof window === "undefined" ? undefined : window.sessionStorage,
      throttleTime: 1_000,
    }),
  );
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          fetch(url, options) {
            const controller = new AbortController();
            const timeout = window.setTimeout(
              () => controller.abort(),
              requestTimeoutMs,
            );

            options?.signal?.addEventListener(
              "abort",
              () => controller.abort(),
              { once: true },
            );

            return fetch(url, { ...options, signal: controller.signal }).finally(
              () => window.clearTimeout(timeout),
            );
          },
          headers: {
            "ngrok-skip-browser-warning": "true",
          },
          methodOverride: "POST",
          transformer: superjson,
          url: `${getBaseUrl()}/api/trpc`,
        }),
      ],
    }),
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{
          buster: "v1",
          maxAge: queryCacheMaxAgeMs,
          persister,
        }}
      >
        {children}
      </PersistQueryClientProvider>
    </trpc.Provider>
  );
}

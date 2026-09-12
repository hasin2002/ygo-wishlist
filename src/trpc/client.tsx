"use client";

import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { timeoutForRequest } from "@/lib/request-timeout";
import { httpBatchLink } from "@trpc/client";
import { createTRPCReact } from "@trpc/react-query";
import superjson from "superjson";
import {
  deserializeQueryCache,
  legacyQueryCacheStorageKey,
  queryCacheBuster,
  queryCacheStorageKey,
  serializeQueryCache,
} from "@/lib/query-cache-persistence";
import {
  confirmCollectionCacheRevision,
  currentCollectionCacheRevision,
  currentCollectionRevision,
} from "@/lib/collection-change";
import type { AppRouter } from "@/server/root";
import { useState, type ReactNode } from "react";

export const trpc = createTRPCReact<AppRouter>();
const queryCacheMaxAgeMs = 15 * 60 * 1_000;
export { queryCacheStorageKey } from "@/lib/query-cache-persistence";

export function clearPersistedQueryCache() {
  if (typeof window !== "undefined") {
    window.sessionStorage.removeItem(queryCacheStorageKey);
    window.sessionStorage.removeItem(legacyQueryCacheStorageKey);
  }
}

function getBaseUrl() {
  if (typeof window !== "undefined") {
    return "";
  }

  return "http://localhost:3000";
}

export function shouldRetryQuery(failureCount: number, error: unknown) {
  if (failureCount >= 1) return false;
  const message = error instanceof Error ? `${error.name} ${error.message}`.toLowerCase() : String(error).toLowerCase();
  return !message.includes("abort")
    && !message.includes("timeout")
    && !message.includes("took too long")
    && !message.includes("unauthorized")
    && !message.includes("sign in");
}

export function TrpcProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            gcTime: queryCacheMaxAgeMs,
            retry: shouldRetryQuery,
            staleTime: 10_000,
          },
        },
      }),
  );
  const [persister] = useState(() =>
    createSyncStoragePersister({
      key: queryCacheStorageKey,
      deserialize: (value) => deserializeQueryCache(value, currentCollectionRevision(), confirmCollectionCacheRevision),
      serialize: (value) => serializeQueryCache(value, currentCollectionCacheRevision()),
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
            const requestTimeout = timeoutForRequest(url);
            const timeout = window.setTimeout(
              () => controller.abort(new DOMException(requestTimeout.message, "TimeoutError")),
              requestTimeout.milliseconds,
            );

            options?.signal?.addEventListener(
              "abort",
              () => controller.abort(options.signal?.reason ?? new DOMException("The request was cancelled.", "AbortError")),
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
          buster: queryCacheBuster,
          maxAge: queryCacheMaxAgeMs,
          persister,
        }}
      >
        {children}
      </PersistQueryClientProvider>
    </trpc.Provider>
  );
}

"use client";

import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
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
const requestTimeoutMs = 15_000;
const purchaseRequestTimeoutMs = 60_000;
const requestTimeoutMessage = "The request took too long. Check your connection, then try again.";
const purchaseRequestTimeoutMessage = "This Purchase is taking longer than expected and may still have been saved. Check Records History before retrying; a retry will not create a duplicate.";
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

function timeoutForRequest(url: RequestInfo | URL) {
  return String(url).includes("records.createPurchase")
    ? {
        message: purchaseRequestTimeoutMessage,
        milliseconds: purchaseRequestTimeoutMs,
      }
    : {
        message: requestTimeoutMessage,
        milliseconds: requestTimeoutMs,
      };
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

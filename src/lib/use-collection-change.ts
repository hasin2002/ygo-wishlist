"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect } from "react";
import {
  collectionInvalidationMatrix,
  confirmCollectionCacheRevision,
  isCollectionChangeStorageEvent,
  nextCollectionChange,
  parseCollectionChange,
  publishCollectionChange,
  settleCollectionPropagation,
  type CollectionChange,
} from "@/lib/collection-change";
import { hasFailedActiveCollectionQuery } from "@/lib/query-cache-persistence";
import { trpc } from "@/trpc/client";

export class CollectionRefreshError extends Error {
  readonly changeConfirmed = true;
  constructor(readonly stage: "refresh" | "broadcast", message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CollectionRefreshError";
  }
}

export function collectionRefreshFailureMessage(error: unknown) {
  if (error instanceof CollectionRefreshError) return error.message;
  return error instanceof Error ? error.message : "The change was saved, but related screens could not be refreshed.";
}

/** Mutation-to-projection matrix; do not replace this with a global refetch. */
function useRefreshCollection() {
  const utils = trpc.useUtils();
  const queryClient = useQueryClient();
  const refresh = useCallback(async (change: CollectionChange) => {
    const invalidators = {
      "library.binderList": () => utils.library.binderList.invalidate(),
      "library.chaseQueue": () => utils.library.chaseQueue.invalidate(),
      "library.list": () => utils.library.list.invalidate(),
      "library.summary": () => utils.library.summary.invalidate(),
      "library.trackerPage": () => utils.library.trackerPage.invalidate(),
      "binder.layout": () => utils.binder.layout.invalidate(),
      "spend.currentMonth": () => utils.spend.currentMonth.invalidate(),
      "spend.monthlyFavourites": () => utils.spend.monthlyFavourites.invalidate(),
      "wheel.state": () => utils.wheel.state.invalidate(),
      "records.snapshot": () => utils.records.snapshot.invalidate(),
      "records.actions": () => utils.records.actions.invalidate(),
      "records.history": () => utils.records.history.invalidate(),
      "records.listEbayListings": () => utils.records.listEbayListings.invalidate(),
    };
    const projections = new Set<string>(collectionInvalidationMatrix[change]);
    try {
      await Promise.all(collectionInvalidationMatrix[change].map((projection) => invalidators[projection]()));
    } catch (error) {
      throw new CollectionRefreshError("refresh", "The change was saved, but related screens could not be refreshed. Refresh them before making another change.", { cause: error });
    }
    const allQueries = queryClient.getQueryCache().getAll();
    const failedActiveQuery = hasFailedActiveCollectionQuery(
      allQueries.map((query) => ({
        observerCount: query.getObserversCount(),
        queryKey: query.queryKey,
        status: query.state.status,
      })),
      projections,
    );
    if (failedActiveQuery) {
      throw new CollectionRefreshError("refresh", "The change was saved, but an open collection screen failed to refresh. Refresh that screen before making another change.");
    }
  }, [queryClient, utils]);

  return refresh;
}

/** Install once near the query provider so each storage event triggers one refresh. */
export function useCollectionChangeListener() {
  const refresh = useRefreshCollection();
  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (!isCollectionChangeStorageEvent(event.key, event.newValue)) return;
      const message = parseCollectionChange(event.newValue);
      if (message) void refresh(message.change)
        .then(() => confirmCollectionCacheRevision(message.revision))
        .catch(() => undefined);
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [refresh]);
}

export function useCollectionChange() {
  const refresh = useRefreshCollection();
  return useCallback(async (change: CollectionChange) => {
    let message;
    try {
      message = await nextCollectionChange(change);
    } catch (error) {
      try {
        await refresh(change);
      } catch (refreshError) {
        throw new CollectionRefreshError("refresh", "The change was saved, but this screen could not refresh and other tabs could not be notified. Refresh all open collection screens manually.", { cause: refreshError });
      }
      throw new CollectionRefreshError("broadcast", "The change was saved and this screen refreshed, but other tabs could not be notified. Refresh other open tabs manually.", { cause: error });
    }
    const { refreshError, broadcastError } = await settleCollectionPropagation(
      async () => {
        await refresh(change);
        confirmCollectionCacheRevision(message.revision);
      },
      () => publishCollectionChange(message),
    );
    if (refreshError && broadcastError) {
      throw new CollectionRefreshError("refresh", "The change was saved, but this screen could not refresh and other tabs could not be notified. Refresh all open collection screens manually.", { cause: refreshError });
    }
    if (refreshError) throw refreshError;
    if (broadcastError) {
      throw new CollectionRefreshError("broadcast", "The change was saved and this screen refreshed, but other tabs could not be notified. Refresh other open tabs manually.", { cause: broadcastError });
    }
  }, [refresh]);
}

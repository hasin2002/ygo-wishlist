import superjson from "superjson";
import {
  compareCollectionRevisions,
  normalizeCollectionRevision,
  type CollectionRevision,
} from "./collection-change.ts";

export const legacyQueryCacheStorageKey = "ygo-wishlist:query-cache:v1";
export const queryCacheStorageKey = "ygo-wishlist:query-cache:v4";
export const queryCacheBuster = "v4";

type PersistedEnvelope = { cache: unknown; collectionRevision: CollectionRevision };
type PersistedQuery = { queryKey?: unknown; state?: { isInvalidated?: boolean } };

const collectionQueryPaths = new Set([
  "records.snapshot",
  "records.listEbayListings",
  "library.binderList",
  "library.chaseQueue",
  "library.list",
  "library.summary",
  "library.trackerPage",
  "binder.layout",
  "spend.currentMonth",
  "spend.monthlyFavourites",
  "wheel.state",
]);

export function collectionQueryPath(queryKey: unknown) {
  if (!Array.isArray(queryKey) || !Array.isArray(queryKey[0])) return null;
  const path = queryKey[0];
  if (path.length !== 2 || path.some((part) => typeof part !== "string")) return null;
  const key = `${path[0]}.${path[1]}`;
  return collectionQueryPaths.has(key) ? key : null;
}

export type CollectionQueryStatus = {
  observerCount: number;
  queryKey: unknown;
  status: string;
};

export function hasFailedActiveCollectionQuery(
  queries: readonly CollectionQueryStatus[],
  projections: ReadonlySet<string>,
) {
  return queries.some((query) => {
    const projection = collectionQueryPath(query.queryKey);
    return projection !== null &&
      projections.has(projection) &&
      query.observerCount > 0 &&
      query.status === "error";
  });
}

function filterPersistedQueries(cache: unknown, shouldDiscard: (query: PersistedQuery) => boolean) {
  if (!cache || typeof cache !== "object") return cache;
  const persisted = cache as { clientState?: { queries?: PersistedQuery[] }; queries?: PersistedQuery[] };
  const queries = persisted.clientState?.queries ?? persisted.queries;
  if (!queries) return cache;
  const nextQueries = queries.filter((query) => !shouldDiscard(query));
  return persisted.clientState?.queries
    ? { ...persisted, clientState: { ...persisted.clientState, queries: nextQueries } }
    : { ...persisted, queries: nextQueries };
}

function discardStaleCollectionQueries(cache: unknown) {
  return filterPersistedQueries(cache, (query) => collectionQueryPath(query.queryKey) !== null);
}

function discardInvalidatedQueries(cache: unknown) {
  return filterPersistedQueries(cache, (query) => query.state?.isInvalidated === true);
}

/**
 * tRPC returns Dates through SuperJSON. The persisted React Query cache must
 * use the same transformer or a browser reload changes those Dates to strings.
 */
export function serializeQueryCache(value: unknown, collectionRevision: CollectionRevision | number = "0:initial:0") {
  // A mutation marks affected queries invalid before their refetch settles.
  // Never persist that old payload with the newly-confirmed revision.
  return superjson.stringify({
    cache: discardInvalidatedQueries(value),
    collectionRevision: normalizeCollectionRevision(collectionRevision) ?? "0:initial:0",
  } satisfies PersistedEnvelope);
}

export function deserializeQueryCache<T>(
  value: string,
  minimumCollectionRevision: CollectionRevision | number = "0:initial:0",
  onAcceptedRevision?: (revision: CollectionRevision) => void,
) {
  const parsed = superjson.parse<unknown>(value);
  if (!parsed || typeof parsed !== "object" || !("cache" in parsed)) return parsed as T;
  const envelope = parsed as PersistedEnvelope;
  const persistedRevision = normalizeCollectionRevision(envelope.collectionRevision);
  const minimumRevision = normalizeCollectionRevision(minimumCollectionRevision) ?? "0:initial:0";
  if (!persistedRevision || compareCollectionRevisions(persistedRevision, minimumRevision) < 0) {
    return discardStaleCollectionQueries(envelope.cache) as T;
  }
  onAcceptedRevision?.(persistedRevision);
  return envelope.cache as T;
}

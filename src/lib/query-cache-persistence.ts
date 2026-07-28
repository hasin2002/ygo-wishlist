import superjson from "superjson";

export const legacyQueryCacheStorageKey = "ygo-wishlist:query-cache:v1";
export const queryCacheStorageKey = "ygo-wishlist:query-cache:v2";
export const queryCacheBuster = "v2";

/**
 * tRPC returns Dates through SuperJSON. The persisted React Query cache must
 * use the same transformer or a browser reload changes those Dates to strings.
 */
export function serializeQueryCache(value: unknown) {
  return superjson.stringify(value);
}

export function deserializeQueryCache<T>(value: string) {
  return superjson.parse<T>(value);
}

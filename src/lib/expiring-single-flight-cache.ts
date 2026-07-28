type CachedValue<T> = {
  expiresAt: number;
  value: T;
};

/**
 * Small in-process cache for renewable credentials. It avoids concurrent
 * refreshes for the same owner without making the credential durable.
 */
export function createExpiringSingleFlightCache<T>(
  now: () => number = Date.now,
) {
  const cached = new Map<string, CachedValue<T>>();
  const pending = new Map<string, Promise<T>>();
  const generations = new Map<string, number>();

  return {
    async get(
      key: string,
      load: () => Promise<CachedValue<T>>,
    ) {
      const current = cached.get(key);
      if (current && current.expiresAt > now()) return current.value;

      const inFlight = pending.get(key);
      if (inFlight) return inFlight;

      const generation = generations.get(key) ?? 0;
      const next = load()
        .then((value) => {
          if ((generations.get(key) ?? 0) === generation) {
            cached.set(key, value);
          }
          return value.value;
        })
        .finally(() => {
          if (pending.get(key) === next) pending.delete(key);
        });
      pending.set(key, next);
      return next;
    },
    invalidate(key: string) {
      cached.delete(key);
      pending.delete(key);
      generations.set(key, (generations.get(key) ?? 0) + 1);
    },
  };
}

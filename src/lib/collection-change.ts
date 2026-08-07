/** A confirmed mutation expressed in terms of affected collection projections. */
export type CollectionChange =
  | "binder"
  | "copies"
  | "favourite"
  | "listing"
  | "photos"
  | "records"
  | "target"
  | "wheel";

export const collectionRevisionStorageKey = "ygo-wishlist:collection-revision:v1";
export const collectionChangeStorageKey = "ygo-wishlist:collection-change:v1";

/**
 * A sortable, cross-tab revision. The source and sequence make concurrent
 * reservations distinct even when they observe the same storage watermark.
 */
export type CollectionRevision = `${number}:${string}:${number}`;

export type CollectionChangeMessage = { change: CollectionChange; revision: CollectionRevision };

export type ConfirmedChangeOutcome<T> =
  | { ok: false; error: unknown }
  | { ok: true; value: T; refreshError?: unknown };

/** Keep server confirmation distinct from the best-effort projection refresh. */
export async function settleConfirmedChange<T>(
  write: () => Promise<T>,
  refresh: () => Promise<unknown>,
): Promise<ConfirmedChangeOutcome<T>> {
  let value: T;
  try {
    value = await write();
  } catch (error) {
    return { ok: false, error };
  }
  try {
    await refresh();
    return { ok: true, value };
  } catch (refreshError) {
    return { ok: true, value, refreshError };
  }
}

export async function settleCollectionPropagation(
  refresh: () => Promise<unknown>,
  broadcast: () => Promise<unknown> | unknown,
) {
  let refreshError: unknown;
  let broadcastError: unknown;
  try {
    await refresh();
  } catch (error) {
    refreshError = error;
  }
  try {
    await broadcast();
  } catch (error) {
    broadcastError = error;
  }
  return { refreshError, broadcastError };
}

export const collectionInvalidationMatrix = {
  target: ["records.snapshot", "library.binderList", "library.chaseQueue", "library.list", "library.summary", "library.trackerPage", "binder.layout", "spend.currentMonth", "spend.monthlyFavourites", "wheel.state"],
  copies: ["records.snapshot", "records.listEbayListings", "library.binderList", "library.chaseQueue", "library.list", "library.summary", "library.trackerPage", "binder.layout", "spend.currentMonth", "spend.monthlyFavourites", "wheel.state"],
  records: ["records.snapshot", "records.history", "records.listEbayListings", "library.binderList", "library.chaseQueue", "library.list", "library.summary", "library.trackerPage", "binder.layout", "spend.currentMonth", "spend.monthlyFavourites", "wheel.state"],
  binder: ["binder.layout"],
  favourite: ["spend.monthlyFavourites"],
  wheel: ["wheel.state"],
  listing: ["records.snapshot", "records.listEbayListings"],
  photos: ["records.snapshot", "records.listEbayListings"],
} as const;

export type CollectionProjection = (typeof collectionInvalidationMatrix)[CollectionChange][number];

export type CollectionStorage = Pick<Storage, "getItem" | "setItem">;

function storage(): CollectionStorage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

const initialCollectionRevision = "0:initial:0" as CollectionRevision;
const legacyRevisionSource = "legacy";
const collectionRevisionSource = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
  ? crypto.randomUUID().replace(/-/g, "")
  : `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

let issuedRevisionClock = 0;
let issuedRevisionSequence = 0;
let collectionCacheRevision = initialCollectionRevision;

type ParsedCollectionRevision = {
  clock: number;
  sequence: number;
  source: string;
  value: CollectionRevision;
};

/** Accept numeric v1 revisions so a current tab can safely supersede them. */
export function normalizeCollectionRevision(value: unknown): CollectionRevision | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return `${value}:${legacyRevisionSource}:0` as CollectionRevision;
  }
  if (typeof value !== "string") return null;
  const legacy = Number(value);
  if (/^\d+$/.test(value) && Number.isSafeInteger(legacy) && legacy >= 0) {
    return `${legacy}:${legacyRevisionSource}:0` as CollectionRevision;
  }
  const match = /^(\d+):([a-z0-9-]+):(\d+)$/.exec(value);
  if (!match) return null;
  const clock = Number(match[1]);
  const sequence = Number(match[3]);
  return Number.isSafeInteger(clock) && clock >= 0 && Number.isSafeInteger(sequence) && sequence >= 0
    ? value as CollectionRevision
    : null;
}

function parseCollectionRevision(value: unknown): ParsedCollectionRevision | null {
  const normalized = normalizeCollectionRevision(value);
  if (!normalized) return null;
  const [clockText, source, sequenceText] = normalized.split(":");
  return {
    clock: Number(clockText),
    sequence: Number(sequenceText),
    source,
    value: normalized,
  };
}

/** Compare revisions by logical time, source, then local sequence. */
export function compareCollectionRevisions(left: unknown, right: unknown) {
  const a = parseCollectionRevision(left);
  const b = parseCollectionRevision(right);
  if (!a || !b) return a ? 1 : b ? -1 : 0;
  if (a.clock !== b.clock) return a.clock < b.clock ? -1 : 1;
  if (a.source !== b.source) return a.source < b.source ? -1 : 1;
  if (a.sequence !== b.sequence) return a.sequence < b.sequence ? -1 : 1;
  return 0;
}

function issueCollectionRevision(browserStorage: CollectionStorage) {
  const observed = parseCollectionRevision(browserStorage.getItem(collectionRevisionStorageKey));
  const clock = Math.max(
    Date.now(),
    (observed?.clock ?? 0) + 1,
    issuedRevisionClock + 1,
  );
  issuedRevisionSequence = clock === issuedRevisionClock ? issuedRevisionSequence + 1 : 0;
  issuedRevisionClock = clock;
  return `${clock}:${collectionRevisionSource}:${issuedRevisionSequence}` as CollectionRevision;
}

/** Revision actually represented by this tab's in-memory query data. */
export function currentCollectionCacheRevision() {
  return collectionCacheRevision;
}

export function confirmCollectionCacheRevision(revision: CollectionRevision | number) {
  const normalized = normalizeCollectionRevision(revision);
  if (normalized && compareCollectionRevisions(normalized, collectionCacheRevision) >= 0) {
    collectionCacheRevision = normalized;
  }
}

export function currentCollectionRevision(browserStorage: CollectionStorage | null = storage()) {
  return normalizeCollectionRevision(browserStorage?.getItem(collectionRevisionStorageKey))
    ?? initialCollectionRevision;
}

/**
 * Reserve a unique shared freshness watermark after server confirmation.
 *
 * localStorage has no compare-and-set operation. The source and sequence make
 * independently issued revisions distinct; publication then retains the
 * deterministic maximum watermark rather than letting a slower tab regress it.
 */
export async function nextCollectionChange(
  change: CollectionChange,
  browserStorage: CollectionStorage | null = storage(),
): Promise<CollectionChangeMessage> {
  if (!browserStorage) throw new Error("Browser storage is unavailable.");
  const message = { change, revision: issueCollectionRevision(browserStorage) };
  const current = currentCollectionRevision(browserStorage);
  const watermark = compareCollectionRevisions(current, message.revision) >= 0
    ? current
    : message.revision;
  browserStorage.setItem(collectionRevisionStorageKey, watermark);
  return message;
}

export function publishCollectionChange(
  message: CollectionChangeMessage,
  browserStorage: CollectionStorage | null = storage(),
) {
  if (!browserStorage) throw new Error("Browser storage is unavailable.");
  const current = currentCollectionRevision(browserStorage);
  const watermark = compareCollectionRevisions(current, message.revision) >= 0
    ? current
    : message.revision;
  browserStorage.setItem(collectionRevisionStorageKey, watermark);
  browserStorage.setItem(collectionChangeStorageKey, JSON.stringify(message));
  return message;
}

export function parseCollectionChange(value: string | null): CollectionChangeMessage | null {
  if (!value) return null;
  try {
    const message = JSON.parse(value) as Partial<CollectionChangeMessage>;
    const revision = normalizeCollectionRevision(message.revision);
    return revision &&
      ["binder", "copies", "favourite", "listing", "photos", "records", "target", "wheel"].includes(message.change ?? "")
      ? { change: message.change as CollectionChange, revision }
      : null;
  } catch {
    return null;
  }
}

export function isCollectionChangeStorageEvent(
  key: string | null,
  value: string | null,
  expectedChange?: CollectionChange,
) {
  if (key !== collectionChangeStorageKey) return false;
  const message = parseCollectionChange(value);
  return Boolean(message && (!expectedChange || message.change === expectedChange));
}

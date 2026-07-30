export const formDraftVersion = 2 as const;

export type FormDraftWorkflow =
  | "purchase"
  | "pack-opening"
  | "sale"
  | "ebay-listing"
  | "ebay-mixed-lot";

export type FormDraftIntent = {
  kind: "none" | "wishlist-target" | "sealed-unit" | "copy";
  id: string | null;
  label?: string;
};

export type FormDraftEnvelope<T> = {
  version: typeof formDraftVersion;
  workflow: FormDraftWorkflow;
  ownerScope: string;
  createdAt: string;
  updatedAt: string;
  origin: string;
  intent: FormDraftIntent;
  data: T;
};

type SessionStorageLike = Pick<Storage, "getItem" | "key" | "length" | "removeItem">;

const noIntent: FormDraftIntent = { kind: "none", id: null };

export function localCalendarDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formDraftStorageKey(
  workflow: FormDraftWorkflow,
  ownerScope: string,
  identity?: string,
) {
  return [
    "ygo-library",
    "form-draft",
    `v${formDraftVersion}`,
    encodeURIComponent(ownerScope),
    workflow,
    identity ? encodeURIComponent(identity) : null,
  ].filter(Boolean).join(":");
}

export function createFormDraftEnvelope<T>({
  data,
  existing,
  intent = noIntent,
  origin,
  ownerScope,
  workflow,
  now = new Date(),
}: {
  data: T;
  existing?: FormDraftEnvelope<T> | null;
  intent?: FormDraftIntent;
  origin: string;
  ownerScope: string;
  workflow: FormDraftWorkflow;
  now?: Date;
}): FormDraftEnvelope<T> {
  const updatedAt = now.toISOString();
  return {
    version: formDraftVersion,
    workflow,
    ownerScope,
    createdAt: existing?.createdAt ?? updatedAt,
    updatedAt,
    origin: existing?.origin ?? origin,
    intent,
    data,
  };
}

export function parseFormDraftEnvelope<T>(
  value: unknown,
  expected: { ownerScope: string; workflow: FormDraftWorkflow },
): FormDraftEnvelope<T> | null {
  if (!value || typeof value !== "object") return null;
  const envelope = value as Partial<FormDraftEnvelope<T>>;
  if (
    envelope.version !== formDraftVersion
    || envelope.workflow !== expected.workflow
    || envelope.ownerScope !== expected.ownerScope
    || typeof envelope.createdAt !== "string"
    || typeof envelope.updatedAt !== "string"
    || typeof envelope.origin !== "string"
    || !envelope.intent
    || typeof envelope.intent !== "object"
    || !("data" in envelope)
  ) {
    return null;
  }
  return envelope as FormDraftEnvelope<T>;
}

export function formDraftIntentConflict(
  saved: FormDraftIntent | null | undefined,
  incoming: FormDraftIntent | null | undefined,
) {
  if (!incoming || incoming.kind === "none" || incoming.id === null) return false;
  // A draft without a route target is still a different piece of work from an
  // explicitly requested target. Silently restoring it would discard the
  // requested target's prefill and make the user believe they are editing it.
  if (!saved || saved.kind === "none" || saved.id === null) return true;
  return saved.kind !== incoming.kind || saved.id !== incoming.id;
}

export function formDraftIntentMatches(
  saved: FormDraftIntent | null | undefined,
  incoming: FormDraftIntent | null | undefined,
) {
  if (!saved || !incoming) return false;
  return saved.kind === incoming.kind && saved.id === incoming.id;
}

/**
 * A changed owner/workflow/Copy key remains read-only until that exact key has
 * hydrated. This is kept pure so the isolation invariant is directly tested.
 */
export function canPersistFormDraft({
  conflict,
  data,
  hydratedScope,
  initialData,
  storageKey,
}: {
  conflict: unknown;
  data: unknown;
  hydratedScope: string | null;
  initialData: unknown;
  storageKey: string;
}) {
  return hydratedScope === storageKey
    && !conflict
    && JSON.stringify(data) !== JSON.stringify(initialData);
}

/** Finds the newest conflicting exact-Copy draft without ever copying it. */
export function findLatestIdentityDraftConflict<T>({
  incomingIntent,
  isValidData,
  ownerScope,
  storage,
  storageKey,
  workflow,
}: {
  incomingIntent: FormDraftIntent;
  isValidData: (value: unknown) => value is T;
  ownerScope: string;
  storage: SessionStorageLike;
  storageKey: string;
  workflow: FormDraftWorkflow;
}): FormDraftEnvelope<T> | null {
  if (incomingIntent.kind !== "copy" || !incomingIntent.id) return null;
  const prefix = `${formDraftStorageKey(workflow, ownerScope)}:`;
  const candidates: FormDraftEnvelope<T>[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key || key === storageKey || !key.startsWith(prefix)) continue;
    const raw = storage.getItem(key);
    if (!raw) continue;
    try {
      const candidate = parseFormDraftEnvelope<T>(JSON.parse(raw), { ownerScope, workflow });
      if (candidate && isValidData(candidate.data) && formDraftIntentConflict(candidate.intent, incomingIntent)) {
        candidates.push(candidate);
      }
    } catch {
      storage.removeItem(key);
    }
  }
  return candidates.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null;
}

type UnknownRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isString(value: unknown): value is string {
  return typeof value === "string";
}

export function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

export function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

export function isInteger(value: unknown): value is number {
  return Number.isInteger(value);
}

export function isOneOf<T extends readonly string[]>(value: unknown, options: T): value is T[number] {
  return typeof value === "string" && options.includes(value);
}

export function hasFields(value: UnknownRecord, fields: readonly string[]) {
  return fields.every((field) => field in value);
}

const editions = ["", "1st Edition", "Unlimited Edition", "Limited Edition"] as const;
const fetchStatuses = ["idle", "fetching", "resolved", "attention", "stale"] as const;

/** Structural validation for the persisted ProductIdentityDraft payload. */
export function isProductIdentityDraft(value: unknown): value is UnknownRecord {
  if (!isRecord(value) || !hasFields(value, [
    "selectedTargetId", "tcgplayerUrl", "name", "imageUrl", "edition", "rarity",
    "setName", "setCode", "cardType", "fetchStatus", "fetchAttempted", "fetchMessage",
    "metadataNeedsAttention", "editedFields",
  ])) return false;
  return isNullableString(value.selectedTargetId)
    && isString(value.tcgplayerUrl)
    && isString(value.name)
    && isNullableString(value.imageUrl)
    && isOneOf(value.edition, editions)
    && isString(value.rarity)
    && isString(value.setName)
    && isString(value.setCode)
    && isString(value.cardType)
    && isOneOf(value.fetchStatus, fetchStatuses)
    && isBoolean(value.fetchAttempted)
    && isString(value.fetchMessage)
    && isBoolean(value.metadataNeedsAttention)
    && Array.isArray(value.editedFields)
    && value.editedFields.every(isString);
}

export function isCardContentsDraft(value: unknown): value is UnknownRecord {
  return isProductIdentityDraft(value)
    && isString(value.id)
    && isInteger(value.quantity);
}

export function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every(isString);
}

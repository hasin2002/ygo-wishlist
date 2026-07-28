export function toEbayListingTimestamp(
  value: Date | string | null | undefined,
) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  }

  if (typeof value === "string") {
    return Number.isNaN(new Date(value).getTime()) ? undefined : value;
  }

  return undefined;
}

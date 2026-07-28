export const ebayListingLifecycleFilters = [
  "all",
  "live",
  "pending",
  "paid",
  "ended",
  "cancelled",
  "needs_attention",
] as const;

export const ebayListingCompositionFilters = [
  "all",
  "individual",
  "quantity",
  "bundle",
] as const;

export type EbayListingLifecycleFilter = typeof ebayListingLifecycleFilters[number];
export type EbayListingCompositionFilter = typeof ebayListingCompositionFilters[number];

export type EbayListingsRouteState = {
  composition: EbayListingCompositionFilter;
  lifecycle: EbayListingLifecycleFilter;
  page: number;
  query: string;
};

export const defaultEbayListingsRouteState: EbayListingsRouteState = {
  composition: "all",
  lifecycle: "all",
  page: 1,
  query: "",
};

function positiveInteger(value: string | null) {
  if (!value || !/^[1-9]\d*$/.test(value)) return 1;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : 1;
}

function valueIn<T extends readonly string[]>(value: string | null, allowed: T, fallback: T[number]) {
  return value && (allowed as readonly string[]).includes(value) ? value as T[number] : fallback;
}

export function parseEbayListingsRouteState(searchParams: URLSearchParams): EbayListingsRouteState {
  return {
    composition: valueIn(searchParams.get("composition"), ebayListingCompositionFilters, "all"),
    lifecycle: valueIn(searchParams.get("lifecycle"), ebayListingLifecycleFilters, "all"),
    page: positiveInteger(searchParams.get("page")),
    query: searchParams.get("query")?.trim().slice(0, 160) ?? "",
  };
}

export function serializeEbayListingsRouteState(state: EbayListingsRouteState) {
  const searchParams = new URLSearchParams();
  if (state.query) searchParams.set("query", state.query);
  if (state.lifecycle !== "all") searchParams.set("lifecycle", state.lifecycle);
  if (state.composition !== "all") searchParams.set("composition", state.composition);
  if (state.page > 1) searchParams.set("page", String(state.page));
  return searchParams;
}

export function ebayListingsHref(state: EbayListingsRouteState) {
  const query = serializeEbayListingsRouteState(state).toString();
  return query ? `/records/listings?${query}` : "/records/listings";
}

export function ebayListingDetailHref(listingId: string, state: EbayListingsRouteState) {
  const query = serializeEbayListingsRouteState(state).toString();
  const path = `/records/listings/${encodeURIComponent(listingId)}`;
  return query ? `${path}?${query}` : path;
}

export function searchParamsFromPage(
  values: Record<string, string | string[] | undefined>,
) {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (Array.isArray(value)) value.forEach((item) => searchParams.append(key, item));
    else if (typeof value === "string") searchParams.set(key, value);
  }
  return searchParams;
}

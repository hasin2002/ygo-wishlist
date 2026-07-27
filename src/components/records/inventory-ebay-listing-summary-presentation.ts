export type InventoryEbayListingSummary = {
  accessibleLabel: string;
  heading: "eBay listings";
  summary: string;
};

function pluralise(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * Returns compact, card-level listing language without conflating eBay state
 * with physical ownership. Ended listings are intentionally described as
 * "previous" so they do not read as currently for sale.
 */
export function inventoryEbayListingSummary(
  liveOfferCount: number,
  endedOfferCount: number,
): InventoryEbayListingSummary {
  const live = Math.max(0, Math.trunc(liveOfferCount));
  const previous = Math.max(0, Math.trunc(endedOfferCount));
  const parts = [
    ...(live ? [pluralise(live, "live offer")] : []),
    ...(previous ? [pluralise(previous, "previous offer")] : []),
  ];
  const summary = parts.length ? parts.join(" · ") : "No eBay listings yet";

  return {
    accessibleLabel: `eBay listings. ${summary}.`,
    heading: "eBay listings",
    summary,
  };
}

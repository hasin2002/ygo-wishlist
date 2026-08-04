const purchaseNotificationTopics = new Set([
  "TRADING_FixedPriceTransaction",
  "TRADING_AuctionCheckoutComplete",
]);

export function ebayNotificationSaleStateObserved(listing: {
  quantitySold: number | null;
  saleState: string;
}) {
  return (listing.quantitySold ?? 0) > 0 || ["pending", "paid", "cancelled"]
    .includes(listing.saleState);
}

export function ebayPurchaseNotificationNeedsRetry(
  topic: string,
  listings: ReadonlyArray<{ quantitySold: number | null; saleState: string }>,
) {
  return purchaseNotificationTopics.has(topic)
    && listings.some((listing) => !ebayNotificationSaleStateObserved(listing));
}

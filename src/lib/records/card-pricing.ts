function normalize(value: string) {
  return value.trim().toLocaleLowerCase("en-GB").replace(/\s+/g, " ");
}

/** One eBay estimate per shared Target identity, never per physical Copy. */
export function cardPricingIdentityKey(card: {
  edition: string;
  name: string;
  rarity: string;
  selectedTargetId?: string | null;
}) {
  return card.selectedTargetId
    ?? [normalize(card.name), normalize(card.rarity), normalize(card.edition)].join("::");
}

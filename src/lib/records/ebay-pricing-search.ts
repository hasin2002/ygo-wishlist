export type EbayPricingSearchCard = {
  condition?: string | null;
  name: string;
  rarity?: string | null;
  setCode?: string | null;
};

function normalizeText(value: string) {
  return value
    .toLocaleLowerCase("en-GB")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function searchablePricingCardName(name: string) {
  return name
    .replace(
      /\s*\((?:new art|alternate art|\d+(?:st|nd|rd|th) art|quarter century secret rare|[a-z])\)/gi,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
}

export function ebayPricingSearchTerms(card: EbayPricingSearchCard, includeCondition: boolean) {
  return card.setCode
    ? [searchablePricingCardName(card.name), card.setCode, includeCondition ? card.condition : null, "english"]
      .filter(Boolean)
      .join(" ")
    : [searchablePricingCardName(card.name), card.rarity, "english"]
      .filter(Boolean)
      .join(" ");
}

function normalizedSetCode(value: string) {
  return normalizeText(value).replace(/[^a-z0-9]/g, "");
}

/**
 * Listings often omit the set code. Accept that omission, but reject a title
 * which names a clearly different Yu-Gi-Oh! Printing code.
 */
export function ebayTitleMatchesSetCode(title: string, setCode: string | null | undefined) {
  if (!setCode) return true;
  const expected = normalizedSetCode(setCode);
  const normalizedTitle = normalizedSetCode(title);
  if (normalizedTitle.includes(expected)) return true;

  const explicitCodes = title.match(
    /\b(?:[a-z0-9]{2,6}[-\s]?en[a-z]?\d{1,4}|[a-z]{2,6}[-\s]?\d{3,4})\b/gi,
  ) ?? [];
  return explicitCodes.length === 0;
}

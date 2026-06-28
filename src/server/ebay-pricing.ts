import { db } from "@/db";
import { cards } from "@/db/schema";
import { eq } from "drizzle-orm";

const excludedTitleTerms = [
  "unlimited",
  "unlim",
  "unltd",
  "proxy",
  "orica",
  "custom",
  "digital",
  "field center",
  "field centre",
  "game mat",
  "playmat",
  "deck and",
  "deck box",
  "sleeves",
  "booster",
  "sealed",
  "pack",
  "box",
  "case",
  "bundle",
  "job lot",
  "bulk",
  "mixed lot",
  "collection",
  "japanese",
  "korean",
  "german",
  "spanish",
  "italian",
  "french",
  "portuguese",
  "ocg",
];
const excludedTitlePatterns = [
  /\bpsa\b/,
  /\bbgs\b/,
  /\bcgc\b/,
  /\bsgc\b/,
  /\bbeckett\b/,
  /\bgraded\b/,
  /\bslabbed\b/,
  /\bslab\b/,
  /\bgem\s+mint\b/,
  /\bpristine\s+10\b/,
  /\bgrade\s+\d+(?:\.\d+)?\b/,
  /\b(?:psa|bgs|cgc|sgc)\s*\d+(?:\.\d+)?\b/,
];
const ebayCardCategoryId = "183454";

function normalizeText(value: string | null | undefined) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9£$.\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function searchableCardName(name: string) {
  return name
    .replace(
      /\s*\((?:new art|alternate art|\d+(?:st|nd|rd|th) art|quarter century secret rare|[a-z])\)/gi,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
}

function shouldExclude(title: string) {
  const normalized = normalizeText(title);
  return (
    excludedTitleTerms.some((term) => normalized.includes(term)) ||
    excludedTitlePatterns.some((pattern) => pattern.test(normalized))
  );
}

function titleMatchesName(title: string, name: string) {
  const normalizedTitle = normalizeText(title);
  const tokens = normalizeText(searchableCardName(name))
    .split(" ")
    .filter((token) => token.length > 2);

  if (!tokens.length) {
    return false;
  }

  const matches = tokens.filter((token) => normalizedTitle.includes(token));
  return matches.length / tokens.length >= 0.75;
}

function titleMatchesRarity(title: string, rarity: string | null) {
  if (!rarity) {
    return true;
  }

  const normalizedTitle = normalizeText(title);
  const normalizedRarity = normalizeText(rarity);

  if (normalizedRarity === "quarter century secret rare") {
    return (
      normalizedTitle.includes("quarter century") ||
      normalizedTitle.includes("qcsr") ||
      normalizedTitle.includes("qcr") ||
      normalizedTitle.includes("25th secret rare")
    );
  }

  if (normalizedRarity === "overframe ultra rare") {
    return (
      normalizedTitle.includes("overframe ultra rare") ||
      normalizedTitle.includes("over frame ultra rare")
    );
  }

  if (
    normalizedRarity === "overframe starlight rare" ||
    normalizedRarity === "overframe startlight rare"
  ) {
    return (
      normalizedTitle.includes("overframe starlight rare") ||
      normalizedTitle.includes("over frame starlight rare") ||
      normalizedTitle.includes("overframe startlight rare") ||
      normalizedTitle.includes("over frame startlight rare")
    );
  }

  return normalizedTitle.includes(normalizedRarity);
}

function priceValue(item: { price?: { value?: string } }) {
  const value = Number(item.price?.value);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function medianSorted(values: number[]) {
  const middle = values.length / 2;

  if (Number.isInteger(middle)) {
    return (values[middle - 1] + values[middle]) / 2;
  }

  return values[Math.floor(middle)];
}

function quantileSorted(values: number[], quantile: number) {
  const position = (values.length - 1) * quantile;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const weight = position - lower;

  if (lower === upper) {
    return values[lower];
  }

  return values[lower] * (1 - weight) + values[upper] * weight;
}

function outlierResistantSample(values: number[]) {
  if (values.length <= 2) {
    return values;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const median = medianSorted(sorted);
  const q1 = quantileSorted(sorted, 0.25);
  const q3 = quantileSorted(sorted, 0.75);
  const iqr = q3 - q1;
  const deviations = sorted
    .map((value) => Math.abs(value - median))
    .sort((a, b) => a - b);
  const mad = medianSorted(deviations);

  let lowerBound = median * 0.35;
  let upperBound = median * 2.5;

  if (iqr > 0) {
    lowerBound = Math.max(lowerBound, q1 - iqr * 1.5);
    upperBound = Math.min(upperBound, q3 + iqr * 1.5);
  }

  if (mad > 0) {
    const robustSpread = (3.5 * mad) / 0.6745;
    lowerBound = Math.max(lowerBound, median - robustSpread);
    upperBound = Math.min(upperBound, median + robustSpread);
  }

  if (lowerBound >= upperBound) {
    lowerBound = median * 0.35;
    upperBound = median * 2.5;
  }

  const filtered = sorted.filter(
    (value) => value >= lowerBound && value <= upperBound,
  );

  if (filtered.length >= Math.max(2, Math.ceil(sorted.length * 0.4))) {
    return filtered;
  }

  const medianBand = sorted.filter(
    (value) => value >= median * 0.35 && value <= median * 2.5,
  );

  return medianBand.length ? medianBand : sorted;
}

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function buildEbaySearchUrl(card: { name: string; rarity: string | null }) {
  const params = new URLSearchParams({
    _nkw: [searchableCardName(card.name), card.rarity, "english"]
      .filter(Boolean)
      .join(" "),
    _sacat: ebayCardCategoryId,
    LH_BIN: "1",
  });

  return `https://www.ebay.co.uk/sch/i.html?${params}`;
}

async function getAccessToken() {
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Missing eBay API credentials.");
  }

  const response = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString(
        "base64",
      )}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "https://api.ebay.com/oauth/api_scope",
    }),
  });

  if (!response.ok) {
    throw new Error(`eBay OAuth failed (${response.status}).`);
  }

  const data = (await response.json()) as { access_token: string };
  return data.access_token;
}

export async function refreshEbayPricing(card: typeof cards.$inferSelect) {
  const token = await getAccessToken();
  const query = [searchableCardName(card.name), card.rarity, "english"]
    .filter(Boolean)
    .join(" ");
  const params = new URLSearchParams({
    q: query,
    category_ids: ebayCardCategoryId,
    limit: "50",
    sort: "price",
    filter: "buyingOptions:{FIXED_PRICE},priceCurrency:GBP",
  });
  const response = await fetch(
    `https://api.ebay.com/buy/browse/v1/item_summary/search?${params}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": process.env.EBAY_MARKETPLACE_ID || "EBAY_GB",
      },
    },
  );

  if (!response.ok) {
    throw new Error(`eBay search failed (${response.status}).`);
  }

  const data = (await response.json()) as {
    itemSummaries?: { title?: string; price?: { value?: string } }[];
  };
  const prices = (data.itemSummaries ?? [])
    .filter((item) => item.title)
    .filter((item) => !shouldExclude(item.title ?? ""))
    .filter((item) => titleMatchesName(item.title ?? "", card.name))
    .filter((item) => titleMatchesRarity(item.title ?? "", card.rarity))
    .map(priceValue)
    .filter((value): value is number => value !== null);
  const sample = outlierResistantSample(prices);
  const ebaySearchUrl = buildEbaySearchUrl(card);

  if (!sample.length) {
    const updated = db
      .update(cards)
      .set({ ebaySearchUrl, updatedAt: new Date() })
      .where(eq(cards.id, card.id))
      .returning()
      .get();
    return updated;
  }

  const priceText = `£${average(sample).toFixed(2)} avg (${sample.length})`;
  const updated = db
    .update(cards)
    .set({ priceText, ebaySearchUrl, updatedAt: new Date() })
    .where(eq(cards.id, card.id))
    .returning()
    .get();

  return updated;
}

import * as cheerio from "cheerio";
import { z } from "zod";

const urlSchema = z
  .string()
  .trim()
  .url()
  .refine((value) => ["http:", "https:"].includes(new URL(value).protocol), {
    message: "Only http and https links are supported.",
  });

export type LinkSource = "tcgplayer" | "ebay" | "other" | "manual";

export type LinkMetadata = {
  title?: string;
  imageUrl?: string;
  priceText?: string;
  rarity?: string;
  cardType?: string;
  source: LinkSource;
};

type YgoProDeckCard = {
  card_sets?: {
    set_name: string;
    set_rarity?: string;
  }[];
  name: string;
  type?: string;
};

let ygoCardsPromise: Promise<YgoProDeckCard[]> | null = null;

const rarityNames = [
  "Quarter Century Secret Rare",
  "Duel Terminal Secret Parallel Rare",
  "Duel Terminal Ultra Parallel Rare",
  "Duel Terminal Super Parallel Rare",
  "Duel Terminal Rare Parallel Rare",
  "Duel Terminal Normal Parallel Rare",
  "Overframe Starlight Rare",
  "Overframe Startlight Rare",
  "Overframe Ultra Rare",
  "Prismatic Secret Rare",
  "Platinum Secret Rare",
  "Gold Secret Rare",
  "Premium Gold Rare",
  "Collector's Rare",
  "Starlight Rare",
  "Ultimate Rare",
  "Secret Rare",
  "Ultra Rare",
  "Super Rare",
  "Ghost Rare",
  "Platinum Rare",
  "Parallel Rare",
  "Pharaoh's Rare",
  "Millennium Rare",
  "Extra Secret Rare",
  "20th Secret Rare",
  "10000 Secret Rare",
  "Gold Rare",
  "Starfoil Rare",
  "Shatterfoil Rare",
  "Mosaic Rare",
  "Short Print",
  "Super Short Print",
  "Common",
  "Rare",
].sort((a, b) => b.length - a.length);

export function normalizeUrl(url: string) {
  return urlSchema.parse(url);
}

export function detectSource(url: string): LinkSource {
  const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();

  if (host.includes("tcgplayer.com")) {
    return "tcgplayer";
  }

  if (host.includes("ebay.co.uk") || host.includes("ebay.com")) {
    return "ebay";
  }

  return "other";
}

function absoluteUrl(value: string | undefined, baseUrl: string) {
  if (!value) {
    return undefined;
  }

  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return undefined;
  }
}

function cleanTitle(title: string | undefined) {
  if (!title) {
    return undefined;
  }

  const cleaned = title
    .replace(/\s*\|\s*TCGplayer.*$/i, "")
    .replace(/\s*\|\s*eBay.*$/i, "")
    .replace(/\s+for sale\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();

  if (
    /^your trusted marketplace for collectible trading card games/i.test(cleaned)
  ) {
    return undefined;
  }

  return cleaned;
}

function titleCaseFromSlug(slug: string) {
  return slug
    .split("-")
    .filter(Boolean)
    .map((word) => {
      if (/^(of|the|and|a|an|to|in)$/i.test(word)) {
        return word.toLowerCase();
      }

      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ")
    .replace(/\bQcsr\b/g, "QCSR");
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/@/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function tcgplayerProductDetails(url: string) {
  const parsed = new URL(url);
  const parts = parsed.pathname.split("/").filter(Boolean);
  const productIndex = parts.findIndex((part) => part === "product");
  const productId =
    productIndex >= 0 && /^\d+$/.test(parts[productIndex + 1] ?? "")
      ? parts[productIndex + 1]
      : undefined;
  const productSlug = productIndex >= 0 ? parts[productIndex + 2] : undefined;

  return {
    productId,
    productSlug,
  };
}

function rarityFromTcgplayerSlug(productSlug: string | undefined) {
  if (!productSlug) {
    return null;
  }

  for (const rarity of rarityNames) {
    const raritySlug = slugify(rarity);

    if (productSlug.endsWith(`-${raritySlug}`) || productSlug === raritySlug) {
      return {
        rarity:
          rarity === "Overframe Startlight Rare"
            ? "Overframe Starlight Rare"
            : rarity,
        slugWithoutRarity: productSlug
          .replace(new RegExp(`-?${raritySlug}$`), "")
          .replace(/^-+|-+$/g, ""),
      };
    }
  }

  return null;
}

async function ygoCards() {
  ygoCardsPromise ??= fetch(
    "https://db.ygoprodeck.com/api/v7/cardinfo.php",
    {
      headers: {
        "accept": "application/json",
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
      },
      next: { revalidate: 86400 },
    },
  )
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`Could not fetch Yu-Gi-Oh card list (${response.status}).`);
      }

      const payload = (await response.json()) as { data?: YgoProDeckCard[] };
      return payload.data ?? [];
    })
    .catch(() => []);

  return ygoCardsPromise;
}

export async function ygoCardDetailsByName(name: string | undefined) {
  const cleanedName = name?.trim();

  if (!cleanedName) {
    return {};
  }

  const normalizedName = slugify(cleanedName);
  const cards = await ygoCards();
  const matchedCard = cards.find((card) => slugify(card.name) === normalizedName);

  return {
    cardType: matchedCard?.type,
    title: matchedCard?.name,
  };
}

async function cardDetailsFromTcgplayerSlug(productSlug: string | undefined) {
  const parsedRarity = rarityFromTcgplayerSlug(productSlug);
  const slugWithoutRarity =
    parsedRarity?.slugWithoutRarity ?? productSlug?.replace(/^yugioh-/, "");

  if (!slugWithoutRarity) {
    return {};
  }

  const candidateSlug = slugWithoutRarity.replace(/^yugioh-/, "");
  const cards = await ygoCards();
  const matchedCard = [...cards]
    .sort((a, b) => b.name.length - a.name.length)
    .find((card) => candidateSlug.endsWith(slugify(card.name)));

  if (!matchedCard) {
    return { title: titleCaseFromSlug(candidateSlug) };
  }

  const cardSlug = slugify(matchedCard.name);
  const setSlug = candidateSlug
    .replace(new RegExp(`-?${cardSlug}$`), "")
    .replace(/^-+|-+$/g, "");
  const matchedSet = matchedCard.card_sets?.find(
    (set) => slugify(set.set_name) === setSlug,
  );

  return {
    cardType: matchedCard.type,
    rarity: matchedSet?.set_rarity,
    title: matchedCard.name,
  };
}

async function tcgplayerMetadataFallback(url: string) {
  const { productId, productSlug } = tcgplayerProductDetails(url);
  const parsedRarity = rarityFromTcgplayerSlug(productSlug);
  const details = await cardDetailsFromTcgplayerSlug(productSlug);

  return {
    imageUrl: productId
      ? `https://tcgplayer-cdn.tcgplayer.com/product/${productId}_in_1000x1000.jpg`
      : undefined,
    cardType: details.cardType,
    rarity: parsedRarity?.rarity ?? details.rarity,
    title: details.title,
  };
}

function pickPrice($: cheerio.CheerioAPI) {
  const selectors = [
    'meta[property="product:price:amount"]',
    'meta[property="og:price:amount"]',
    'meta[itemprop="price"]',
    '[itemprop="price"]',
    '[data-testid="x-price-primary"] span',
    ".x-price-primary span",
  ];

  for (const selector of selectors) {
    const element = $(selector).first();
    const value =
      element.attr("content") ?? element.attr("value") ?? element.text();
    const cleaned = value?.replace(/\s+/g, " ").trim();

    if (cleaned) {
      return cleaned.startsWith("£") || cleaned.startsWith("$")
        ? cleaned
        : `£${cleaned}`;
    }
  }

  const bodyText = $("body").text().replace(/\s+/g, " ");
  const match = bodyText.match(/(?:£|\$)\s?\d+(?:[,.]\d{2})?/);
  return match?.[0]?.replace(/\s+/g, "");
}

export async function fetchLinkMetadata(url: string): Promise<LinkMetadata> {
  const parsedUrl = normalizeUrl(url);
  const source = detectSource(parsedUrl);
  const tcgplayerFallback =
    source === "tcgplayer" ? await tcgplayerMetadataFallback(parsedUrl) : null;

  const response = await fetch(parsedUrl, {
    headers: {
      "accept-language": "en-GB,en;q=0.9",
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
    },
    next: { revalidate: 0 },
  });

  if (!response.ok) {
    throw new Error(`Could not fetch link details (${response.status}).`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);
  const rawTitle =
    $('meta[property="og:title"]').attr("content") ??
    $('meta[name="twitter:title"]').attr("content") ??
    $("title").first().text();
  const rawImage =
    $('meta[property="og:image"]').attr("content") ??
    $('meta[name="twitter:image"]').attr("content") ??
    $('[itemprop="image"]').first().attr("content") ??
    $('[itemprop="image"]').first().attr("src");

  return {
    title: cleanTitle(rawTitle) ?? tcgplayerFallback?.title,
    imageUrl: absoluteUrl(rawImage, parsedUrl) ?? tcgplayerFallback?.imageUrl,
    priceText: pickPrice($),
    cardType: tcgplayerFallback?.cardType,
    rarity: tcgplayerFallback?.rarity,
    source,
  };
}

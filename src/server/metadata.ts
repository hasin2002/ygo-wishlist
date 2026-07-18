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
  edition?: "1st Edition" | "Unlimited Edition" | "Limited Edition";
  rarity?: string;
  setName?: string;
  setCode?: string;
  cardType?: string;
  source: LinkSource;
  resolution?: "page" | "fallback";
};

type YgoProDeckCard = {
  card_sets?: {
    set_code?: string;
    set_name: string;
    set_rarity?: string;
  }[];
  name: string;
  type?: string;
};

type TcgplayerMarketplaceProduct = {
  customAttributes?: {
    cardType?: string[];
    number?: string;
    rarityDbName?: string;
  };
  formattedAttributes?: Record<string, string>;
  productLineName?: string;
  productLineUrlName?: string;
  productName?: string;
  rarityName?: string;
  setName?: string;
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

function titleFromUnmatchedTcgplayerSlug(slug: string) {
  const tokens = slug
    .replace(/^yugioh-/, "")
    .replace(/-(?:1st|unlimited)-edition$/i, "")
    .split("-")
    .filter(Boolean);

  for (let length = Math.floor(tokens.length / 2); length >= 1; length -= 1) {
    for (let start = 0; start + (length * 2) <= tokens.length; start += 1) {
      const first = tokens.slice(start, start + length).join("-");
      const second = tokens.slice(start + length, start + (length * 2)).join("-");

      if (first === second) {
        return titleCaseFromSlug(tokens.slice(start + length).join("-"));
      }
    }
  }

  return titleCaseFromSlug(tokens.join("-"));
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/&/g, " and ")
    .replace(/@/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function containsSlug(candidate: string, value: string) {
  return `-${candidate}-`.includes(`-${value}-`);
}

type SlugContext = {
  after: string;
  before: string;
};

function contextsAroundSlug(candidate: string, value: string) {
  const paddedCandidate = `-${candidate}-`;
  const paddedValue = `-${value}-`;
  const contexts: SlugContext[] = [];
  let searchFrom = 0;
  let matchIndex = paddedCandidate.indexOf(paddedValue, searchFrom);

  while (matchIndex >= 0) {
    contexts.push({
      after: paddedCandidate
        .slice(matchIndex + paddedValue.length)
        .replace(/^-+|-+$/g, ""),
      before: paddedCandidate.slice(0, matchIndex).replace(/^-+|-+$/g, ""),
    });
    searchFrom = matchIndex + 1;
    matchIndex = paddedCandidate.indexOf(paddedValue, searchFrom);
  }

  return contexts;
}

const setMatchStopWords = new Set([
  "a",
  "an",
  "and",
  "card",
  "cards",
  "edition",
  "gi",
  "oh",
  "the",
  "yu",
  "yugioh",
]);

function meaningfulSlugTokens(value: string) {
  return value
    .split("-")
    .filter((token) => token && !setMatchStopWords.has(token));
}

function setContextScore(setSlug: string, context: string) {
  if (!context) {
    return 0;
  }

  if (setSlug === context) {
    return 10_000;
  }

  if (containsSlug(context, setSlug)) {
    return 9_000 + setSlug.length;
  }

  if (containsSlug(setSlug, context)) {
    return 8_500 + context.length;
  }

  const setTokens = meaningfulSlugTokens(setSlug);
  const contextTokens = meaningfulSlugTokens(context);
  const contextTokenSet = new Set(contextTokens);
  const sharedCount = setTokens.filter((token) =>
    contextTokenSet.has(token),
  ).length;

  if (sharedCount < 2 || !setTokens.length || !contextTokens.length) {
    return 0;
  }

  const smallerCoverage =
    sharedCount / Math.min(setTokens.length, contextTokens.length);
  const unionSize = new Set([...setTokens, ...contextTokens]).size;
  const similarity = sharedCount / unionSize;

  if (smallerCoverage < 0.6 && similarity < 0.5) {
    return 0;
  }

  return Math.round(
    1_000 +
      (smallerCoverage * 500) +
      (similarity * 250) +
      (sharedCount * 10),
  );
}

function matchingCardSet(
  cardSets: YgoProDeckCard["card_sets"],
  contexts: SlugContext[],
  parsedRarity: string | undefined,
) {
  let bestMatch: {
    score: number;
    set: NonNullable<YgoProDeckCard["card_sets"]>[number];
  } | null = null;

  for (const set of cardSets ?? []) {
    const setSlug = slugify(set.set_name);
    const contextScore = contexts.reduce(
      (best, context) => Math.max(
        best,
        setContextScore(setSlug, context.before),
        setContextScore(setSlug, context.after),
      ),
      0,
    );

    if (!contextScore) {
      continue;
    }

    const rarityScore =
      parsedRarity && slugify(set.set_rarity ?? "") === slugify(parsedRarity)
        ? 250
        : 0;
    const score = contextScore + rarityScore;

    if (!bestMatch || score > bestMatch.score) {
      bestMatch = { score, set };
    }
  }

  return bestMatch?.set;
}

function titleForMatchedPrinting(
  cardName: string,
  setCode: string | undefined,
) {
  const qualifierBySetCode: Record<string, string> = {
    "FMR-001": "Forbidden Memories",
  };
  const qualifier = setCode ? qualifierBySetCode[setCode] : undefined;

  return qualifier ? `${cardName} (${qualifier})` : cardName;
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

function editionFromTcgplayerSlug(productSlug: string | undefined) {
  if (!productSlug) {
    return undefined;
  }

  if (/(?:^|-)1st-edition(?:-|$)/i.test(productSlug)) {
    return "1st Edition" as const;
  }

  if (/(?:^|-)unlimited-edition(?:-|$)/i.test(productSlug)) {
    return "Unlimited Edition" as const;
  }

  if (/(?:^|-)limited-edition(?:-|$)/i.test(productSlug)) {
    return "Limited Edition" as const;
  }

  return undefined;
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
      cache: "no-store",
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
    .sort((a, b) => slugify(b.name).length - slugify(a.name).length)
    .find((card) => containsSlug(candidateSlug, slugify(card.name)));

  if (!matchedCard) {
    return { title: titleFromUnmatchedTcgplayerSlug(candidateSlug) };
  }

  const cardSlug = slugify(matchedCard.name);
  const cardContexts = contextsAroundSlug(candidateSlug, cardSlug);
  const matchedSet = matchingCardSet(
    matchedCard.card_sets,
    cardContexts,
    parsedRarity?.rarity,
  );

  return {
    cardType: matchedCard.type,
    rarity: matchedSet?.set_rarity,
    setCode: matchedSet?.set_code,
    setName: matchedSet?.set_name,
    title: titleForMatchedPrinting(matchedCard.name, matchedSet?.set_code),
  };
}

async function tcgplayerMarketplaceDetails(productId: string | undefined) {
  if (!productId) {
    return null;
  }

  try {
    const response = await fetch(
      `https://mp-search-api.tcgplayer.com/v1/product/${productId}/details`,
      {
        headers: {
          "accept": "application/json",
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
        },
        cache: "no-store",
      },
    );

    if (!response.ok) {
      return null;
    }

    const product = (await response.json()) as TcgplayerMarketplaceProduct;
    const productLine =
      product.productLineUrlName?.toLowerCase() ??
      product.productLineName?.toLowerCase();

    if (productLine !== "yugioh") {
      return null;
    }

    const cardType = product.customAttributes?.cardType;

    return {
      cardType: cardType?.length ? cardType.join(", ") : undefined,
      rarity:
        product.customAttributes?.rarityDbName ??
        product.rarityName ??
        product.formattedAttributes?.Rarity,
      setCode:
        product.customAttributes?.number ??
        product.formattedAttributes?.Number,
      setName: product.setName,
      title: cleanTitle(product.productName),
    };
  } catch {
    return null;
  }
}

async function tcgplayerMetadataFallback(url: string) {
  const { productId, productSlug } = tcgplayerProductDetails(url);
  const parsedRarity = rarityFromTcgplayerSlug(productSlug);
  const [marketplaceDetails, catalogueDetails] = await Promise.all([
    tcgplayerMarketplaceDetails(productId),
    cardDetailsFromTcgplayerSlug(productSlug),
  ]);

  return {
    imageUrl: productId
      ? `https://tcgplayer-cdn.tcgplayer.com/product/${productId}_in_1000x1000.jpg`
      : undefined,
    cardType: catalogueDetails.cardType ?? marketplaceDetails?.cardType,
    edition: editionFromTcgplayerSlug(productSlug),
    rarity:
      marketplaceDetails?.rarity ??
      parsedRarity?.rarity ??
      catalogueDetails.rarity,
    setCode: marketplaceDetails?.setCode ?? catalogueDetails.setCode,
    setName: marketplaceDetails?.setName ?? catalogueDetails.setName,
    title: catalogueDetails.title ?? marketplaceDetails?.title,
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

  let response: Response;
  try {
    response = await fetch(parsedUrl, {
      headers: {
        "accept-language": "en-GB,en;q=0.9",
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
      },
      next: { revalidate: 0 },
    });
  } catch (error) {
    if (tcgplayerFallback) {
      return { ...tcgplayerFallback, source, resolution: "fallback" };
    }
    throw error;
  }

  if (!response.ok) {
    if (tcgplayerFallback) {
      return { ...tcgplayerFallback, source, resolution: "fallback" };
    }
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
    title: tcgplayerFallback?.title ?? cleanTitle(rawTitle),
    imageUrl: absoluteUrl(rawImage, parsedUrl) ?? tcgplayerFallback?.imageUrl,
    priceText: pickPrice($),
    cardType: tcgplayerFallback?.cardType,
    edition: tcgplayerFallback?.edition,
    rarity: tcgplayerFallback?.rarity,
    setCode: tcgplayerFallback?.setCode,
    setName: tcgplayerFallback?.setName,
    source,
    resolution: "page",
  };
}

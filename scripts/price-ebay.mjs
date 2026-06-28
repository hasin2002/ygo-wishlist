import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const envPath = path.join(rootDir, ".env.local");
const dbPath = path.join(rootDir, "data", "wishlist.sqlite");
const ebayCardCategoryId = "183454";
const retryBaseDelayMs = Number(process.env.EBAY_PRICE_RETRY_DELAY_MS ?? 250);
const retryMaxDelayMs = Number(process.env.EBAY_PRICE_RETRY_MAX_DELAY_MS ?? 30000);
const maxRetries = Number(process.env.EBAY_PRICE_MAX_RETRIES ?? 8);
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

const rarityAliases = new Map([
  ["common", ["common"]],
  ["short print", ["short print", "sp"]],
  ["super short print", ["super short print", "ssp"]],
  ["rare", ["rare"]],
  ["super rare", ["super rare", "sr"]],
  ["ultra rare", ["ultra rare", "ur"]],
  ["overframe ultra rare", ["overframe ultra rare", "over frame ultra rare"]],
  ["secret rare", ["secret rare", "scr"]],
  ["ultimate rare", ["ultimate rare", "utr", "ulti"]],
  ["ghost rare", ["ghost rare", "gr"]],
  ["gold rare", ["gold rare"]],
  ["gold secret rare", ["gold secret rare", "gscr"]],
  ["premium gold rare", ["premium gold rare", "pgr"]],
  ["platinum rare", ["platinum rare"]],
  ["platinum secret rare", ["platinum secret rare"]],
  ["collector's rare", ["collector's rare", "collectors rare", "cr"]],
  ["starlight rare", ["starlight rare", "starlight", "slr"]],
  [
    "overframe starlight rare",
    [
      "overframe starlight rare",
      "over frame starlight rare",
      "overframe startlight rare",
      "over frame startlight rare",
    ],
  ],
  [
    "overframe startlight rare",
    [
      "overframe starlight rare",
      "over frame starlight rare",
      "overframe startlight rare",
      "over frame startlight rare",
    ],
  ],
  [
    "quarter century secret rare",
    [
      "quarter century secret rare",
      "quarter century",
      "qcsr",
      "qcr",
      "25th secret rare",
    ],
  ],
  [
    "qcsr",
    [
      "quarter century secret rare",
      "quarter century",
      "qcsr",
      "qcr",
      "25th secret rare",
    ],
  ],
  ["prismatic secret rare", ["prismatic secret rare", "pscr"]],
  ["parallel rare", ["parallel rare"]],
  ["mosaic rare", ["mosaic rare"]],
  ["starfoil rare", ["starfoil rare"]],
  ["shatterfoil rare", ["shatterfoil rare"]],
  ["pharaoh's rare", ["pharaoh's rare", "pharaohs rare"]],
  ["millennium rare", ["millennium rare"]],
  ["extra secret rare", ["extra secret rare"]],
  ["20th secret rare", ["20th secret rare"]],
  ["10000 secret rare", ["10000 secret rare", "ten thousand secret rare"]],
]);

class EbayHttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  return Object.fromEntries(
    fs
      .readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const index = line.indexOf("=");
        const key = line.slice(0, index).trim();
        const value = line
          .slice(index + 1)
          .trim()
          .replace(/^['"]|['"]$/g, "");

        return [key, value];
      }),
  );
}

function normalizeText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9£$.\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function searchableCardName(name) {
  return String(name ?? "")
    .replace(
      /\s*\((?:new art|alternate art|\d+(?:st|nd|rd|th) art|quarter century secret rare|[a-z])\)/gi,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
}

function rarityTerms(rarity) {
  const normalized = normalizeText(rarity);
  return rarityAliases.get(normalized) ?? (normalized ? [normalized] : []);
}

function buildEbaySearchUrl(card) {
  const query = [searchableCardName(card.name), card.rarity, "english"]
    .filter(Boolean)
    .join(" ");
  const params = new URLSearchParams({
    _nkw: query,
    _sacat: ebayCardCategoryId,
    LH_BIN: "1",
  });

  return `https://www.ebay.co.uk/sch/i.html?${params}`;
}

function nowUnixSeconds() {
  return Math.floor(Date.now() / 1000);
}

function shouldExclude(title) {
  const normalized = normalizeText(title);
  return (
    excludedTitleTerms.some((term) => normalized.includes(term)) ||
    excludedTitlePatterns.some((pattern) => pattern.test(normalized))
  );
}

function titleMatchesName(title, name) {
  const normalizedTitle = normalizeText(title);
  const meaningfulTokens = normalizeText(searchableCardName(name))
    .split(" ")
    .filter((token) => token.length > 2);

  if (meaningfulTokens.length === 0) {
    return false;
  }

  const matches = meaningfulTokens.filter((token) =>
    normalizedTitle.includes(token),
  );

  return matches.length / meaningfulTokens.length >= 0.75;
}

function titleMatchesRarity(title, rarity) {
  const terms = rarityTerms(rarity);

  if (terms.length === 0) {
    return true;
  }

  const normalizedTitle = normalizeText(title);
  return terms.some((term) => normalizedTitle.includes(normalizeText(term)));
}

function extractPrice(item) {
  const value = Number(item.price?.value);

  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }

  return {
    value,
    currency: item.price.currency ?? "GBP",
    title: item.title,
    itemWebUrl: item.itemWebUrl,
  };
}

function average(values) {
  if (!values.length) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function medianSorted(values) {
  const middle = values.length / 2;

  if (Number.isInteger(middle)) {
    return (values[middle - 1] + values[middle]) / 2;
  }

  return values[Math.floor(middle)];
}

function quantileSorted(values, quantile) {
  const position = (values.length - 1) * quantile;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const weight = position - lower;

  if (lower === upper) {
    return values[lower];
  }

  return values[lower] * (1 - weight) + values[upper] * weight;
}

function outlierResistantSample(matches) {
  if (matches.length <= 2) {
    return matches;
  }

  const sorted = [...matches].sort((a, b) => a.value - b.value);
  const values = sorted.map((match) => match.value);
  const median = medianSorted(values);
  const q1 = quantileSorted(values, 0.25);
  const q3 = quantileSorted(values, 0.75);
  const iqr = q3 - q1;
  const deviations = values
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
    (match) => match.value >= lowerBound && match.value <= upperBound,
  );

  if (filtered.length >= Math.max(2, Math.ceil(sorted.length * 0.4))) {
    return filtered;
  }

  const medianBand = sorted.filter(
    (match) => match.value >= median * 0.35 && match.value <= median * 2.5,
  );

  return medianBand.length ? medianBand : sorted;
}

async function getAccessToken(env) {
  const clientId = env.EBAY_CLIENT_ID;
  const clientSecret = env.EBAY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Missing EBAY_CLIENT_ID or EBAY_CLIENT_SECRET in .env.local.");
  }

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope: "https://api.ebay.com/oauth/api_scope",
  });

  const response = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`eBay OAuth failed (${response.status}): ${text}`);
  }

  const data = await response.json();
  return data.access_token;
}

async function searchEbay({ token, marketplaceId, card }) {
  const queryParts = [searchableCardName(card.name), card.rarity].filter(Boolean);
  const query = [...queryParts, "english"].join(" ");
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
        "X-EBAY-C-MARKETPLACE-ID": marketplaceId,
      },
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new EbayHttpError(
      response.status,
      `eBay search failed (${response.status}): ${text}`,
    );
  }

  const data = await response.json();
  return data.itemSummaries ?? [];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function searchWithRetry(args) {
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await searchEbay(args);
    } catch (error) {
      const retryable =
        (error instanceof EbayHttpError &&
          (error.status === 429 || (error.status >= 500 && error.status <= 599))) ||
        (error instanceof Error && error.message === "fetch failed");

      if (!retryable || attempt === maxRetries) {
        throw error;
      }

      const exponentialDelay = Math.min(
        retryMaxDelayMs,
        retryBaseDelayMs * 2 ** attempt,
      );
      const waitMs = Math.round(exponentialDelay * (0.5 + Math.random()));
      console.log(
        `  retry ${attempt + 1}/${maxRetries} after ${waitMs}ms (${error.status})`,
      );
      await sleep(waitMs);
    }
  }

  return [];
}

async function main() {
  const env = { ...readEnvFile(envPath), ...process.env };
  const marketplaceId = env.EBAY_MARKETPLACE_ID || "EBAY_GB";
  const db = new Database(dbPath);

  const columns = db.prepare("PRAGMA table_info(cards)").all();
  if (!columns.some((column) => column.name === "ebay_search_url")) {
    db.exec("ALTER TABLE cards ADD COLUMN ebay_search_url TEXT;");
  }

  db.prepare(
    `
      UPDATE cards
      SET rarity = CASE
          WHEN rarity IS NULL OR trim(rarity) = '' THEN 'Quarter Century Secret Rare'
          ELSE rarity
        END,
        notes = NULL
      WHERE lower(trim(coalesce(notes, ''))) IN ('qcsr', 'quarter century secret rare')
    `,
  ).run();

  const cards = db
    .prepare(
      "SELECT id, name, rarity, price_text AS priceText FROM cards ORDER BY id ASC",
    )
    .all();

  const token = await getAccessToken(env);
  const update = db.prepare(
    "UPDATE cards SET price_text = ?, ebay_search_url = ?, updated_at = ? WHERE id = ?",
  );
  const results = [];

  for (const card of cards) {
    try {
      const items = await searchWithRetry({ token, marketplaceId, card });
      const ebaySearchUrl = buildEbaySearchUrl(card);
      const matches = items
        .filter((item) => item.title)
        .filter((item) => !shouldExclude(item.title))
        .filter((item) => titleMatchesName(item.title, card.name))
        .filter((item) => titleMatchesRarity(item.title, card.rarity))
        .map(extractPrice)
        .filter(Boolean);
      const sample = outlierResistantSample(matches);
      const avg = average(sample.map((match) => match.value));

      if (avg === null) {
        db.prepare(
          "UPDATE cards SET ebay_search_url = ?, updated_at = ? WHERE id = ?",
        ).run(ebaySearchUrl, nowUnixSeconds(), card.id);
        results.push({ id: card.id, name: card.name, status: "skipped", matches: 0 });
        console.log(`skip ${card.id}: ${card.name} - no matching listings`);
      } else {
        const currency = sample[0]?.currency === "GBP" ? "£" : `${sample[0]?.currency} `;
        const priceText = `${currency}${avg.toFixed(2)} avg (${sample.length})`;
        update.run(priceText, ebaySearchUrl, nowUnixSeconds(), card.id);
        results.push({
          id: card.id,
          name: card.name,
          status: "priced",
          matches: sample.length,
          priceText,
        });
        console.log(`price ${card.id}: ${card.name} -> ${priceText}`);
      }
    } catch (error) {
      results.push({
        id: card.id,
        name: card.name,
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
      console.log(`error ${card.id}: ${card.name} - ${error.message}`);
    }
  }

  const priced = results.filter((result) => result.status === "priced").length;
  const skipped = results.filter((result) => result.status === "skipped").length;
  const errors = results.filter((result) => result.status === "error").length;

  console.log("");
  console.log(`Done. Priced ${priced}, skipped ${skipped}, errors ${errors}.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

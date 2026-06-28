import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const jsonPath =
  process.argv[2] ??
  "/Users/hasinmahmood/Documents/code/yugioh_quarter_century_secret_rare_cards.json";
const dbPath = path.join(process.cwd(), "data", "wishlist.sqlite");
const rarity = "Quarter Century Secret Rare";

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/@/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function articlelessSlug(value) {
  return slugify(value)
    .split("-")
    .filter((part) => !["a", "an", "the"].includes(part))
    .join("-");
}

function cleanName(productName) {
  return productName.replace(/\s*\(Quarter Century Secret Rare\)\s*$/i, "").trim();
}

function tcgImageUrl(productId) {
  return `https://tcgplayer-cdn.tcgplayer.com/product/${productId}_in_1000x1000.jpg`;
}

function ebaySearchUrl(name) {
  const params = new URLSearchParams({
    _nkw: `${name} ${rarity}`,
    _sacat: "183454",
    LH_BIN: "1",
  });

  return `https://www.ebay.co.uk/sch/i.html?${params}`;
}

async function ygoTypeIndex() {
  const response = await fetch("https://db.ygoprodeck.com/api/v7/cardinfo.php", {
    headers: {
      accept: "application/json",
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
    },
  });

  if (!response.ok) {
    throw new Error(`Could not fetch YGOPRODeck cards (${response.status}).`);
  }

  const payload = await response.json();
  const ygoCards = payload.data ?? [];
  const byName = new Map(
    ygoCards
      .filter((card) => card.name && card.type)
      .map((card) => [slugify(card.name), card.type]),
  );
  const byArticlelessName = new Map(
    ygoCards
      .filter((card) => card.name && card.type)
      .map((card) => [articlelessSlug(card.name), card.type]),
  );
  const searchableCards = ygoCards
    .filter((card) => card.name && card.type)
    .map((card) => ({
      nameSlug: slugify(card.name),
      type: card.type,
    }))
    .sort((a, b) => b.nameSlug.length - a.nameSlug.length);

  return { byArticlelessName, byName, searchableCards };
}

function cardTypeForName(index, name) {
  const nameSlug = slugify(name);
  const fuzzyMatch = index.searchableCards.find(
    (card) =>
      card.nameSlug.startsWith(nameSlug) ||
      nameSlug.includes(card.nameSlug),
  );

  return (
    index.byName.get(nameSlug) ??
    index.byArticlelessName.get(articlelessSlug(name)) ??
    fuzzyMatch?.type ??
    null
  );
}

const source = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
const rows = source.rows ?? [];

if (!rows.length) {
  throw new Error(`No rows found in ${jsonPath}`);
}

const typeIndex = await ygoTypeIndex();
const db = new Database(dbPath);
db.pragma("foreign_keys = ON");

const now = Date.now();
const existingQcsrIds = db
  .prepare("SELECT id FROM cards WHERE rarity = ?")
  .all(rarity)
  .map((row) => row.id);
const existingQcsrIdList = existingQcsrIds.join(",");

const insertCard = db.prepare(`
  INSERT INTO cards (
    name,
    url,
    source,
    image_url,
    price_text,
    paid_price_text,
    ebay_search_url,
    ebay_listing_url,
    rarity,
    card_type,
    chase_level,
    status,
    notes,
    created_at,
    updated_at
  ) VALUES (
    @name,
    @url,
    'tcgplayer',
    @imageUrl,
    NULL,
    NULL,
    @ebaySearchUrl,
    NULL,
    @rarity,
    @cardType,
    NULL,
    'wishlist',
    @notes,
    @now,
    @now
  )
`);
const insertWheelEntry = db.prepare(`
  INSERT INTO wheel_entries (
    card_id,
    sort_order,
    selected_at,
    selected_order,
    created_at,
    updated_at
  ) VALUES (?, ?, NULL, NULL, ?, ?)
`);

let inserted = 0;
let missingTypes = 0;

db.transaction(() => {
  if (existingQcsrIds.length) {
    db.exec(`DELETE FROM binder_slots WHERE card_id IN (${existingQcsrIdList})`);
    db.exec(`DELETE FROM wheel_entries WHERE card_id IN (${existingQcsrIdList})`);
    db.exec(`DELETE FROM cards WHERE id IN (${existingQcsrIdList})`);
  }

  let nextSortOrder =
    (db
      .prepare("SELECT COALESCE(MAX(sort_order), -1) AS maxSortOrder FROM wheel_entries")
      .get().maxSortOrder ?? -1) + 1;

  for (const row of rows) {
    const name = cleanName(row.productName);
    const cardType = cardTypeForName(typeIndex, name);
    const notes = [
      row.setName ? `Set: ${row.setName}` : null,
      row.setCode ? `Code: ${row.setCode}` : null,
      row.cardNumber ? `Card: ${row.cardNumber}` : null,
      row.releaseDate ? `Released: ${row.releaseDate}` : null,
      row.productId ? `TCGplayer product: ${row.productId}` : null,
    ]
      .filter(Boolean)
      .join(" | ");

    if (!cardType) {
      missingTypes += 1;
    }

    const result = insertCard.run({
      cardType,
      ebaySearchUrl: ebaySearchUrl(name),
      imageUrl: row.productId ? tcgImageUrl(row.productId) : null,
      name,
      notes,
      now,
      rarity,
      url: row.productUrl,
    });

    insertWheelEntry.run(result.lastInsertRowid, nextSortOrder, now, now);
    nextSortOrder += 1;
    inserted += 1;
  }
})();

console.log(
  `Removed ${existingQcsrIds.length} existing QCSR cards and inserted ${inserted} wishlist cards from ${path.basename(jsonPath)}. Missing card types: ${missingTypes}.`,
);

import Database from "better-sqlite3";
import path from "node:path";

const dbPath = path.join(process.cwd(), "data", "wishlist.sqlite");
const db = new Database(dbPath);

const columns = db.prepare("PRAGMA table_info(cards)").all();
if (!columns.some((column) => column.name === "card_type")) {
  db.exec("ALTER TABLE cards ADD COLUMN card_type TEXT;");
}

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

function cleanTrackedName(value) {
  return value
    .replace(/\bquarter century stampede\b/gi, " ")
    .replace(/\b(?:ur|sr|scr|qcsr|psr|utr|str)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

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
const typeByName = new Map(
  ygoCards
    .filter((card) => card.name && card.type)
    .map((card) => [slugify(card.name), card.type]),
);
const typeByArticlelessName = new Map(
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

const rows = db
  .prepare("SELECT id, name, card_type FROM cards WHERE status IN ('owned', 'wishlist')")
  .all();
const update = db.prepare(
  "UPDATE cards SET card_type = ?, updated_at = ? WHERE id = ?",
);
const now = Date.now();

let updated = 0;
let alreadySet = 0;
let missing = 0;

const applyUpdates = db.transaction(() => {
  for (const row of rows) {
    if (row.card_type) {
      alreadySet += 1;
      continue;
    }

    const cleanedName = cleanTrackedName(row.name);
    const nameSlug = slugify(cleanedName);
    const nameWithoutArticles = articlelessSlug(cleanedName);
    const fuzzyMatch = searchableCards.find(
      (card) =>
        card.nameSlug.startsWith(nameSlug) ||
        nameSlug.includes(card.nameSlug),
    );
    const cardType =
      typeByName.get(nameSlug) ??
      typeByArticlelessName.get(nameWithoutArticles) ??
      fuzzyMatch?.type;

    if (!cardType) {
      missing += 1;
      continue;
    }

    update.run(cardType, now, row.id);
    updated += 1;
  }
});

applyUpdates();

console.log(
  `Card type backfill complete. Updated ${updated}, already set ${alreadySet}, unmatched ${missing}.`,
);

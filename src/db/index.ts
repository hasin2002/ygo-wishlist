import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema";

const dataDir = path.join(process.cwd(), "data");
const dbPath = path.join(dataDir, "wishlist.sqlite");

fs.mkdirSync(dataDir, { recursive: true });

const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    url TEXT,
    source TEXT NOT NULL DEFAULT 'manual',
    image_url TEXT,
    price_text TEXT,
    market_price_text TEXT,
    paid_price_text TEXT,
    purchase_month TEXT,
    ebay_search_url TEXT,
    ebay_listing_url TEXT,
    rarity TEXT,
    card_type TEXT,
    chase_level INTEGER,
    status TEXT NOT NULL DEFAULT 'wishlist',
    notes TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
`);

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS binder_slots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    page_index INTEGER NOT NULL,
    slot_index INTEGER NOT NULL,
    card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    updated_at INTEGER NOT NULL
  );
`);

sqlite.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS binder_slots_page_slot_unique
    ON binder_slots(page_index, slot_index);
  CREATE UNIQUE INDEX IF NOT EXISTS binder_slots_card_unique
    ON binder_slots(card_id);
`);

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS wheel_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL,
    selected_at INTEGER,
    selected_order INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
`);

sqlite.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS wheel_entries_card_unique
    ON wheel_entries(card_id);
`);

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS monthly_favorites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    month TEXT NOT NULL,
    card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
`);

sqlite.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS monthly_favorites_month_unique
    ON monthly_favorites(month);
`);

const columns = sqlite.prepare("PRAGMA table_info(cards)").all() as {
  name: string;
}[];

if (!columns.some((column) => column.name === "rarity")) {
  sqlite.exec("ALTER TABLE cards ADD COLUMN rarity TEXT;");
}

if (!columns.some((column) => column.name === "ebay_search_url")) {
  sqlite.exec("ALTER TABLE cards ADD COLUMN ebay_search_url TEXT;");
}

if (!columns.some((column) => column.name === "ebay_listing_url")) {
  sqlite.exec("ALTER TABLE cards ADD COLUMN ebay_listing_url TEXT;");
}

if (!columns.some((column) => column.name === "paid_price_text")) {
  sqlite.exec("ALTER TABLE cards ADD COLUMN paid_price_text TEXT;");
}

if (!columns.some((column) => column.name === "purchase_month")) {
  sqlite.exec("ALTER TABLE cards ADD COLUMN purchase_month TEXT;");
}

if (!columns.some((column) => column.name === "market_price_text")) {
  sqlite.exec("ALTER TABLE cards ADD COLUMN market_price_text TEXT;");
}

if (!columns.some((column) => column.name === "chase_level")) {
  sqlite.exec("ALTER TABLE cards ADD COLUMN chase_level INTEGER;");
}

if (!columns.some((column) => column.name === "card_type")) {
  sqlite.exec("ALTER TABLE cards ADD COLUMN card_type TEXT;");
}

export const db = drizzle(sqlite, { schema });

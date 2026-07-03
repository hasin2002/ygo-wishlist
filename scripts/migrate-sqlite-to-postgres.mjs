import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { Pool } from "pg";

const sqlitePath = path.join(process.cwd(), "data", "wishlist.sqlite");

function readEnvValue(name) {
  if (process.env[name]) {
    return process.env[name];
  }

  const envPath = path.join(process.cwd(), ".env.local");

  if (!fs.existsSync(envPath)) {
    return undefined;
  }

  const line = fs
    .readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .find((entry) => entry.startsWith(`${name}=`));

  if (!line) {
    return undefined;
  }

  const value = line.slice(name.length + 1).trim();

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function timestampFromUnixSeconds(value) {
  return value === null || value === undefined ? null : new Date(value * 1000);
}

function sqliteRows(db, tableName) {
  return db.prepare(`SELECT * FROM ${tableName} ORDER BY id`).all();
}

async function assertPostgresEmpty(client) {
  const { rows } = await client.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('cards', 'binder_slots', 'wheel_entries', 'monthly_favorites')
    ORDER BY table_name
  `);

  for (const row of rows) {
    const count = await client.query(`SELECT count(*)::int AS count FROM ${row.table_name}`);

    if (count.rows[0].count > 0) {
      throw new Error(
        `Postgres table ${row.table_name} already has rows. Refusing to import over existing data.`,
      );
    }
  }
}

async function createSchema(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS cards (
      id SERIAL PRIMARY KEY,
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
      created_at TIMESTAMP NOT NULL,
      updated_at TIMESTAMP NOT NULL
    );

    CREATE TABLE IF NOT EXISTS binder_slots (
      id SERIAL PRIMARY KEY,
      page_index INTEGER NOT NULL,
      slot_index INTEGER NOT NULL,
      card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      updated_at TIMESTAMP NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS binder_slots_page_slot_unique
      ON binder_slots(page_index, slot_index);
    CREATE UNIQUE INDEX IF NOT EXISTS binder_slots_card_unique
      ON binder_slots(card_id);

    CREATE TABLE IF NOT EXISTS wheel_entries (
      id SERIAL PRIMARY KEY,
      card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      sort_order INTEGER NOT NULL,
      selected_at TIMESTAMP,
      selected_order INTEGER,
      created_at TIMESTAMP NOT NULL,
      updated_at TIMESTAMP NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS wheel_entries_card_unique
      ON wheel_entries(card_id);

    CREATE TABLE IF NOT EXISTS monthly_favorites (
      id SERIAL PRIMARY KEY,
      month TEXT NOT NULL,
      card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      created_at TIMESTAMP NOT NULL,
      updated_at TIMESTAMP NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS monthly_favorites_month_unique
      ON monthly_favorites(month);
  `);
}

async function insertCards(client, rows) {
  for (const row of rows) {
    await client.query(
      `
        INSERT INTO cards (
          id, name, url, source, image_url, price_text, market_price_text,
          paid_price_text, purchase_month, ebay_search_url, ebay_listing_url,
          rarity, card_type, chase_level, status, notes, created_at, updated_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
        )
      `,
      [
        row.id,
        row.name,
        row.url,
        row.source,
        row.image_url,
        row.price_text,
        row.market_price_text,
        row.paid_price_text,
        row.purchase_month,
        row.ebay_search_url,
        row.ebay_listing_url,
        row.rarity,
        row.card_type,
        row.chase_level,
        row.status,
        row.notes,
        timestampFromUnixSeconds(row.created_at),
        timestampFromUnixSeconds(row.updated_at),
      ],
    );
  }
}

async function insertBinderSlots(client, rows) {
  for (const row of rows) {
    await client.query(
      `
        INSERT INTO binder_slots (id, page_index, slot_index, card_id, updated_at)
        VALUES ($1, $2, $3, $4, $5)
      `,
      [
        row.id,
        row.page_index,
        row.slot_index,
        row.card_id,
        timestampFromUnixSeconds(row.updated_at),
      ],
    );
  }
}

async function insertWheelEntries(client, rows) {
  for (const row of rows) {
    await client.query(
      `
        INSERT INTO wheel_entries (
          id, card_id, sort_order, selected_at, selected_order, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        row.id,
        row.card_id,
        row.sort_order,
        timestampFromUnixSeconds(row.selected_at),
        row.selected_order,
        timestampFromUnixSeconds(row.created_at),
        timestampFromUnixSeconds(row.updated_at),
      ],
    );
  }
}

async function insertMonthlyFavorites(client, rows) {
  for (const row of rows) {
    await client.query(
      `
        INSERT INTO monthly_favorites (id, month, card_id, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5)
      `,
      [
        row.id,
        row.month,
        row.card_id,
        timestampFromUnixSeconds(row.created_at),
        timestampFromUnixSeconds(row.updated_at),
      ],
    );
  }
}

async function syncSequences(client) {
  for (const table of ["cards", "binder_slots", "wheel_entries", "monthly_favorites"]) {
    await client.query(
      `SELECT setval(pg_get_serial_sequence($1, 'id'), COALESCE((SELECT max(id) FROM ${table}), 1), (SELECT count(*) > 0 FROM ${table}))`,
      [table],
    );
  }
}

async function postgresCount(client, tableName) {
  const { rows } = await client.query(`SELECT count(*)::int AS count FROM ${tableName}`);
  return rows[0].count;
}

async function verifyCounts(client, sourceCounts) {
  for (const [table, sourceCount] of Object.entries(sourceCounts)) {
    const importedCount = await postgresCount(client, table);

    if (importedCount !== sourceCount) {
      throw new Error(
        `Count mismatch for ${table}: SQLite has ${sourceCount}, Postgres has ${importedCount}.`,
      );
    }
  }
}

async function main() {
  const databaseUrl = readEnvValue("DATABASE_URL");

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  if (!fs.existsSync(sqlitePath)) {
    throw new Error(`SQLite database not found at ${sqlitePath}.`);
  }

  const sqlite = new Database(sqlitePath, { readonly: true });
  const sourceRows = {
    cards: sqliteRows(sqlite, "cards"),
    binder_slots: sqliteRows(sqlite, "binder_slots"),
    wheel_entries: sqliteRows(sqlite, "wheel_entries"),
    monthly_favorites: sqliteRows(sqlite, "monthly_favorites"),
  };
  const sourceCounts = Object.fromEntries(
    Object.entries(sourceRows).map(([table, rows]) => [table, rows.length]),
  );

  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await assertPostgresEmpty(client);
    await createSchema(client);
    await insertCards(client, sourceRows.cards);
    await insertBinderSlots(client, sourceRows.binder_slots);
    await insertWheelEntries(client, sourceRows.wheel_entries);
    await insertMonthlyFavorites(client, sourceRows.monthly_favorites);
    await syncSequences(client);
    await verifyCounts(client, sourceCounts);
    await client.query("COMMIT");

    console.table(
      Object.entries(sourceCounts).map(([table, count]) => ({
        table,
        sqlite: count,
        postgres: count,
      })),
    );
    console.log("SQLite data migrated to Postgres successfully.");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
    sqlite.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

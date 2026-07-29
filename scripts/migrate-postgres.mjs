import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const apply = process.argv.includes("--apply");
const adopt = process.argv.includes("--adopt-current-schema");
const confirmConfiguredDatabase = process.argv.includes("--confirm-configured-nonloopback-database");
const migrationsFolder = path.join(process.cwd(), "drizzle");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required; it is never printed.");
const databaseUrl = new URL(process.env.DATABASE_URL);
const loopback = ["127.0.0.1", "::1", "localhost"].includes(databaseUrl.hostname);
if (process.env.VERCEL || process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production") {
  throw new Error("Refusing migration in a Vercel or production-marked environment.");
}
if (apply && !loopback && !confirmConfiguredDatabase) {
  throw new Error("Refusing to apply to a configured non-loopback database without --confirm-configured-nonloopback-database.");
}

const client = new pg.Client({ connectionString: databaseUrl.toString() });
await client.connect();
try {
  const [{ present: hasCurrentSchema }] = (await client.query(
    "select to_regclass('public.card_printings') is not null as present",
  )).rows;
  const [{ present: hasLedger }] = (await client.query(
    "select to_regclass('drizzle.__drizzle_migrations') is not null as present",
  )).rows;
  const applied = hasLedger
    ? Number((await client.query("select count(*)::int as count from drizzle.__drizzle_migrations")).rows[0].count)
    : 0;
  if (!apply) {
    console.log(JSON.stringify({
      mode: "dry-run", hasCurrentSchema, appliedMigrations: applied,
      action: hasCurrentSchema && applied === 0 ? "adoption-required" : "ready",
    }, null, 2));
  } else if (hasCurrentSchema && applied === 0 && !adopt) {
    throw new Error("Current schema found without a migration ledger. Review db:migrate:preflight, then rerun with --adopt-current-schema; this records the audited baseline without replaying CREATE TABLE statements.");
  }
  if (apply && hasCurrentSchema && applied === 0) {
    const baselineSql = fs.readFileSync(path.join(migrationsFolder, "0000_baseline_existing_schema.sql"), "utf8");
    const required = [...baselineSql.matchAll(/CREATE TABLE "([^"]+)"/g)].map((match) => match[1]);
    const missing = [];
    for (const table of required) {
      const row = (await client.query("select to_regclass($1) is not null as present", [`public.${table}`])).rows[0];
      if (!row.present) missing.push(table);
    }
    if (missing.length) throw new Error(`Refusing baseline adoption: current schema is incomplete (${missing.join(", ")}).`);
    const journal = JSON.parse(fs.readFileSync(path.join(migrationsFolder, "meta", "_journal.json"), "utf8"));
    const baseline = journal.entries[0];
    const hash = crypto.createHash("sha256").update(baselineSql).digest("hex");
    await client.query("create schema if not exists drizzle");
    await client.query("create table if not exists drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)");
    await client.query("insert into drizzle.__drizzle_migrations (hash, created_at) values ($1, $2)", [hash, baseline.when]);
  }
  if (apply) await migrate(drizzle(client), { migrationsFolder, migrationsSchema: "drizzle" });
} finally {
  await client.end();
}

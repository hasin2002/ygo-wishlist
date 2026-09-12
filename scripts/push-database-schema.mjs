import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const projectRoot = process.cwd();
const drizzleExecutable = path.join(
  projectRoot,
  "node_modules",
  "drizzle-kit",
  "bin.cjs",
);
const repairScript = path.join(
  projectRoot,
  "scripts",
  "repair-ebay-composition-schema.mjs",
);
const catalogueOnly = process.argv.includes("--catalogue-only");
const forwardedArguments = process.argv.slice(2).filter((argument) => argument !== "--catalogue-only");

// Drizzle's table filter still includes unrelated sequences. This additive
// development path applies only the reviewed catalogue DDL and cannot drop data.
if (catalogueOnly) {
  const { readFile } = await import("node:fs/promises");
  const { default: pg } = await import("pg");
  const migration = (await Promise.all(["0011_owned_card_catalogue.sql", "0012_catalogue_market_prices.sql"].map((file) => readFile(path.join(projectRoot, "drizzle", file), "utf8")))).join("\n--> statement-breakpoint\n");
  const statements = migration.split("--> statement-breakpoint").map((statement) => statement.trim()).filter(Boolean);
  if (statements.some((statement) => !/^CREATE (?:TABLE|INDEX) "card_catalogue_/.test(statement) && statement !== 'ALTER TABLE "card_catalogue_products" ADD COLUMN "market_prices_usd_cents" jsonb;')) {
    throw new Error("Catalogue-only push accepts only additive catalogue tables and indexes.");
  }
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 8000 });
  try {
    await client.connect();
    await client.query("begin");
    for (const statement of statements) {
      await client.query(statement.replace(/^CREATE (TABLE|INDEX) /, "CREATE $1 IF NOT EXISTS ").replace('ADD COLUMN "market_prices_usd_cents"', 'ADD COLUMN IF NOT EXISTS "market_prices_usd_cents"'));
    }
    await client.query("commit");
    console.log("Catalogue schema is up to date; ownership tables were unchanged.");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
  process.exit(0);
}

function runRepair() {

  const result = spawnSync(
    process.execPath,
    [repairScript, "--apply"],
    {
      cwd: projectRoot,
      env: process.env,
      encoding: "utf8",
    },
  );
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function runDrizzlePush() {
  const result = spawnSync(
    process.execPath,
    [
      drizzleExecutable,
      "push",
      "--config",
      "drizzle.config.ts",
      ...forwardedArguments,
    ],
    {
      cwd: projectRoot,
      env: process.env,
      encoding: "utf8",
    },
  );
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  return result;
}

function combinedOutput(result) {
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
}

function hasReportedError(result) {
  return /(?:^|\n)error:/i.test(combinedOutput(result));
}

function isCompositeKeyOrderingError(result) {
  return combinedOutput(result).includes(
    "there is no unique constraint matching given keys for referenced table",
  );
}

runRepair();
const firstPush = runDrizzlePush();
if (firstPush.status === 0 && !hasReportedError(firstPush)) {
  runRepair();
  process.exit(0);
}

if (!isCompositeKeyOrderingError(firstPush)) {
  process.exit(firstPush.status && firstPush.status !== 0 ? firstPush.status : 1);
}

console.warn(
  "Drizzle created the empty tables before their composite-key indexes. "
    + "Preparing those indexes and retrying the schema push once.",
);
runRepair();
const secondPush = runDrizzlePush();
if (secondPush.status === 0 && !hasReportedError(secondPush)) {
  runRepair();
  process.exit(0);
}
process.exit(
  secondPush.status && secondPush.status !== 0 ? secondPush.status : 1,
);

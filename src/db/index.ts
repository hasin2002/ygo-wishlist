import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is required. Add a Postgres connection string to .env.local and to the Vercel project environment variables.",
  );
}

declare global {
  var ygoWishlistPgPool: Pool | undefined;
}

const configuredPoolMax = Number.parseInt(process.env.PG_POOL_MAX ?? "1", 10);
const poolMax =
  Number.isFinite(configuredPoolMax) && configuredPoolMax > 0
    ? configuredPoolMax
    : 1;

const pool =
  globalThis.ygoWishlistPgPool ??
  new Pool({
    connectionString: databaseUrl,
    max: poolMax,
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.ygoWishlistPgPool = pool;
}

export const db = drizzle(pool, { schema });

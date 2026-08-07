import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { attachDatabasePool } from "@vercel/functions";
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

const configuredPoolMax = Number.parseInt(process.env.PG_POOL_MAX ?? "3", 10);
const poolMax =
  Number.isFinite(configuredPoolMax) && configuredPoolMax > 0
    ? configuredPoolMax
    : 3;

const pool =
  globalThis.ygoWishlistPgPool ??
  new Pool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 8_000,
    idleTimeoutMillis: 5_000,
    max: poolMax,
    maxUses: 500,
    query_timeout: 12_000,
    statement_timeout: 12_000,
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.ygoWishlistPgPool = pool;
}

if (process.env.VERCEL) {
  attachDatabasePool(pool);
}

export function databasePoolStats() {
  return {
    idle: pool.idleCount,
    total: pool.totalCount,
    waiting: pool.waitingCount,
  };
}

export async function withDatabaseTiming<T>(operation: string, work: () => Promise<T>) {
  const startedAt = performance.now();
  try {
    const value = await work();
    console.info("[database-operation]", {
      durationMs: Math.round(performance.now() - startedAt),
      operation,
      outcome: "success",
      pool: databasePoolStats(),
    });
    return value;
  } catch (error) {
    console.error("[database-operation]", {
      durationMs: Math.round(performance.now() - startedAt),
      error: error instanceof Error ? error.name : "UnknownError",
      operation,
      outcome: "failure",
      pool: databasePoolStats(),
    });
    throw error;
  }
}

export const db = drizzle(pool, { schema });

import { defineConfig } from "drizzle-kit";
import fs from "node:fs";

function envValue(name: string) {
  if (process.env[name]) {
    return process.env[name];
  }

  if (!fs.existsSync(".env.local")) {
    return undefined;
  }

  const line = fs
    .readFileSync(".env.local", "utf8")
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

const databaseUrl = envValue("DATABASE_URL");

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to open Postgres Drizzle Studio.");
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
});

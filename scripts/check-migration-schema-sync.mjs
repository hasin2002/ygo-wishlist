import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const projectRoot = process.cwd();
const migrationsFolder = path.join(projectRoot, "drizzle");
const schemaPath = path.join(projectRoot, "src", "db", "schema.ts");
const drizzleExecutable = path.join(
  projectRoot,
  "node_modules",
  "drizzle-kit",
  "bin.cjs",
);
const temporaryRoot = fs.mkdtempSync(
  path.join(projectRoot, ".drizzle-migration-check-"),
);
const temporaryMigrations = path.join(temporaryRoot, "drizzle");
const temporaryMigrationsRelative = path.relative(projectRoot, temporaryMigrations);

try {
  fs.cpSync(migrationsFolder, temporaryMigrations, { recursive: true });
  const journalPath = path.join(temporaryMigrations, "meta", "_journal.json");
  const before = JSON.parse(fs.readFileSync(journalPath, "utf8"));
  const result = spawnSync(
    process.execPath,
    [
      drizzleExecutable,
      "generate",
      "--dialect",
      "postgresql",
      "--schema",
      path.relative(projectRoot, schemaPath),
      "--out",
      temporaryMigrationsRelative,
      "--name",
      "uncommitted_schema_change",
    ],
    {
      cwd: projectRoot,
      encoding: "utf8",
      env: process.env,
    },
  );

  if (result.status !== 0) {
    process.stdout.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    throw new Error(`Drizzle schema comparison failed with exit code ${result.status ?? 1}.`);
  }

  const generatorOutput = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const after = JSON.parse(fs.readFileSync(journalPath, "utf8"));
  const noSchemaChanges = /No schema changes, nothing to migrate/i.test(generatorOutput);
  if (!noSchemaChanges || after.entries.length !== before.entries.length) {
    process.stdout.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    console.error(
      "src/db/schema.ts contains a database change without a committed Drizzle migration. "
        + "Run drizzle-kit generate, review the SQL, and commit the migration plus metadata.",
    );
    throw new Error("Committed Drizzle migrations are behind src/db/schema.ts.");
  }

  console.log("Database schema and committed Drizzle migrations are in sync.");
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

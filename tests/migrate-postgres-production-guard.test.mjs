import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

const script = new URL("../scripts/migrate-postgres.mjs", import.meta.url);
const databaseUrl = "postgresql://migration_test:migration_test@127.0.0.1:1/migration_test";
const releaseWorkflow = fs.readFileSync(".github/workflows/production-release.yml", "utf8");

function runMigration(arguments_, environment = {}) {
  return spawnSync(process.execPath, [script.pathname, ...arguments_], {
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: databaseUrl, ...environment },
  });
}

test("production-marked migration requires the GitHub Actions release flag", () => {
  const result = runMigration(["--apply"], { NODE_ENV: "production" });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /production-marked environment without the GitHub Actions release flag/);
});

test("the GitHub Actions release flag cannot be used outside GitHub Actions", () => {
  const result = runMigration(["--apply", "--allow-github-actions-production"], { NODE_ENV: "production" });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /only valid inside GitHub Actions/);
});

test("a Vercel environment remains blocked even with the GitHub Actions release flag", () => {
  const result = runMigration(
    ["--apply", "--allow-github-actions-production", "--confirm-configured-nonloopback-database"],
    { GITHUB_ACTIONS: "true", NODE_ENV: "production", VERCEL: "1" },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Refusing migration in a Vercel environment/);
});

test("the approved GitHub Actions release path passes the production guard", () => {
  const result = runMigration(
    ["--apply", "--allow-github-actions-production", "--confirm-configured-nonloopback-database"],
    { GITHUB_ACTIONS: "true", NODE_ENV: "production" },
  );

  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stderr, /Refusing migration|only valid inside GitHub Actions/);
  assert.match(result.stderr, /ECONNREFUSED/);
});

test("production verifies committed schema migrations before applying or deploying", () => {
  const check = releaseWorkflow.indexOf("run: npm run db:migrate:check");
  const migrate = releaseWorkflow.indexOf("run: npm run db:migrate:apply");
  const deploy = releaseWorkflow.indexOf("run: npx --yes vercel@");

  assert.ok(check >= 0, "Production must check for uncommitted schema changes");
  assert.ok(check < migrate, "Schema consistency must be checked before migrations run");
  assert.ok(migrate < deploy, "Migrations must complete before deployment starts");
});

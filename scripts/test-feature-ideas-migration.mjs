import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";

const root = process.cwd();
const marker = `ygo_wishlist_test_feature_ideas_${process.pid}_${Date.now()}`;
const dataDirectory = await mkdtemp(path.join(tmpdir(), `${marker}-`));

function run(command, args, { env = process.env, allowFailure = false } = {}) {
  const result = spawnSync(command, args, { cwd: root, env, encoding: "utf8" });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (!allowFailure && result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}.`);
  }
  return result;
}

async function unusedLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Could not reserve a loopback port.")));
        return;
      }
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

const port = await unusedLoopbackPort();
const databaseUrl = `postgresql://postgres@127.0.0.1:${port}/${marker}`;
const testEnvironment = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
};

for (const key of ["CI", "VERCEL", "VERCEL_ENV", "VERCEL_URL", "VERCEL_REGION", "NEXT_PUBLIC_VERCEL_URL"]) {
  delete testEnvironment[key];
}

try {
  run("initdb", ["-D", dataDirectory, "-A", "trust", "-U", "postgres", "--no-locale"]);
  run("pg_ctl", ["-D", dataDirectory, "-l", path.join(dataDirectory, "postgres.log"), "-o", `-h 127.0.0.1 -p ${port}`, "-w", "start"]);
  run("createdb", ["-h", "127.0.0.1", "-p", String(port), "-U", "postgres", marker]);
  run(process.execPath, ["scripts/migrate-postgres.mjs", "--apply"], { env: testEnvironment });

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const [{ present }] = (await client.query(
      "select to_regclass('public.feature_idea_pages') is not null as present",
    )).rows;
    const [{ count }] = (await client.query(
      "select count(*)::int as count from drizzle.__drizzle_migrations",
    )).rows;
    assert.equal(present, false, "Feature Ideas table must be absent after migration history runs");
    assert.equal(count, 6, "The empty database must apply migrations 0000 through 0005");
  } finally {
    await client.end();
  }
} finally {
  run("pg_ctl", ["-D", dataDirectory, "-m", "immediate", "stop"], { allowFailure: true });
  await rm(dataDirectory, { force: true, recursive: true });
}

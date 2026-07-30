import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

const root = process.cwd();
const marker = `ygo_wishlist_test_${process.pid}_${Date.now()}`;
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

function assertDisposableUrl(value) {
  const url = new URL(value);
  if (url.hostname !== "127.0.0.1" || !url.pathname.slice(1).startsWith("ygo_wishlist_test_")) {
    throw new Error("Transaction tests require an isolated loopback database with the ygo_wishlist_test_ marker.");
  }
}

const port = await unusedLoopbackPort();
const databaseUrl = `postgresql://postgres@127.0.0.1:${port}/${marker}`;
assertDisposableUrl(databaseUrl);
const testEnvironment = {
  ...process.env,
  BETTER_AUTH_SECRET: `${marker}_better_auth_secret_for_isolated_tests`,
  DATABASE_URL: databaseUrl,
  EBAY_CLIENT_ID: "isolated-client-id",
  EBAY_CLIENT_SECRET: "isolated-client-secret",
  EBAY_OAUTH_LOCAL_RU_NAME: "isolated-local-ru-name",
  NODE_ENV: "test",
  PG_POOL_MAX: "1",
};
for (const key of ["AWS_REGION", "CI", "S3_BUCKET_NAME", "VERCEL", "VERCEL_ENV", "VERCEL_URL", "VERCEL_REGION", "NEXT_PUBLIC_VERCEL_URL"]) {
  delete testEnvironment[key];
}

try {
  // `initdb` receives an empty directory made above. The configured .env.local
  // is intentionally never loaded by this script or its children.
  run("initdb", ["-D", dataDirectory, "-A", "trust", "-U", "postgres", "--no-locale"]);
  // Give Postgres its own log file. Otherwise the daemon inherits the test
  // runner's output pipe and a synchronous `pg_ctl` child never closes it.
  run("pg_ctl", ["-D", dataDirectory, "-l", path.join(dataDirectory, "postgres.log"), "-o", `-h 127.0.0.1 -p ${port}`, "-w", "start"]);
  run("createdb", ["-h", "127.0.0.1", "-p", String(port), "-U", "postgres", marker]);
  run(process.execPath, ["scripts/push-database-schema.mjs", "--force"], { env: testEnvironment });
  run(process.execPath, ["--experimental-transform-types", "--experimental-loader", "./tests/node-ts-loader.mjs", "--test", "--test-force-exit", "tests/records-transactions.test.ts"], { env: testEnvironment });
} finally {
  run("pg_ctl", ["-D", dataDirectory, "-m", "immediate", "stop"], { allowFailure: true });
  await rm(dataDirectory, { force: true, recursive: true });
}

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
const forwardedArguments = process.argv.slice(2);

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

#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import {
  assertStrongMutationConfirmation,
  categoryEvidence,
  errorEvidence,
  getItem,
  getOrderEvidence,
  getSeller,
  mutationPlan,
  preflight,
  projectEvidence,
  runMutation,
  sandboxAccessToken,
  verifyLot,
} from "./lib/ebay-sandbox-compatibility.mjs";

const readCommands = new Set(["preflight", "read", "category", "order", "seller"]);
const validationCommands = new Set(["verify-lot"]);
const mutationCommands = new Set(["add-quantity", "revise-inventory", "end-not-available"]);

function argumentsFrom(argv) {
  const [command, ...raw] = argv;
  const options = {};
  for (const entry of raw) {
    if (!entry.startsWith("--")) continue;
    const [key, value = true] = entry.slice(2).split("=", 2);
    options[key] = value;
  }
  return { command, options };
}

function requiredOption(options, name) {
  if (!options[name] || options[name] === true) throw new Error(`--${name}=... is required.`);
  return options[name];
}

async function optionsForMutation(command, options) {
  const mutation = {
    itemId: options["item-id"],
    operationKey: requiredOption(options, "operation-key"),
    quantity: options.quantity,
    sourceAddOperationKey: options["source-add-operation-key"],
  };
  if (command === "add-quantity") {
    const itemFile = requiredOption(options, "item-xml-file");
    mutation.itemXml = await fs.readFile(itemFile, "utf8");
    mutation.quantity = requiredOption(options, "quantity");
  }
  if (command !== "add-quantity" && command !== "end-not-available") mutation.quantity = requiredOption(options, "quantity");
  if (command !== "add-quantity") {
    mutation.itemId = requiredOption(options, "item-id");
    mutation.sourceAddOperationKey = requiredOption(options, "source-add-operation-key");
  }
  return mutation;
}

async function capture(options, evidence) {
  if (!options.capture) return;
  const filename = path.resolve(options.capture);
  if (/\.raw\./i.test(filename)) throw new Error("Refusing to write a raw evidence capture. Use a sanitized filename.");
  await fs.mkdir(path.dirname(filename), { recursive: true });
  await fs.writeFile(filename, `${JSON.stringify(projectEvidence(evidence), null, 2)}\n`, { encoding: "utf8", flag: "wx" });
}

async function main() {
  const { command, options } = argumentsFrom(process.argv.slice(2));
  if (!command || command === "--help") {
    console.log("Usage: node scripts/ebay-sandbox-compatibility.mjs <preflight|seller|read|category|order|verify-lot|add-quantity|revise-inventory|end-not-available> [--key=value]\nverify-lot makes exactly one non-publishing VerifyAddItem call and requires --item-xml-file, --category-id=183455, --lot-size, and --probe-key. Revise/end require --item-id and --source-add-operation-key; every mutation also requires --operation-key and --confirm-sandbox-mutation=I_UNDERSTAND_THIS_MUTATES_EBAY_SANDBOX. ReviseItem is request-shape-only and cannot execute yet.");
    return;
  }
  if (!readCommands.has(command) && !validationCommands.has(command) && !mutationCommands.has(command)) {
    throw new Error(`Unknown command: ${command}`);
  }
  if (command === "preflight") {
    const result = preflight();
    console.log(JSON.stringify(projectEvidence(result), null, 2));
    process.exitCode = result.canAuthenticate ? 0 : 2;
    return;
  }
  if (mutationCommands.has(command)) {
    const mutation = await optionsForMutation(command, options);
    // This plan is deliberately printed before any credential is resolved or
    // request is sent, so an operator has a bounded, sanitized last look.
    console.log(JSON.stringify(projectEvidence({ plan: mutationPlan(command, mutation) }), null, 2));
    assertStrongMutationConfirmation(options["confirm-sandbox-mutation"]);
    const result = await runMutation({
      accessToken: await sandboxAccessToken({}),
      command,
      confirm: options["confirm-sandbox-mutation"],
      intentDirectory: path.resolve(".ebay-sandbox-operation-intents"),
      options: mutation,
    });
    await capture(options, result);
    console.log(JSON.stringify(projectEvidence(result), null, 2));
    if (result.result.error) process.exitCode = 1;
    return;
  }
  if (command === "verify-lot") {
    const result = await verifyLot({
      accessToken: await sandboxAccessToken({}),
      categoryId: requiredOption(options, "category-id"),
      itemXml: await fs.readFile(requiredOption(options, "item-xml-file"), "utf8"),
      lotSize: requiredOption(options, "lot-size"),
      probeKey: requiredOption(options, "probe-key"),
    });
    await capture(options, result);
    console.log(JSON.stringify(projectEvidence(result), null, 2));
    if (!result.accepted) process.exitCode = 1;
    return;
  }
  const accessToken = await sandboxAccessToken({});
  let result;
  if (command === "read") result = await getItem({ accessToken, itemId: requiredOption(options, "item-id") });
  if (command === "order") result = await getOrderEvidence({ accessToken, itemId: requiredOption(options, "item-id") });
  if (command === "seller") result = await getSeller({ accessToken });
  if (command === "category") result = await categoryEvidence({ accessToken, categoryId: requiredOption(options, "category-id") });
  await capture(options, result);
  console.log(JSON.stringify(projectEvidence(result), null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify(projectEvidence(errorEvidence(error)), null, 2));
  process.exitCode = 1;
});

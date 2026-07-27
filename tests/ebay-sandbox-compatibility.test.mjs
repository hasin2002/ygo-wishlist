import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  SANDBOX_HOST,
  STRONG_MUTATION_CONFIRMATION,
  assertSandboxUrl,
  buildAddItemRequest,
  buildEndItemRequest,
  buildReviseInventoryStatusRequest,
  buildReviseItemRequest,
  buildVerifyLotRequest,
  categoryEvidence,
  errorEvidence,
  getItem,
  getItemTransactions,
  getOrderEvidence,
  getSeller,
  mutationPlan,
  parseMultiUnitTransactions,
  preflight,
  persistOperationIntent,
  projectEvidence,
  redactEvidence,
  recordOperationItemId,
  runMutation,
  sandboxAccessToken,
  sandboxUrls,
  stableAddItemUuid,
  stableLotProbeMessageId,
  stableReviseInvocationId,
  timeoutDecision,
  tradingCall,
  verifyLot,
} from "../scripts/lib/ebay-sandbox-compatibility.mjs";

function assertExactKeys(value, expected, context) {
  assert.equal(typeof value, "object", `${context} must be an object`);
  assert.notEqual(value, null, `${context} must not be null`);
  assert.equal(Array.isArray(value), false, `${context} must not be an array`);
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), `${context} has an unexpected schema`);
}

function completeTradingPage(transactionXml = "") {
  const count = (transactionXml.match(/<Transaction>/g) ?? []).length;
  return `<Ack>Success</Ack><HasMoreTransactions>false</HasMoreTransactions><PageNumber>1</PageNumber><ReturnedTransactionCountActual>${count}</ReturnedTransactionCountActual><PaginationResult><TotalNumberOfPages>1</TotalNumberOfPages><TotalNumberOfEntries>${count}</TotalNumberOfEntries></PaginationResult><TransactionArray>${transactionXml}</TransactionArray>`;
}

async function sourceIntentFor({ intentDirectory, itemId, operationKey, quantity = 3 }) {
  const intent = await persistOperationIntent({
    command: "add-quantity",
    intentDirectory,
    options: { itemXml: "<Item><Title>fixture</Title></Item>", operationKey, quantity },
  });
  await recordOperationItemId({ intent, itemId });
  return intent;
}

async function runGuardedMutationScenario({
  command = "revise-inventory",
  fulfillmentBody = { orders: [], total: 0 },
  itemId,
  quantity = 0,
  quantitySold = 2,
  transactionXml = "",
}) {
  const intentDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "ebay-sandbox-order-gate-"));
  const sourceAddOperationKey = `source-${itemId}`;
  await sourceIntentFor({ intentDirectory, itemId, operationKey: sourceAddOperationKey });
  const callNames = [];
  const tradingBodies = [];
  const result = await runMutation({
    accessToken: "token",
    command,
    confirm: STRONG_MUTATION_CONFIRMATION,
    intentDirectory,
    options: {
      itemId,
      operationKey: `${command}-${itemId}`,
      quantity,
      sourceAddOperationKey,
    },
    fetchImpl: async (url, request) => {
      if (url.includes("/sell/fulfillment/v1/order")) {
        callNames.push("FulfillmentGetOrders");
        return { ok: true, status: 200, json: async () => fulfillmentBody };
      }
      const callName = request.headers["X-EBAY-API-CALL-NAME"];
      callNames.push(callName);
      tradingBodies.push({ body: request.body, callName });
      if (callName === "GetItem") {
        const getItemCount = callNames.filter((name) => name === "GetItem").length;
        const listing = command === "end-not-available" && getItemCount > 1
          ? `<ListingStatus>Ended</ListingStatus><EndingReason>NotAvailable</EndingReason><Quantity>3</Quantity><QuantitySold>${quantitySold}</QuantitySold>`
          : getItemCount > 1
            ? `<ListingStatus>Active</ListingStatus><Quantity>${quantity + quantitySold}</Quantity><QuantitySold>${quantitySold}</QuantitySold>`
            : `<ListingStatus>Active</ListingStatus><Quantity>3</Quantity><QuantitySold>${quantitySold}</QuantitySold>`;
        return { ok: true, status: 200, text: async () => `<Ack>Success</Ack><Item><ItemID>${itemId}</ItemID>${listing}</Item>` };
      }
      if (callName === "GetItemTransactions") {
        return { ok: true, status: 200, text: async () => completeTradingPage(transactionXml) };
      }
      return { ok: true, status: 200, text: async () => "<Ack>Success</Ack>" };
    },
  });
  return { callNames, result, tradingBodies };
}

test("endpoint and credential isolation only permits eBay Sandbox", () => {
  assert.equal(SANDBOX_HOST, "https://api.sandbox.ebay.com");
  assert.throws(() => assertSandboxUrl("https://api.ebay.com/ws/api.dll"), /non-Sandbox/);
  assert.equal(assertSandboxUrl(sandboxUrls().trading), sandboxUrls().trading);
  const report = preflight({ EBAY_CLIENT_ID: "production-must-not-be-read", DATABASE_URL: "postgres://not-used" });
  assert.equal(report.canAuthenticate, false);
  assert.equal(report.productionInputsIgnored, true);
  assert.equal(report.readsDatabase, false);
  assert.equal(projectEvidence(report).readsDatabase, false);
});

test("refresh credential exchange remains on Sandbox", async () => {
  let requestedUrl;
  let requestedOptions;
  await sandboxAccessToken({
    environment: { EBAY_SANDBOX_CLIENT_ID: "id", EBAY_SANDBOX_CLIENT_SECRET: "secret", EBAY_SANDBOX_REFRESH_TOKEN: "refresh" },
    fetchImpl: async (url, options) => {
      requestedUrl = url;
      requestedOptions = options;
      return { ok: true, status: 200, json: async () => ({ access_token: "sandbox-token" }) };
    },
  });
  assert.equal(requestedUrl, "https://api.sandbox.ebay.com/identity/v1/oauth2/token");
  assert.equal(requestedOptions.redirect, "error");
});

test("mutation request shapes bind stable identities and quantities", async () => {
  const firstUuid = stableAddItemUuid("lot-123");
  assert.equal(firstUuid, stableAddItemUuid("lot-123"));
  assert.notEqual(firstUuid, stableAddItemUuid("lot-124"));
  assert.match(firstUuid, /^[A-F0-9]{32}$/);
  const add = buildAddItemRequest({ itemXml: "<Item><Title>Test</Title><Quantity>1</Quantity></Item>", operationKey: "lot-123", quantity: 3 });
  assert.match(add.body, /<Quantity>3<\/Quantity>/);
  assert.match(add.body, new RegExp(`<UUID>${firstUuid}<\\/UUID>`));
  assert.match(add.body, new RegExp(`<MessageID>${firstUuid}<\\/MessageID>`));
  const inventory = buildReviseInventoryStatusRequest({ itemId: "123", operationKey: "reduce-1", quantity: 2 });
  assert.match(inventory.body, /<InventoryStatus><ItemID>123<\/ItemID><Quantity>2<\/Quantity><\/InventoryStatus>/);
  assert.match(inventory.messageId, /^sandbox-revise-inventory-/);
  assert.equal(inventory.invocationId, undefined);
  const fallback = buildReviseItemRequest({ itemId: "123", operationKey: "fallback-1", quantity: 1 });
  assert.match(fallback.body, new RegExp(`<MessageID>${fallback.messageId}<\\/MessageID><InvocationID>${fallback.invocationId}<\\/InvocationID>`));
  assert.match(fallback.invocationId, /^[A-F0-9]{32}$/);
  assert.equal(fallback.invocationId, stableReviseInvocationId({ command: "revise-item", operationKey: "fallback-1" }));
  assert.match(fallback.body, /<Item><ItemID>123<\/ItemID><Quantity>1/);
  await assert.rejects(
    runMutation({ accessToken: "token", command: "revise-item", confirm: STRONG_MUTATION_CONFIRMATION, options: { itemId: "123", operationKey: "never-live", quantity: 1 } }),
    /execution is disabled/,
  );
  assert.match(buildEndItemRequest({ itemId: "123", operationKey: "end-1" }).body, /<EndingReason>NotAvailable<\/EndingReason>/);
});

test("mutations require the strong confirmation, persist intent, and expose a bounded plan", async () => {
  const options = { itemId: "123", operationKey: "reduce-1", quantity: 2 };
  const plan = mutationPlan("revise-inventory", options);
  assert.equal(plan.sandboxOnly, true);
  assert.equal(plan.quantity, 2);
  assert.match(plan.reconciliation, /do not retry/i);
  await assert.rejects(
    runMutation({ accessToken: "token", command: "revise-inventory", confirm: "yes", options }),
    /confirm-sandbox-mutation/,
  );
  const callNames = [];
  const intentDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "ebay-sandbox-intent-"));
  const sourceIntent = await persistOperationIntent({
    command: "add-quantity",
    intentDirectory,
    options: { itemXml: "<Item><Title>Test</Title></Item>", operationKey: "source-add", quantity: 2 },
  });
  await recordOperationItemId({ intent: sourceIntent, itemId: "123" });
  options.sourceAddOperationKey = "source-add";
  const result = await runMutation({
    accessToken: "token",
    command: "revise-inventory",
    confirm: STRONG_MUTATION_CONFIRMATION,
    intentDirectory,
    options,
    fetchImpl: async (url, request) => {
      if (url.includes("/sell/fulfillment/v1/order")) {
        callNames.push("FulfillmentGetOrders");
        return { ok: true, status: 200, json: async () => ({ orders: [], total: 0 }) };
      }
      const callName = request.headers["X-EBAY-API-CALL-NAME"];
      callNames.push(callName);
      const getItemCount = callNames.filter((name) => name === "GetItem").length;
      return {
        ok: true,
        status: 200,
        text: async () => callName === "GetItem"
          ? getItemCount === 1
            ? "<Ack>Success</Ack><Item><ItemID>123</ItemID><ListingStatus>Active</ListingStatus><Quantity>5</Quantity><QuantitySold>0</QuantitySold></Item>"
            : "<Ack>Success</Ack><Item><ItemID>123</ItemID><ListingStatus>Active</ListingStatus><Quantity>2</Quantity><QuantitySold>0</QuantitySold></Item>"
          : callName === "GetItemTransactions" ? completeTradingPage() : "<Ack>Success</Ack>",
      };
    },
  });
  assert.deepEqual(
    callNames,
    ["GetItem", "GetItemTransactions", "FulfillmentGetOrders", "ReviseInventoryStatus", "GetItem"],
    "the fresh order gate runs immediately before revise and read reconciliation follows",
  );
  assert.equal(result.reconciliation.itemId, "123");
  assert.deepEqual(result.reconciliation.listing, { itemId: "123", endingReason: null, listingStatus: "Active", quantity: 2, quantitySold: 0, available: 2 });
  const storedIntent = JSON.parse(await fs.readFile(result.intent.filename, "utf8"));
  assert.equal(storedIntent.desiredQuantity, 2);
  assert.match(storedIntent.operationKeyPseudonym, /^\[operation-key:/);
  assert.equal(JSON.stringify(storedIntent).includes("reduce-1"), false);
  assert.equal(storedIntent.outcome, "confirmed");
});

test("GetItem returns total, sold, and available quantity while failed remote calls retain sanitized errors", async () => {
  const listing = await getItem({
    accessToken: "token",
    itemId: "123",
    fetchImpl: async () => ({ status: 200, ok: true, text: async () => "<Ack>Success</Ack><Item><ItemID>123</ItemID><Quantity>5</Quantity><QuantitySold>2</QuantitySold></Item>" }),
  });
  assert.deepEqual(listing.listing, { itemId: "123", endingReason: null, listingStatus: null, quantity: 5, quantitySold: 2, available: 3 });
  let fetchOptions;
  await assert.rejects(
    tradingCall({
      accessToken: "token",
      callName: "ReviseItem",
      body: "<Item/>",
      fetchImpl: async (_url, options) => {
        fetchOptions = options;
        return { status: 400, ok: false, text: async () => "<Ack>Failure</Ack><Errors><ErrorCode>219</ErrorCode><LongMessage>buyer@example.test failed</LongMessage><SeverityCode>Error</SeverityCode></Errors>" };
      },
    }),
    (error) => {
      assert.deepEqual(errorEvidence(error), {
        ack: "Failure",
        errors: [{ code: "219", message: "[redacted]", severity: "Error" }],
        httpStatus: 400,
        message: "[redacted]",
      });
      return true;
    },
  );
  assert.equal(fetchOptions.redirect, "error");
  assert.equal(fetchOptions.headers["X-EBAY-API-IAF-TOKEN"], "token");
  assert.doesNotMatch(fetchOptions.body, /token|RequesterCredentials|eBayAuthToken/);
});

test("AddItem verifies first and recovers an ambiguous duplicate UUID without changing its identity", async () => {
  const intentDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "ebay-sandbox-add-"));
  let call = 0;
  const result = await runMutation({
    accessToken: "token",
    command: "add-quantity",
    confirm: STRONG_MUTATION_CONFIRMATION,
    intentDirectory,
    options: { itemXml: "<Item><Title>temporary fixture</Title></Item>", operationKey: "add-duplicate", quantity: 2 },
    fetchImpl: async () => {
      call += 1;
      return {
        ok: true,
        status: 200,
        text: async () => call === 1
          ? "<Ack>Warning</Ack>"
          : call === 2
            ? "<Ack>Failure</Ack><Errors><ErrorCode>488</ErrorCode><ErrorParameters ParamID=\"0\"><Value>1</Value></ErrorParameters><ErrorParameters ParamID=\"1\"><Value>456789</Value></ErrorParameters><LongMessage>duplicate private text</LongMessage><SeverityCode>Error</SeverityCode></Errors>"
            : "<Ack>Success</Ack><Item><ItemID>456789</ItemID><ListingStatus>Active</ListingStatus><Quantity>2</Quantity><QuantitySold>0</QuantitySold></Item>",
      };
    },
  });
  assert.equal(call, 3, "VerifyAddItem, duplicate AddItem response, then GetItem reconciliation");
  assert.equal(result.verification.ack, "Warning");
  assert.equal(result.recoveredDuplicate, true);
  assert.equal(result.reconciliation.itemId, "456789");
  const stored = JSON.parse(await fs.readFile(result.intent.filename, "utf8"));
  assert.equal(stored.returnedItemId, "456789");
  assert.match(stored.uuid, /^[A-F0-9]{32}$/);
});

test("duplicate UUID recovery fails closed without the same-application ParamID proof", async () => {
  const intentDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "ebay-sandbox-duplicate-negative-"));
  let call = 0;
  const result = await runMutation({
    accessToken: "token",
    command: "add-quantity",
    confirm: STRONG_MUTATION_CONFIRMATION,
    intentDirectory,
    options: { itemXml: "<Item><Title>fixture</Title></Item>", operationKey: "duplicate-negative", quantity: 1 },
    fetchImpl: async () => {
      call += 1;
      return {
        ok: true,
        status: 200,
        text: async () => call === 1
          ? "<Ack>Success</Ack>"
          : "<Ack>Failure</Ack><Errors><ErrorCode>488</ErrorCode><ErrorParameters ParamID=\"1\"><Value>456789</Value></ErrorParameters><SeverityCode>Error</SeverityCode></Errors>",
      };
    },
  });
  assert.equal(call, 2, "the original ItemID is not reconciled without ParamID=0 same-application proof");
  assert.equal(result.recoveredDuplicate, undefined);
  assert.equal(result.result.error.ack, "Failure");
});

test("ambiguous AddItem retries reuse the verified UUID and skip re-verification", async () => {
  const intentDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "ebay-sandbox-timeout-"));
  const options = {
    itemXml: "<Item><Title>temporary timeout fixture</Title></Item>",
    operationKey: "add-timeout",
    quantity: 2,
  };
  let firstRunCalls = 0;
  const uncertain = await runMutation({
    accessToken: "token",
    command: "add-quantity",
    confirm: STRONG_MUTATION_CONFIRMATION,
    intentDirectory,
    options,
    fetchImpl: async () => {
      firstRunCalls += 1;
      if (firstRunCalls === 1) {
        return { ok: true, status: 200, text: async () => "<Ack>Success</Ack>" };
      }
      throw new DOMException("timed out", "AbortError");
    },
  });
  assert.equal(firstRunCalls, 2);
  assert.equal(uncertain.timeout.action, "reconcile-before-retry");

  let retryCalls = 0;
  const recovered = await runMutation({
    accessToken: "token",
    command: "add-quantity",
    confirm: STRONG_MUTATION_CONFIRMATION,
    intentDirectory,
    options,
    fetchImpl: async () => {
      retryCalls += 1;
      return {
        ok: true,
        status: 200,
        text: async () => retryCalls === 1
          ? "<Ack>Failure</Ack><Errors><ErrorCode>488</ErrorCode><ErrorParameters ParamID=\"0\"><Value>1</Value></ErrorParameters><ErrorParameters ParamID=\"1\"><Value>777888999</Value></ErrorParameters><SeverityCode>Error</SeverityCode></Errors>"
          : "<Ack>Success</Ack><Item><ItemID>777888999</ItemID><ListingStatus>Active</ListingStatus><Quantity>2</Quantity><QuantitySold>0</QuantitySold></Item>",
      };
    },
  });
  assert.equal(retryCalls, 2, "retry skips VerifyAddItem, reuses AddItem UUID, then reconciles");
  assert.equal(recovered.reconciliation.itemId, "777888999");
  assert.equal(recovered.recoveredDuplicate, true);
});

test("EndItem is bound to a local AddItem intent and uses safe pre-reads", async () => {
  const intentDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "ebay-sandbox-end-"));
  const addIntent = await persistOperationIntent({
    command: "add-quantity",
    intentDirectory,
    options: { itemXml: "<Item><Title>fixture</Title></Item>", operationKey: "source-for-end", quantity: 1 },
  });
  await recordOperationItemId({ intent: addIntent, itemId: "987" });
  const callNames = [];
  const result = await runMutation({
    accessToken: "token",
    command: "end-not-available",
    confirm: STRONG_MUTATION_CONFIRMATION,
    intentDirectory,
    options: { itemId: "987", operationKey: "end-once", sourceAddOperationKey: "source-for-end" },
    fetchImpl: async (_url, options) => {
      if (_url.includes("/sell/fulfillment/v1/order")) {
        callNames.push("FulfillmentGetOrders");
        return { ok: true, status: 200, json: async () => ({ orders: [], total: 0 }) };
      }
      callNames.push(options.headers["X-EBAY-API-CALL-NAME"]);
      const callName = options.headers["X-EBAY-API-CALL-NAME"];
      return {
        ok: true,
        status: 200,
        text: async () => callName === "GetItem"
          ? callNames.filter((name) => name === "GetItem").length === 1
            ? "<Ack>Success</Ack><Item><ItemID>987</ItemID><ListingStatus>Active</ListingStatus><Quantity>1</Quantity><QuantitySold>0</QuantitySold></Item>"
            : "<Ack>Success</Ack><Item><ItemID>987</ItemID><ListingStatus>Ended</ListingStatus><EndingReason>NotAvailable</EndingReason><Quantity>1</Quantity><QuantitySold>0</QuantitySold></Item>"
          : callName === "GetItemTransactions" ? completeTradingPage() : "<Ack>Success</Ack>",
      };
    },
  });
  assert.deepEqual(callNames, ["GetItem", "GetItemTransactions", "FulfillmentGetOrders", "EndItem", "GetItem"]);
  assert.equal(result.result.ack, "Success");
  assert.equal(result.intent.outcome, "confirmed");
  let called = false;
  const refused = await runMutation({
    accessToken: "token",
    command: "end-not-available",
    confirm: STRONG_MUTATION_CONFIRMATION,
    intentDirectory,
    options: { itemId: "987", operationKey: "bad-source", sourceAddOperationKey: "missing" },
    fetchImpl: async () => { called = true; throw new Error("must not fetch"); },
  });
  assert.equal(called, false);
  assert.equal(refused.result.error.message, "[redacted]");
});

test("EndItem permits cleanup only after Trading and Fulfillment both prove cancellation complete", async () => {
  const intentDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "ebay-sandbox-cancelled-end-"));
  const addIntent = await persistOperationIntent({
    command: "add-quantity",
    intentDirectory,
    options: { itemXml: "<Item><Title>fixture</Title></Item>", operationKey: "cancelled-source", quantity: 3 },
  });
  await recordOperationItemId({ intent: addIntent, itemId: "654" });
  const callNames = [];
  const result = await runMutation({
    accessToken: "token",
    command: "end-not-available",
    confirm: STRONG_MUTATION_CONFIRMATION,
    intentDirectory,
    options: { itemId: "654", operationKey: "cancelled-end", sourceAddOperationKey: "cancelled-source" },
    fetchImpl: async (url, options) => {
      if (url.includes("/sell/fulfillment/v1/order")) {
        callNames.push("FulfillmentGetOrders");
        return {
          ok: true,
          status: 200,
          json: async () => ({
            orders: [{
              cancelStatus: { cancelState: "CANCELED" },
              lineItems: [{ legacyItemId: "654", quantity: 2 }],
              orderFulfillmentStatus: "NOT_STARTED",
              orderPaymentStatus: "FULLY_REFUNDED",
            }],
            total: 1,
          }),
        };
      }
      const callName = options.headers["X-EBAY-API-CALL-NAME"];
      callNames.push(callName);
      const getItemCount = callNames.filter((name) => name === "GetItem").length;
      const xml = callName === "GetItem"
        ? getItemCount === 1
          ? "<Ack>Success</Ack><Item><ItemID>654</ItemID><ListingStatus>Active</ListingStatus><Quantity>3</Quantity><QuantitySold>2</QuantitySold></Item>"
          : "<Ack>Success</Ack><Item><ItemID>654</ItemID><ListingStatus>Ended</ListingStatus><EndingReason>NotAvailable</EndingReason><Quantity>3</Quantity><QuantitySold>2</QuantitySold></Item>"
        : callName === "GetItemTransactions"
          ? completeTradingPage("<Transaction><CancelStatus>CancelComplete</CancelStatus><CheckoutStatus>CheckoutComplete</CheckoutStatus><QuantityPurchased>2</QuantityPurchased></Transaction>")
          : "<Ack>Success</Ack>";
      return { ok: true, status: 200, text: async () => xml };
    },
  });
  assert.deepEqual(callNames, ["GetItem", "GetItemTransactions", "FulfillmentGetOrders", "EndItem", "GetItem"]);
  assert.equal(result.intent.outcome, "confirmed");
  assert.equal(result.transactions.complete, true);
  assert.equal(result.transactions.trading.transactions[0].cancelled, true);
  assert.equal(result.transactions.fulfillment.matchingOrders[0].cancelState, "CANCELED");
});

test("EndItem fails closed when Trading sees an order that Fulfillment cannot reconcile", async () => {
  const intentDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "ebay-sandbox-unreconciled-end-"));
  const addIntent = await persistOperationIntent({
    command: "add-quantity",
    intentDirectory,
    options: { itemXml: "<Item><Title>fixture</Title></Item>", operationKey: "unreconciled-source", quantity: 3 },
  });
  await recordOperationItemId({ intent: addIntent, itemId: "655" });
  const callNames = [];
  const result = await runMutation({
    accessToken: "token",
    command: "end-not-available",
    confirm: STRONG_MUTATION_CONFIRMATION,
    intentDirectory,
    options: { itemId: "655", operationKey: "unreconciled-end", sourceAddOperationKey: "unreconciled-source" },
    fetchImpl: async (url, options) => {
      if (url.includes("/sell/fulfillment/v1/order")) {
        callNames.push("FulfillmentGetOrders");
        return { ok: true, status: 200, json: async () => ({ orders: [], total: 0 }) };
      }
      const callName = options.headers["X-EBAY-API-CALL-NAME"];
      callNames.push(callName);
      const xml = callName === "GetItem"
        ? "<Ack>Success</Ack><Item><ItemID>655</ItemID><ListingStatus>Active</ListingStatus><Quantity>3</Quantity><QuantitySold>2</QuantitySold></Item>"
        : "<Ack>Success</Ack><HasMoreTransactions>false</HasMoreTransactions><PageNumber>1</PageNumber><ReturnedTransactionCountActual>1</ReturnedTransactionCountActual><PaginationResult><TotalNumberOfPages>1</TotalNumberOfPages><TotalNumberOfEntries>1</TotalNumberOfEntries></PaginationResult><TransactionArray><Transaction><QuantityPurchased>2</QuantityPurchased><OrderStatus>Active</OrderStatus></Transaction></TransactionArray>";
      return { ok: true, status: 200, text: async () => xml };
    },
  });
  assert.deepEqual(callNames, ["GetItem", "GetItemTransactions", "FulfillmentGetOrders"]);
  assert.equal(callNames.includes("EndItem"), false);
  assert.equal(result.result.error.message, "[redacted]");
  assert.equal(result.intent.outcome, undefined);
});

test("uncertain revise retry short-circuits when authoritative pre-read already has the desired available quantity", async () => {
  const intentDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "ebay-sandbox-revise-applied-"));
  const source = await persistOperationIntent({ command: "add-quantity", intentDirectory, options: { itemXml: "<Item><Title>fixture</Title></Item>", operationKey: "retry-source-applied", quantity: 5 } });
  await recordOperationItemId({ intent: source, itemId: "333" });
  const options = { itemId: "333", operationKey: "retry-applied", quantity: 2, sourceAddOperationKey: "retry-source-applied" };
  const first = await runMutation({
    accessToken: "token", command: "revise-inventory", confirm: STRONG_MUTATION_CONFIRMATION, intentDirectory, options,
    fetchImpl: async (url, request) => {
      if (url.includes("/sell/fulfillment/v1/order")) {
        return { ok: true, status: 200, json: async () => ({ orders: [], total: 0 }) };
      }
      const callName = request.headers["X-EBAY-API-CALL-NAME"];
      if (callName === "GetItem") {
        return { ok: true, status: 200, text: async () => "<Ack>Success</Ack><Item><ItemID>333</ItemID><Quantity>5</Quantity><QuantitySold>0</QuantitySold></Item>" };
      }
      if (callName === "GetItemTransactions") {
        return { ok: true, status: 200, text: async () => completeTradingPage() };
      }
      throw new DOMException("timed out", "AbortError");
    },
  });
  assert.equal(first.intent.outcome, "uncertain");
  const callNames = [];
  const retry = await runMutation({
    accessToken: "token", command: "revise-inventory", confirm: STRONG_MUTATION_CONFIRMATION, intentDirectory, options,
    fetchImpl: async (url, request) => {
      if (url.includes("/sell/fulfillment/v1/order")) {
        callNames.push("FulfillmentGetOrders");
        return { ok: true, status: 200, json: async () => ({ orders: [], total: 0 }) };
      }
      const callName = request.headers["X-EBAY-API-CALL-NAME"];
      callNames.push(callName);
      return {
        ok: true,
        status: 200,
        text: async () => callName === "GetItem"
          ? "<Ack>Success</Ack><Item><ItemID>333</ItemID><Quantity>2</Quantity><QuantitySold>0</QuantitySold></Item>"
          : completeTradingPage(),
      };
    },
  });
  assert.deepEqual(
    callNames,
    ["GetItem", "GetItemTransactions", "FulfillmentGetOrders"],
    "the no-order retry validates fresh order evidence before resolving idempotently",
  );
  assert.equal(retry.alreadyApplied, true);
  assert.equal(retry.intent.outcome, "confirmed");
  assert.equal(retry.transactions.complete, true);
});

test("already-desired revise refuses a pending Trading order instead of confirming idempotency", async () => {
  const intentDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "ebay-sandbox-revise-pending-applied-"));
  await sourceIntentFor({
    intentDirectory,
    itemId: "pending-already-desired",
    operationKey: "pending-already-desired-source",
  });
  const callNames = [];
  const result = await runMutation({
    accessToken: "token",
    command: "revise-inventory",
    confirm: STRONG_MUTATION_CONFIRMATION,
    intentDirectory,
    options: {
      itemId: "pending-already-desired",
      operationKey: "pending-already-desired-revise",
      quantity: 2,
      sourceAddOperationKey: "pending-already-desired-source",
    },
    fetchImpl: async (url, request) => {
      if (url.includes("/sell/fulfillment/v1/order")) {
        callNames.push("FulfillmentGetOrders");
        return { ok: true, status: 200, json: async () => ({ orders: [], total: 0 }) };
      }
      const callName = request.headers["X-EBAY-API-CALL-NAME"];
      callNames.push(callName);
      const xml = callName === "GetItem"
        ? "<Ack>Success</Ack><Item><ItemID>pending-already-desired</ItemID><ListingStatus>Active</ListingStatus><Quantity>4</Quantity><QuantitySold>2</QuantitySold></Item>"
        : completeTradingPage("<Transaction><CancelStatus>CancelPending</CancelStatus><CheckoutStatus>CheckoutIncomplete</CheckoutStatus><QuantityPurchased>2</QuantityPurchased></Transaction>");
      return { ok: true, status: 200, text: async () => xml };
    },
  });
  assert.deepEqual(callNames, ["GetItem", "GetItemTransactions", "FulfillmentGetOrders"]);
  assert.equal(result.alreadyApplied, undefined);
  assert.equal(result.intent.outcome, undefined);
  assert.equal(result.result.error.message, "[redacted]");
  assert.equal(callNames.includes("ReviseInventoryStatus"), false);
});

test("uncertain revise retry resends only after pre-read proves desired quantity is not applied", async () => {
  const intentDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "ebay-sandbox-revise-retry-"));
  const source = await persistOperationIntent({ command: "add-quantity", intentDirectory, options: { itemXml: "<Item><Title>fixture</Title></Item>", operationKey: "retry-source-not-applied", quantity: 5 } });
  await recordOperationItemId({ intent: source, itemId: "444" });
  const options = { itemId: "444", operationKey: "retry-not-applied", quantity: 2, sourceAddOperationKey: "retry-source-not-applied" };
  await runMutation({
    accessToken: "token", command: "revise-inventory", confirm: STRONG_MUTATION_CONFIRMATION, intentDirectory, options,
    fetchImpl: async (url, request) => {
      if (url.includes("/sell/fulfillment/v1/order")) {
        return { ok: true, status: 200, json: async () => ({ orders: [], total: 0 }) };
      }
      const callName = request.headers["X-EBAY-API-CALL-NAME"];
      if (callName === "GetItem") {
        return { ok: true, status: 200, text: async () => "<Ack>Success</Ack><Item><ItemID>444</ItemID><Quantity>5</Quantity><QuantitySold>0</QuantitySold></Item>" };
      }
      if (callName === "GetItemTransactions") {
        return { ok: true, status: 200, text: async () => completeTradingPage() };
      }
      throw new DOMException("timed out", "AbortError");
    },
  });
  const callNames = [];
  const retry = await runMutation({
    accessToken: "token", command: "revise-inventory", confirm: STRONG_MUTATION_CONFIRMATION, intentDirectory, options,
    fetchImpl: async (url, request) => {
      if (url.includes("/sell/fulfillment/v1/order")) {
        callNames.push("FulfillmentGetOrders");
        return { ok: true, status: 200, json: async () => ({ orders: [], total: 0 }) };
      }
      const callName = request.headers["X-EBAY-API-CALL-NAME"];
      callNames.push(callName);
      const getItemCount = callNames.filter((name) => name === "GetItem").length;
      return {
        ok: true,
        status: 200,
        text: async () => callName === "GetItem"
          ? getItemCount === 1
            ? "<Ack>Success</Ack><Item><ItemID>444</ItemID><Quantity>5</Quantity><QuantitySold>0</QuantitySold></Item>"
            : "<Ack>Success</Ack><Item><ItemID>444</ItemID><Quantity>2</Quantity><QuantitySold>0</QuantitySold></Item>"
          : callName === "GetItemTransactions" ? completeTradingPage() : "<Ack>Success</Ack>",
      };
    },
  });
  assert.deepEqual(callNames, ["GetItem", "GetItemTransactions", "FulfillmentGetOrders", "ReviseInventoryStatus", "GetItem"]);
  assert.equal(retry.alreadyApplied, undefined);
  assert.equal(retry.intent.outcome, "confirmed");
});

test("sanitized evidence redacts auth, personal data, and opaque IDs while retaining business signals", () => {
  const raw = "<Ack>Warning</Ack><ItemID>123456</ItemID><CategoryID>183454</CategoryID><Quantity>3</Quantity><RegistrationAddress><Email>buyer@example.test</Email><PostalCode>SW1A 1AA</PostalCode></RegistrationAddress><eBayAuthToken>secret</eBayAuthToken><ErrorCode>219</ErrorCode>";
  const clean = redactEvidence(raw);
  assert.match(clean, /<Ack>Warning<\/Ack>/);
  assert.match(clean, /<CategoryID>183454<\/CategoryID><Quantity>3<\/Quantity>/);
  assert.match(clean, /<ErrorCode>219<\/ErrorCode>/);
  assert.doesNotMatch(clean, /123456|buyer@example|SW1A|secret/);
  const object = redactEvidence({
    itemId: "123456",
    lifecycleState: "Active",
    quantity: 3,
    returnedItemId: "654321",
  });
  assert.match(object.itemId, /^\[itemid:/);
  assert.match(object.returnedItemId, /^\[returneditemid:/);
  assert.doesNotMatch(JSON.stringify(object), /123456|654321/);
  assert.equal(object.lifecycleState, "Active");
});

test("sanitization drops adversarial free text and nested customer data while retaining evidence signals", () => {
  const raw = "<Ack>Failure</Ack><Errors><ErrorCode>488</ErrorCode><ShortMessage>private error text</ShortMessage><SeverityCode>Error</SeverityCode><ErrorParameters><Value>987654</Value></ErrorParameters></Errors><Item><Title>Private title</Title><Description>Private description</Description><SKU>private-sku</SKU><PictureURL>https://private.example/image.jpg</PictureURL><Location>Private town</Location><EndTime>2026-07-01T01:02:03Z</EndTime><Quantity>3</Quantity><QuantitySold>1</QuantitySold></Item><ShippingAddress><Street>1 Private Lane</Street><BuyerCheckoutMessage>private note</BuyerCheckoutMessage></ShippingAddress><CategoryID>183454</CategoryID>";
  const clean = redactEvidence({
    message: "private top-level error",
    nested: { buyerCheckoutMessage: "private note", paymentReference: "pay-ref", title: "private title", endTime: "2026-07-01" },
    xml: raw,
  });
  assert.match(clean.xml, /<Ack>Failure<\/Ack>/);
  assert.match(clean.xml, /<ErrorCode>488<\/ErrorCode><ShortMessage>\[redacted\]<\/ShortMessage><SeverityCode>Error<\/SeverityCode>/);
  assert.equal(clean.xml.includes("<Quantity>3</Quantity><QuantitySold>1</QuantitySold>"), true);
  assert.match(clean.xml, /<CategoryID>183454<\/CategoryID>/);
  assert.doesNotMatch(JSON.stringify(clean), /private|987654|https:\/\/|2026-07-01|pay-ref/i);
  assert.equal(clean.message, "[redacted]");
});

test("projected CLI evidence is allowlist-only and drops arbitrary nested API fields", () => {
  const projected = projectEvidence({
    ack: "Success",
    errors: [{ code: "219", severity: "Warning", message: "private" }],
    listing: { available: 2, quantity: 3, quantitySold: 1, listingStatus: "Active", rogue: "private" },
    xml: "<ApplicationData>private</ApplicationData>",
    ApplicationData: { arbitrary: "private" },
    unknown: { nested: { secret: "private" } },
  });
  assert.deepEqual(projected, {
    ack: "Success",
    errors: [{ code: "219", severity: "Warning" }],
    httpStatus: null,
    listing: { available: 2, endingReason: null, listingStatus: "Active", quantity: 3, quantitySold: 1 },
  });
  const category = projectEvidence({
    categoryId: "183454",
    categoryTreeId: "3",
    taxonomyPath: { categorySubtreeNode: { category: { categoryId: "183454", categoryName: "CCG Individual Cards" }, leafCategoryTreeNode: true, ApplicationData: "private" } },
    categoryPolicies: { categoryPolicies: [{ categoryId: "183454", lsd: true, expired: false, virtual: false, arbitrary: "private" }] },
    arbitrary: "private",
  });
  assert.deepEqual(category, {
    categoryId: "183454",
    categoryName: "CCG Individual Cards",
    categoryTreeId: "3",
    leafCategory: true,
    policyCategoryId: "183454",
    policyFlags: { expired: false, lsd: true, virtual: false },
  });
});

test("seller preflight read returns only a pseudonymized Sandbox seller identifier", async () => {
  const seller = await getSeller({
    accessToken: "token",
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => "<Ack>Success</Ack><User><UserID>sandbox-seller-private</UserID></User>" }),
  });
  assert.match(seller.sellerId, /^\[seller:/);
  assert.doesNotMatch(JSON.stringify(seller), /sandbox-seller-private/);
});

test("transaction parsing preserves multiple order quantities and cancellation state", () => {
  const xml = "<Transaction><OrderID>o-1</OrderID><OrderLineItemID>ol-1</OrderLineItemID><TransactionID>t-1</TransactionID><QuantityPurchased>2</QuantityPurchased><OrderStatus>Active</OrderStatus></Transaction><Transaction><OrderID>o-2</OrderID><TransactionID>t-2</TransactionID><QuantityPurchased>3</QuantityPurchased><TransactionStatus>Cancelled</TransactionStatus></Transaction>";
  assert.deepEqual(parseMultiUnitTransactions(xml), [
    { cancellationState: "not-cancelled", cancelled: false, orderId: "o-1", orderLineItemId: "ol-1", paymentState: "unknown", quantityPurchased: 2, transactionId: "t-1" },
    { cancellationState: "complete", cancelled: true, orderId: "o-2", orderLineItemId: null, paymentState: "unknown", quantityPurchased: 3, transactionId: "t-2" },
  ]);
});

test("Trading cancellation and checkout evidence is projected into narrow safe states", () => {
  const terminalStatuses = [
    "CancelClosedForCommitment",
    "CancelClosedNoRefund",
    "CancelClosedUnknownRefund",
    "CancelClosedWithRefund",
    "CancelComplete",
    "Cancelled",
  ];
  for (const status of terminalStatuses) {
    const [transaction] = parseMultiUnitTransactions(`<Transaction><CancelStatus>${status}</CancelStatus><CheckoutStatus>CheckoutIncomplete</CheckoutStatus><QuantityPurchased>1</QuantityPurchased></Transaction>`);
    assert.equal(transaction.cancellationState, "complete", status);
    assert.equal(transaction.cancelled, true, status);
    assert.equal(transaction.paymentState, "unpaid", status);
  }

  const nonterminalStates = new Map([
    ["CancelRequested", "requested"],
    ["CancelPending", "pending"],
    ["CancelRejected", "rejected"],
    ["CancelFailed", "failed"],
    ["Active", "not-cancelled"],
    ["Canceled", "unknown"],
    ["CancelCompletePending", "unknown"],
  ]);
  for (const [status, expected] of nonterminalStates) {
    const [transaction] = parseMultiUnitTransactions(`<Transaction><CancelStatus>${status}</CancelStatus><QuantityPurchased>1</QuantityPurchased></Transaction>`);
    assert.equal(transaction.cancellationState, expected, status);
    assert.equal(transaction.cancelled, false, status);
  }

  const paymentCases = [
    ["<CheckoutStatus>CheckoutIncomplete</CheckoutStatus>", "unpaid"],
    ["<CheckoutStatus>CheckoutComplete</CheckoutStatus>", "paid"],
    ["<CompleteStatus>Incomplete</CompleteStatus>", "unpaid"],
    ["<CompleteStatus>Complete</CompleteStatus>", "paid"],
    ["<eBayPaymentStatus>NoPaymentFailure</eBayPaymentStatus>", "unknown"],
    ["<CheckoutStatus>CheckoutIncomplete</CheckoutStatus><eBayPaymentStatus>NoPaymentFailure</eBayPaymentStatus>", "unpaid"],
    ["<CheckoutStatus>CheckoutIncomplete</CheckoutStatus><eBayPaymentStatus>PaymentInProcess</eBayPaymentStatus>", "pending"],
    ["<CheckoutStatus>CheckoutIncomplete</CheckoutStatus><PaidTime>2026-01-01T00:00:00Z</PaidTime>", "unknown"],
    ["", "unknown"],
  ];
  for (const [paymentXml, expected] of paymentCases) {
    const [transaction] = parseMultiUnitTransactions(`<Transaction><CancelStatus>CancelComplete</CancelStatus>${paymentXml}<QuantityPurchased>1</QuantityPurchased></Transaction>`);
    assert.equal(transaction.paymentState, expected, paymentXml || "missing payment state");
  }
});

test("GetItemTransactions requests containing orders and requires every first-page completeness field", async () => {
  let requestBody;
  const complete = await getItemTransactions({
    accessToken: "token",
    itemId: "123",
    fetchImpl: async (_url, request) => {
      requestBody = request.body;
      return { ok: true, status: 200, text: async () => completeTradingPage() };
    },
  });
  assert.equal(complete.complete, true);
  assert.match(requestBody, /<IncludeContainingOrder>true<\/IncludeContainingOrder>/);
  const zeroPage = await getItemTransactions({
    accessToken: "token",
    itemId: "123",
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => completeTradingPage().replace(
        "<TotalNumberOfPages>1</TotalNumberOfPages>",
        "<TotalNumberOfPages>0</TotalNumberOfPages>",
      ),
    }),
  });
  assert.equal(zeroPage.complete, true, "an explicit zero-page total is valid for an empty result");

  const requiredFields = [
    "HasMoreTransactions",
    "PageNumber",
    "ReturnedTransactionCountActual",
    "TotalNumberOfPages",
    "TotalNumberOfEntries",
  ];
  for (const field of requiredFields) {
    const incompleteXml = completeTradingPage().replace(new RegExp(`<${field}>[^<]*</${field}>`), "");
    const result = await getItemTransactions({
      accessToken: "token",
      itemId: "123",
      fetchImpl: async () => ({ ok: true, status: 200, text: async () => incompleteXml }),
    });
    assert.equal(result.complete, false, `missing ${field} must fail closed`);
  }
});

test("Fulfillment order evidence refuses a missing or non-integer total", async () => {
  for (const invalidTotal of [undefined, null, "0", -1, 0.5]) {
    await assert.rejects(
      getOrderEvidence({
        accessToken: "token",
        itemId: "123",
        fetchImpl: async (url) => url.endsWith("/ws/api.dll")
          ? { ok: true, status: 200, text: async () => completeTradingPage() }
          : {
            ok: true,
            status: 200,
            json: async () => invalidTotal === undefined ? { orders: [] } : { orders: [], total: invalidTotal },
          },
      }),
      /invalid total/,
      String(invalidTotal),
    );
  }
});

test("revise permits an exact terminal unpaid cancellation despite Fulfillment's documented zero-match gap", async () => {
  const transactionXml = "<Transaction><CancelStatus>CancelComplete</CancelStatus><CheckoutStatus>CheckoutIncomplete</CheckoutStatus><QuantityPurchased>2</QuantityPurchased></Transaction>";
  const { callNames, result, tradingBodies } = await runGuardedMutationScenario({
    itemId: "unpaid-101",
    transactionXml,
  });
  assert.deepEqual(callNames, ["GetItem", "GetItemTransactions", "FulfillmentGetOrders", "ReviseInventoryStatus", "GetItem"]);
  assert.equal(result.intent.outcome, "confirmed");
  assert.equal(result.transactions.trading.transactions[0].paymentState, "unpaid");
  const orderReadIndex = callNames.indexOf("GetItemTransactions");
  assert.equal(callNames[orderReadIndex + 1], "FulfillmentGetOrders");
  assert.equal(callNames[orderReadIndex + 2], "ReviseInventoryStatus");
  assert.match(
    tradingBodies.find((request) => request.callName === "GetItemTransactions").body,
    /<IncludeContainingOrder>true<\/IncludeContainingOrder>/,
  );
});

test("zero-match Fulfillment refuses terminal cancellations unless every Trading checkout is explicitly unpaid", async (t) => {
  const refusedCases = [
    ["pending", "<Transaction><CancelStatus>CancelComplete</CancelStatus><CheckoutStatus>CheckoutIncomplete</CheckoutStatus><eBayPaymentStatus>PaymentInProcess</eBayPaymentStatus><QuantityPurchased>2</QuantityPurchased></Transaction>"],
    ["paid", "<Transaction><CancelStatus>CancelComplete</CancelStatus><CheckoutStatus>CheckoutComplete</CheckoutStatus><QuantityPurchased>2</QuantityPurchased></Transaction>"],
    ["unknown", "<Transaction><CancelStatus>CancelComplete</CancelStatus><QuantityPurchased>2</QuantityPurchased></Transaction>"],
    ["mixed", "<Transaction><CancelStatus>CancelComplete</CancelStatus><CheckoutStatus>CheckoutIncomplete</CheckoutStatus><QuantityPurchased>1</QuantityPurchased></Transaction><Transaction><CancelStatus>Cancelled</CancelStatus><QuantityPurchased>1</QuantityPurchased></Transaction>"],
  ];
  for (const [name, transactionXml] of refusedCases) {
    await t.test(name, async () => {
      const refused = await runGuardedMutationScenario({
        itemId: `zero-match-${name}`,
        transactionXml,
      });
      assert.deepEqual(refused.callNames, ["GetItem", "GetItemTransactions", "FulfillmentGetOrders"]);
      assert.equal(refused.result.result.error.message, "[redacted]");
    });
  }
});

test("paid cancellations require exact Fulfillment terminal states and correlated quantities", async (t) => {
  const transactionXml = "<Transaction><CancelStatus>CancelClosedWithRefund</CancelStatus><CheckoutStatus>CheckoutComplete</CheckoutStatus><QuantityPurchased>2</QuantityPurchased></Transaction>";
  const fulfillmentOrder = {
    cancelStatus: { cancelState: "CANCELED" },
    lineItems: [{ legacyItemId: "paid-allowed", quantity: 2 }],
    orderFulfillmentStatus: "NOT_STARTED",
    orderPaymentStatus: "FULLY_REFUNDED",
  };
  const allowed = await runGuardedMutationScenario({
    fulfillmentBody: { orders: [fulfillmentOrder], total: 1 },
    itemId: "paid-allowed",
    transactionXml,
  });
  assert.ok(allowed.callNames.includes("ReviseInventoryStatus"));
  assert.equal(allowed.result.intent.outcome, "confirmed");

  const refusedCases = [
    ["cancel state", { ...fulfillmentOrder, cancelStatus: { cancelState: "CANCELED " } }],
    ["fulfillment state", { ...fulfillmentOrder, orderFulfillmentStatus: "IN_PROGRESS" }],
    ["payment state", { ...fulfillmentOrder, orderPaymentStatus: "REFUNDED" }],
    ["quantity mismatch", { ...fulfillmentOrder, lineItems: [{ legacyItemId: "ignored", quantity: 1 }] }],
  ];
  for (const [name, refusedOrder] of refusedCases) {
    await t.test(name, async () => {
      const itemId = `paid-refused-${name.replaceAll(" ", "-")}`;
      const lineItems = refusedOrder.lineItems.map((lineItem) => ({
        ...lineItem,
        legacyItemId: itemId,
      }));
      const refused = await runGuardedMutationScenario({
        fulfillmentBody: { orders: [{ ...refusedOrder, lineItems }], total: 1 },
        itemId,
        transactionXml,
      });
      assert.equal(refused.callNames.includes("ReviseInventoryStatus"), false);
      assert.equal(refused.result.result.error.message, "[redacted]");
    });
  }
});

test("revise is blocked for requested, pending, rejected, failed, active, and unknown cancellations", async (t) => {
  const statuses = [
    "CancelRequested",
    "CancelPending",
    "CancelRejected",
    "CancelFailed",
    "Active",
    "CancelCompletePending",
  ];
  for (const status of statuses) {
    await t.test(status, async () => {
      const refused = await runGuardedMutationScenario({
        itemId: `blocked-${status}`,
        transactionXml: `<Transaction><CancelStatus>${status}</CancelStatus><CheckoutStatus>CheckoutIncomplete</CheckoutStatus><QuantityPurchased>2</QuantityPurchased></Transaction>`,
      });
      assert.deepEqual(refused.callNames, ["GetItem", "GetItemTransactions", "FulfillmentGetOrders"]);
      assert.equal(refused.result.result.error.message, "[redacted]");
      assert.equal(refused.result.intent.outcome, undefined);
    });
  }
});

test("order evidence requires a complete Trading page and scans every Fulfillment page without exposing PII", async () => {
  const tradingXml = "<GetItemTransactionsResponse><Ack>Success</Ack><HasMoreTransactions>false</HasMoreTransactions><PageNumber>1</PageNumber><ReturnedTransactionCountActual>1</ReturnedTransactionCountActual><PaginationResult><TotalNumberOfPages>1</TotalNumberOfPages><TotalNumberOfEntries>1</TotalNumberOfEntries></PaginationResult><TransactionArray><Transaction><OrderID>raw-order</OrderID><OrderLineItemID>raw-line</OrderLineItemID><TransactionID>raw-transaction</TransactionID><QuantityPurchased>2</QuantityPurchased><OrderStatus>Active</OrderStatus></Transaction></TransactionArray></GetItemTransactionsResponse>";
  const requestedUrls = [];
  const fetchImpl = async (url) => {
    requestedUrls.push(url);
    if (url.endsWith("/ws/api.dll")) {
      return { ok: true, status: 200, text: async () => tradingXml };
    }
    const offset = Number(new URL(url).searchParams.get("offset"));
    return {
      ok: true,
      status: 200,
      json: async () => offset === 0
        ? {
          total: 3,
          orders: [
            {
              buyer: { username: "private-buyer" },
              cancelStatus: { cancelState: "NONE_REQUESTED" },
              lineItems: [{ legacyItemId: "123", quantity: 2, shipToLocation: { addressLine1: "Private Lane" } }],
              orderFulfillmentStatus: "NOT_STARTED",
              orderId: "raw-fulfillment-order",
              orderPaymentStatus: "PAID",
            },
            { lineItems: [{ legacyItemId: "different-item", quantity: 1 }], orderId: "not-a-match" },
          ],
        }
        : {
          total: 3,
          orders: [{
            cancelStatus: { cancelState: "CANCELED" },
            lineItems: [{ legacyItemId: "123", quantity: 2 }],
            orderFulfillmentStatus: "NOT_STARTED",
            orderId: "raw-cancelled-order",
            orderPaymentStatus: "FULLY_REFUNDED",
          }],
        },
    };
  };
  const evidence = await getOrderEvidence({ accessToken: "token", itemId: "123", fetchImpl });
  assert.equal(evidence.trading.complete, true);
  assert.equal(evidence.fulfillment.complete, true);
  assert.equal(evidence.fulfillment.pagesScanned, 2);
  assert.equal(evidence.fulfillment.totalOrdersScanned, 3);
  assert.equal(evidence.fulfillment.matchingOrders.length, 2);
  assert.ok(requestedUrls.every((url) => url.startsWith(SANDBOX_HOST)));
  const projected = projectEvidence(evidence);
  assert.deepEqual(projected.trading.transactions, [{
    cancellationState: "not-cancelled",
    cancelled: false,
    paymentState: "unknown",
    quantityPurchased: 2,
  }]);
  assert.deepEqual(projected.fulfillment.matchingOrders, [
    { cancelState: "NONE_REQUESTED", fulfillmentStatus: "NOT_STARTED", lineItemQuantities: [2], paymentStatus: "PAID" },
    { cancelState: "CANCELED", fulfillmentStatus: "NOT_STARTED", lineItemQuantities: [2], paymentStatus: "FULLY_REFUNDED" },
  ]);
  assert.doesNotMatch(JSON.stringify(projected), /private|raw-|address|buyer|orderId/i);
});

test("incomplete Trading pagination fails closed before Fulfillment reconciliation", async () => {
  const xml = "<GetItemTransactionsResponse><Ack>Success</Ack><HasMoreTransactions>true</HasMoreTransactions><PageNumber>1</PageNumber><ReturnedTransactionCountActual>1</ReturnedTransactionCountActual><PaginationResult><TotalNumberOfPages>2</TotalNumberOfPages><TotalNumberOfEntries>2</TotalNumberOfEntries></PaginationResult><TransactionArray><Transaction><QuantityPurchased>2</QuantityPurchased></Transaction></TransactionArray></GetItemTransactionsResponse>";
  const result = await getItemTransactions({
    accessToken: "token",
    itemId: "123",
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => xml }),
  });
  assert.equal(result.complete, false);
  await assert.rejects(
    getOrderEvidence({
      accessToken: "token",
      itemId: "123",
      fetchImpl: async () => ({ ok: true, status: 200, text: async () => xml }),
    }),
    /incomplete/,
  );
});

test("VerifyAddItem lot probes bind one immutable quantity-one mixed-lot request", async () => {
  const itemXml = await fs.readFile(
    path.resolve("tests/fixtures/ebay-sandbox/issue14-lot-verify-item.xml"),
    "utf8",
  );
  const options = {
    categoryId: "183455",
    itemXml,
    lotSize: 2,
    probeKey: "issue14-lot-183455-v1",
  };
  const first = buildVerifyLotRequest(options);
  const second = buildVerifyLotRequest(options);
  assert.deepEqual(first, second);
  assert.match(first.messageId, /^[A-F0-9]{32}$/);
  assert.equal(first.messageId, stableLotProbeMessageId(options.probeKey));
  assert.deepEqual(first.request, {
    categoryId: "183455",
    categoryMappingAllowed: false,
    lotSize: 2,
    quantity: 1,
    requestSha256: first.request.requestSha256,
  });
  assert.match(first.request.requestSha256, /^[a-f0-9]{64}$/);
  assert.match(first.body, /<MessageID>[A-F0-9]{32}<\/MessageID><Item>/);
  assert.match(first.body, /<CategoryID>183455<\/CategoryID>/);
  assert.match(first.body, /<CategoryMappingAllowed>false<\/CategoryMappingAllowed>/);
  assert.match(first.body, /<Quantity>1<\/Quantity>/);
  assert.match(first.body, /<LotSize>2<\/LotSize>/);

  const invalidCases = [
    { ...options, categoryId: "183454" },
    { ...options, lotSize: 1 },
    { ...options, lotSize: 450001 },
    { ...options, itemXml: itemXml.replace("<CategoryMappingAllowed>false", "<CategoryMappingAllowed>true") },
    { ...options, itemXml: itemXml.replace("<Quantity>1", "<Quantity>2") },
    { ...options, itemXml: itemXml.replace("<LotSize>2", "<LotSize>3") },
    { ...options, itemXml: itemXml.replace("<Item>", "<Item><ItemID>123</ItemID>") },
    { ...options, itemXml: itemXml.replace("<Item>", "<Item><UUID>ABC</UUID>") },
    { ...options, itemXml: itemXml.replace("</Item>", "<LotSize>2</LotSize></Item>") },
    { ...options, itemXml: itemXml.replace("</PrimaryCategory>", "<CategoryID>183455</CategoryID></PrimaryCategory>") },
  ];
  for (const invalid of invalidCases) {
    assert.throws(() => buildVerifyLotRequest(invalid));
  }
});

test("lot verification makes one non-publishing call and never retries success, failure, or timeout", async (t) => {
  const itemXml = await fs.readFile(
    path.resolve("tests/fixtures/ebay-sandbox/issue14-lot-verify-item.xml"),
    "utf8",
  );
  const baseOptions = {
    accessToken: "private-token",
    categoryId: "183455",
    itemXml,
    lotSize: 2,
    probeKey: "issue14-lot-183455-v1",
  };
  const cases = [
    { ack: "Success", expectedAccepted: true, status: 200 },
    {
      ack: "Warning",
      errors: "<Errors><ErrorCode>219</ErrorCode><SeverityCode>Warning</SeverityCode><LongMessage>private</LongMessage></Errors>",
      expectedAccepted: true,
      status: 200,
    },
    {
      ack: "Failure",
      errors: "<Errors><ErrorCode>17000</ErrorCode><SeverityCode>Error</SeverityCode><LongMessage>private</LongMessage></Errors>",
      expectedAccepted: false,
      status: 400,
    },
    { expectedAccepted: false, timeout: true },
  ];
  for (const scenario of cases) {
    await t.test(scenario.timeout ? "timeout" : scenario.ack, async () => {
      const calls = [];
      const result = await verifyLot({
        ...baseOptions,
        fetchImpl: async (url, request) => {
          calls.push({ request, url });
          if (scenario.timeout) throw new DOMException("timed out", "AbortError");
          return {
            ok: scenario.status < 400,
            status: scenario.status,
            text: async () => `<VerifyAddItemResponse><Ack>${scenario.ack}</Ack>${scenario.errors ?? ""}</VerifyAddItemResponse>`,
          };
        },
      });
      assert.equal(calls.length, 1);
      assert.equal(calls[0].request.headers["X-EBAY-API-CALL-NAME"], "VerifyAddItem");
      assert.doesNotMatch(calls[0].request.body, /<AddItemRequest|<UUID>|<ItemID>/);
      assert.equal(result.accepted, scenario.expectedAccepted);
      const projected = projectEvidence({
        ...result,
        arbitrary: "private",
        response: { ...result.response, xml: "<Buyer>private</Buyer>" },
      });
      assert.equal(projected.callName, "VerifyAddItem");
      assert.equal(projected.publishingAttempted, false);
      assert.equal(projected.sandboxOnly, true);
      assert.equal(projected.accepted, scenario.expectedAccepted);
      assert.match(projected.request.requestSha256, /^[a-f0-9]{64}$/);
      assert.doesNotMatch(JSON.stringify(projected), /private|token|buyer|xml|title|description/i);
    });
  }
});

test("committed Sandbox evidence fixtures match projected schemas without secrets or PII", async () => {
  const fixtureDirectory = path.resolve("tests/fixtures/ebay-sandbox");
  const names = (await fs.readdir(fixtureDirectory)).filter((name) => name.endsWith(".json"));
  assert.ok(names.length >= 1);

  function assertProjectedErrors(errors, context) {
    assert.ok(Array.isArray(errors), `${context} must be an array`);
    for (const [index, error] of errors.entries()) {
      assertExactKeys(error, ["code", "severity"], `${context}[${index}]`);
    }
  }

  function assertProjectedTrading(value, context) {
    if (value === null) return;
    assertExactKeys(
      value,
      Object.hasOwn(value, "error") ? ["error"] : ["ack", "errors", "httpStatus", "listing"],
      context,
    );
    if (Object.hasOwn(value, "error")) {
      assertProjectedTrading(value.error, `${context}.error`);
      return;
    }
    assertProjectedErrors(value.errors, `${context}.errors`);
    if (value.listing !== null) {
      assertExactKeys(
        value.listing,
        ["available", "endingReason", "listingStatus", "quantity", "quantitySold"],
        `${context}.listing`,
      );
    }
  }

  function assertProjectedOrder(value, context) {
    assertExactKeys(value, ["complete", "fulfillment", "trading"], context);
    assertExactKeys(
      value.fulfillment,
      ["complete", "matchingOrders", "pagesScanned", "totalOrdersScanned"],
      `${context}.fulfillment`,
    );
    assert.ok(Array.isArray(value.fulfillment.matchingOrders));
    for (const [index, order] of value.fulfillment.matchingOrders.entries()) {
      assertExactKeys(
        order,
        ["cancelState", "fulfillmentStatus", "lineItemQuantities", "paymentStatus"],
        `${context}.fulfillment.matchingOrders[${index}]`,
      );
      assert.ok(Array.isArray(order.lineItemQuantities));
    }
    assertExactKeys(
      value.trading,
      [
        "ack",
        "complete",
        "errors",
        "hasMoreTransactions",
        "pageNumber",
        "returnedTransactionCountActual",
        "totalNumberOfEntries",
        "totalNumberOfPages",
        "transactions",
      ],
      `${context}.trading`,
    );
    assertProjectedErrors(value.trading.errors, `${context}.trading.errors`);
    assert.ok(Array.isArray(value.trading.transactions));
    for (const [index, transaction] of value.trading.transactions.entries()) {
      const hasLifecycleStates = Object.hasOwn(transaction, "cancellationState");
      assertExactKeys(
        transaction,
        hasLifecycleStates
          ? ["cancellationState", "cancelled", "paymentState", "quantityPurchased"]
          : ["cancelled", "quantityPurchased"],
        `${context}.trading.transactions[${index}]`,
      );
    }
  }

  for (const name of names) {
    const fixture = JSON.parse(await fs.readFile(path.join(fixtureDirectory, name), "utf8"));
    const serialized = JSON.stringify(fixture);
    assert.doesNotMatch(serialized, /access.?token|refresh.?token|client.?secret|authorization|buyer|email|phone|postal|street|address|pictureurl|raw-/i);
    assert.doesNotMatch(serialized, /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
    assert.doesNotMatch(serialized, /https?:\/\/|(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=:-]+/i);
    assert.doesNotMatch(serialized, /\b(?:GIR\s?0AA|[A-PR-UWYZ][A-HK-Y]?\d[A-Z\d]?\s?\d[ABD-HJLNP-UW-Z]{2})\b/i);
    assert.doesNotMatch(serialized, /\b\d{10,}\b/);

    if (name === "issue14-seller-preflight.json") {
      assertExactKeys(fixture, ["ack", "errors", "sellerId"], name);
      assertProjectedErrors(fixture.errors, `${name}.errors`);
      assert.match(fixture.sellerId, /^\[seller:[a-f0-9]{16}\]$/);
      continue;
    }
    if (name.startsWith("issue14-category-")) {
      const hasCategoryName = Object.hasOwn(fixture, "categoryName");
      assertExactKeys(
        fixture,
        hasCategoryName
          ? ["categoryId", "categoryName", "categoryTreeId", "leafCategory", "policyCategoryId", "policyFlags"]
          : ["categoryId", "categoryTreeId", "leafCategory", "policyFlags"],
        name,
      );
      assertExactKeys(fixture.policyFlags, Object.keys(fixture.policyFlags), `${name}.policyFlags`);
      assert.ok(Object.keys(fixture.policyFlags).every((key) => ["expired", "lsd", "virtual"].includes(key)));
      assert.ok(Object.values(fixture.policyFlags).every((value) => typeof value === "boolean"));
      continue;
    }
    if ([
      "issue14-order-created.json",
      "issue14-order-created-v2.json",
      "issue14-order-after-cancel-ui-failure.json",
    ].includes(name)) {
      assertProjectedOrder(fixture, name);
      assert.equal(fixture.complete, true);
      assert.equal(fixture.trading.complete, true);
      assert.equal(fixture.trading.hasMoreTransactions, false);
      assert.equal(fixture.trading.totalNumberOfPages, 1);
      assert.equal(fixture.trading.totalNumberOfEntries, 1);
      assert.equal(fixture.trading.returnedTransactionCountActual, 1);
      assert.deepEqual(
        fixture.trading.transactions,
        name === "issue14-order-created.json"
          ? [{ cancelled: false, quantityPurchased: 2 }]
          : [{
            cancellationState: "not-cancelled",
            cancelled: false,
            paymentState: "unpaid",
            quantityPurchased: 2,
          }],
      );
      assert.equal(fixture.fulfillment.complete, true);
      continue;
    }
    if (/^issue14-lot-verify(?:-v2)?\.json$/.test(name)) {
      assertExactKeys(
        fixture,
        ["accepted", "callName", "publishingAttempted", "request", "response", "sandboxOnly"],
        name,
      );
      assertExactKeys(
        fixture.request,
        ["categoryId", "categoryMappingAllowed", "lotSize", "quantity", "requestSha256"],
        `${name}.request`,
      );
      assertExactKeys(fixture.response, ["ack", "errors", "httpStatus"], `${name}.response`);
      assertProjectedErrors(fixture.response.errors, `${name}.response.errors`);
      assert.equal(fixture.callName, "VerifyAddItem");
      assert.equal(fixture.publishingAttempted, false);
      assert.equal(fixture.sandboxOnly, true);
      assert.equal(fixture.accepted, name.endsWith("-v2.json"));
      assert.match(fixture.request.requestSha256, /^[a-f0-9]{64}$/);
      continue;
    }
    if (name === "issue14-order-listing-after-purchase.json") {
      assertProjectedTrading(fixture, name);
      continue;
    }
    if (/^issue14-(?:quantity|order)-(?:add(?:-v2)?|reduce|increase|end)\.json$/.test(name)) {
      const expectedKeys = [
        "alreadyApplied",
        "outcome",
        "plan",
        "preRead",
        "reconciliation",
        "recoveredDuplicate",
        "result",
        "reusedRecordedItem",
        "verification",
      ];
      if (Object.hasOwn(fixture, "transactionPrecheck")) expectedKeys.push("transactionPrecheck");
      assertExactKeys(fixture, expectedKeys, name);
      assertExactKeys(fixture.plan, ["bounded", "callName", "command", "quantity", "sandboxOnly"], `${name}.plan`);
      assertProjectedTrading(fixture.preRead, `${name}.preRead`);
      assertProjectedTrading(fixture.reconciliation, `${name}.reconciliation`);
      assertProjectedTrading(fixture.result, `${name}.result`);
      assertProjectedTrading(fixture.verification, `${name}.verification`);
      if (fixture.transactionPrecheck !== null && fixture.transactionPrecheck !== undefined) {
        assertProjectedOrder(fixture.transactionPrecheck, `${name}.transactionPrecheck`);
      }
      continue;
    }
    assert.fail(`No evidence schema assertion exists for ${name}`);
  }
});

test("taxonomy category evidence uses Sandbox REST endpoints and timeout decisions never retry blindly", async () => {
  const urls = [];
  const result = await categoryEvidence({
    accessToken: "token",
    categoryId: "183454",
    fetchImpl: async (url) => {
      urls.push(url);
      const defaultTree = url.includes("get_default_category_tree_id");
      const subtree = url.includes("get_category_subtree");
      return {
        ok: true,
        json: async () => defaultTree
          ? { categoryTreeId: "3" }
          : subtree
            ? { categorySubtreeNode: { category: { categoryId: "183454", categoryName: "CCG Individual Cards" }, leafCategoryTreeNode: true } }
            : { categoryPolicies: [{ categoryId: "183454", expired: false, lsd: true, virtual: false }] },
      };
    },
  });
  assert.equal(result.categoryTreeId, "3");
  assert.equal(urls.length, 3);
  assert.ok(urls.every((url) => url.startsWith(SANDBOX_HOST)));
  assert.ok(urls.some((url) => url.includes("commerce/taxonomy")));
  assert.ok(urls.some((url) => url.includes("sell/metadata")));
  assert.ok(urls.every((url) => !url.includes("get_category_suggestions")));
  assert.deepEqual(result.categoryPolicies.categoryPolicies[0], { categoryId: "183454", expired: false, lsd: true, virtual: false });
  assert.deepEqual(projectEvidence(result), {
    categoryId: "183454",
    categoryName: "CCG Individual Cards",
    categoryTreeId: "3",
    leafCategory: true,
    policyCategoryId: "183454",
    policyFlags: { expired: false, lsd: true, virtual: false },
  });
  assert.deepEqual(timeoutDecision(new DOMException("timed out", "AbortError")), { action: "reconcile-before-retry", remoteState: "unknown", retryMutation: false });
  assert.equal(timeoutDecision(new Error("validation failed")).action, "report-failure");
});

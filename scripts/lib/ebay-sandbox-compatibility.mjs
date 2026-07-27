import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * This module deliberately has no imports from the application.  In particular,
 * it never opens a database and it only reads the EBAY_SANDBOX_* environment
 * names listed in sandboxEnvironment().  Keep it that way: it is a bounded
 * compatibility probe, not an alternate production eBay client.
 */
export const SANDBOX_HOST = "https://api.sandbox.ebay.com";
export const SANDBOX_TRADING_URL = `${SANDBOX_HOST}/ws/api.dll`;
export const SANDBOX_IDENTITY_URL = `${SANDBOX_HOST}/identity/v1/oauth2/token`;
export const STRONG_MUTATION_CONFIRMATION = "I_UNDERSTAND_THIS_MUTATES_EBAY_SANDBOX";

const tradingCompatibilityLevel = "1423";
const tradingSiteId = "3";
const sensitiveXmlTags = new Set([
  "ebayauthtoken", "authorization", "accesstoken", "refreshtoken", "userid",
  "seller", "buyer", "buyeruserid", "selleruserid", "email", "emailaddress",
  "phone", "phonenumber", "name", "firstname", "lastname", "street", "street1",
  "street2", "cityname", "stateorprovince", "country", "postalcode", "itemid",
  "orderid", "orderlineitemid", "transactionid", "messageid", "correlationid",
  "uuid", "invocationid", "extendedorderid", "sku", "buyercheckoutmessage",
  "checkoutmessage", "paymentreference", "paymenttransactionid", "title",
  "description", "pictureurl", "galleryurl", "registrationaddress", "shippingaddress",
  "location", "longmessage", "shortmessage", "errorparameters", "value", "endtime",
  "starttime", "listingstartdate", "listingenddate", "paidtime", "createdtime",
  "modtime", "timestamp",
]);
const opaqueJsonKeys = new Set([
  "itemid", "orderid", "orderlineitemid", "transactionid", "messageid",
  "correlationid", "uuid", "invocationid", "userid", "seller", "buyer",
  "extendedorderid", "returneditemid",
]);
const droppedJsonKeys = new Set([
  "message", "longmessage", "shortmessage", "email", "emailaddress", "phone",
  "phonenumber", "postalcode", "address", "registrationaddress", "shippingaddress",
  "street", "street1", "street2", "cityname", "stateorprovince", "country",
  "location", "sku", "buyercheckoutmessage", "checkoutmessage", "paymentreference",
  "paymenttransactionid", "title", "description", "pictureurl", "galleryurl",
  "errorparameters", "endtime", "starttime", "listingstartdate", "listingenddate",
  "paidtime", "createdtime", "modtime", "timestamp",
]);

export function sandboxUrls(marketplaceId = "EBAY_GB") {
  return {
    fulfillmentOrders: `${SANDBOX_HOST}/sell/fulfillment/v1/order`,
    identity: SANDBOX_IDENTITY_URL,
    metadataCategoryPolicies: `${SANDBOX_HOST}/sell/metadata/v1/marketplace/${encodeURIComponent(marketplaceId)}/get_category_policies`,
    taxonomyDefaultTree: `${SANDBOX_HOST}/commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=${encodeURIComponent(marketplaceId)}`,
    trading: SANDBOX_TRADING_URL,
  };
}

function metadataCategoryPoliciesUrl(marketplaceId, categoryId) {
  return `${sandboxUrls(marketplaceId).metadataCategoryPolicies}?filter=${encodeURIComponent(`categoryIds:{${categoryId}}`)}`;
}

export function assertSandboxUrl(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.hostname !== "api.sandbox.ebay.com") {
    throw new Error("Refusing a non-Sandbox eBay endpoint.");
  }
  return url;
}

export function sandboxEnvironment(environment = process.env) {
  // Deliberately enumerate the only supported inputs rather than inspecting
  // process.env.  This makes EBAY_* Production variables and DATABASE_URL
  // invisible to this harness.
  return {
    accessToken: environment.EBAY_SANDBOX_ACCESS_TOKEN?.trim() || null,
    clientId: environment.EBAY_SANDBOX_CLIENT_ID?.trim() || null,
    clientSecret: environment.EBAY_SANDBOX_CLIENT_SECRET?.trim() || null,
    marketplaceId: environment.EBAY_SANDBOX_MARKETPLACE_ID?.trim() || "EBAY_GB",
    refreshToken: environment.EBAY_SANDBOX_REFRESH_TOKEN?.trim() || null,
  };
}

export function preflight(environment = process.env) {
  const config = sandboxEnvironment(environment);
  const canAuthenticate = Boolean(config.accessToken || (config.clientId && config.clientSecret && config.refreshToken));
  return {
    canAuthenticate,
    credentialMode: config.accessToken ? "sandbox-access-token" : canAuthenticate ? "sandbox-refresh-token" : "missing",
    endpoints: sandboxUrls(config.marketplaceId),
    marketplaceId: config.marketplaceId,
    productionInputsIgnored: true,
    readsDatabase: false,
    sandboxOnly: true,
  };
}

export function xmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function xmlValue(xml, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return xml.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([^<]*)</${escaped}>`, "i"))?.[1]?.trim() ?? null;
}

export function xmlContainers(xml, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...xml.matchAll(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)</${escaped}>`, "gi"))].map((match) => match[1]);
}

export function parseTradingResponse(xml) {
  return {
    ack: xmlValue(xml, "Ack"),
    errors: xmlContainers(xml, "Errors").map((errorXml) => ({
      code: xmlValue(errorXml, "ErrorCode"),
      message: xmlValue(errorXml, "LongMessage") ?? xmlValue(errorXml, "ShortMessage"),
      severity: xmlValue(errorXml, "SeverityCode"),
    })),
    itemId: xmlValue(xml, "ItemID"),
    invocationId: xmlValue(xml, "CorrelationID") ?? xmlValue(xml, "MessageID"),
    xml,
  };
}

function hash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 16);
}

export function stableOperationId({ command, operationKey }) {
  if (!operationKey?.trim()) throw new Error("--operation-key is required for every mutation.");
  return `sandbox-${command}-${hash(`${command}:${operationKey}`)}`;
}

export function stableAddItemUuid(operationKey) {
  return crypto.createHash("sha256").update(`add-item:${operationKey}`).digest("hex").slice(0, 32).toUpperCase();
}

export function stableReviseInvocationId({ command, operationKey }) {
  return crypto.createHash("sha256").update(`revise-invocation:${command}:${operationKey}`).digest("hex").slice(0, 32).toUpperCase();
}

export function stableLotProbeMessageId(probeKey) {
  const normalized = probeKey?.trim();
  if (!normalized) throw new Error("--probe-key is required for lot verification.");
  return crypto.createHash("sha256").update(`verify-lot:${normalized}`).digest("hex").slice(0, 32).toUpperCase();
}

function xmlElementCount(xml, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...xml.matchAll(new RegExp(`<${escaped}(?:\\s[^>]*)?>`, "gi"))].length;
}

function requiredSingleXmlValue(xml, name) {
  if (xmlElementCount(xml, name) !== 1 || xmlContainers(xml, name).length !== 1) {
    throw new Error(`Lot verification requires exactly one <${name}> element.`);
  }
  return xmlValue(xml, name);
}

export function buildVerifyLotRequest({ categoryId, itemXml, lotSize, probeKey }) {
  const normalizedCategoryId = categoryId?.trim();
  const parsedLotSize = Number(lotSize);
  const trimmedItemXml = itemXml?.trim() ?? "";
  if (normalizedCategoryId !== "183455") {
    throw new Error("Lot verification is restricted to UK category 183455.");
  }
  if (!Number.isInteger(parsedLotSize) || parsedLotSize < 2 || parsedLotSize > 450000) {
    throw new Error("Lot verification requires a whole-number --lot-size from 2 through 450000.");
  }
  if (!/^<Item(?:\s[^>]*)?>[\s\S]*<\/Item>$/i.test(trimmedItemXml) || xmlElementCount(trimmedItemXml, "Item") !== 1) {
    throw new Error("--item-xml-file must contain exactly one complete root <Item> element.");
  }
  for (const forbiddenName of ["ItemID", "UUID", "MessageID"]) {
    if (xmlElementCount(trimmedItemXml, forbiddenName) !== 0) {
      throw new Error(`Lot verification refuses <${forbiddenName}> in the Item template.`);
    }
  }
  if (xmlElementCount(trimmedItemXml, "PrimaryCategory") !== 1 || xmlContainers(trimmedItemXml, "PrimaryCategory").length !== 1) {
    throw new Error("Lot verification requires exactly one <PrimaryCategory> element.");
  }
  const categoryValue = requiredSingleXmlValue(trimmedItemXml, "CategoryID");
  const mappingValue = requiredSingleXmlValue(trimmedItemXml, "CategoryMappingAllowed")?.toLowerCase();
  const quantityValue = Number(requiredSingleXmlValue(trimmedItemXml, "Quantity"));
  const lotSizeValue = Number(requiredSingleXmlValue(trimmedItemXml, "LotSize"));
  if (categoryValue !== normalizedCategoryId) {
    throw new Error("The Item template category must match --category-id=183455.");
  }
  if (mappingValue !== "false") {
    throw new Error("Lot verification requires CategoryMappingAllowed=false.");
  }
  if (quantityValue !== 1) {
    throw new Error("Lot verification requires Quantity=1.");
  }
  if (!Number.isInteger(lotSizeValue) || lotSizeValue !== parsedLotSize) {
    throw new Error("The Item template LotSize must exactly match --lot-size.");
  }
  const messageId = stableLotProbeMessageId(probeKey);
  const body = `<MessageID>${messageId}</MessageID>${trimmedItemXml}`;
  return {
    body,
    messageId,
    request: {
      categoryId: normalizedCategoryId,
      categoryMappingAllowed: false,
      lotSize: parsedLotSize,
      quantity: 1,
      requestSha256: crypto.createHash("sha256").update(body).digest("hex"),
    },
  };
}

function withoutRootItemUuid(itemXml) {
  return itemXml.replace(/<UUID(?:\s[^>]*)?>[\s\S]*?<\/UUID>/gi, "");
}

export function buildAddItemRequest({ itemXml, operationKey, quantity }) {
  const parsedQuantity = Number(quantity);
  if (!Number.isInteger(parsedQuantity) || parsedQuantity < 1) throw new Error("AddItem quantity must be a positive integer.");
  if (!itemXml?.includes("<Item") || !/<\/Item>\s*$/i.test(itemXml)) {
    throw new Error("--item-xml-file must contain one complete root <Item> element.");
  }
  const uuid = stableAddItemUuid(operationKey);
  const itemWithQuantity = withoutRootItemUuid(itemXml)
    .replace(/<Quantity(?:\s[^>]*)?>[\s\S]*?<\/Quantity>/i, "")
    .replace(/<\/Item>\s*$/i, `<Quantity>${parsedQuantity}</Quantity><UUID>${uuid}</UUID></Item>`);
  return {
    body: `<MessageID>${uuid}</MessageID>${itemWithQuantity}`,
    messageId: uuid,
    operationId: stableOperationId({ command: "add-quantity", operationKey }),
    uuid,
  };
}

export function buildReviseInventoryStatusRequest({ itemId, operationKey, quantity }) {
  const parsedQuantity = Number(quantity);
  if (!itemId?.trim() || !Number.isInteger(parsedQuantity) || parsedQuantity < 0) {
    throw new Error("ReviseInventoryStatus requires --item-id and a whole-number --quantity of zero or more.");
  }
  const messageId = stableOperationId({ command: "revise-inventory", operationKey });
  return {
    body: `<MessageID>${xmlEscape(messageId)}</MessageID><InventoryStatus><ItemID>${xmlEscape(itemId)}</ItemID><Quantity>${parsedQuantity}</Quantity></InventoryStatus>`,
    messageId,
    operationId: messageId,
  };
}

export function buildReviseItemRequest({ itemId, operationKey, quantity }) {
  const parsedQuantity = Number(quantity);
  if (!itemId?.trim() || !Number.isInteger(parsedQuantity) || parsedQuantity < 0) {
    throw new Error("ReviseItem requires --item-id and a whole-number --quantity of zero or more.");
  }
  const messageId = stableOperationId({ command: "revise-item", operationKey });
  const invocationId = stableReviseInvocationId({ command: "revise-item", operationKey });
  return {
    body: `<MessageID>${xmlEscape(messageId)}</MessageID><InvocationID>${xmlEscape(invocationId)}</InvocationID><Item><ItemID>${xmlEscape(itemId)}</ItemID><Quantity>${parsedQuantity}</Quantity></Item>`,
    invocationId,
    messageId,
    operationId: messageId,
  };
}

export function buildEndItemRequest({ itemId, operationKey }) {
  if (!itemId?.trim()) throw new Error("EndItem requires --item-id.");
  const messageId = stableOperationId({ command: "end-not-available", operationKey });
  return {
    body: `<MessageID>${xmlEscape(messageId)}</MessageID><ItemID>${xmlEscape(itemId)}</ItemID><EndingReason>NotAvailable</EndingReason>`,
    messageId,
    operationId: messageId,
  };
}

export function buildMutation(command, options) {
  switch (command) {
    case "add-quantity": return { callName: "AddItem", ...buildAddItemRequest(options) };
    case "revise-inventory": return { callName: "ReviseInventoryStatus", ...buildReviseInventoryStatusRequest(options) };
    case "revise-item": return { callName: "ReviseItem", ...buildReviseItemRequest(options) };
    case "end-not-available": return { callName: "EndItem", ...buildEndItemRequest(options) };
    default: throw new Error(`Unsupported mutation command: ${command}`);
  }
}

export function mutationPlan(command, options) {
  const request = buildMutation(command, options);
  return {
    bounded: true,
    callName: request.callName,
    command,
    itemId: options.itemId ? opaque(options.itemId, "item") : null,
    operationId: opaque(request.operationId, "operation"),
    quantity: options.quantity === undefined ? null : Number(options.quantity),
    reconciliation: "Read GetItem after a response; if a request times out, do not retry the mutation until GetItem reconciliation is complete.",
    sandboxOnly: true,
  };
}

export async function persistOperationIntent({ command, intentDirectory, options }) {
  const request = buildMutation(command, options);
  const intent = {
    bodyHash: crypto.createHash("sha256").update(request.body).digest("hex"),
    command,
    desiredQuantity: options.quantity === undefined ? null : Number(options.quantity),
    messageId: request.messageId ?? null,
    operationKeyPseudonym: opaque(options.operationKey, "operation-key"),
    operationId: request.operationId,
    recordedAt: new Date().toISOString(),
    uuid: request.uuid ?? null,
  };
  const filename = path.join(intentDirectory, `${request.operationId}.json`);
  await fs.mkdir(intentDirectory, { recursive: true });
  try {
    await fs.writeFile(filename, `${JSON.stringify(intent, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const existing = JSON.parse(await fs.readFile(filename, "utf8"));
    if (existing.bodyHash !== intent.bodyHash) {
      throw new Error("Existing Sandbox operation intent has a different request body; choose a new operation key.");
    }
    return { ...existing, filename };
  }
  return { ...intent, filename };
}

async function sourceAddIntent({ intentDirectory, itemId, sourceAddOperationKey }) {
  if (!sourceAddOperationKey?.trim()) {
    throw new Error("--source-add-operation-key is required for revise and end mutations.");
  }
  const sourceOperationId = stableOperationId({ command: "add-quantity", operationKey: sourceAddOperationKey });
  let source;
  try {
    source = JSON.parse(await fs.readFile(path.join(intentDirectory, `${sourceOperationId}.json`), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error("No local AddItem operation intent exists for --source-add-operation-key.");
    throw error;
  }
  if (!source.returnedItemId || source.returnedItemId !== itemId) {
    throw new Error("The requested item ID does not match the ItemID recorded for the source AddItem operation.");
  }
  return source;
}

export async function recordOperationItemId({ intent, itemId }) {
  if (!itemId) throw new Error("Sandbox AddItem did not return an ItemID; reconcile before trying again.");
  const current = JSON.parse(await fs.readFile(intent.filename, "utf8"));
  if (current.returnedItemId && current.returnedItemId !== itemId) {
    throw new Error("Operation intent already records a different ItemID; stop for review.");
  }
  const updated = { ...current, returnedItemId: itemId };
  await fs.writeFile(intent.filename, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
  return { ...updated, filename: intent.filename };
}

async function recordOperationOutcome(intent, outcome) {
  const current = JSON.parse(await fs.readFile(intent.filename, "utf8"));
  const updated = { ...current, outcome, outcomeRecordedAt: new Date().toISOString() };
  await fs.writeFile(intent.filename, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
  return { ...updated, filename: intent.filename };
}

async function recordOperationVerified(intent) {
  const current = JSON.parse(await fs.readFile(intent.filename, "utf8"));
  const updated = { ...current, verifiedAt: current.verifiedAt ?? new Date().toISOString() };
  await fs.writeFile(intent.filename, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
  return { ...updated, filename: intent.filename };
}

export function opaque(value, label = "opaque") {
  return `[${label}:${hash(value)}]`;
}

export function redactEvidence(value) {
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map(redactEvidence);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [
      key,
      droppedJsonKeys.has(key.toLowerCase()) && child != null ? "[redacted]"
        : opaqueJsonKeys.has(key.toLowerCase()) && child != null ? opaque(child, key.toLowerCase())
          : redactEvidence(child),
    ]));
  }
  return value;
}

function redactString(value) {
  let redacted = value;
  // Redact each sensitive tag independently. A generic parent-element matcher
  // would skip nested address/contact elements such as
  // <RegistrationAddress><PostalCode>…</PostalCode></RegistrationAddress>.
  for (const tag of sensitiveXmlTags) {
    const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const replacement = opaqueJsonKeys.has(tag) ? (_contents) => opaque(_contents, tag) : () => "[redacted]";
    redacted = redacted.replace(new RegExp(`<(${escaped})(?:\\s[^>]*)?>([^<]*)<\\/\\1>`, "gi"), (_whole, originalTag, contents) => (
      `<${originalTag}>${replacement(contents)}</${originalTag}>`
    ));
  }
  redacted = redacted.replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+\/=:-]+/gi, "[redacted]");
  redacted = redacted.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted]");
  redacted = redacted.replace(/https?:\/\/[^\s<>"]+/gi, "[redacted]");
  return redacted;
}

const terminalCancellationStatuses = new Set([
  "CancelClosedForCommitment",
  "CancelClosedNoRefund",
  "CancelClosedUnknownRefund",
  "CancelClosedWithRefund",
  "CancelComplete",
  "Cancelled",
]);
const requestedCancellationStatuses = new Set(["CancelRequested", "CancellationRequested", "Requested"]);
const pendingCancellationStatuses = new Set(["CancelPending", "CancellationPending", "Pending"]);
const rejectedCancellationStatuses = new Set(["CancelRejected", "CancellationRejected", "Rejected"]);
const failedCancellationStatuses = new Set(["CancelFailed", "CancellationFailed", "Failed"]);
const notCancelledStatuses = new Set([
  "Active",
  "CancelNotRequested",
  "NoCancellation",
  "NoCancelRequest",
  "None",
  "NotApplicable",
  "NotCancelled",
]);

function cancellationState(transactionXml) {
  // CancelStatus/CancelState are authoritative when present. OrderStatus and
  // TransactionStatus are only fallbacks because they may describe a broader
  // lifecycle than the cancellation itself.
  const status = [
    xmlValue(transactionXml, "CancelStatus"),
    xmlValue(transactionXml, "CancelState"),
    xmlValue(transactionXml, "OrderStatus"),
    xmlValue(transactionXml, "TransactionStatus"),
  ].find((value) => value !== null);
  if (terminalCancellationStatuses.has(status)) return "complete";
  if (requestedCancellationStatuses.has(status)) return "requested";
  if (pendingCancellationStatuses.has(status)) return "pending";
  if (rejectedCancellationStatuses.has(status)) return "rejected";
  if (failedCancellationStatuses.has(status)) return "failed";
  if (notCancelledStatuses.has(status)) return "not-cancelled";
  return "unknown";
}

function transactionPaymentState(transactionXml) {
  const checkoutStatus = xmlValue(transactionXml, "CheckoutStatus");
  const completeStatus = xmlValue(transactionXml, "CompleteStatus");
  const paymentStatus = xmlValue(transactionXml, "eBayPaymentStatus");
  const paid = xmlValue(transactionXml, "PaidTime") !== null
    || checkoutStatus === "CheckoutComplete"
    || completeStatus === "Complete";
  const unpaid = checkoutStatus === "CheckoutIncomplete" || completeStatus === "Incomplete";
  const pending = checkoutStatus === "CheckoutPending"
    || ["PayPalPaymentInProcess", "PaymentInProcess", "PaymentPending", "Pending"].includes(paymentStatus);
  if (paid && (unpaid || pending)) return "unknown";
  if (paid) return "paid";
  if (pending) return "pending";
  if (unpaid) return "unpaid";
  return "unknown";
}

function positiveIntegerOrNull(value) {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function parseMultiUnitTransactions(xml) {
  return xmlContainers(xml, "Transaction").map((transactionXml) => {
    const parsedCancellationState = cancellationState(transactionXml);
    return {
      cancellationState: parsedCancellationState,
      cancelled: parsedCancellationState === "complete",
      orderId: xmlValue(transactionXml, "OrderID"),
      orderLineItemId: xmlValue(transactionXml, "OrderLineItemID"),
      paymentState: transactionPaymentState(transactionXml),
      quantityPurchased: positiveIntegerOrNull(xmlValue(transactionXml, "QuantityPurchased")),
      transactionId: xmlValue(transactionXml, "TransactionID"),
    };
  });
}

export function timeoutDecision(error) {
  const message = String(error?.message ?? error ?? "");
  const uncertain = error?.name === "AbortError" || /timeout|timed out|network|fetch failed|socket/i.test(message);
  return uncertain
    ? { action: "reconcile-before-retry", remoteState: "unknown", retryMutation: false }
    : { action: "report-failure", remoteState: "not-confirmed", retryMutation: false };
}

export class EbaySandboxTradingError extends Error {
  constructor(message, { ack, errors, httpStatus, xml }) {
    super(message);
    this.ack = ack;
    this.errors = errors;
    this.httpStatus = httpStatus;
    this.xml = xml;
  }
}

export function errorEvidence(error) {
  return redactEvidence({
    ack: error?.ack ?? null,
    errors: error?.errors ?? [],
    httpStatus: error?.httpStatus ?? null,
    message: String(error?.message ?? error),
  });
}

function projectErrors(errors) {
  return Array.isArray(errors)
    ? errors.map((error) => ({
      code: /^[A-Za-z0-9_.:-]{1,64}$/.test(error?.code ?? "") ? error.code : null,
      severity: /^[A-Za-z0-9_.:-]{1,64}$/.test(error?.severity ?? "") ? error.severity : null,
    }))
    : [];
}

function projectListing(listing) {
  if (!listing) return null;
  return {
    available: listing.available ?? null,
    endingReason: listing.endingReason ?? null,
    listingStatus: listing.listingStatus ?? null,
    quantity: listing.quantity ?? null,
    quantitySold: listing.quantitySold ?? null,
  };
}

function projectTrading(result) {
  if (!result) return null;
  if (result.error) return { error: projectTrading(result.error) };
  return {
    ack: result.ack ?? null,
    errors: projectErrors(result.errors),
    httpStatus: result.httpStatus ?? null,
    listing: projectListing(result.listing),
  };
}

function projectTransactions(result) {
  return {
    ack: result.ack ?? null,
    complete: result.complete === true,
    errors: projectErrors(result.errors),
    hasMoreTransactions: result.hasMoreTransactions ?? null,
    pageNumber: result.pageNumber ?? null,
    returnedTransactionCountActual: result.returnedTransactionCountActual ?? null,
    totalNumberOfEntries: result.totalNumberOfEntries ?? null,
    totalNumberOfPages: result.totalNumberOfPages ?? null,
    transactions: Array.isArray(result.transactions)
      ? result.transactions.map((transaction) => ({
        cancellationState: transaction.cancellationState ?? "unknown",
        cancelled: transaction.cancelled === true,
        paymentState: transaction.paymentState ?? "unknown",
        quantityPurchased: transaction.quantityPurchased ?? null,
      }))
      : [],
  };
}

function projectFulfillmentOrders(result) {
  return {
    complete: result.complete === true,
    matchingOrders: Array.isArray(result.matchingOrders)
      ? result.matchingOrders.map((order) => ({
        cancelState: order.cancelState ?? null,
        fulfillmentStatus: order.fulfillmentStatus ?? null,
        lineItemQuantities: Array.isArray(order.lineItems) ? order.lineItems.map((lineItem) => lineItem.quantity ?? null) : [],
        paymentStatus: order.paymentStatus ?? null,
      }))
      : [],
    pagesScanned: result.pagesScanned ?? null,
    totalOrdersScanned: result.totalOrdersScanned ?? null,
  };
}

function projectCategory(result) {
  const policy = result.categoryPolicies?.categoryPolicies?.[0] ?? {};
  const category = result.taxonomyPath?.categorySubtreeNode?.category ?? {};
  const flags = {};
  for (const name of ["lsd", "expired", "virtual"]) {
    if (typeof policy[name] === "boolean") flags[name] = policy[name];
  }
  return {
    categoryId: result.categoryId ?? null,
    categoryName: category.categoryName ?? null,
    categoryTreeId: result.categoryTreeId ?? null,
    leafCategory: result.taxonomyPath?.categorySubtreeNode?.leafCategoryTreeNode === true,
    policyCategoryId: policy.categoryId ?? null,
    policyFlags: flags,
  };
}

function projectLotVerification(result) {
  const requestHash = result.request?.requestSha256;
  const ack = ["Success", "Warning", "Failure", "PartialFailure"].includes(result.response?.ack)
    ? result.response.ack
    : null;
  const httpStatus = Number.isInteger(result.response?.httpStatus)
    && result.response.httpStatus >= 100
    && result.response.httpStatus <= 599
    ? result.response.httpStatus
    : null;
  return {
    accepted: result.accepted === true,
    callName: result.callName === "VerifyAddItem" ? "VerifyAddItem" : null,
    publishingAttempted: false,
    request: {
      categoryId: result.request?.categoryId === "183455" ? "183455" : null,
      categoryMappingAllowed: result.request?.categoryMappingAllowed === false ? false : null,
      lotSize: Number.isInteger(result.request?.lotSize)
        && result.request.lotSize >= 2
        && result.request.lotSize <= 450000
        ? result.request.lotSize
        : null,
      quantity: result.request?.quantity === 1 ? 1 : null,
      requestSha256: typeof requestHash === "string" && /^[a-f0-9]{64}$/.test(requestHash) ? requestHash : null,
    },
    response: {
      ack,
      errors: projectErrors(result.response?.errors),
      httpStatus,
    },
    sandboxOnly: result.sandboxOnly === true,
  };
}

/**
 * The only serializer permitted at the CLI/capture boundary.  It projects a
 * small evidence schema and intentionally ignores raw XML, API JSON, unknown
 * nested fields, and free text rather than attempting to redact them.
 */
export function projectEvidence(result) {
  if (!result || typeof result !== "object") return { status: "redacted" };
  if (result.evidenceType === "lot-verification") return projectLotVerification(result);
  if ("categoryPolicies" in result || "taxonomyPath" in result) return projectCategory(result);
  if ("trading" in result && "fulfillment" in result) {
    return {
      complete: result.complete === true,
      fulfillment: projectFulfillmentOrders(result.fulfillment),
      trading: projectTransactions(result.trading),
    };
  }
  if ("plan" in result) {
    return {
      alreadyApplied: result.alreadyApplied === true,
      outcome: result.intent?.outcome ?? null,
      plan: {
        bounded: result.plan?.bounded === true,
        callName: result.plan?.callName ?? null,
        command: result.plan?.command ?? null,
        quantity: result.plan?.quantity ?? null,
        sandboxOnly: result.plan?.sandboxOnly === true,
      },
      preRead: projectTrading(result.preRead),
      reconciliation: projectTrading(result.reconciliation),
      recoveredDuplicate: result.recoveredDuplicate === true,
      reusedRecordedItem: result.reusedRecordedItem === true,
      result: projectTrading(result.result),
      transactionPrecheck: result.transactions
        ? ("trading" in result.transactions && "fulfillment" in result.transactions
          ? projectEvidence(result.transactions)
          : projectTransactions(result.transactions))
        : null,
      verification: projectTrading(result.verification),
    };
  }
  if ("sellerId" in result) return { ack: result.ack ?? null, errors: projectErrors(result.errors), sellerId: result.sellerId ?? null };
  if ("transactions" in result) {
    return projectTransactions(result);
  }
  if ("canAuthenticate" in result) {
    return {
      canAuthenticate: result.canAuthenticate === true,
      credentialMode: result.credentialMode ?? null,
      marketplaceId: result.marketplaceId ?? null,
      productionInputsIgnored: result.productionInputsIgnored === true,
      readsDatabase: result.readsDatabase === true,
      sandboxOnly: result.sandboxOnly === true,
    };
  }
  return projectTrading(result);
}

export async function sandboxAccessToken({ environment = process.env, fetchImpl = fetch }) {
  const config = sandboxEnvironment(environment);
  if (config.accessToken) return config.accessToken;
  if (!config.clientId || !config.clientSecret || !config.refreshToken) {
    throw new Error("Use EBAY_SANDBOX_ACCESS_TOKEN or all of EBAY_SANDBOX_CLIENT_ID, EBAY_SANDBOX_CLIENT_SECRET, and EBAY_SANDBOX_REFRESH_TOKEN.");
  }
  const url = assertSandboxUrl(SANDBOX_IDENTITY_URL);
  const response = await fetchImpl(url, {
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: config.refreshToken }),
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    method: "POST",
    redirect: "error",
  });
  const payload = await response.json();
  if (!response.ok || !payload.access_token) throw new Error(`Sandbox token refresh failed (${response.status}).`);
  return payload.access_token;
}

export async function tradingCall({ accessToken, body, callName, fetchImpl = fetch }) {
  const url = assertSandboxUrl(SANDBOX_TRADING_URL);
  const response = await fetchImpl(url, {
    body: `<?xml version="1.0" encoding="utf-8"?><${callName}Request xmlns="urn:ebay:apis:eBLBaseComponents">${body}</${callName}Request>`,
    headers: {
      "Content-Type": "text/xml",
      "X-EBAY-API-CALL-NAME": callName,
      "X-EBAY-API-COMPATIBILITY-LEVEL": tradingCompatibilityLevel,
      "X-EBAY-API-IAF-TOKEN": accessToken,
      "X-EBAY-API-SITEID": tradingSiteId,
    },
    method: "POST",
    redirect: "error",
  });
  const xml = await response.text();
  const parsed = { httpStatus: response.status, ...parseTradingResponse(xml) };
  if (!response.ok || parsed.ack === "Failure" || parsed.ack === "PartialFailure") {
    const firstError = parsed.errors.find((error) => error.severity === "Error") ?? parsed.errors[0];
    throw new EbaySandboxTradingError(firstError?.message ?? `Sandbox ${callName} failed (${response.status}).`, parsed);
  }
  return parsed;
}

export async function verifyLot({ accessToken, categoryId, fetchImpl = fetch, itemXml, lotSize, probeKey }) {
  const request = buildVerifyLotRequest({ categoryId, itemXml, lotSize, probeKey });
  const evidence = {
    accepted: false,
    callName: "VerifyAddItem",
    evidenceType: "lot-verification",
    publishingAttempted: false,
    request: request.request,
    response: { ack: null, errors: [], httpStatus: null },
    sandboxOnly: true,
  };
  try {
    const response = await tradingCall({
      accessToken,
      body: request.body,
      callName: "VerifyAddItem",
      fetchImpl,
    });
    const accepted = ["Success", "Warning"].includes(response.ack)
      && !response.errors.some((error) => error.severity === "Error");
    return { ...evidence, accepted, response };
  } catch (error) {
    return {
      ...evidence,
      response: {
        ack: error?.ack ?? null,
        errors: Array.isArray(error?.errors) ? error.errors : [],
        httpStatus: error?.httpStatus ?? null,
      },
    };
  }
}

function xmlNumber(xml, name) {
  const value = xmlValue(xml, name);
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function listingQuantities(xml) {
  const itemXml = xmlContainers(xml, "Item")[0] ?? xml;
  const quantity = xmlNumber(itemXml, "Quantity");
  const quantitySold = xmlNumber(itemXml, "QuantitySold");
  return {
    available: quantity === null || quantitySold === null ? null : Math.max(0, quantity - quantitySold),
    quantity,
    quantitySold,
  };
}

export async function getItem({ accessToken, itemId, fetchImpl }) {
  const result = await tradingCall({ accessToken, callName: "GetItem", fetchImpl, body: `<ItemID>${xmlEscape(itemId)}</ItemID><DetailLevel>ReturnAll</DetailLevel>` });
  const itemXml = xmlContainers(result.xml, "Item")[0] ?? result.xml;
  return {
    ...result,
    listing: {
      itemId: result.itemId ?? itemId,
      endingReason: xmlValue(itemXml, "EndingReason"),
      listingStatus: xmlValue(itemXml, "ListingStatus"),
      ...listingQuantities(result.xml),
    },
  };
}

export async function getItemTransactions({ accessToken, itemId, fetchImpl }) {
  const result = await tradingCall({ accessToken, callName: "GetItemTransactions", fetchImpl, body: `<ItemID>${xmlEscape(itemId)}</ItemID><DetailLevel>ReturnAll</DetailLevel><IncludeContainingOrder>true</IncludeContainingOrder><Pagination><EntriesPerPage>200</EntriesPerPage><PageNumber>1</PageNumber></Pagination>` });
  const transactions = parseMultiUnitTransactions(result.xml);
  const hasMoreTransactionsValue = xmlValue(result.xml, "HasMoreTransactions")?.toLowerCase() ?? null;
  const hasMoreTransactions = hasMoreTransactionsValue === "true"
    ? true
    : hasMoreTransactionsValue === "false" ? false : null;
  const pageNumber = xmlNumber(result.xml, "PageNumber");
  const returnedTransactionCountActual = xmlNumber(result.xml, "ReturnedTransactionCountActual");
  const totalNumberOfEntries = xmlNumber(result.xml, "TotalNumberOfEntries");
  const totalNumberOfPages = xmlNumber(result.xml, "TotalNumberOfPages");
  const complete = hasMoreTransactions === false
    && pageNumber === 1
    && Number.isInteger(returnedTransactionCountActual)
    && returnedTransactionCountActual === transactions.length
    && Number.isInteger(totalNumberOfEntries)
    && totalNumberOfEntries === transactions.length
    && (totalNumberOfEntries === 0
      ? [0, 1].includes(totalNumberOfPages)
      : totalNumberOfPages === 1);
  return {
    ...result,
    complete,
    hasMoreTransactions,
    pageNumber,
    returnedTransactionCountActual,
    totalNumberOfEntries,
    totalNumberOfPages,
    transactions,
  };
}

export async function getFulfillmentOrders({ accessToken, itemId, marketplaceId = "EBAY_GB", fetchImpl = fetch }) {
  if (!itemId?.trim()) throw new Error("--item-id is required for Fulfillment order evidence.");
  const limit = 50;
  let offset = 0;
  let pagesScanned = 0;
  let totalOrdersScanned = null;
  const matchingOrders = [];
  while (totalOrdersScanned === null || offset < totalOrdersScanned) {
    if (pagesScanned >= 100) throw new Error("Refusing to scan more than 100 Fulfillment order pages.");
    const url = `${sandboxUrls(marketplaceId).fulfillmentOrders}?limit=${limit}&offset=${offset}`;
    const response = await fetchImpl(assertSandboxUrl(url), {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        "X-EBAY-C-MARKETPLACE-ID": marketplaceId,
      },
      redirect: "error",
    });
    const body = await response.json();
    if (!response.ok) {
      throw new EbaySandboxTradingError(`Sandbox Fulfillment getOrders failed (${response.status}).`, {
        ack: null,
        errors: Array.isArray(body?.errors) ? body.errors.map((error) => ({ code: String(error?.errorId ?? ""), severity: "Error" })) : [],
        httpStatus: response.status,
        xml: "",
      });
    }
    if (!Array.isArray(body?.orders)) throw new Error("Sandbox Fulfillment getOrders returned an invalid orders collection.");
    const orders = body.orders;
    const responseTotal = body?.total;
    if (!Number.isInteger(responseTotal) || responseTotal < 0) throw new Error("Sandbox Fulfillment getOrders returned an invalid total.");
    if (totalOrdersScanned === null) totalOrdersScanned = responseTotal;
    if (responseTotal !== totalOrdersScanned) throw new Error("Sandbox Fulfillment order total changed during pagination.");
    for (const order of orders) {
      const lineItems = Array.isArray(order?.lineItems)
        ? order.lineItems.filter((lineItem) => String(lineItem?.legacyItemId ?? "") === String(itemId))
        : [];
      if (lineItems.length > 0) {
        matchingOrders.push({
          cancelState: order?.cancelStatus?.cancelState ?? null,
          fulfillmentStatus: order?.orderFulfillmentStatus ?? null,
          lineItems: lineItems.map((lineItem) => ({ quantity: positiveIntegerOrNull(lineItem?.quantity ?? null) })),
          orderId: order?.orderId ?? null,
          paymentStatus: order?.orderPaymentStatus ?? null,
        });
      }
    }
    pagesScanned += 1;
    offset += orders.length;
    if (orders.length === 0 && offset < totalOrdersScanned) {
      throw new Error("Sandbox Fulfillment pagination made no progress.");
    }
  }
  return {
    complete: offset === totalOrdersScanned,
    matchingOrders,
    pagesScanned,
    totalOrdersScanned,
  };
}

export async function getOrderEvidence({ accessToken, itemId, marketplaceId = "EBAY_GB", fetchImpl = fetch }) {
  const trading = await getItemTransactions({ accessToken, itemId, fetchImpl });
  if (!trading.complete) throw new Error("GetItemTransactions evidence is incomplete; refusing to claim order reconciliation.");
  const fulfillment = await getFulfillmentOrders({ accessToken, itemId, marketplaceId, fetchImpl });
  if (!fulfillment.complete) throw new Error("Fulfillment getOrders evidence is incomplete; refusing to claim order reconciliation.");
  return { complete: true, fulfillment, trading };
}

export async function getSeller({ accessToken, fetchImpl }) {
  const result = await tradingCall({ accessToken, callName: "GetUser", fetchImpl, body: "<DetailLevel>ReturnAll</DetailLevel>" });
  return {
    ack: result.ack,
    errors: result.errors,
    sellerId: opaque(xmlValue(result.xml, "UserID") ?? "unknown", "seller"),
  };
}

function duplicateItemId(error) {
  if (!(error instanceof EbaySandboxTradingError) || !error.errors.some((detail) => detail.code === "488")) return null;
  const errorDetails = xmlContainers(error.xml ?? "", "Errors").filter((detail) => xmlValue(detail, "ErrorCode") === "488");
  for (const detail of errorDetails) {
    const parameters = [...detail.matchAll(/<ErrorParameters\b([^>]*)>([\s\S]*?)<\/ErrorParameters>/gi)].map((match) => ({
      paramId: match[1].match(/\bParamID\s*=\s*["']([^"']+)["']/i)?.[1] ?? null,
      value: xmlValue(match[2], "Value"),
    }));
    const sameApplication = parameters.find((parameter) => parameter.paramId === "0")?.value;
    const originalItemId = parameters.find((parameter) => parameter.paramId === "1")?.value;
    if (["1", "true"].includes(sameApplication?.toLowerCase()) && originalItemId && /^[0-9]+$/.test(originalItemId)) {
      return originalItemId;
    }
  }
  return null;
}

async function preflightMutationTarget({ accessToken, command, fetchImpl, intentDirectory, options }) {
  if (command === "add-quantity") return { sourceIntent: null, preRead: null, transactions: null };
  const sourceIntent = await sourceAddIntent({
    intentDirectory,
    itemId: options.itemId,
    sourceAddOperationKey: options.sourceAddOperationKey,
  });
  const preRead = await getItem({ accessToken, itemId: options.itemId, fetchImpl });
  return { sourceIntent, preRead, transactions: null };
}

function desiredStateApplied(command, options, listing) {
  if (command === "revise-inventory") return listing.available === Number(options.quantity);
  if (command === "end-not-available") {
    return listing.listingStatus?.toLowerCase() !== "active" && listing.endingReason === "NotAvailable";
  }
  return false;
}

function summedQuantity(values) {
  if (values.some((value) => !Number.isInteger(value) || value < 1)) return null;
  return values.reduce((sum, value) => sum + value, 0);
}

async function assertMutationMayProceed({ accessToken, command, fetchImpl, options, preRead }) {
  if (command === "end-not-available" && preRead.listing.listingStatus?.toLowerCase() !== "active") {
    throw new Error("EndItem is only permitted for a currently Active Sandbox Listing.");
  }
  if (!Number.isInteger(preRead.listing.quantitySold) || preRead.listing.quantitySold < 0) {
    throw new Error("The Sandbox mutation is refused when QuantitySold is unavailable or invalid.");
  }
  const orderEvidence = await getOrderEvidence({ accessToken, itemId: options.itemId, fetchImpl });
  const transactions = orderEvidence.trading.transactions;
  const fulfillmentOrders = orderEvidence.fulfillment.matchingOrders;
  if (transactions.length === 0 && fulfillmentOrders.length === 0) {
    if (preRead.listing.quantitySold !== 0) {
      throw new Error("The Sandbox mutation is refused when QuantitySold is nonzero without matching order evidence.");
    }
    return orderEvidence;
  }
  if (transactions.length === 0) {
    throw new Error("The Sandbox mutation is refused when Fulfillment has an order that Trading cannot reconcile.");
  }
  if (transactions.some((transaction) => transaction.cancellationState !== "complete")) {
    throw new Error("The Sandbox mutation is refused until every Trading transaction has an exact terminal cancellation state.");
  }
  const tradingQuantity = summedQuantity(transactions.map((transaction) => transaction.quantityPurchased));
  if (tradingQuantity === null) {
    throw new Error("The Sandbox mutation is refused when Trading transaction quantities are invalid.");
  }
  if (fulfillmentOrders.length === 0) {
    if (transactions.some((transaction) => transaction.paymentState !== "unpaid")) {
      throw new Error("The Sandbox mutation is refused when zero-match Fulfillment evidence is not explicitly explained by unpaid Trading cancellations.");
    }
    return orderEvidence;
  }
  if (transactions.some((transaction) => transaction.paymentState !== "paid")) {
    throw new Error("The Sandbox mutation is refused when Trading and Fulfillment payment evidence disagree.");
  }
  if (fulfillmentOrders.some((order) => (
    order.cancelState !== "CANCELED"
    || order.fulfillmentStatus !== "NOT_STARTED"
    || order.paymentStatus !== "FULLY_REFUNDED"
  ))) {
    throw new Error("The Sandbox mutation is refused until every paid Fulfillment order is exactly canceled, unfulfilled, and fully refunded.");
  }
  const fulfillmentQuantity = summedQuantity(fulfillmentOrders.flatMap((order) => (
    order.lineItems.map((lineItem) => lineItem.quantity)
  )));
  if (fulfillmentQuantity === null || fulfillmentQuantity !== tradingQuantity) {
    throw new Error("The Sandbox mutation is refused when Trading and Fulfillment quantities do not correlate.");
  }
  return orderEvidence;
}

export async function categoryEvidence({ accessToken, categoryId, marketplaceId = "EBAY_GB", fetchImpl = fetch }) {
  if (!categoryId?.trim()) throw new Error("--category-id is required; category suggestions are not compatibility evidence.");
  const urls = sandboxUrls(marketplaceId);
  const defaultTreeResponse = await fetchImpl(assertSandboxUrl(urls.taxonomyDefaultTree), {
    headers: { Authorization: `Bearer ${accessToken}` },
    redirect: "error",
  });
  const defaultTree = await defaultTreeResponse.json();
  if (!defaultTreeResponse.ok || !defaultTree.categoryTreeId) throw new Error("Sandbox Taxonomy default category tree lookup failed.");
  const subtreeUrl = `${SANDBOX_HOST}/commerce/taxonomy/v1/category_tree/${encodeURIComponent(defaultTree.categoryTreeId)}/get_category_subtree?category_id=${encodeURIComponent(categoryId)}`;
  const subtreeResponse = await fetchImpl(assertSandboxUrl(subtreeUrl), {
    headers: { Authorization: `Bearer ${accessToken}` },
    redirect: "error",
  });
  const taxonomyPath = await subtreeResponse.json();
  if (!subtreeResponse.ok) throw new Error("Sandbox Taxonomy category path lookup failed.");
  const categoryNode = taxonomyPath.categorySubtreeNode ?? null;
  if (!categoryNode?.leafCategoryTreeNode) throw new Error("The requested category is not a Taxonomy leaf category.");
  const policiesResponse = await fetchImpl(assertSandboxUrl(metadataCategoryPoliciesUrl(marketplaceId, categoryId)), {
    headers: { Authorization: `Bearer ${accessToken}` },
    redirect: "error",
  });
  const categoryPolicies = await policiesResponse.json();
  if (!policiesResponse.ok) throw new Error("Sandbox Metadata category policy lookup failed.");
  return { categoryId, categoryPolicies, categoryTreeId: defaultTree.categoryTreeId, marketplaceId, taxonomyPath };
}

export async function runMutation({ accessToken, command, confirm, fetchImpl = fetch, intentDirectory, options }) {
  if (confirm !== STRONG_MUTATION_CONFIRMATION) {
    throw new Error(`Refusing Sandbox mutation. Pass --confirm-sandbox-mutation=${STRONG_MUTATION_CONFIRMATION}.`);
  }
  if (command === "revise-item") {
    throw new Error("ReviseItem execution is disabled until a captured ReviseInventoryStatus compatibility rejection enables it.");
  }
  const request = buildMutation(command, options);
  let intent = null;
  let preRead = null;
  let transactions = null;
  let verification = null;
  try {
    const resolvedIntentDirectory = intentDirectory ?? path.resolve(".ebay-sandbox-operation-intents");
    intent = await persistOperationIntent({
      command,
      intentDirectory: resolvedIntentDirectory,
      options,
    });
    if (command === "add-quantity" && intent.returnedItemId) {
      const reconciliation = await getItem({
        accessToken,
        itemId: intent.returnedItemId,
        fetchImpl,
      });
      const quantityMatches = reconciliation.listing.available === Number(options.quantity);
      intent = await recordOperationOutcome(intent, quantityMatches ? "confirmed" : "uncertain");
      return {
        intent,
        plan: mutationPlan(command, options),
        preRead: null,
        recoveredDuplicate: true,
        reconciliation,
        result: quantityMatches
          ? { ack: "Recorded", errors: [], itemId: intent.returnedItemId }
          : { error: { ack: "Recorded", errors: [], httpStatus: null } },
        reusedRecordedItem: true,
        transactions: null,
        verification: null,
      };
    }
    const target = await preflightMutationTarget({
      accessToken,
      command,
      fetchImpl,
      intentDirectory: resolvedIntentDirectory,
      options,
    });
    preRead = target.preRead;
    if (command === "revise-inventory") {
      transactions = await assertMutationMayProceed({ accessToken, command, fetchImpl, options, preRead });
    }
    if (["revise-inventory", "end-not-available"].includes(command) && desiredStateApplied(command, options, preRead.listing)) {
      intent = await recordOperationOutcome(intent, "confirmed");
      return {
        alreadyApplied: true,
        intent,
        plan: mutationPlan(command, options),
        preRead,
        recoveredDuplicate: false,
        reconciliation: preRead,
        result: { ack: "AlreadyApplied", errors: [], httpStatus: null },
        transactions,
        verification: null,
      };
    }
    if (command === "end-not-available") {
      transactions = await assertMutationMayProceed({ accessToken, command, fetchImpl, options, preRead });
    }
    if (command === "add-quantity" && !intent.verifiedAt) {
      verification = await tradingCall({ accessToken, callName: "VerifyAddItem", body: request.body, fetchImpl });
      if (!["Success", "Warning"].includes(verification.ack)) {
        throw new Error("VerifyAddItem did not return Success or Warning; AddItem was not attempted.");
      }
      intent = await recordOperationVerified(intent);
    }
    let result;
    let recoveredDuplicate = false;
    try {
      result = await tradingCall({ accessToken, callName: request.callName, body: request.body, fetchImpl });
    } catch (error) {
      const originalItemId = command === "add-quantity" ? duplicateItemId(error) : null;
      if (!originalItemId) throw error;
      recoveredDuplicate = true;
      result = { ack: error.ack, errors: error.errors, httpStatus: error.httpStatus, itemId: originalItemId, xml: error.xml };
    }
    if (command === "add-quantity") intent = await recordOperationItemId({ intent, itemId: result.itemId });
    const needsReconciliation = Boolean(options.itemId || result.itemId);
    const reconciliation = needsReconciliation
      ? await getItem({ accessToken, itemId: options.itemId ?? result.itemId, fetchImpl })
      : null;
    if (command === "add-quantity") {
      if (!reconciliation || reconciliation.listing.available !== Number(options.quantity)) {
        intent = await recordOperationOutcome(intent, "uncertain");
        return {
          intent,
          plan: mutationPlan(command, options),
          preRead,
          recoveredDuplicate,
          reconciliation,
          result: { error: { ack: result.ack ?? null, errors: result.errors ?? [], httpStatus: result.httpStatus ?? null } },
          timeout: { action: "reconcile-before-retry", remoteState: "unknown", retryMutation: false },
          transactions,
          verification,
        };
      }
      intent = await recordOperationOutcome(intent, "confirmed");
    }
    if (["revise-inventory", "end-not-available"].includes(command)) {
      if (!reconciliation || !desiredStateApplied(command, options, reconciliation.listing)) {
        intent = await recordOperationOutcome(intent, "uncertain");
        return {
          intent,
          plan: mutationPlan(command, options),
          preRead,
          reconciliation,
          result: { error: { ack: result.ack ?? null, errors: result.errors ?? [], httpStatus: result.httpStatus ?? null } },
          timeout: { action: "reconcile-before-retry", remoteState: "unknown", retryMutation: false },
          transactions,
          verification,
        };
      }
      intent = await recordOperationOutcome(intent, "confirmed");
    }
    return { intent, plan: mutationPlan(command, options), preRead, recoveredDuplicate, reconciliation, result, transactions, verification };
  } catch (error) {
    const timeout = timeoutDecision(error);
    if (intent && timeout.remoteState === "unknown") intent = await recordOperationOutcome(intent, "uncertain");
    return { intent, plan: mutationPlan(command, options), preRead, result: { error: errorEvidence(error) }, timeout, transactions, verification };
  }
}

export function assertStrongMutationConfirmation(confirm) {
  if (confirm !== STRONG_MUTATION_CONFIRMATION) {
    throw new Error(`Refusing Sandbox mutation. Pass --confirm-sandbox-mutation=${STRONG_MUTATION_CONFIRMATION}.`);
  }
}

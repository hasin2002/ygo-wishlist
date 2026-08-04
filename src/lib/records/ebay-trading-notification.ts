import { createHash, timingSafeEqual } from "node:crypto";
import { SaxesParser } from "saxes";

export const ebayTradingNotificationEvents = [
  "ItemClosed",
  "ItemRevised",
  "ItemSuspended",
  "FixedPriceTransaction",
  "AuctionCheckoutComplete",
] as const;

export type EbayTradingNotificationEvent =
  (typeof ebayTradingNotificationEvents)[number];

export type ParsedEbayTradingNotification = {
  correlationId: string | null;
  eventAt: Date;
  eventName: EbayTradingNotificationEvent;
  listingRefs: Array<{ itemId: string; orderLineItemId: string | null }>;
  notificationId: string;
  notificationSignature: string;
  orderId: string | null;
  publishedAt: Date;
  sellerUserId: string | null;
  timestampText: string;
  topic: `TRADING_${EbayTradingNotificationEvent}`;
};

export const ebayTradingNotificationMaxBytes = 256 * 1_024;
export const ebayTradingNotificationClockSkewMs = 10 * 60 * 1_000;

const soapNamespaces = new Set([
  "http://schemas.xmlsoap.org/soap/envelope/",
  "http://www.w3.org/2003/05/soap-envelope",
]);
const maxXmlDepth = 64;
const maxXmlElements = 4_096;

type StrictXmlNode = {
  children: StrictXmlNode[];
  localName: string;
  namespace: string;
  text: string;
};

function parseStrictXmlDocument(xml: string): StrictXmlNode | null {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) return null;
  let root: StrictXmlNode | null = null;
  let elementCount = 0;
  const stack: StrictXmlNode[] = [];
  const parser = new SaxesParser({ xmlns: true });
  parser.on("opentag", (tag) => {
    elementCount += 1;
    if (elementCount > maxXmlElements || stack.length >= maxXmlDepth) {
      throw new Error("Notification XML exceeds its structural limits.");
    }
    const node: StrictXmlNode = {
      children: [],
      localName: tag.local,
      namespace: tag.uri,
      text: "",
    };
    const parent = stack.at(-1);
    if (parent) parent.children.push(node);
    else if (root) throw new Error("Notification XML has more than one root element.");
    else root = node;
    stack.push(node);
  });
  parser.on("text", (value) => {
    const current = stack.at(-1);
    if (current) current.text += value;
  });
  parser.on("cdata", (value) => {
    const current = stack.at(-1);
    if (current) current.text += value;
  });
  parser.on("closetag", () => {
    stack.pop();
  });
  parser.on("error", (error) => {
    throw error;
  });
  try {
    parser.write(xml).close();
    return root;
  } catch {
    return null;
  }
}

function childNodes(node: StrictXmlNode, localName: string) {
  return node.children.filter((child) => child.localName === localName);
}

function descendantNodes(node: StrictXmlNode, localName: string): StrictXmlNode[] {
  return node.children.flatMap((child) => [
    ...(child.localName === localName ? [child] : []),
    ...descendantNodes(child, localName),
  ]);
}

function descendantText(node: StrictXmlNode, localName: string) {
  const value = descendantNodes(node, localName)[0]?.text.trim();
  return value || null;
}

function xmlUnescape(value: string) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function escapedXmlName(name: string) {
  return name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function xmlText(xml: string, name: string) {
  const escapedName = escapedXmlName(name);
  const match = xml.match(new RegExp(
    `<(?:[A-Za-z0-9_-]+:)?${escapedName}(?:\\s[^>]*)?>([^<]*)</(?:[A-Za-z0-9_-]+:)?${escapedName}\\s*>`,
  ));
  return match ? xmlUnescape(match[1]!.trim()) || null : null;
}

function xmlContainers(xml: string, name: string) {
  const escapedName = escapedXmlName(name);
  return [...xml.matchAll(new RegExp(
    `<(?:[A-Za-z0-9_-]+:)?${escapedName}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[A-Za-z0-9_-]+:)?${escapedName}\\s*>`,
    "g",
  ))].map((match) => match[1]!);
}

function supportedEvent(value: string | null): value is EbayTradingNotificationEvent {
  return ebayTradingNotificationEvents.some((event) => event === value);
}

function uniqueListingRefs(
  values: Array<{ itemId: string; orderLineItemId: string | null }>,
) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = `${value.itemId}\0${value.orderLineItemId ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function deterministicNotificationId(input: {
  correlationId: string | null;
  eventName: EbayTradingNotificationEvent;
  listingRefs: Array<{ itemId: string; orderLineItemId: string | null }>;
  orderId: string | null;
  sellerUserId: string | null;
  timestampText: string;
}) {
  const identity = JSON.stringify({
    correlationId: input.correlationId,
    eventName: input.eventName,
    listingRefs: input.listingRefs,
    orderId: input.orderId,
    sellerUserId: input.sellerUserId,
    timestampText: input.timestampText,
  });
  return `trading:${createHash("sha256").update(identity).digest("hex")}`;
}

/**
 * Parses only the routing and audit fields Records needs. The complete SOAP
 * body and buyer data are deliberately excluded from the returned value.
 */
export function parseEbayTradingNotification(
  xml: string,
): ParsedEbayTradingNotification | null {
  const envelope = parseStrictXmlDocument(xml);
  if (
    !envelope
    || envelope.localName !== "Envelope"
    || !soapNamespaces.has(envelope.namespace)
  ) return null;
  const headers = childNodes(envelope, "Header");
  const bodies = childNodes(envelope, "Body");
  if (headers.length !== 1 || bodies.length !== 1 || bodies[0]!.children.length !== 1) {
    return null;
  }
  const header = headers[0]!;
  const body = bodies[0]!;
  const signatures = descendantNodes(header, "NotificationSignature");
  if (signatures.length !== 1) return null;

  const eventName = descendantText(body, "NotificationEventName");
  if (!supportedEvent(eventName)) return null;
  const timestampText = descendantText(body, "Timestamp");
  const notificationSignature = signatures[0]!.text.trim() || null;
  if (!timestampText || !notificationSignature) return null;
  const eventAt = new Date(timestampText);
  if (Number.isNaN(eventAt.getTime())) return null;

  const itemContainers = descendantNodes(body, "Item");
  const transactionContainers = descendantNodes(body, "Transaction");
  const listingRefs = uniqueListingRefs([
    ...itemContainers.map((item) => ({
      itemId: descendantText(item, "ItemID") ?? "",
      orderLineItemId: descendantText(item, "OrderLineItemID"),
    })),
    ...transactionContainers.map((transaction) => ({
      itemId: descendantText(transaction, "ItemID") ?? "",
      orderLineItemId: descendantText(transaction, "OrderLineItemID"),
    })),
  ].filter((reference) => Boolean(reference.itemId)));
  if (!listingRefs.length) {
    const itemId = descendantText(body, "ItemID");
    if (itemId) listingRefs.push({
      itemId,
      orderLineItemId: descendantText(body, "OrderLineItemID"),
    });
  }
  if (!listingRefs.length) return null;

  const containingOrder = descendantNodes(body, "ContainingOrder")[0];
  const order = descendantNodes(body, "Order")[0];
  const seller = descendantNodes(body, "Seller")[0];
  const orderId = (containingOrder ? descendantText(containingOrder, "OrderID") : null)
    ?? (order ? descendantText(order, "OrderID") : null)
    ?? descendantText(body, "OrderID");
  const correlationId = descendantText(body, "CorrelationID");
  const sellerUserId = descendantText(body, "RecipientUserID")
    ?? (seller ? descendantText(seller, "UserID") : null)
    ?? descendantText(body, "SellerUserID");
  const notificationId = deterministicNotificationId({
    correlationId,
    eventName,
    listingRefs,
    orderId,
    sellerUserId,
    timestampText,
  });

  return {
    correlationId,
    eventAt,
    eventName,
    listingRefs,
    notificationId,
    notificationSignature,
    orderId,
    publishedAt: eventAt,
    sellerUserId,
    timestampText,
    topic: `TRADING_${eventName}`,
  };
}

export function ebayTradingNotificationTimestampIsFresh(
  timestamp: Date,
  now = new Date(),
  allowedClockSkewMs = ebayTradingNotificationClockSkewMs,
) {
  return Math.abs(now.getTime() - timestamp.getTime()) <= allowedClockSkewMs;
}

export function ebayTradingNotificationSignature({
  appId,
  certId,
  devId,
  timestampText,
}: {
  appId: string;
  certId: string;
  devId: string;
  timestampText: string;
}) {
  return createHash("md5")
    .update(`${timestampText}${devId}${appId}${certId}`, "utf8")
    .digest();
}

export function verifyEbayTradingNotificationSignature({
  appId,
  certId,
  devId,
  signature,
  timestampText,
}: {
  appId: string;
  certId: string;
  devId: string;
  signature: string;
  timestampText: string;
}) {
  const normalizedSignature = signature.trim();
  if (
    normalizedSignature.length % 4 !== 0
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(normalizedSignature)
  ) {
    return false;
  }
  let supplied: Buffer;
  try {
    supplied = Buffer.from(normalizedSignature, "base64");
  } catch {
    return false;
  }
  if (supplied.toString("base64") !== normalizedSignature) return false;
  const expected = ebayTradingNotificationSignature({
    appId,
    certId,
    devId,
    timestampText,
  });
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function mergeEbayTradingEventPreferences(
  current: ReadonlyMap<string, string>,
) {
  const merged = new Map(current);
  for (const event of ebayTradingNotificationEvents) merged.set(event, "Enable");
  return merged;
}

/** Every Item in the containing order must cross reconciliation exactly once. */
export function ebayOrderItemIdsFromXml(xml: string, orderId: string) {
  const orderXml = xmlContainers(xml, "Order")
    .find((candidate) => xmlText(candidate, "OrderID") === orderId)
    ?? xml;
  return Array.from(new Set(
    xmlContainers(orderXml, "Item")
      .map((itemXml) => xmlText(itemXml, "ItemID"))
      .filter((itemId): itemId is string => Boolean(itemId)),
  ));
}

export function ebayNotificationReconciliationItemIds(
  listingRefs: ReadonlyArray<{ itemId: string }>,
  containingOrderItemIds: ReadonlyArray<string>,
) {
  return Array.from(new Set([
    ...listingRefs.map((reference) => reference.itemId),
    ...containingOrderItemIds,
  ].filter(Boolean)));
}

function invalidAuthTokenDeliveryMessage(message: string) {
  return message.includes("INVALID_AUTH_TOKEN_STATUS")
    || message.toLowerCase().includes("invalidated token");
}

export function ebayTradingNotificationDeliveryProblem(
  xml: string,
  {
    ignoreInvalidAuthTokenRejections = false,
  }: { ignoreInvalidAuthTokenRejections?: boolean } = {},
) {
  const markedDown = xmlContainers(xml, "MarkUpMarkDownEvent")
    .some((event) => xmlText(event, "Type") === "MarkDown");
  if (markedDown) {
    return "Delivery: eBay reports that this application was marked down after failed notification deliveries.";
  }

  const failedDetail = xmlContainers(xml, "NotificationDetails").find((detail) => {
    const failed = ["Failed", "Rejected", "MarkedDown"].includes(
      xmlText(detail, "DeliveryStatus") ?? "",
    );
    const message = xmlText(detail, "ErrorMessage") ?? "";
    return failed && !(
      ignoreInvalidAuthTokenRejections
      && invalidAuthTokenDeliveryMessage(message)
    );
  });
  if (failedDetail) {
    const status = xmlText(failedDetail, "DeliveryStatus") ?? "failed";
    const message = xmlText(failedDetail, "ErrorMessage") ?? "";
    if (invalidAuthTokenDeliveryMessage(message)) {
      return "Delivery: eBay rejected notification generation because the saved Trading authorization is invalid. Renew Trading authorization from the eBay settings page.";
    }
    return `Delivery: eBay reports a recent ${status.toLowerCase()} Trading notification. ${message.slice(0, 700) || "Review GetNotificationsUsage and retry setup."}`;
  }

  const errorCount = Number(xmlText(xml, "ErrorCount") ?? "0");
  const expiredCount = Number(xmlText(xml, "ExpiredCount") ?? "0");
  if (errorCount > 0 || expiredCount > 0) {
    return `Delivery: eBay reports ${errorCount} recent delivery error${errorCount === 1 ? "" : "s"} and ${expiredCount} expired notification${expiredCount === 1 ? "" : "s"}.`;
  }
  return null;
}

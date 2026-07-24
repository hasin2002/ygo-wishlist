export const supportedEbayNotificationTopics = [
  "LISTING",
  "ORDER_CONFIRMATION",
] as const;

export type SupportedEbayNotificationTopic =
  (typeof supportedEbayNotificationTopics)[number];

export type EbayNotificationListingReference = {
  itemId: string;
  orderLineItemId: string | null;
};

export type ParsedEbayNotification = {
  eventAt: Date | null;
  listingRefs: EbayNotificationListingReference[];
  notificationId: string;
  orderId: string | null;
  publishedAt: Date | null;
  sellerUserId: string | null;
  topic: SupportedEbayNotificationTopic;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function dateValue(value: unknown) {
  const text = stringValue(value);
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function listingReference(
  value: unknown,
): EbayNotificationListingReference | null {
  if (!isRecord(value)) return null;
  const itemId = stringValue(value.listingId)
    ?? stringValue(value.itemId)
    ?? stringValue(value.legacyItemId);
  if (!itemId) return null;
  return {
    itemId,
    orderLineItemId: stringValue(value.orderLineItemId)
      ?? stringValue(value.lineItemId),
  };
}

function uniqueListingReferences(
  values: Array<EbayNotificationListingReference | null>,
) {
  const seen = new Set<string>();
  return values.filter((value): value is EbayNotificationListingReference => {
    if (!value) return false;
    const key = `${value.itemId}\0${value.orderLineItemId ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Extracts only the routing data needed by the application. Buyer details and
 * the rest of the order payload are deliberately not retained.
 */
export function parseEbayNotificationPayload(
  payload: unknown,
): ParsedEbayNotification | null {
  if (!isRecord(payload) || !isRecord(payload.metadata) || !isRecord(payload.notification)) {
    return null;
  }

  const topic = stringValue(payload.metadata.topic);
  if (
    topic !== supportedEbayNotificationTopics[0]
    && topic !== supportedEbayNotificationTopics[1]
  ) {
    return null;
  }

  const notificationId = stringValue(payload.notification.notificationId);
  if (!notificationId) return null;
  const data = isRecord(payload.notification.data)
    ? payload.notification.data
    : {};
  const user = isRecord(data.user) ? data.user : null;
  const order = isRecord(data.order) ? data.order : null;
  const lineItemsValue = order?.orderLineItems ?? order?.lineItems;
  const lineItems = Array.isArray(lineItemsValue) ? lineItemsValue : [];
  const listingRefs = uniqueListingReferences([
    listingReference(data),
    listingReference(data.listing),
    ...lineItems.map(listingReference),
  ]);

  return {
    eventAt: dateValue(payload.notification.eventDate),
    listingRefs,
    notificationId,
    orderId: stringValue(order?.orderId) ?? stringValue(data.orderId),
    publishedAt: dateValue(payload.notification.publishDate),
    sellerUserId: stringValue(user?.username)
      ?? stringValue(user?.userId)
      ?? stringValue(data.sellerUserId),
    topic,
  };
}

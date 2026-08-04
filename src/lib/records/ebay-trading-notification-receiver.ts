import { createHash } from "node:crypto";
import {
  ebayTradingNotificationMaxBytes,
  ebayTradingNotificationTimestampIsFresh,
  type ParsedEbayTradingNotification,
  parseEbayTradingNotification,
  verifyEbayTradingNotificationSignature,
} from "./ebay-trading-notification.ts";

type PersistedReceipt = {
  duplicate: boolean;
  eventId: string | null;
  process: boolean;
};

type ReceiverDependencies = {
  credentials: { appId: string; certId: string; devId: string } | null;
  now?: Date;
  persist: (input: {
    parsed: ParsedEbayTradingNotification;
    payloadHash: string;
  }) => Promise<PersistedReceipt>;
  process: (eventId: string) => Promise<unknown>;
};

export type EbayTradingNotificationReceipt = {
  body: Record<string, boolean | string>;
  postResponse: (() => Promise<void>) | null;
  status: number;
};

class OversizedTradingNotificationError extends Error {}

async function boundedRequestText(request: Request) {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > ebayTradingNotificationMaxBytes) {
    throw new OversizedTradingNotificationError();
  }
  if (!request.body) return "";

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let byteLength = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > ebayTradingNotificationMaxBytes) {
        throw new OversizedTradingNotificationError();
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    reader.releaseLock();
  }
}

function failure(status: number, error: string): EbayTradingNotificationReceipt {
  return { body: { error }, postResponse: null, status };
}

export async function receiveEbayTradingNotification(
  request: Request,
  dependencies: ReceiverDependencies,
): Promise<EbayTradingNotificationReceipt> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim();
  if (!contentType || ![
    "text/xml",
    "application/xml",
    "application/soap+xml",
  ].includes(contentType)) {
    return failure(415, "Expected an eBay SOAP notification.");
  }

  let rawBody: string;
  try {
    rawBody = await boundedRequestText(request);
  } catch (error) {
    if (error instanceof OversizedTradingNotificationError) {
      return failure(413, "Notification payload is too large.");
    }
    return failure(400, "Notification XML is not valid UTF-8.");
  }

  const parsed = parseEbayTradingNotification(rawBody);
  if (!parsed) {
    return failure(400, "Malformed, unsupported, or incomplete eBay SOAP notification.");
  }
  if (!ebayTradingNotificationTimestampIsFresh(parsed.eventAt, dependencies.now)) {
    return failure(412, "The eBay notification timestamp is stale.");
  }
  if (!dependencies.credentials) {
    return failure(503, "Trading notification verification is not configured.");
  }
  if (!verifyEbayTradingNotificationSignature({
    ...dependencies.credentials,
    signature: parsed.notificationSignature,
    timestampText: parsed.timestampText,
  })) {
    return failure(412, "Invalid eBay notification signature.");
  }

  let persisted: PersistedReceipt;
  try {
    persisted = await dependencies.persist({
      parsed,
      payloadHash: createHash("sha256").update(rawBody).digest("hex"),
    });
  } catch {
    return failure(503, "The notification could not be stored yet.");
  }

  const eventId = persisted.process ? persisted.eventId : null;
  return {
    body: { accepted: true, duplicate: persisted.duplicate },
    postResponse: eventId
      ? async () => { await dependencies.process(eventId); }
      : null,
    status: 200,
  };
}

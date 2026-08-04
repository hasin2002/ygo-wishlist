import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ebayTradingNotificationDeliveryProblem,
  ebayTradingNotificationEvents,
  ebayTradingNotificationMaxBytes,
  ebayTradingNotificationSignature,
  ebayTradingNotificationTimestampIsFresh,
  ebayNotificationReconciliationItemIds,
  ebayOrderItemIdsFromXml,
  mergeEbayTradingEventPreferences,
  parseEbayTradingNotification,
  verifyEbayTradingNotificationSignature,
} from "../src/lib/records/ebay-trading-notification.ts";
import {
  ebayPurchaseNotificationNeedsRetry,
} from "../src/lib/records/ebay-notification-processing.ts";
import {
  ebayTradingAuthTokenKeysetHeaders,
  ebayTradingRequestAuthentication,
} from "../src/lib/records/ebay-trading-request.ts";
import {
  receiveEbayTradingNotification,
} from "../src/lib/records/ebay-trading-notification-receiver.ts";

const credentials = {
  appId: "app-id",
  certId: "cert-id",
  devId: "dev-id",
};

function soapNotification({
  eventName,
  extra = "",
  itemId = "110000000001",
  timestampText = "2026-08-04T12:00:00.000Z",
}: {
  eventName: string;
  extra?: string;
  itemId?: string;
  timestampText?: string;
}) {
  const signature = ebayTradingNotificationSignature({
    ...credentials,
    timestampText,
  }).toString("base64");
  return `<?xml version="1.0" encoding="utf-8"?>
    <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ebl="urn:ebay:apis:eBLBaseComponents">
      <soapenv:Header><ebl:RequesterCredentials><ebl:NotificationSignature>${signature}</ebl:NotificationSignature></ebl:RequesterCredentials></soapenv:Header>
      <soapenv:Body><ebl:GetItemTransactionsResponse>
        <ebl:Timestamp>${timestampText}</ebl:Timestamp>
        <ebl:NotificationEventName>${eventName}</ebl:NotificationEventName>
        <ebl:CorrelationID>correlation-1</ebl:CorrelationID>
        <ebl:RecipientUserID>seller-one</ebl:RecipientUserID>
        <ebl:Item><ebl:ItemID>${itemId}</ebl:ItemID></ebl:Item>
        ${extra}
      </ebl:GetItemTransactionsResponse></soapenv:Body>
    </soapenv:Envelope>`;
}

test("parses all five namespace-qualified Trading events without buyer data", () => {
  for (const eventName of ebayTradingNotificationEvents) {
    const parsed = parseEbayTradingNotification(soapNotification({ eventName }));
    assert.ok(parsed, eventName);
    assert.equal(parsed.eventName, eventName);
    assert.equal(parsed.topic, `TRADING_${eventName}`);
    assert.equal(parsed.sellerUserId, "seller-one");
    assert.deepEqual(parsed.listingRefs, [{
      itemId: "110000000001",
      orderLineItemId: null,
    }]);
    assert.match(parsed.notificationId, /^trading:[a-f0-9]{64}$/);
    assert.equal("buyer" in parsed, false);
  }
});

test("extracts the containing order used for a multi-line checkout", () => {
  const parsed = parseEbayTradingNotification(soapNotification({
    eventName: "AuctionCheckoutComplete",
    extra: "<ebl:Transaction><ebl:OrderLineItemID>line-1</ebl:OrderLineItemID><ebl:ContainingOrder><ebl:OrderID>order-1</ebl:OrderID></ebl:ContainingOrder></ebl:Transaction>",
  }));
  assert.ok(parsed);
  assert.equal(parsed.orderId, "order-1");
});

test("multi-line checkout resolves and reconciles every distinct containing-order item", () => {
  const getOrdersXml = `<GetOrdersResponse xmlns="urn:ebay:apis:eBLBaseComponents">
    <OrderArray>
      <Order><OrderID>another-order</OrderID><TransactionArray>
        <Transaction><Item><ItemID>900</ItemID></Item></Transaction>
      </TransactionArray></Order>
      <Order><OrderID>order-1</OrderID><TransactionArray>
        <Transaction><Item><ItemID>111</ItemID></Item></Transaction>
        <Transaction><Item><ItemID>222</ItemID></Item></Transaction>
        <Transaction><Item><ItemID>222</ItemID></Item></Transaction>
      </TransactionArray></Order>
    </OrderArray>
  </GetOrdersResponse>`;
  const containingOrderItemIds = ebayOrderItemIdsFromXml(getOrdersXml, "order-1");
  assert.deepEqual(containingOrderItemIds, ["111", "222"]);
  assert.deepEqual(ebayNotificationReconciliationItemIds(
    [{ itemId: "111" }],
    containingOrderItemIds,
  ), ["111", "222"]);
});

test("verifies the prescribed signature and rejects altered timestamps", () => {
  const timestampText = "2026-08-04T12:00:00.000Z";
  const signature = ebayTradingNotificationSignature({
    ...credentials,
    timestampText,
  }).toString("base64");
  assert.equal(verifyEbayTradingNotificationSignature({
    ...credentials,
    signature,
    timestampText,
  }), true);
  assert.equal(verifyEbayTradingNotificationSignature({
    ...credentials,
    signature,
    timestampText: "2026-08-04T12:00:01.000Z",
  }), false);
  assert.equal(verifyEbayTradingNotificationSignature({
    ...credentials,
    signature: "not-base64!",
    timestampText,
  }), false);
});

test("accepts only eBay's documented ten-minute timestamp window", () => {
  const now = new Date("2026-08-04T12:00:00.000Z");
  assert.equal(ebayTradingNotificationTimestampIsFresh(
    new Date("2026-08-04T11:50:00.000Z"),
    now,
  ), true);
  assert.equal(ebayTradingNotificationTimestampIsFresh(
    new Date("2026-08-04T11:49:59.999Z"),
    now,
  ), false);
  assert.equal(ebayTradingNotificationTimestampIsFresh(
    new Date("2026-08-04T12:10:00.001Z"),
    now,
  ), false);
});

test("rejects malformed, unsupported, and entity-bearing XML", () => {
  assert.equal(parseEbayTradingNotification("not xml"), null);
  assert.equal(parseEbayTradingNotification(soapNotification({
    eventName: "Feedback",
  })), null);
  assert.equal(parseEbayTradingNotification(
    `<!DOCTYPE x [<!ENTITY secret SYSTEM "file:///etc/passwd">]>${soapNotification({ eventName: "ItemClosed" })}`,
  ), null);
  assert.equal(parseEbayTradingNotification(
    soapNotification({ eventName: "ItemClosed" })
      .replace("</ebl:GetItemTransactionsResponse></soapenv:Body>", "</soapenv:Body></ebl:GetItemTransactionsResponse>"),
  ), null);
});

test("preference merging enables owned events and preserves unrelated settings", () => {
  const merged = mergeEbayTradingEventPreferences(new Map([
    ["Feedback", "Enable"],
    ["AskSellerQuestion", "Disable"],
    ["ItemClosed", "Disable"],
  ]));
  assert.equal(merged.get("Feedback"), "Enable");
  assert.equal(merged.get("AskSellerQuestion"), "Disable");
  for (const event of ebayTradingNotificationEvents) {
    assert.equal(merged.get(event), "Enable");
  }
});

test("notification setup isolates Auth'n'Auth from ordinary OAuth Trading calls", () => {
  const legacy = ebayTradingRequestAuthentication({
    authToken: "legacy<&token",
  });
  assert.deepEqual(legacy.authorizationHeaders, {});
  assert.equal(
    legacy.requesterCredentialsXml,
    "<RequesterCredentials><eBayAuthToken>legacy&lt;&amp;token</eBayAuthToken></RequesterCredentials>",
  );

  const oauth = ebayTradingRequestAuthentication({ oauthAccessToken: "oauth-token" });
  assert.deepEqual(oauth.authorizationHeaders, {
    "X-EBAY-API-IAF-TOKEN": "oauth-token",
  });
  assert.equal(oauth.requesterCredentialsXml, "");
  assert.throws(() => ebayTradingRequestAuthentication({}), /exactly one/);
  assert.throws(() => ebayTradingRequestAuthentication({
    authToken: "legacy",
    oauthAccessToken: "oauth",
  }), /exactly one/);

  assert.deepEqual(ebayTradingAuthTokenKeysetHeaders({
    appId: "app-id",
    authToken: "legacy-token",
    callName: "GetTokenStatus",
    certId: "cert-id",
    devId: "dev-id",
  }), {
    "X-EBAY-API-APP-NAME": "app-id",
    "X-EBAY-API-CERT-NAME": "cert-id",
    "X-EBAY-API-DEV-NAME": "dev-id",
  });
  assert.deepEqual(ebayTradingAuthTokenKeysetHeaders({
    appId: "app-id",
    authToken: "legacy-token",
    callName: "GetUser",
    certId: "cert-id",
    devId: "dev-id",
  }), {});
  assert.throws(() => ebayTradingAuthTokenKeysetHeaders({
    authToken: "legacy-token",
    callName: "GetTokenStatus",
  }), /AppID, DevID, and CertID/);
});

test("delivery health detects a rejected event even when aggregate errors are zero", () => {
  const rejected = `<GetNotificationsUsageResponse>
    <NotificationDetailsArray><NotificationDetails>
      <Type>ItemClosed</Type><DeliveryStatus>Rejected</DeliveryStatus>
      <ErrorMessage>INVALID_AUTH_TOKEN_STATUS:Invalidated token: Token does not exist</ErrorMessage>
    </NotificationDetails></NotificationDetailsArray>
    <NotificationStatistics><DeliveredCount>0</DeliveredCount><ErrorCount>0</ErrorCount><ExpiredCount>0</ExpiredCount></NotificationStatistics>
  </GetNotificationsUsageResponse>`;
  assert.match(
    ebayTradingNotificationDeliveryProblem(rejected) ?? "",
    /saved Trading authorization/,
  );
  assert.equal(ebayTradingNotificationDeliveryProblem(rejected, {
    ignoreInvalidAuthTokenRejections: true,
  }), null);
  assert.equal(ebayTradingNotificationDeliveryProblem(`
    <GetNotificationsUsageResponse><NotificationStatistics>
      <DeliveredCount>1</DeliveredCount><ErrorCount>0</ErrorCount><ExpiredCount>0</ExpiredCount>
    </NotificationStatistics></GetNotificationsUsageResponse>
  `), null);
});

test("purchase notifications retry until authoritative sale state appears", () => {
  assert.equal(ebayPurchaseNotificationNeedsRetry(
    "TRADING_FixedPriceTransaction",
    [{ quantitySold: 0, saleState: "none" }],
  ), true);
  assert.equal(ebayPurchaseNotificationNeedsRetry(
    "TRADING_AuctionCheckoutComplete",
    [{ quantitySold: 1, saleState: "pending" }],
  ), false);
  assert.equal(ebayPurchaseNotificationNeedsRetry(
    "TRADING_ItemClosed",
    [{ quantitySold: 0, saleState: "none" }],
  ), false);
});

test("identical deliveries have a deterministic transport-prefixed identity", () => {
  const first = parseEbayTradingNotification(soapNotification({ eventName: "ItemRevised" }));
  const second = parseEbayTradingNotification(soapNotification({ eventName: "ItemRevised" }));
  assert.ok(first && second);
  assert.equal(first.notificationId, second.notificationId);
});

test("the receiver persists a valid signed event before deferring reconciliation", async () => {
  const calls: string[] = [];
  let storedHash: string | null = null;
  const receipt = await receiveEbayTradingNotification(new Request("https://example.test", {
    body: soapNotification({ eventName: "ItemClosed" }),
    headers: { "Content-Type": "text/xml; charset=utf-8" },
    method: "POST",
  }), {
    credentials,
    now: new Date("2026-08-04T12:00:00.000Z"),
    persist: async ({ parsed, payloadHash }) => {
      calls.push(`persist:${parsed.eventName}`);
      storedHash = payloadHash;
      return { duplicate: false, eventId: "event-1", process: true };
    },
    process: async (eventId) => { calls.push(`process:${eventId}`); },
  });
  assert.equal(receipt.status, 200);
  assert.deepEqual(receipt.body, { accepted: true, duplicate: false });
  assert.deepEqual(calls, ["persist:ItemClosed"]);
  assert.match(storedHash ?? "", /^[a-f0-9]{64}$/);
  assert.ok(receipt.postResponse);
  await receipt.postResponse();
  assert.deepEqual(calls, ["persist:ItemClosed", "process:event-1"]);
});

test("the receiver handles duplicate and storage-failure acknowledgement safely", async () => {
  const request = () => new Request("https://example.test", {
    body: soapNotification({ eventName: "ItemRevised" }),
    headers: { "Content-Type": "application/soap+xml" },
    method: "POST",
  });
  const duplicate = await receiveEbayTradingNotification(request(), {
    credentials,
    now: new Date("2026-08-04T12:00:00.000Z"),
    persist: async () => ({ duplicate: true, eventId: null, process: false }),
    process: async () => assert.fail("duplicates are not processed again"),
  });
  assert.equal(duplicate.status, 200);
  assert.deepEqual(duplicate.body, { accepted: true, duplicate: true });
  assert.equal(duplicate.postResponse, null);

  const unavailable = await receiveEbayTradingNotification(request(), {
    credentials,
    now: new Date("2026-08-04T12:00:00.000Z"),
    persist: async () => { throw new Error("database unavailable"); },
    process: async () => undefined,
  });
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.postResponse, null);
});

test("the receiver rejects unsupported content, bad signatures, stale events, invalid UTF-8, and oversized bodies", async () => {
  const dependencies = {
    credentials,
    now: new Date("2026-08-04T12:00:00.000Z"),
    persist: async () => {
      assert.fail("invalid requests must not reach persistence");
      return { duplicate: false, eventId: null, process: false };
    },
    process: async () => undefined,
  };
  const unsupported = await receiveEbayTradingNotification(new Request("https://example.test", {
    body: "{}",
    headers: { "Content-Type": "application/json" },
    method: "POST",
  }), dependencies);
  assert.equal(unsupported.status, 415);

  const badSignatureXml = soapNotification({ eventName: "ItemClosed" })
    .replace(/<ebl:NotificationSignature>[^<]+/, "<ebl:NotificationSignature>bm90LXZhbGlk");
  const badSignature = await receiveEbayTradingNotification(new Request("https://example.test", {
    body: badSignatureXml,
    headers: { "Content-Type": "text/xml" },
    method: "POST",
  }), dependencies);
  assert.equal(badSignature.status, 412);

  const stale = await receiveEbayTradingNotification(new Request("https://example.test", {
    body: soapNotification({
      eventName: "ItemClosed",
      timestampText: "2026-08-04T11:49:59.999Z",
    }),
    headers: { "Content-Type": "text/xml" },
    method: "POST",
  }), dependencies);
  assert.equal(stale.status, 412);

  const invalidUtf8 = await receiveEbayTradingNotification(new Request("https://example.test", {
    body: new Uint8Array([0xff]),
    headers: { "Content-Type": "text/xml" },
    method: "POST",
  }), dependencies);
  assert.equal(invalidUtf8.status, 400);

  const oversized = await receiveEbayTradingNotification(new Request("https://example.test", {
    body: "<Envelope/>",
    headers: {
      "Content-Length": String(ebayTradingNotificationMaxBytes + 1),
      "Content-Type": "text/xml",
    },
    method: "POST",
  }), dependencies);
  assert.equal(oversized.status, 413);
});

test("the SOAP route schedules only already-persisted post-response work", () => {
  const route = readFileSync(new URL(
    "../src/app/api/ebay/trading-notifications/route.ts",
    import.meta.url,
  ), "utf8");
  assert.match(route, /await receiveEbayTradingNotification/);
  assert.match(route, /if \(receipt\.postResponse\)/);
  assert.match(route, /after\(async/);
});

test("failed post-response reconciliation remains queued for the authenticated daily retry", () => {
  const service = readFileSync(new URL(
    "../src/server/ebay-notification-service.ts",
    import.meta.url,
  ), "utf8");
  const cron = readFileSync(new URL(
    "../src/app/api/cron/reconcile-ebay-listings/route.ts",
    import.meta.url,
  ), "utf8");
  assert.match(service, /processingStatus: "failed"/);
  assert.match(service, /nextAttemptAt/);
  assert.match(service, /eq\(ebayNotificationEvents\.processingStatus, "pending"\)/);
  assert.match(service, /eq\(ebayNotificationEvents\.processingStatus, "failed"\)/);
  assert.match(cron, /retryDueEbayNotificationEvents/);
  assert.match(cron, /reconcileDueEbayListings/);
  assert.match(cron, /authorization !== `Bearer \$\{cronSecret\}`/);
});

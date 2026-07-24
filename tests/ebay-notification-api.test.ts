import assert from "node:assert/strict";
import { generateKeyPairSync, createSign } from "node:crypto";
import test from "node:test";
import {
  classifyEbayNotificationCapabilities,
  createEbayNotificationClient,
  decodeEbayNotificationSignature,
  ebayFulfillmentReadonlyScope,
  ebayListingReadScope,
  ebayNotificationSubscriptionScope,
  notificationPayloadFromTopic,
  verifyEbayNotificationSignature,
} from "../src/server/ebay-notification-api.ts";

test("classifies seller notification topics and the additional user subscription consent", () => {
  const topics = [
    {
      authorizationScopes: [ebayListingReadScope],
      scope: "USER",
      status: "ENABLED",
      topicId: "LISTING",
    },
    {
      authorizationScopes: [ebayFulfillmentReadonlyScope],
      scope: "USER",
      status: "ENABLED",
      topicId: "ORDER_CONFIRMATION",
    },
  ];

  const capabilities = classifyEbayNotificationCapabilities(topics, [
    ebayNotificationSubscriptionScope,
    ebayListingReadScope,
  ]);

  assert.deepEqual(capabilities.map((capability) => ({
    available: capability.available,
    missingScopes: capability.missingScopes,
    topicId: capability.topicId,
  })), [
    { available: true, missingScopes: [], topicId: "LISTING" },
    { available: true, missingScopes: [ebayFulfillmentReadonlyScope], topicId: "ORDER_CONFIRMATION" },
  ]);
});

test("selects a JSON HTTPS payload only from eBay's advertised supported payloads", () => {
  assert.deepEqual(notificationPayloadFromTopic({
    supportedPayloads: [
      { deliveryProtocol: "HTTPS", format: ["JSON"], schemaVersion: "1.0" },
    ],
    topicId: "LISTING",
  }), {
    deliveryProtocol: "HTTPS",
    format: "JSON",
    schemaVersion: "1.0",
  });
  assert.equal(notificationPayloadFromTopic({ topicId: "LISTING" }), null);
});

test("uses eBay's destination and subscription request shapes", async () => {
  const requests: Array<{ body: unknown; method: string; url: string }> = [];
  const client = createEbayNotificationClient({
    accessToken: "access-token",
    fetchImpl: async (input, init) => {
      requests.push({
        body: init?.body ? JSON.parse(String(init.body)) : null,
        method: init?.method ?? "GET",
        url: String(input),
      });
      return new Response(JSON.stringify(
        String(input).endsWith("/destination")
          ? { destinationId: "destination-1", deliveryConfig: { endpoint: "https://example.test/ebay" }, name: "YGO", status: "ENABLED" }
          : { subscriptionId: "subscription-1", destinationId: "destination-1", topicId: "LISTING", status: "ENABLED" },
      ), { status: 200 });
    },
  });

  await client.createDestination({
    endpoint: "https://example.test/api/ebay/notifications",
    name: "YGO listing updates",
    verificationToken: "a".repeat(32),
  });
  await client.createSubscription({
    destinationId: "destination-1",
    payload: { deliveryProtocol: "HTTPS", format: "JSON", schemaVersion: "1.0" },
    topicId: "LISTING",
  });

  assert.deepEqual(requests, [
    {
      body: {
        deliveryConfig: { endpoint: "https://example.test/api/ebay/notifications", verificationToken: "a".repeat(32) },
        name: "YGO listing updates",
        status: "ENABLED",
      },
      method: "POST",
      url: "https://api.ebay.com/commerce/notification/v1/destination",
    },
    {
      body: {
        destinationId: "destination-1",
        payload: { deliveryProtocol: "HTTPS", format: "JSON", schemaVersion: "1.0" },
        status: "ENABLED",
        topicId: "LISTING",
      },
      method: "POST",
      url: "https://api.ebay.com/commerce/notification/v1/subscription",
    },
  ]);
});

test("creates eBay's required application-level notification configuration", async () => {
  const requests: Array<{ body: unknown; method: string; url: string }> = [];
  const client = createEbayNotificationClient({
    accessToken: "application-access-token",
    fetchImpl: async (input, init) => {
      requests.push({
        body: init?.body ? JSON.parse(String(init.body)) : null,
        method: init?.method ?? "GET",
        url: String(input),
      });
      return new Response(null, { status: 204 });
    },
  });

  await client.updateConfig("notifications@example.com");

  assert.deepEqual(requests, [{
    body: { alertEmail: "notifications@example.com" },
    method: "PUT",
    url: "https://api.ebay.com/commerce/notification/v1/config",
  }]);
});

test("retrieves a subscription by its URL-encoded eBay ID", async () => {
  const requests: Array<{ method: string; url: string }> = [];
  const client = createEbayNotificationClient({
    accessToken: "seller-access-token",
    fetchImpl: async (input, init) => {
      requests.push({
        method: init?.method ?? "GET",
        url: String(input),
      });
      return Response.json({
        destinationId: "destination-1",
        status: "DISABLED",
        subscriptionId: "subscription/id",
        topicId: "ORDER_CONFIRMATION",
      });
    },
  });

  const subscription = await client.getSubscription("subscription/id");

  assert.equal(subscription.topicId, "ORDER_CONFIRMATION");
  assert.deepEqual(requests, [{
    method: "GET",
    url: "https://api.ebay.com/commerce/notification/v1/subscription/subscription%2Fid",
  }]);
});

test("reads created destination and subscription IDs from eBay Location headers", async () => {
  let requestCount = 0;
  const client = createEbayNotificationClient({
    accessToken: "access-token",
    fetchImpl: async () => {
      requestCount += 1;
      return new Response(null, {
        headers: {
          Location: requestCount === 1
            ? "https://api.ebay.com/commerce/notification/v1/destination/destination-from-header"
            : "/commerce/notification/v1/subscription/subscription-from-header",
        },
        status: 201,
      });
    },
  });

  const destination = await client.createDestination({
    endpoint: "https://example.test/api/ebay/notifications",
    name: "YGO listing updates",
    verificationToken: "a".repeat(32),
  });
  const subscription = await client.createSubscription({
    destinationId: destination.destinationId,
    payload: { deliveryProtocol: "HTTPS", format: "JSON", schemaVersion: "1.0" },
    topicId: "LISTING",
  });

  assert.equal(destination.destinationId, "destination-from-header");
  assert.equal(subscription.subscriptionId, "subscription-from-header");
});

test("rejects non-public destinations and malformed verification tokens before any request", async () => {
  const client = createEbayNotificationClient({ accessToken: "access-token" });
  await assert.rejects(
    client.createDestination({ endpoint: "http://localhost:3000/webhook", name: "local", verificationToken: "short" }),
    /public HTTPS endpoint/,
  );
});

test("verifies the exact notification body with the decoded eBay ECC header", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const exactBody = '{"metadata":{"topic":"LISTING"},"notification":{"notificationId":"one"}}';
  const signer = createSign("sha1");
  signer.update(exactBody);
  signer.end();
  const signatureHeader = Buffer.from(JSON.stringify({
    kid: "ebay-key-1",
    signature: signer.sign(privateKey, "base64"),
  })).toString("base64");

  assert.deepEqual(decodeEbayNotificationSignature(signatureHeader), {
    kid: "ebay-key-1",
    signature: decodeEbayNotificationSignature(signatureHeader).signature,
  });
  assert.equal(verifyEbayNotificationSignature({
    publicKey: { digest: "SHA1", key: publicKey.export({ format: "pem", type: "spki" }).toString() },
    rawBody: exactBody,
    signatureHeader,
  }), true);
  assert.equal(verifyEbayNotificationSignature({
    publicKey: { digest: "SHA1", key: publicKey.export({ format: "pem", type: "spki" }).toString() },
    rawBody: `${exactBody}\n`,
    signatureHeader,
  }), false);
});

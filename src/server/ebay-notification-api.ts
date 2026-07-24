import {
  createVerify,
} from "node:crypto";
import {
  ebayFulfillmentReadonlyScope,
  ebayFulfillmentScope,
  ebayListingReadScope,
  ebayNotificationSubscriptionScope,
} from "../lib/records/ebay-oauth-scopes.ts";

export {
  ebayFulfillmentReadonlyScope,
  ebayFulfillmentScope,
  ebayListingReadScope,
  ebayNotificationSubscriptionScope,
} from "../lib/records/ebay-oauth-scopes.ts";

const productionBaseUrl = "https://api.ebay.com/commerce/notification/v1";
const sandboxBaseUrl = "https://api.sandbox.ebay.com/commerce/notification/v1";
const publicKeyCacheLifetimeMs = 60 * 60 * 1_000;
const publicKeyCache = new Map<string, {
  expiresAt: number;
  publicKey: EbayNotificationPublicKey;
}>();

export const ebayNotificationTopics = ["LISTING", "ORDER_CONFIRMATION"] as const;
export type EbayNotificationTopicId = typeof ebayNotificationTopics[number];

export type EbayNotificationPayload = {
  deliveryProtocol: "HTTPS" | string;
  format: "JSON" | string;
  schemaVersion: string;
};

export type EbayNotificationTopic = {
  authorizationScopes?: string[];
  description?: string;
  scope?: "APPLICATION" | "USER" | string;
  status?: "ENABLED" | "DISABLED" | string;
  supportedPayloads?: Array<{
    deliveryProtocol?: string;
    format?: string[];
    schemaVersion?: string;
  }>;
  topicId: string;
};

export type EbayNotificationCapability = {
  available: boolean;
  authorizationCodeScopes: string[];
  missingScopes: string[];
  observedTopic: EbayNotificationTopic | null;
  requiredAnyOfScopes: string[];
  subscriptionScope: "USER";
  topicId: EbayNotificationTopicId;
};

export type EbayNotificationDestinationInput = {
  endpoint: string;
  name: string;
  status?: "ENABLED" | "DISABLED";
  verificationToken: string;
};

export type EbayNotificationSubscriptionInput = {
  destinationId: string;
  payload: EbayNotificationPayload;
  status?: "ENABLED" | "DISABLED";
  topicId: string;
};

export type EbayNotificationDestination = {
  deliveryConfig: { endpoint: string };
  destinationId: string;
  name: string;
  status: "ENABLED" | "DISABLED" | "MARKED_DOWN" | string;
};

export type EbayNotificationSubscription = {
  destinationId: string;
  status: "ENABLED" | "DISABLED" | string;
  subscriptionId: string;
  topicId: string;
};

type EbayDestinationSearchResponse = {
  destinations?: EbayNotificationDestination[];
};

type EbaySubscriptionSearchResponse = {
  subscriptions?: EbayNotificationSubscription[];
};

type EbayNotificationConfig = {
  alertEmail?: string;
};

export type EbayNotificationPublicKey = {
  algorithm?: string;
  digest?: string;
  key: string;
};

export type EbayNotificationSignature = {
  kid: string;
  signature: string;
};

export class EbayNotificationApiError extends Error {
  readonly errorId: number | null;
  readonly status: number;

  constructor(
    message: string,
    status: number,
    errorId: number | null = null,
  ) {
    super(message);
    this.name = "EbayNotificationApiError";
    this.status = status;
    this.errorId = errorId;
  }
}

function notificationBaseUrl(environment: "production" | "sandbox") {
  return environment === "sandbox" ? sandboxBaseUrl : productionBaseUrl;
}

function normalizedScopes(scopes: Iterable<string>) {
  return new Set([...scopes].map((scope) => scope.trim()).filter(Boolean));
}

function topicScopeOptions(topicId: EbayNotificationTopicId) {
  switch (topicId) {
    case "LISTING":
      return [ebayListingReadScope];
    case "ORDER_CONFIRMATION":
      // eBay documents these as the two permitted Fulfillment scopes. The
      // readonly variant is sufficient for this receive-only notification.
      return [ebayFulfillmentScope, ebayFulfillmentReadonlyScope];
  }
}

/**
 * Classifies the two seller-reconciliation topics without assuming that a
 * topic exposed by eBay is usable by the current user grant. User-based
 * subscriptions need the notification subscription scope as well as one of
 * the topic's listed seller scopes.
 */
export function classifyEbayNotificationCapabilities(
  topics: EbayNotificationTopic[],
  grantedScopes: Iterable<string> = [],
): EbayNotificationCapability[] {
  const granted = normalizedScopes(grantedScopes);

  return ebayNotificationTopics.map((topicId) => {
    const observedTopic = topics.find((topic) => topic.topicId === topicId) ?? null;
    const requiredAnyOfScopes = observedTopic?.authorizationScopes?.length
      ? observedTopic.authorizationScopes
      : topicScopeOptions(topicId);
    const subscriptionScopePresent = granted.has(ebayNotificationSubscriptionScope);
    const topicScopePresent = requiredAnyOfScopes.some((scope) => granted.has(scope));
    const missingScopes = [
      ...(subscriptionScopePresent ? [] : [ebayNotificationSubscriptionScope]),
      ...(topicScopePresent ? [] : requiredAnyOfScopes),
    ];

    return {
      available: observedTopic?.status !== "DISABLED" && observedTopic !== null,
      authorizationCodeScopes: [ebayNotificationSubscriptionScope, ...requiredAnyOfScopes],
      missingScopes,
      observedTopic,
      requiredAnyOfScopes,
      subscriptionScope: "USER",
      topicId,
    };
  });
}

export function notificationPayloadFromTopic(topic: EbayNotificationTopic): EbayNotificationPayload | null {
  const payload = topic.supportedPayloads?.find((candidate) => (
    candidate.schemaVersion
    && candidate.format?.includes("JSON")
    && candidate.deliveryProtocol === "HTTPS"
  ));
  if (!payload?.schemaVersion) return null;

  return {
    deliveryProtocol: "HTTPS",
    format: "JSON",
    schemaVersion: payload.schemaVersion,
  };
}

function validateDestination(input: EbayNotificationDestinationInput) {
  let endpoint: URL;
  try {
    endpoint = new URL(input.endpoint);
  } catch {
    throw new TypeError("eBay notification destinations require a valid HTTPS endpoint.");
  }

  if (endpoint.protocol !== "https:" || endpoint.hostname === "localhost" || isPrivateIpv4(endpoint.hostname)) {
    throw new TypeError("eBay notification destinations must use a public HTTPS endpoint.");
  }
  if (!/^[A-Za-z0-9_-]{32,80}$/.test(input.verificationToken)) {
    throw new TypeError("eBay notification verification tokens must be 32-80 alphanumeric, underscore, or hyphen characters.");
  }
  if (!input.name.trim()) throw new TypeError("eBay notification destinations require a name.");
}

function isPrivateIpv4(hostname: string) {
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) return false;
  const values = parts.map(Number);
  if (values.some((value) => value < 0 || value > 255)) return false;
  return values[0] === 10
    || values[0] === 127
    || values[0] === 0
    || (values[0] === 169 && values[1] === 254)
    || (values[0] === 172 && values[1]! >= 16 && values[1]! <= 31)
    || (values[0] === 192 && values[1] === 168);
}

function createApiError(response: Response, body: unknown) {
  const record = isRecord(body) ? body : null;
  const firstError = Array.isArray(record?.errors) && isRecord(record.errors[0]) ? record.errors[0] : null;
  const errorId = typeof firstError?.errorId === "number" ? firstError.errorId : null;
  const eBayMessage = typeof firstError?.message === "string" ? firstError.message : null;
  return new EbayNotificationApiError(
    eBayMessage ? `eBay Notification API request failed (${response.status}): ${eBayMessage}` : `eBay Notification API request failed (${response.status}).`,
    response.status,
    errorId,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseTopics(body: unknown): EbayNotificationTopic[] {
  if (Array.isArray(body)) return body.filter(isRecord) as EbayNotificationTopic[];
  if (isRecord(body) && Array.isArray(body.topics)) return body.topics.filter(isRecord) as EbayNotificationTopic[];
  return [];
}

export function decodeEbayNotificationSignature(signatureHeader: string): EbayNotificationSignature {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(signatureHeader, "base64").toString("utf8"));
  } catch {
    throw new TypeError("eBay notification signature header is not valid Base64 JSON.");
  }
  if (!isRecord(parsed) || typeof parsed.kid !== "string" || typeof parsed.signature !== "string") {
    throw new TypeError("eBay notification signature header does not include a key ID and signature.");
  }
  return { kid: parsed.kid, signature: parsed.signature };
}

function formatPublicKey(key: string) {
  const trimmed = key.trim();
  if (!trimmed.includes("-----BEGIN PUBLIC KEY-----") || !trimmed.includes("-----END PUBLIC KEY-----")) {
    throw new TypeError("eBay notification public key is not PEM encoded.");
  }
  if (trimmed.includes("\n")) return trimmed;
  return trimmed
    .replace("-----BEGIN PUBLIC KEY-----", "-----BEGIN PUBLIC KEY-----\n")
    .replace("-----END PUBLIC KEY-----", "\n-----END PUBLIC KEY-----");
}

function digestAlgorithm(digest: string | undefined) {
  const normalized = (digest ?? "SHA1").replaceAll("-", "").toUpperCase();
  if (normalized === "SHA1" || normalized === "SSL3SHA1") return "sha1";
  if (normalized === "SHA256") return "sha256";
  if (normalized === "SHA384") return "sha384";
  if (normalized === "SHA512") return "sha512";
  throw new TypeError(`Unsupported eBay notification signature digest: ${digest}.`);
}

/**
 * Verifies the exact bytes received from eBay. Do not parse and stringify the
 * request JSON before calling this helper: eBay signs the original payload.
 */
export function verifyEbayNotificationSignature({
  publicKey,
  rawBody,
  signatureHeader,
}: {
  publicKey: EbayNotificationPublicKey;
  rawBody: string | Uint8Array;
  signatureHeader: string;
}) {
  const signature = decodeEbayNotificationSignature(signatureHeader);
  const verifier = createVerify(digestAlgorithm(publicKey.digest));
  verifier.update(rawBody);
  verifier.end();
  return verifier.verify(formatPublicKey(publicKey.key), signature.signature, "base64");
}

export function createEbayNotificationClient({
  accessToken,
  environment = "production",
  fetchImpl = fetch,
}: {
  accessToken: string;
  environment?: "production" | "sandbox";
  fetchImpl?: typeof fetch;
}) {
  if (!accessToken.trim()) throw new TypeError("An eBay access token is required.");
  const baseUrl = notificationBaseUrl(environment);

  async function request<T>(path: string, init: RequestInit = {}) {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
    const text = await response.text();
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        if (response.ok) throw new EbayNotificationApiError("eBay Notification API returned an invalid JSON response.", response.status);
      }
    }
    if (!response.ok) throw createApiError(response, body);
    return {
      body: body as T,
      location: response.headers.get("location"),
    };
  }

  async function getPublicKey(publicKeyId: string) {
    if (!publicKeyId.trim()) throw new TypeError("An eBay notification public key ID is required.");
    const cacheKey = `${environment}:${publicKeyId}`;
    const cached = publicKeyCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.publicKey;
    const publicKey = (await request<EbayNotificationPublicKey>(
      `/public_key/${encodeURIComponent(publicKeyId)}`,
    )).body;
    publicKeyCache.set(cacheKey, {
      expiresAt: Date.now() + publicKeyCacheLifetimeMs,
      publicKey,
    });
    return publicKey;
  }

  return {
    async getConfig() {
      try {
        return (await request<EbayNotificationConfig>("/config")).body;
      } catch (error) {
        if (error instanceof EbayNotificationApiError && error.status === 404) {
          return {};
        }
        throw error;
      }
    },

    async createDestination(input: EbayNotificationDestinationInput) {
      validateDestination(input);
      const result = await request<EbayNotificationDestination | null>("/destination", {
        body: JSON.stringify({
          deliveryConfig: { endpoint: input.endpoint, verificationToken: input.verificationToken },
          name: input.name,
          status: input.status ?? "ENABLED",
        }),
        method: "POST",
      });
      const destinationId = result.body?.destinationId
        ?? resourceIdFromLocation(result.location);
      if (!destinationId) {
        throw new EbayNotificationApiError(
          "eBay created the notification destination without returning its ID.",
          502,
        );
      }
      return {
        deliveryConfig: { endpoint: input.endpoint },
        destinationId,
        name: input.name,
        status: input.status ?? "ENABLED",
      } satisfies EbayNotificationDestination;
    },

    async createSubscription(input: EbayNotificationSubscriptionInput) {
      if (!input.destinationId.trim() || !input.topicId.trim() || !input.payload.schemaVersion.trim()) {
        throw new TypeError("eBay notification subscriptions require a destination, topic, and supported payload schema version.");
      }
      const result = await request<EbayNotificationSubscription | null>("/subscription", {
        body: JSON.stringify({ ...input, status: input.status ?? "ENABLED" }),
        method: "POST",
      });
      const subscriptionId = result.body?.subscriptionId
        ?? resourceIdFromLocation(result.location);
      if (!subscriptionId) {
        throw new EbayNotificationApiError(
          "eBay created the notification subscription without returning its ID.",
          502,
        );
      }
      return {
        destinationId: input.destinationId,
        status: input.status ?? "ENABLED",
        subscriptionId,
        topicId: input.topicId,
      } satisfies EbayNotificationSubscription;
    },

    async enableSubscription(subscriptionId: string) {
      if (!subscriptionId.trim()) throw new TypeError("An eBay notification subscription ID is required.");
      await request<unknown>(`/subscription/${encodeURIComponent(subscriptionId)}/enable`, {
        method: "POST",
      });
    },

    async getDestinations() {
      const result = (await request<EbayDestinationSearchResponse>("/destination?limit=100")).body;
      return Array.isArray(result.destinations) ? result.destinations : [];
    },

    getPublicKey,

    async getPublicKeyForSignature(signatureHeader: string) {
      return getPublicKey(decodeEbayNotificationSignature(signatureHeader).kid);
    },

    async getTopics() {
      return parseTopics((await request<unknown>("/topic?limit=100")).body);
    },

    async getSubscriptions() {
      const result = (await request<EbaySubscriptionSearchResponse>("/subscription?limit=100")).body;
      return Array.isArray(result.subscriptions) ? result.subscriptions : [];
    },

    async getSubscription(subscriptionId: string) {
      if (!subscriptionId.trim()) throw new TypeError("An eBay notification subscription ID is required.");
      return (await request<EbayNotificationSubscription>(
        `/subscription/${encodeURIComponent(subscriptionId)}`,
      )).body;
    },

    async testSubscription(subscriptionId: string) {
      if (!subscriptionId.trim()) throw new TypeError("An eBay notification subscription ID is required.");
      return (await request<{ notificationId?: string }>(
        `/subscription/${encodeURIComponent(subscriptionId)}/test`,
        { method: "POST" },
      )).body;
    },

    async updateConfig(alertEmail: string) {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(alertEmail.trim())) {
        throw new TypeError("A valid notification alert email is required.");
      }
      await request<unknown>("/config", {
        body: JSON.stringify({ alertEmail: alertEmail.trim() }),
        method: "PUT",
      });
    },

    async updateDestination(
      destinationId: string,
      input: EbayNotificationDestinationInput,
    ) {
      if (!destinationId.trim()) {
        throw new TypeError("An eBay notification destination ID is required.");
      }
      validateDestination(input);
      await request<unknown>(
        `/destination/${encodeURIComponent(destinationId)}`,
        {
          body: JSON.stringify({
            deliveryConfig: {
              endpoint: input.endpoint,
              verificationToken: input.verificationToken,
            },
            name: input.name,
            status: input.status ?? "ENABLED",
          }),
          method: "PUT",
        },
      );
    },

    async updateSubscription(
      subscriptionId: string,
      input: EbayNotificationSubscriptionInput,
    ) {
      if (!subscriptionId.trim()) {
        throw new TypeError("An eBay notification subscription ID is required.");
      }
      if (!input.destinationId.trim() || !input.topicId.trim() || !input.payload.schemaVersion.trim()) {
        throw new TypeError("eBay notification subscriptions require a destination, topic, and supported payload schema version.");
      }
      await request<unknown>(
        `/subscription/${encodeURIComponent(subscriptionId)}`,
        {
          body: JSON.stringify({ ...input, status: input.status ?? "ENABLED" }),
          method: "PUT",
        },
      );
    },
  };
}

function resourceIdFromLocation(location: string | null) {
  if (!location) return null;
  const pathname = (() => {
    try {
      return new URL(location, productionBaseUrl).pathname;
    } catch {
      return location.split("?", 1)[0] ?? "";
    }
  })();
  const value = pathname.split("/").filter(Boolean).at(-1);
  return value ? decodeURIComponent(value) : null;
}

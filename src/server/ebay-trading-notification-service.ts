import "server-only";

import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  ebayListings,
  ebayNotificationSubscriptions,
} from "@/db/schema";
import { isMissingDatabaseSchemaError } from "@/lib/database-error";
import { tradingNotificationHealthState } from "@/lib/ebay-notification-health-presentation";
import {
  ebayTradingNotificationDeliveryProblem,
  ebayTradingNotificationEvents,
  mergeEbayTradingEventPreferences,
} from "@/lib/records/ebay-trading-notification";
import {
  callEbayTradingApi,
  EbayTradingError,
  ebayXmlContainers,
  ebayXmlEscape,
  ebayXmlText,
} from "@/server/ebay-trading";
import {
  EbayAuthorizationError,
  EbayConfigurationError,
  getEbayConnectionStatus,
  getEbayTradingAuthTokenMetadata,
  getStoredEbayTradingAuthToken,
  recordEbayTradingAuthTokenStatus,
  saveEbayTradingAuthToken,
  type EbayTradingAuthTokenStatus,
} from "@/server/ebay-seller";

const productionNotificationHost = "ygo-wishlist.vercel.app";
const tradingTopicPrefix = "TRADING_";
const tradingDestinationPrefix = "trading-platform:";
const tradingRenewalWarningMs = 90 * 24 * 60 * 60 * 1_000;
// Platform Notifications use a narrower payload-version allowlist than the
// general Trading API. Version 1113 is eBay's documented baseline for modern
// order IDs and contains every routing field this listener consumes.
const tradingPayloadVersion = "1113";

type TradingAuthorizationHealth = {
  checkedAt: Date | null;
  expiresAt: Date | null;
  renewalRequired: boolean;
  status: EbayTradingAuthTokenStatus;
};

export type EbayTradingNotificationHealth = {
  authorization: TradingAuthorizationHealth;
  configured: boolean;
  demonstrated: boolean;
  events: Array<{ status: string; topic: string }>;
  lastError: string | null;
  lastNotificationAt: Date | null;
  lastVerifiedAt: Date | null;
  schemaReady: boolean;
  state: "active" | "setup_required" | "delivery_attention" | "fallback";
};

type PreferenceSnapshot = {
  applicationEnabled: boolean;
  applicationUrl: string | null;
  events: Map<string, string>;
  notificationPayloadType: string | null;
  payloadVersion: string | null;
};

type VerifiedTradingAuthorization = {
  expiresAt: Date;
  sellerUserId: string;
  warning: string | null;
};

class EbayTradingCredentialStatusError extends EbayAuthorizationError {
  readonly status: Exclude<EbayTradingAuthTokenStatus, "missing" | "active">;

  constructor(
    message: string,
    status: Exclude<EbayTradingAuthTokenStatus, "missing" | "active">,
  ) {
    super(message);
    this.status = status;
  }
}

function publicHttpsEndpoint(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:") {
    throw new EbayConfigurationError(
      "The Trading notification endpoint must use HTTPS.",
    );
  }
  return url.toString();
}

export function getEbayTradingNotificationEndpoint() {
  const explicit = process.env.EBAY_TRADING_NOTIFICATION_ENDPOINT_URL?.trim();
  if (explicit) return publicHttpsEndpoint(explicit);
  if (process.env.NODE_ENV === "development") {
    throw new EbayConfigurationError(
      "Local Trading notification setup needs a public HTTPS webhook. Set EBAY_TRADING_NOTIFICATION_ENDPOINT_URL to the tunnel's /api/ebay/trading-notifications URL, restart the development server, then retry.",
    );
  }
  const productionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim()
    || productionNotificationHost;
  return publicHttpsEndpoint(
    `https://${productionHost}/api/ebay/trading-notifications`,
  );
}

function tradingStaticConfigurationError() {
  if (!process.env.EBAY_DEV_ID?.trim()) {
    return "The server-only eBay DevID is missing. Add EBAY_DEV_ID before enabling Trading notifications.";
  }
  if (!process.env.EBAY_CLIENT_ID?.trim() || !process.env.EBAY_CLIENT_SECRET?.trim()) {
    return "The eBay AppID or CertID is missing from the server configuration.";
  }
  try {
    getEbayTradingNotificationEndpoint();
    return null;
  } catch (error) {
    return error instanceof Error
      ? error.message
      : "The Trading notification endpoint is not configured.";
  }
}

function environmentBootstrapToken() {
  return process.env.EBAY_TRADING_AUTH_TOKEN?.trim() || null;
}

async function tradingAuthToken(ownerId: string) {
  const stored = await getStoredEbayTradingAuthToken(ownerId);
  const token = stored ?? environmentBootstrapToken();
  if (!token) {
    throw new EbayConfigurationError(
      "Trading authorization is missing. Use Renew Trading authorization; no environment-variable token is required.",
    );
  }
  return token;
}

function preferenceSnapshot(applicationXml: string, userXml: string): PreferenceSnapshot {
  const applicationPreferences = ebayXmlContainers(
    applicationXml,
    "ApplicationDeliveryPreferences",
  )[0] ?? applicationXml;
  const events = new Map<string, string>();
  for (const notification of ebayXmlContainers(userXml, "NotificationEnable")) {
    const eventType = ebayXmlText(notification, "EventType");
    const eventEnable = ebayXmlText(notification, "EventEnable");
    if (eventType && eventEnable) events.set(eventType, eventEnable);
  }
  return {
    applicationEnabled: ebayXmlText(applicationPreferences, "ApplicationEnable") === "Enable",
    applicationUrl: ebayXmlText(applicationPreferences, "ApplicationURL"),
    events,
    notificationPayloadType: ebayXmlText(
      applicationPreferences,
      "NotificationPayloadType",
    ),
    payloadVersion: ebayXmlText(applicationPreferences, "PayloadVersion"),
  };
}

async function readPreferences(ownerId: string, authToken: string) {
  async function readPreferenceLevel(level: "Application" | "User") {
    try {
      return await callEbayTradingApi({
        authToken,
        body: `<PreferenceLevel>${level}</PreferenceLevel>`,
        callName: "GetNotificationPreferences",
        ownerId,
      });
    } catch (error) {
      // Error 12209 is the normal empty state before first setup.
      if (
        error instanceof EbayTradingError
        && error.details.some((detail) => detail.code === "12209")
      ) {
        return { ack: "Success", errors: [], xml: "" };
      }
      throw error;
    }
  }

  const [application, user] = await Promise.all([
    readPreferenceLevel("Application"),
    readPreferenceLevel("User"),
  ]);
  return preferenceSnapshot(application.xml, user.xml);
}

function eventPreferencesXml(events: ReadonlyMap<string, string>) {
  return [...events.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([event, enabled]) => (
      `<NotificationEnable><EventType>${ebayXmlEscape(event)}</EventType><EventEnable>${ebayXmlEscape(enabled)}</EventEnable></NotificationEnable>`
    ))
    .join("");
}

function ownedEventsEnabled(snapshot: PreferenceSnapshot) {
  return ebayTradingNotificationEvents.every(
    (event) => snapshot.events.get(event) === "Enable",
  );
}

function credentialExpirationWarning(expiresAt: Date, now = new Date()) {
  if (expiresAt.getTime() > now.getTime() + tradingRenewalWarningMs) return null;
  return `Credential: Trading authorization expires at ${expiresAt.toISOString()}. Renew it from this page before then; no environment-variable update is needed.`;
}

function statusFromTokenResponse(xml: string, expiresAt: Date) {
  const rawStatus = ebayXmlText(xml, "Status")?.toLowerCase();
  if (rawStatus === "revoked") return "revoked" as const;
  if (rawStatus && rawStatus !== "active") return "invalid" as const;
  if (expiresAt <= new Date()) return "expired" as const;
  return "active" as const;
}

async function inspectTradingAuthorization(
  ownerId: string,
  authToken: string,
  expirationHint?: Date,
): Promise<VerifiedTradingAuthorization> {
  const [oauthUser, authTokenUser, tokenStatus] = await Promise.all([
    callEbayTradingApi({
      body: "<DetailLevel>ReturnSummary</DetailLevel>",
      callName: "GetUser",
      ownerId,
    }),
    callEbayTradingApi({
      authToken,
      body: "<DetailLevel>ReturnSummary</DetailLevel>",
      callName: "GetUser",
      ownerId,
    }),
    callEbayTradingApi({
      authToken,
      body: "",
      callName: "GetTokenStatus",
      ownerId,
    }),
  ]);
  const oauthUserId = ebayXmlText(oauthUser.xml, "UserID");
  const authTokenUserId = ebayXmlText(authTokenUser.xml, "UserID");
  if (!oauthUserId || !authTokenUserId || oauthUserId !== authTokenUserId) {
    throw new EbayConfigurationError(
      "Trading authorization belongs to a different eBay seller than the connected account.",
    );
  }
  const expirationText = ebayXmlText(tokenStatus.xml, "ExpirationTime");
  const expiresAt = expirationText ? new Date(expirationText) : expirationHint;
  if (!expiresAt || Number.isNaN(expiresAt.getTime())) {
    throw new EbayAuthorizationError(
      "eBay did not report the Trading authorization expiry. Renew it and try again.",
    );
  }
  const status = statusFromTokenResponse(tokenStatus.xml, expiresAt);
  if (status !== "active") {
    throw new EbayTradingCredentialStatusError(
      `Trading authorization is ${status}. Renew it before enabling automatic updates.`,
      status,
    );
  }
  return {
    expiresAt,
    sellerUserId: authTokenUserId,
    warning: credentialExpirationWarning(expiresAt),
  };
}

export async function storeVerifiedEbayTradingAuthorization({
  expiresAt,
  ownerId,
  token,
}: {
  expiresAt?: Date;
  ownerId: string;
  token: string;
}) {
  try {
    const verified = await inspectTradingAuthorization(ownerId, token, expiresAt);
    await saveEbayTradingAuthToken({
      ebayUserId: verified.sellerUserId,
      expiresAt: verified.expiresAt,
      ownerId,
      token,
    });
    return verified;
  } catch (error) {
    if (error instanceof EbayTradingCredentialStatusError) {
      await recordEbayTradingAuthTokenStatus({ ownerId, status: error.status });
    }
    throw error;
  }
}

async function recentDeliveryProblem(ownerId: string, authToken: string) {
  const [listing] = await db.select({ itemId: ebayListings.itemId })
    .from(ebayListings)
    .where(eq(ebayListings.ownerId, ownerId))
    .orderBy(desc(ebayListings.updatedAt))
    .limit(1);
  if (!listing) return null;
  const usage = await callEbayTradingApi({
    authToken,
    body: `<ItemID>${ebayXmlEscape(listing.itemId)}</ItemID>`,
    callName: "GetNotificationsUsage",
    ownerId,
  });
  return ebayTradingNotificationDeliveryProblem(usage.xml, {
    ignoreInvalidAuthTokenRejections: true,
  });
}

async function persistVerifiedPreferences({
  deliveryProblem,
  endpoint,
  expiresAt,
  ownerId,
}: {
  deliveryProblem: string | null;
  endpoint: string;
  expiresAt: Date;
  ownerId: string;
}) {
  const now = new Date();
  const destinationId = `${tradingDestinationPrefix}${endpoint}`;
  await db.transaction(async (transaction) => {
    for (const event of ebayTradingNotificationEvents) {
      const topic = `${tradingTopicPrefix}${event}`;
      const values = {
        destinationId,
        enabledAt: now,
        expiresAt,
        lastCheckedAt: now,
        lastError: deliveryProblem,
        lastErrorAt: deliveryProblem ? now : null,
        nextRetryAt: null,
        retryCount: 0,
        scopeVersion: 1,
        status: deliveryProblem?.startsWith("Delivery:")
          ? "marked_down" as const
          : "enabled" as const,
        updatedAt: now,
        verifiedAt: now,
      };
      await transaction.insert(ebayNotificationSubscriptions).values({
        ...values,
        createdAt: now,
        id: `ebay-notification-sub-${crypto.randomUUID()}`,
        ownerId,
        topic,
      }).onConflictDoUpdate({
        set: values,
        target: [
          ebayNotificationSubscriptions.ownerId,
          ebayNotificationSubscriptions.topic,
          ebayNotificationSubscriptions.destinationId,
        ],
      });
    }
  });
}

async function recordSetupFailure(ownerId: string, error: unknown) {
  const now = new Date();
  const message = error instanceof Error
    ? `Setup: ${error.message.slice(0, 900)}`
    : "Setup: Trading notification setup failed.";
  await db.update(ebayNotificationSubscriptions).set({
    lastCheckedAt: now,
    lastError: message,
    lastErrorAt: now,
    status: "error",
    updatedAt: now,
  }).where(and(
    eq(ebayNotificationSubscriptions.ownerId, ownerId),
    inArray(
      ebayNotificationSubscriptions.topic,
      ebayTradingNotificationEvents.map((event) => `${tradingTopicPrefix}${event}`),
    ),
  )).catch(() => undefined);
}

/** Explicit, idempotent administrator action. Ordinary status reads never call eBay. */
export async function ensureEbayTradingNotificationPreferences(ownerId: string) {
  try {
    const connection = await getEbayConnectionStatus(ownerId);
    if (!connection) throw new Error("Connect eBay before enabling Trading notifications.");
    const configurationError = tradingStaticConfigurationError();
    if (configurationError) throw new EbayConfigurationError(configurationError);
    const authToken = await tradingAuthToken(ownerId);
    const credential = await storeVerifiedEbayTradingAuthorization({ ownerId, token: authToken });
    const endpoint = getEbayTradingNotificationEndpoint();
    const before = await readPreferences(ownerId, authToken);

    // Reassert both levels so a renewed token replaces the delivery association.
    await callEbayTradingApi({
      authToken,
      body: `<ApplicationDeliveryPreferences><ApplicationEnable>Enable</ApplicationEnable><ApplicationURL>${ebayXmlEscape(endpoint)}</ApplicationURL><DeviceType>Platform</DeviceType><NotificationPayloadType>eBLSchemaSOAP</NotificationPayloadType><PayloadVersion>${tradingPayloadVersion}</PayloadVersion></ApplicationDeliveryPreferences>`,
      callName: "SetNotificationPreferences",
      ownerId,
    });
    const merged = mergeEbayTradingEventPreferences(before.events);
    await callEbayTradingApi({
      authToken,
      body: `<UserDeliveryPreferenceArray>${eventPreferencesXml(merged)}</UserDeliveryPreferenceArray>`,
      callName: "SetNotificationPreferences",
      ownerId,
    });

    const verified = await readPreferences(ownerId, authToken);
    if (
      !verified.applicationEnabled
      || verified.applicationUrl !== endpoint
      || verified.notificationPayloadType !== "eBLSchemaSOAP"
      || verified.payloadVersion !== tradingPayloadVersion
      || !ownedEventsEnabled(verified)
    ) {
      throw new Error(
        "eBay Trading notification preferences still differ from the required setup after verification.",
      );
    }
    const deliveryProblem = credential.warning ?? await recentDeliveryProblem(
      ownerId,
      authToken,
    ).catch(() => (
      "Delivery: Trading preferences are verified, but recent eBay delivery health could not be checked. Retry the check shortly."
    ));
    await persistVerifiedPreferences({
      deliveryProblem,
      endpoint,
      expiresAt: credential.expiresAt,
      ownerId,
    });
    return getEbayTradingNotificationHealth(ownerId);
  } catch (error) {
    await recordSetupFailure(ownerId, error);
    throw error;
  }
}

function authFailureStatus(error: unknown, expiresAt: Date | null) {
  if (expiresAt && expiresAt <= new Date()) return "expired" as const;
  if (error instanceof EbayTradingCredentialStatusError) return error.status;
  if (error instanceof EbayTradingError) {
    if (error.details.some((detail) => detail.code === "932")) return "expired" as const;
    if (error.details.some((detail) => detail.code === "931")) return "invalid" as const;
  }
  return null;
}

export async function checkEbayTradingAuthTokenStatus(ownerId: string) {
  const metadata = await getEbayTradingAuthTokenMetadata(ownerId);
  if (!metadata?.hasToken) return { checked: false, status: "missing" as const };
  const token = await getStoredEbayTradingAuthToken(ownerId);
  if (!token) return { checked: false, status: "missing" as const };
  try {
    const verified = await inspectTradingAuthorization(ownerId, token, metadata.expiresAt ?? undefined);
    await recordEbayTradingAuthTokenStatus({
      expiresAt: verified.expiresAt,
      ownerId,
      status: "active",
    });
    if (verified.warning) {
      const now = new Date();
      await db.update(ebayNotificationSubscriptions).set({
        expiresAt: verified.expiresAt,
        lastCheckedAt: now,
        lastError: verified.warning,
        lastErrorAt: now,
        updatedAt: now,
      }).where(eq(ebayNotificationSubscriptions.ownerId, ownerId));
    }
    return {
      checked: true,
      expiresAt: verified.expiresAt,
      status: "active" as const,
    };
  } catch (error) {
    const status = authFailureStatus(error, metadata.expiresAt);
    if (!status) throw error;
    await recordEbayTradingAuthTokenStatus({ ownerId, status });
    const now = new Date();
    await db.update(ebayNotificationSubscriptions).set({
      lastCheckedAt: now,
      lastError: `Credential: Trading authorization is ${status}. Renew it to restore automatic updates.`,
      lastErrorAt: now,
      status: "error",
      updatedAt: now,
    }).where(eq(ebayNotificationSubscriptions.ownerId, ownerId));
    return { checked: true, status };
  }
}

function latestDate(values: Array<Date | null>) {
  return values.reduce<Date | null>(
    (latest, value) => value && (!latest || value > latest) ? value : latest,
    null,
  );
}

function credentialProblem(metadata: Awaited<ReturnType<typeof getEbayTradingAuthTokenMetadata>>) {
  if (!metadata?.hasToken) {
    return environmentBootstrapToken()
      ? "Credential: Run notification setup once to import the existing Trading authorization into encrypted storage."
      : "Credential: Trading authorization is missing. Use Renew Trading authorization.";
  }
  if (metadata.status !== "active") {
    return `Credential: Trading authorization is ${metadata.status}. Renew it to restore automatic updates.`;
  }
  if (!metadata.expiresAt) {
    return "Credential: Trading authorization expiry is unknown. Recheck or renew it.";
  }
  if (metadata.expiresAt <= new Date()) {
    return "Credential: Trading authorization has expired. Renew it to restore automatic updates.";
  }
  return credentialExpirationWarning(metadata.expiresAt);
}

export async function getEbayTradingNotificationHealth(
  ownerId: string,
): Promise<EbayTradingNotificationHealth> {
  const connection = await getEbayConnectionStatus(ownerId);
  const baseConfigurationError = !connection
    ? "Connect eBay before enabling Trading notifications."
    : connection.health === "reconnect_required"
      ? "Reconnect eBay before checking or repairing Trading notifications."
      : tradingStaticConfigurationError();
  const expectedDestinationId = baseConfigurationError
    ? null
    : `${tradingDestinationPrefix}${getEbayTradingNotificationEndpoint()}`;
  try {
    const [rows, tokenMetadata] = await Promise.all([
      db.select()
        .from(ebayNotificationSubscriptions)
        .where(and(
          eq(ebayNotificationSubscriptions.ownerId, ownerId),
          inArray(
            ebayNotificationSubscriptions.topic,
            ebayTradingNotificationEvents.map((event) => `${tradingTopicPrefix}${event}`),
          ),
        ))
        .orderBy(
          desc(ebayNotificationSubscriptions.verifiedAt),
          desc(ebayNotificationSubscriptions.updatedAt),
        ),
      getEbayTradingAuthTokenMetadata(ownerId),
    ]);
    const latestRows = ebayTradingNotificationEvents.map((event) => ({
      event,
      row: rows.find((row) => row.topic === `${tradingTopicPrefix}${event}`),
    }));
    const configured = !baseConfigurationError && latestRows.every(
      ({ row }) => Boolean(row && row.destinationId === expectedDestinationId && (
        row.status === "enabled" || row.status === "marked_down" || row.status === "error"
      )),
    );
    const endpointDrift = latestRows.some(({ row }) => (
      row && row.destinationId !== expectedDestinationId
    ));
    const lastVerifiedAt = latestDate(latestRows.map(({ row }) => row?.verifiedAt ?? null));
    const lastNotificationAt = latestDate(latestRows.map(
      ({ row }) => row?.lastNotificationAt ?? null,
    ));
    const tokenProblem = credentialProblem(tokenMetadata);
    const lastError = baseConfigurationError
      ?? tokenProblem
      ?? (endpointDrift
        ? "The verified Trading notification endpoint differs from the server's current endpoint. Run setup to review and repair the preference."
        : null)
      ?? latestRows.find(({ row }) => row?.lastError)?.row?.lastError
      ?? null;
    const demonstrated = Boolean(lastNotificationAt);
    const deliveryAttention = Boolean(tokenProblem) || latestRows.some(({ row }) => (
      row?.status === "marked_down"
      || row?.status === "error"
      || row?.lastError?.startsWith("Delivery:")
      || row?.lastError?.startsWith("Credential:")
      || row?.lastError?.startsWith("Setup:")
    ));
    const state = tradingNotificationHealthState({
      configured,
      deliveryAttention,
      demonstrated,
    });
    const authorizationStatus = tokenMetadata?.status ?? "missing";
    return {
      authorization: {
        checkedAt: tokenMetadata?.checkedAt ?? null,
        expiresAt: tokenMetadata?.expiresAt ?? null,
        renewalRequired: authorizationStatus !== "active" || Boolean(tokenProblem),
        status: authorizationStatus,
      },
      configured,
      demonstrated,
      events: latestRows.map(({ event, row }) => ({
        status: row?.status ?? "not_configured",
        topic: event,
      })),
      lastError,
      lastNotificationAt,
      lastVerifiedAt,
      schemaReady: true,
      state,
    };
  } catch (error) {
    if (!isMissingDatabaseSchemaError(error)) throw error;
    return {
      authorization: {
        checkedAt: null,
        expiresAt: null,
        renewalRequired: true,
        status: "missing",
      },
      configured: false,
      demonstrated: false,
      events: ebayTradingNotificationEvents.map((topic) => ({
        status: "not_configured",
        topic,
      })),
      lastError: "The eBay notification tables or Trading credential fields are not available in this database.",
      lastNotificationAt: null,
      lastVerifiedAt: null,
      schemaReady: false,
      state: "setup_required",
    };
  }
}

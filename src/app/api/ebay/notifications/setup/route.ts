import { NextRequest, NextResponse } from "next/server";
import { getAllowedRequestOrigin } from "@/lib/auth-hosts";
import { EbayNotificationApiError } from "@/server/ebay-notification-api";
import {
  ensureEbayNotificationSubscriptions,
  getEbayNotificationSubscriptionStatus,
} from "@/server/ebay-notification-service";
import { EbayAuthorizationError, EbayConfigurationError } from "@/server/ebay-seller";
import { getSessionFromHeaders } from "@/server/session";

export const runtime = "nodejs";
export const maxDuration = 60;

function safeFailureMessage(error: unknown) {
  if (error instanceof EbayNotificationApiError) return error.message;
  if (error instanceof EbayAuthorizationError) {
    return "eBay could not renew the seller connection. Reconnect eBay, approve access again, then retry notification setup.";
  }
  if (error instanceof EbayConfigurationError) {
    if (error.message.startsWith("Local eBay notification setup needs")) {
      return error.message;
    }
    return "The server is missing required eBay notification configuration. Check the deployment environment settings, then retry.";
  }
  if (error instanceof Error) {
    const message = error.message.trim();
    if (
      message.startsWith("Configure an eBay notification alert email")
      || message.startsWith("The current eBay connection cannot subscribe")
      || message.startsWith("Reconnect eBay")
      || message.startsWith("Connect eBay")
    ) {
      return message;
    }
  }
  return "Notification setup could not be completed. Check the deployment logs for the underlying eBay response, then retry.";
}

function failedStatusMessage(
  subscriptions: Awaited<ReturnType<typeof getEbayNotificationSubscriptionStatus>>["subscriptions"],
) {
  return subscriptions.find((subscription) => (
    subscription.status !== "unsupported" && subscription.lastError
  ))?.lastError
    ?? subscriptions.find((subscription) => subscription.lastError)?.lastError
    ?? "eBay did not enable a notification subscription. Review the per-topic status and retry.";
}

export async function POST(request: NextRequest) {
  const session = await getSessionFromHeaders(request.headers);
  if (!session || session.user.role !== "admin") {
    return NextResponse.json(
      { message: "Your administrator session has expired. Sign in again, then retry." },
      { status: 401 },
    );
  }
  if (request.headers.get("origin") !== getAllowedRequestOrigin(request)) {
    return NextResponse.json(
      { message: "The notification check was rejected for safety. Reload this page from the approved site address, then retry." },
      { status: 403 },
    );
  }

  try {
    await ensureEbayNotificationSubscriptions(session.user.id);
    const notifications = await getEbayNotificationSubscriptionStatus(
      session.user.id,
    );
    if (!notifications.enabled) {
      return NextResponse.json(
        {
          message: failedStatusMessage(notifications.subscriptions),
          notifications,
        },
        { status: 409 },
      );
    }
    return NextResponse.json({
      message: notifications.coverage === "full"
        ? "Connection established. Listing and order notifications are active."
        : "Connection established for order notifications. Listing-change push is unavailable to this eBay keyset, so interaction-time and daily reconciliation remain active.",
      notifications,
    });
  } catch (error) {
    return NextResponse.json(
      { message: safeFailureMessage(error) },
      { status: 400 },
    );
  }
}

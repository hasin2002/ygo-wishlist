import { NextRequest, NextResponse } from "next/server";
import { getAllowedRequestOrigin } from "@/lib/auth-hosts";
import { EbayTradingError } from "@/server/ebay-trading";
import {
  ensureEbayTradingNotificationPreferences,
  getEbayTradingNotificationHealth,
} from "@/server/ebay-trading-notification-service";
import {
  EbayAuthorizationError,
  EbayConfigurationError,
} from "@/server/ebay-seller";
import { getSessionFromHeaders } from "@/server/session";

export const runtime = "nodejs";
export const maxDuration = 60;

function safeFailureMessage(error: unknown) {
  if (
    error instanceof EbayConfigurationError
    || error instanceof EbayAuthorizationError
    || error instanceof EbayTradingError
  ) {
    return error.message;
  }
  if (error instanceof Error && (
    error.message.startsWith("Connect eBay")
    || error.message.startsWith("eBay Trading notification preferences")
  )) {
    return error.message;
  }
  return "Trading notification setup could not be completed. Check the server configuration and the underlying eBay response, then retry.";
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
      { message: "The notification setup request was rejected for safety. Reload this page from the approved site address, then retry." },
      { status: 403 },
    );
  }

  try {
    const notifications = await ensureEbayTradingNotificationPreferences(
      session.user.id,
    );
    return NextResponse.json({
      message: notifications.state === "active"
        ? "Automatic Listing and checkout updates are active."
        : notifications.state === "delivery_attention"
          ? "Trading preferences are configured, but recent delivery needs attention."
          : "Trading preferences are configured. Records will keep using interaction and daily checks until a real notification is received.",
      notifications,
    });
  } catch (error) {
    const notifications = await getEbayTradingNotificationHealth(
      session.user.id,
    ).catch(() => null);
    return NextResponse.json(
      { message: safeFailureMessage(error), notifications },
      { status: 400 },
    );
  }
}

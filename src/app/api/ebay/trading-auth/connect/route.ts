import { NextRequest, NextResponse } from "next/server";
import {
  ebayTradingAuthSessionCookieName,
  ebayTradingAuthSessionCookieOptions,
} from "@/lib/ebay-trading-auth-route-state";
import {
  beginEbayTradingAuthorization,
  ebayTradingAuthorizationFailureCode,
  ebayTradingAuthorizationFailureDiagnostics,
} from "@/server/ebay-trading-authorization";
import { getSessionFromHeaders } from "@/server/session";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const session = await getSessionFromHeaders(request.headers);
  if (!session) {
    return NextResponse.redirect(new URL("/login?next=/ebay", request.url));
  }
  if (session.user.role !== "admin") {
    return NextResponse.redirect(new URL("/", request.url));
  }

  try {
    const started = await beginEbayTradingAuthorization(session.user.id);
    const response = NextResponse.redirect(started.signInUrl);
    response.cookies.set(
      ebayTradingAuthSessionCookieName,
      started.cookieValue,
      ebayTradingAuthSessionCookieOptions(),
    );
    return response;
  } catch (error) {
    const failure = ebayTradingAuthorizationFailureCode(error);
    console.warn(
      "[ebay] Trading authorization start failed",
      ebayTradingAuthorizationFailureDiagnostics(error),
    );
    return NextResponse.redirect(new URL(`/ebay?error=${failure}`, request.url));
  }
}

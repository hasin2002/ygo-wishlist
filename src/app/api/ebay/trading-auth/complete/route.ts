import { NextRequest, NextResponse } from "next/server";
import { getAllowedRequestOrigin } from "@/lib/auth-hosts";
import {
  clearEbayTradingAuthSessionCookie,
  ebayTradingAuthSessionCookieName,
} from "@/lib/ebay-trading-auth-route-state";
import {
  completeEbayTradingAuthorization,
  ebayTradingAuthorizationFailureCanRetry,
  ebayTradingAuthorizationFailureCode,
  ebayTradingAuthorizationFailureDiagnostics,
  parseEbayTradingAuthorizationCookie,
} from "@/server/ebay-trading-authorization";
import { parseEbayOAuthState } from "@/server/ebay-seller";
import { getSessionFromHeaders } from "@/server/session";

export const runtime = "nodejs";
export const maxDuration = 60;

function finish(request: NextRequest, destination: string, clear = true) {
  const response = NextResponse.redirect(new URL(destination, request.url), 303);
  return clear ? clearEbayTradingAuthSessionCookie(response) : response;
}

export async function POST(request: NextRequest) {
  const session = await getSessionFromHeaders(request.headers);
  if (!session || session.user.role !== "admin") return finish(request, "/");
  if (request.headers.get("origin") !== getAllowedRequestOrigin(request)) {
    return finish(request, "/ebay?error=security", false);
  }
  const cookieValue = request.cookies.get(ebayTradingAuthSessionCookieName)?.value;
  const pending = cookieValue
    ? parseEbayTradingAuthorizationCookie(cookieValue)
    : null;
  const state = pending ? parseEbayOAuthState(pending.state) : null;
  if (
    !pending
    || !state
    || pending.ownerId !== session.user.id
    || state.ownerId !== session.user.id
    || state.purpose !== "trading_authorization"
  ) {
    return finish(request, "/ebay?error=trading_consent");
  }
  try {
    await completeEbayTradingAuthorization(session.user.id, pending.sessionId);
    return finish(request, "/ebay?tradingAuthorized=1");
  } catch (error) {
    const failure = ebayTradingAuthorizationFailureCode(error);
    console.warn(
      "[ebay] Trading authorization completion failed",
      ebayTradingAuthorizationFailureDiagnostics(error),
    );
    return finish(
      request,
      `/ebay?error=${failure}`,
      !ebayTradingAuthorizationFailureCanRetry(failure),
    );
  }
}

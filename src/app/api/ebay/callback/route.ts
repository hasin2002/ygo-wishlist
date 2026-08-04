import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  clearEbayOAuthStateCookie,
  ebayOAuthStateCookieName,
} from "@/lib/ebay-oauth-route-state";
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
import {
  EbayAuthorizationError,
  EbayConfigurationError,
  exchangeEbayAuthorizationCode,
  parseEbayOAuthState,
  saveEbayConnection,
} from "@/server/ebay-seller";
import { getSessionFromHeaders } from "@/server/session";

export const runtime = "nodejs";

function sameValue(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function finish(request: NextRequest, destination: string) {
  const response = NextResponse.redirect(new URL(destination, request.url));
  return clearEbayOAuthStateCookie(response);
}

function finishTrading(request: NextRequest, destination: string, clear = true) {
  const response = NextResponse.redirect(new URL(destination, request.url));
  return clear ? clearEbayTradingAuthSessionCookie(response) : response;
}

async function completeTradingCallback(request: NextRequest, tradingState: string) {
  const session = await getSessionFromHeaders(request.headers);
  const cookieValue = request.cookies.get(ebayTradingAuthSessionCookieName)?.value;
  const pending = cookieValue
    ? parseEbayTradingAuthorizationCookie(cookieValue)
    : null;
  const state = pending ? parseEbayOAuthState(pending.state) : null;
  if (
    !session
    || session.user.role !== "admin"
    || !pending
    || !state
    || !sameValue(tradingState, pending.state)
    || pending.ownerId !== session.user.id
    || state.ownerId !== session.user.id
    || state.purpose !== "trading_authorization"
  ) {
    return finishTrading(request, "/ebay?error=trading_consent");
  }
  try {
    await completeEbayTradingAuthorization(session.user.id, pending.sessionId);
    return finishTrading(request, "/ebay?tradingAuthorized=1");
  } catch (error) {
    const failure = ebayTradingAuthorizationFailureCode(error);
    console.warn(
      "[ebay] Trading authorization callback failed",
      ebayTradingAuthorizationFailureDiagnostics(error),
    );
    return finishTrading(
      request,
      `/ebay?error=${failure}`,
      !ebayTradingAuthorizationFailureCanRetry(failure),
    );
  }
}

export async function GET(request: NextRequest) {
  const tradingState = request.nextUrl.searchParams.get("tradingState");
  if (tradingState) return completeTradingCallback(request, tradingState);

  const state = request.nextUrl.searchParams.get("state");
  const code = request.nextUrl.searchParams.get("code");
  const expectedState = request.cookies.get(ebayOAuthStateCookieName)?.value;
  if (!state || !code || !expectedState || !sameValue(state, expectedState)) {
    return finish(request, "/ebay?error=consent");
  }

  const stateDetails = parseEbayOAuthState(state);
  const session = await getSessionFromHeaders(request.headers);
  if (
    !stateDetails
    || !session
    || session.user.role !== "admin"
    || session.user.id !== stateDetails.ownerId
  ) {
    return finish(request, "/ebay?error=consent");
  }

  try {
    const token = await exchangeEbayAuthorizationCode(code);
    await saveEbayConnection({
      ownerId: session.user.id,
      refreshToken: token.refresh_token,
      refreshTokenExpiresIn: token.refresh_token_expires_in,
      scopes: token.scope,
    });
    return finish(request, "/ebay?connected=1");
  } catch (error) {
    const reason = error instanceof EbayConfigurationError
      ? "configuration"
      : error instanceof EbayAuthorizationError
        ? "ebay"
        : "unknown";
    return finish(request, `/ebay?error=${reason}`);
  }
}

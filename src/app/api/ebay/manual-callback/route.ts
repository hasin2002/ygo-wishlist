import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  parseEbayManualCallbackUrl,
  safeEbayReturnTo,
} from "@/lib/ebay-connection-state";
import {
  clearEbayOAuthStateCookie,
  ebayOAuthStateCookieName,
} from "@/lib/ebay-oauth-route-state";
import {
  EbayAuthorizationError,
  EbayConfigurationError,
  exchangeEbayAuthorizationCode,
  parseEbayOAuthState,
  saveEbayConnection,
  EbayTemporaryError,
} from "@/server/ebay-seller";
import { getSessionFromHeaders } from "@/server/session";

export const runtime = "nodejs";

function sameValue(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function finish(request: NextRequest, destination: string, clearState = true) {
  const response = NextResponse.redirect(new URL(destination, request.url));
  return clearState ? clearEbayOAuthStateCookie(response) : response;
}

function ebaySettingsDestination(
  params: Record<string, string>,
  returnTo: string | null | undefined,
) {
  const query = new URLSearchParams(params);
  const safeReturnTo = safeEbayReturnTo(returnTo);
  if (safeReturnTo) query.set("returnTo", safeReturnTo);
  return `/ebay?${query}`;
}

export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ message: "This local OAuth helper is unavailable in production." }, { status: 404 });
  }

  const session = await getSessionFromHeaders(request.headers);
  if (!session || session.user.role !== "admin") return finish(request, "/");

  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) {
    return finish(request, "/ebay?error=security");
  }

  let resultUrl: URL;
  try {
    const form = await request.formData();
    const result = parseEbayManualCallbackUrl(String(form.get("callbackUrl") ?? ""));
    if (result.kind === "cancelled") {
      return finish(request, "/ebay?error=cancelled");
    }
    if (result.kind === "invalid") {
      return finish(request, "/ebay?error=local");
    }
    resultUrl = new URL(`https://auth2.ebay.com/?state=${encodeURIComponent(result.state)}&code=${encodeURIComponent(result.code)}`);
  } catch {
    return finish(request, "/ebay?error=local");
  }

  const state = resultUrl.searchParams.get("state");
  const code = resultUrl.searchParams.get("code");
  const expectedState = request.cookies.get(ebayOAuthStateCookieName)?.value;
  if (!state || !code || !expectedState || !sameValue(state, expectedState)) {
    return finish(request, "/ebay?error=consent");
  }

  const stateDetails = parseEbayOAuthState(state);
  if (!stateDetails || session.user.id !== stateDetails.ownerId) {
    return finish(request, "/ebay?error=consent");
  }

  const completionDestination = ebaySettingsDestination({ connected: "1" }, stateDetails.returnTo);

  try {
    const token = await exchangeEbayAuthorizationCode(code);
    await saveEbayConnection({
      ownerId: session.user.id,
      refreshToken: token.refresh_token,
      refreshTokenExpiresIn: token.refresh_token_expires_in,
      scopes: token.scope,
    });
    return finish(request, completionDestination);
  } catch (error) {
    if (error instanceof EbayTemporaryError) {
      return finish(request, ebaySettingsDestination({ error: "temporary" }, stateDetails.returnTo), false);
    }
    const reason = error instanceof EbayConfigurationError
      ? "configuration"
      : error instanceof EbayAuthorizationError
        ? "ebay"
        : "unknown";
    return finish(request, ebaySettingsDestination({ error: reason }, stateDetails.returnTo), false);
  }
}

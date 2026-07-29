import { NextRequest, NextResponse } from "next/server";
import { safeEbayReturnTo } from "@/lib/ebay-connection-state";
import { ebayOAuthStateCookieName, ebayOAuthStateCookieOptions } from "@/lib/ebay-oauth-route-state";
import {
  ebayConsentUrl,
  createEbayOAuthState,
  EbayConfigurationError,
  getEbayConnectionStatus,
} from "@/server/ebay-seller";
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
    const returnTo = safeEbayReturnTo(request.nextUrl.searchParams.get("returnTo"));
    const connection = await getEbayConnectionStatus(session.user.id);
    const state = createEbayOAuthState(session.user.id, {
      purpose: connection ? "replacement" : "connect",
      returnTo: returnTo ?? undefined,
    });
    const response = NextResponse.redirect(ebayConsentUrl(state));
    response.cookies.set(ebayOAuthStateCookieName, state, ebayOAuthStateCookieOptions());
    return response;
  } catch (error) {
    const reason = error instanceof EbayConfigurationError ? "configuration" : "unknown";
    return NextResponse.redirect(new URL(`/ebay?error=${reason}`, request.url));
  }
}

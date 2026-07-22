import { NextRequest, NextResponse } from "next/server";
import { ebayConsentUrl, createEbayOAuthState, EbayConfigurationError } from "@/server/ebay-seller";
import { getSessionFromHeaders } from "@/server/session";

export const runtime = "nodejs";

const stateCookieName = "ebay-oauth-state";

export async function GET(request: NextRequest) {
  const session = await getSessionFromHeaders(request.headers);
  if (!session) {
    return NextResponse.redirect(new URL("/login?next=/ebay", request.url));
  }
  if (session.user.role !== "admin") {
    return NextResponse.redirect(new URL("/", request.url));
  }

  try {
    const state = createEbayOAuthState(session.user.id);
    const response = NextResponse.redirect(ebayConsentUrl(state));
    response.cookies.set(stateCookieName, state, {
      httpOnly: true,
      maxAge: 10 * 60,
      path: "/api/ebay",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
    return response;
  } catch (error) {
    const reason = error instanceof EbayConfigurationError ? "configuration" : "unknown";
    return NextResponse.redirect(new URL(`/ebay?error=${reason}`, request.url));
  }
}

import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  EbayAuthorizationError,
  EbayConfigurationError,
  exchangeEbayAuthorizationCode,
  parseEbayOAuthState,
  saveEbayConnection,
} from "@/server/ebay-seller";
import { getSessionFromHeaders } from "@/server/session";

export const runtime = "nodejs";

const stateCookieName = "ebay-oauth-state";
const allowedEbayHosts = new Set([
  "auth2.ebay.com",
  "signin.ebay.com",
  "signin.ebay.co.uk",
]);

function sameValue(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function finish(request: NextRequest, destination: string) {
  const response = NextResponse.redirect(new URL(destination, request.url));
  response.cookies.delete(stateCookieName);
  return response;
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
    resultUrl = new URL(String(form.get("callbackUrl") ?? "").trim());
  } catch {
    return finish(request, "/ebay?error=local");
  }
  if (
    resultUrl.protocol !== "https:"
    || !allowedEbayHosts.has(resultUrl.hostname.toLowerCase())
    || resultUrl.searchParams.get("isAuthSuccessful") !== "true"
  ) {
    return finish(request, "/ebay?error=local");
  }

  const state = resultUrl.searchParams.get("state");
  const code = resultUrl.searchParams.get("code");
  const expectedState = request.cookies.get(stateCookieName)?.value;
  if (!state || !code || !expectedState || !sameValue(state, expectedState)) {
    return finish(request, "/ebay?error=consent");
  }

  const stateDetails = parseEbayOAuthState(state);
  if (!stateDetails || session.user.id !== stateDetails.ownerId) {
    return finish(request, "/ebay?error=consent");
  }

  try {
    const token = await exchangeEbayAuthorizationCode(code);
    await saveEbayConnection({
      ownerId: session.user.id,
      refreshToken: token.refresh_token,
      refreshTokenExpiresIn: token.refresh_token_expires_in,
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

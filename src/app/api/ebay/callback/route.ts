import { timingSafeEqual } from "node:crypto";
import { after, NextRequest, NextResponse } from "next/server";
import { ensureEbayNotificationSubscriptions } from "@/server/ebay-notification-service";
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

export async function GET(request: NextRequest) {
  const state = request.nextUrl.searchParams.get("state");
  const code = request.nextUrl.searchParams.get("code");
  const expectedState = request.cookies.get(stateCookieName)?.value;
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
    after(async () => {
      await ensureEbayNotificationSubscriptions(session.user.id).catch(() => undefined);
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

import { NextResponse, type NextRequest } from "next/server";
import {
  loginHref,
  protectedNavigationIntentHeader,
} from "@/lib/navigation-intent";

const sessionCookiePattern = /(?:^|;\s*)(?:__Secure-)?better-auth\.session_token(?:\.|=)/;

/**
 * This is intentionally only an optimistic cookie check. Route layouts and
 * API handlers remain the authority for an expired session and user role, but
 * this early redirect retains the original pathname and search string before a
 * shared layout can collapse it to a generic workspace route.
 */
export function proxy(request: NextRequest) {
  const localPreviewReview = process.env.NODE_ENV !== "production"
    && process.env.NEXT_PUBLIC_RECORDS_UI_PREVIEW === "1"
    && request.headers.get("x-records-test-live") !== "1";
  const currentHref = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  if (!localPreviewReview && !sessionCookiePattern.test(request.headers.get("cookie") ?? "")) {
    return NextResponse.redirect(new URL(loginHref(currentHref), request.url));
  }

  // Never trust an incoming value for this header. Proxy is the sole writer,
  // and the request header is available to a later session guard only.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(protectedNavigationIntentHeader, currentHref);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: [
    "/assign-chase",
    "/ebay/:path*",
    "/records/:path*",
    "/spend",
    "/wheel",
    "/wishlist/new",
  ],
};

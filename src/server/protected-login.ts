import "server-only";
import { headers } from "next/headers";
import {
  protectedLoginHref as protectedLoginHrefFromIntent,
  protectedNavigationIntentHeader,
} from "@/lib/navigation-intent";

/**
 * Protected layouts remain the session authority. This only carries the URL
 * that Proxy observed so an expired cookie returns the owner to the same safe
 * internal destination after sign-in.
 */
export async function protectedLoginHref(fallback: string) {
  const requestHeaders = await headers();
  return protectedLoginHrefFromIntent(
    requestHeaders.get(protectedNavigationIntentHeader),
    fallback,
  );
}

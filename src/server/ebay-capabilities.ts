import "server-only";

import { TRPCError } from "@trpc/server";
import type { AuthSession } from "@/lib/auth";
import { decideEbayCapability } from "@/lib/records/ebay-capabilities";
import { getEbayConnectionStatus, isEbayOAuthConfigured } from "@/server/ebay-seller";

/** Recreates the UI capability from trusted server-side facts. */
export async function getEbayCapabilityForSession(
  session: AuthSession | null,
  mode: "live" | "preview" = process.env.NEXT_PUBLIC_RECORDS_UI_PREVIEW === "1"
    ? "preview"
    : "live",
) {
  const connection = session ? await getEbayConnectionStatus(session.user.id) : null;
  return decideEbayCapability({
    configured: isEbayOAuthConfigured(),
    connection,
    isSeller: session?.user.role === "admin",
    mode,
    signedIn: Boolean(session),
  });
}

export async function requireEbayExternalCapability(session: AuthSession) {
  const capability = await getEbayCapabilityForSession(session);
  if (!capability.ebay.allowed) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `${capability.ebay.message} ${capability.ebay.remedy}`.trim(),
    });
  }
  return capability;
}

import type { EbayConnectionHealth } from "@/lib/ebay-connection-state";

/**
 * The value returned here is deliberately serializable. The UI can use it to
 * explain an unavailable control, but servers must always recreate it from
 * the session and stored connection instead of accepting it from a client.
 */
export type EbayCapability = {
  canManageOwnCopyPhotos: boolean;
  canManageListingPhotoDrafts: boolean;
  ebay: {
    allowed: boolean;
    code:
      | "allowed"
      | "preview"
      | "signed_out"
      | "seller_role_required"
      | "not_configured"
      | "not_connected"
      | "reconnect_required"
      | "temporarily_unavailable"
      | "missing_scopes";
    message: string;
    remedy: string;
  };
  mode: "live" | "preview";
};

type CapabilityConnection = {
  health: EbayConnectionHealth;
  missingScopes: readonly string[];
} | null;

export function decideEbayCapability({
  configured,
  connection,
  isSeller,
  mode,
  signedIn,
}: {
  configured: boolean;
  connection: CapabilityConnection;
  isSeller: boolean;
  mode: "live" | "preview";
  signedIn: boolean;
}): EbayCapability {
  const canManageOwnCopyPhotos = mode === "live" && signedIn;
  const canManageListingPhotoDrafts = canManageOwnCopyPhotos && isSeller;
  const denied = (
    code: Exclude<EbayCapability["ebay"]["code"], "allowed">,
    message: string,
    remedy: string,
  ): EbayCapability => ({
    canManageOwnCopyPhotos,
    canManageListingPhotoDrafts,
    ebay: { allowed: false, code, message, remedy },
    mode,
  });

  if (mode !== "live") return denied(
    "preview",
    "eBay actions are unavailable in preview mode.",
    "Switch to live Records to work with eBay.",
  );
  if (!signedIn) return denied(
    "signed_out",
    "Sign in before managing this collection’s eBay listings.",
    "Sign in, then return to this Copy.",
  );
  if (!isSeller) return denied(
    "seller_role_required",
    "Your account does not have the seller permission required for eBay actions.",
    "Ask an administrator to perform this eBay action.",
  );
  if (!configured) return denied(
    "not_configured",
    "eBay selling is not configured on this server.",
    "An administrator must finish the server’s eBay setup.",
  );
  if (!connection) return denied(
    "not_connected",
    "No eBay seller account is connected for this collection.",
    "Connect eBay in eBay settings, then try again.",
  );
  if (connection.health === "reconnect_required") return denied(
    "reconnect_required",
    "The saved eBay connection needs to be replaced.",
    "Reconnect eBay in eBay settings, then try again.",
  );
  if (connection.health === "temporarily_unavailable") return denied(
    "temporarily_unavailable",
    "eBay is temporarily unavailable.",
    "Try the eBay action again shortly; do not replace the connection just for this.",
  );
  if (connection.missingScopes.length) return denied(
    "missing_scopes",
    "The connected eBay account is missing permissions required for this action.",
    "Reconnect eBay and approve the requested seller permissions.",
  );
  return {
    canManageOwnCopyPhotos,
    canManageListingPhotoDrafts,
    ebay: {
      allowed: true,
      code: "allowed",
      message: "eBay selling is ready for this collection.",
      remedy: "",
    },
    mode,
  };
}

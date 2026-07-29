export type EbayConnectionHealth = "stored" | "recently_verified" | "reconnect_required" | "temporarily_unavailable";

export type EbayConnectionPresentation = {
  label: string;
  message: string;
  tone: "neutral" | "success" | "warning";
};

export function ebayConnectionPresentation(
  health: EbayConnectionHealth | null,
): EbayConnectionPresentation {
  switch (health) {
    case "recently_verified":
      return {
        label: "Recently verified",
        message: "eBay accepted this seller connection during a recent listing action.",
        tone: "success",
      };
    case "reconnect_required":
      return {
        label: "Reconnect required",
        message: "eBay rejected the stored seller credential. Start a replacement without removing it first.",
        tone: "warning",
      };
    case "temporarily_unavailable":
      return {
        label: "Temporarily unavailable",
        message: "eBay could not be reached or asked us to retry. Try the listing action again; do not replace the connection just for this.",
        tone: "warning",
      };
    case "stored":
      return {
        label: "Stored",
        message: "A renewable seller credential is stored. It has not been presented as a current health check.",
        tone: "neutral",
      };
    default:
      return {
        label: "Not connected",
        message: "No eBay seller credential is stored for this administrator.",
        tone: "neutral",
      };
  }
}

/**
 * Only return to a page inside the authenticated Records workspace. This keeps
 * a Copy-specific reconnect journey useful without turning OAuth into an open
 * redirect.
 */
export function safeEbayReturnTo(value: string | null | undefined) {
  if (!value || !value.startsWith("/records/")) return null;
  try {
    const url = new URL(value, "https://collection-hub.invalid");
    return url.origin === "https://collection-hub.invalid" && url.pathname.startsWith("/records/")
      ? `${url.pathname}${url.search}${url.hash}`
      : null;
  } catch {
    return null;
  }
}

export function ebaySettingsHref(returnTo: string | null | undefined) {
  const safeReturnTo = safeEbayReturnTo(returnTo);
  return safeReturnTo ? `/ebay?returnTo=${encodeURIComponent(safeReturnTo)}` : "/ebay";
}

export function ebayConnectHref(returnTo: string | null | undefined) {
  const safeReturnTo = safeEbayReturnTo(returnTo);
  return safeReturnTo ? `/api/ebay/connect?returnTo=${encodeURIComponent(safeReturnTo)}` : "/api/ebay/connect";
}

export function shouldRefreshEbaySettings({
  awaitingReturn,
  event,
  leftForEbay,
}: {
  awaitingReturn: boolean;
  event: "focus" | "settled" | "visible";
  leftForEbay: boolean;
}) {
  return awaitingReturn && (event === "settled" || leftForEbay);
}

export type EbayManualCallbackUrl =
  | { kind: "cancelled" }
  | { code: string; kind: "success"; state: string }
  | { kind: "invalid" };

const allowedEbayCallbackHosts = new Set([
  "auth2.ebay.com",
  "signin.ebay.com",
  "signin.ebay.co.uk",
]);

/**
 * This only validates the pasted URL shape. The route still verifies the
 * signed state, state cookie, session owner, expiry, and one-time use.
 */
export function parseEbayManualCallbackUrl(value: string): EbayManualCallbackUrl {
  let resultUrl: URL;
  try {
    resultUrl = new URL(value.trim());
  } catch {
    return { kind: "invalid" };
  }
  if (
    resultUrl.protocol !== "https:"
    || !allowedEbayCallbackHosts.has(resultUrl.hostname.toLowerCase())
  ) {
    return { kind: "invalid" };
  }
  if (resultUrl.searchParams.get("isAuthSuccessful") === "false") {
    return { kind: "cancelled" };
  }
  const state = resultUrl.searchParams.get("state");
  const code = resultUrl.searchParams.get("code");
  return state && code ? { code, kind: "success", state } : { kind: "invalid" };
}

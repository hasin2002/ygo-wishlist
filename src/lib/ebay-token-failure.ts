export type EbayTokenRequestKind = "authorization_code" | "application" | "seller_refresh";
export type EbayTokenFailureKind = "authorization" | "configuration" | "temporary";

/**
 * Only an explicit rejected seller credential should ask the owner to reconnect.
 * Rate limits, outages, and malformed upstream responses are retryable instead.
 */
export function ebayTokenFailureKind(
  status: number,
  requestKind: EbayTokenRequestKind,
): EbayTokenFailureKind {
  if (
    (requestKind === "authorization_code" || requestKind === "seller_refresh")
    && (status === 400 || status === 401 || status === 403)
  ) {
    return "authorization";
  }
  if (requestKind === "application" && (status === 400 || status === 401 || status === 403)) {
    return "configuration";
  }
  return "temporary";
}

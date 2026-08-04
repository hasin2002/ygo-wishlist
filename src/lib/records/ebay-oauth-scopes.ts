export const ebayBaseScope = "https://api.ebay.com/oauth/api_scope";
export const ebayInventoryScope = "https://api.ebay.com/oauth/api_scope/sell.inventory";
export const ebayAccountReadonlyScope = "https://api.ebay.com/oauth/api_scope/sell.account.readonly";

/**
 * OAuth covers seller-facing listing operations. Trading Platform
 * Notifications authenticate separately with an encrypted Auth'n'Auth token
 * obtained through the server-only Trading consent flow, so they add no
 * Commerce Notification or Fulfillment scope.
 */
export const ebaySellerScopeList = [
  ebayBaseScope,
  ebayInventoryScope,
  ebayAccountReadonlyScope,
] as const;

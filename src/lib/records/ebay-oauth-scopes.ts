export const ebayBaseScope = "https://api.ebay.com/oauth/api_scope";
export const ebayInventoryScope = "https://api.ebay.com/oauth/api_scope/sell.inventory";
export const ebayAccountReadonlyScope = "https://api.ebay.com/oauth/api_scope/sell.account.readonly";
export const ebayNotificationSubscriptionScope = "https://api.ebay.com/oauth/api_scope/commerce.notification.subscription";
export const ebayListingReadScope = "https://api.ebay.com/oauth/api_scope/sell.listing.read";
export const ebayFulfillmentScope = "https://api.ebay.com/oauth/api_scope/sell.fulfillment";
export const ebayFulfillmentReadonlyScope = "https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly";

/**
 * Only request scopes confirmed to be available to the application's current
 * production keyset. LISTING notifications require the separately assigned
 * sell.listing.read scope, so that optional capability must not prevent the
 * seller from granting the rest of the application access.
 */
export const ebaySellerScopeList = [
  ebayBaseScope,
  ebayInventoryScope,
  ebayAccountReadonlyScope,
  ebayNotificationSubscriptionScope,
  ebayFulfillmentReadonlyScope,
] as const;

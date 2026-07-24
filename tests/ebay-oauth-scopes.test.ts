import assert from "node:assert/strict";
import test from "node:test";
import {
  ebayFulfillmentReadonlyScope,
  ebayListingReadScope,
  ebayNotificationSubscriptionScope,
  ebaySellerScopeList,
} from "../src/lib/records/ebay-oauth-scopes.ts";

test("seller consent uses supported notification scopes without the restricted listing scope", () => {
  assert.equal(ebaySellerScopeList.includes(ebayNotificationSubscriptionScope), true);
  assert.equal(ebaySellerScopeList.includes(ebayFulfillmentReadonlyScope), true);
  assert.equal(
    (ebaySellerScopeList as readonly string[]).includes(ebayListingReadScope),
    false,
  );
});

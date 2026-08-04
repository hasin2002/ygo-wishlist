import assert from "node:assert/strict";
import test from "node:test";
import {
  ebayAccountReadonlyScope,
  ebayBaseScope,
  ebayInventoryScope,
  ebaySellerScopeList,
} from "../src/lib/records/ebay-oauth-scopes.ts";

test("seller consent excludes permissions used only by retired Commerce notifications", () => {
  assert.deepEqual(ebaySellerScopeList, [
    ebayBaseScope,
    ebayInventoryScope,
    ebayAccountReadonlyScope,
  ]);
  assert.equal(ebaySellerScopeList.some((scope) => (
    scope.includes("commerce.notification")
    || scope.includes("sell.fulfillment")
    || scope.includes("sell.listing.read")
  )), false);
});

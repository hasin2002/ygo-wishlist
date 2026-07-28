import assert from "node:assert/strict";
import test from "node:test";
import {
  ebayListingReviewMessage,
  isEbayListingDataReviewMessage,
  preferredEbayCompositionReviewReason,
} from "../src/lib/records/ebay-listing-reconciliation-reason.ts";

test("a legacy listing without a member reports the exact physical-Copy repair needed", () => {
  const message = ebayListingReviewMessage("missing_listing_member");

  assert.match(message, /missing its exact physical Copy link/);
  assert.equal(isEbayListingDataReviewMessage(message), true);
});

test("order, allocation, and lifecycle conflicts remain explicit data-safety failures", () => {
  assert.match(
    ebayListingReviewMessage("copy_allocation_conflict"),
    /not allocated to this exact physical Copy/,
  );
  assert.match(
    ebayListingReviewMessage("conflicting_remote_identifier"),
    /conflict with the saved listing history/,
  );
  assert.equal(
    isEbayListingDataReviewMessage("eBay returned a listing state that needs review."),
    true,
  );
  assert.equal(isEbayListingDataReviewMessage("eBay could not be reached."), false);
});

test("the underlying composition problem is preferred over a derived needs-review state", () => {
  assert.equal(
    preferredEbayCompositionReviewReason([
      "paid_order_needs_review",
      "missing_listing_member",
    ]),
    "missing_listing_member",
  );
});

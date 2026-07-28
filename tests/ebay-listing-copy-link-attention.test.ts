import assert from "node:assert/strict";
import test from "node:test";
import {
  ebayCopyLinkAttentionDecision,
  ebayListingStatusAttentionDecision,
} from "../src/lib/records/ebay-listing-copy-link-attention.ts";

test("an individual Listing with its saved legacy Copy is offered for confirmation", () => {
  assert.deepEqual(
    ebayCopyLinkAttentionDecision({
      hasExactMember: false,
      kind: "individual",
      legacyCopyExists: true,
    }),
    {
      action: "confirm_copy_link",
      detail: "This eBay listing needs its exact physical Copy link confirmed.",
    },
  );
});

test("ambiguous or incomplete Listing composition stays visible but requires investigation", () => {
  assert.equal(
    ebayCopyLinkAttentionDecision({
      hasExactMember: true,
      kind: "individual",
      legacyCopyExists: true,
    }),
    null,
  );
  assert.equal(
    ebayCopyLinkAttentionDecision({
      hasExactMember: false,
      kind: "quantity",
      legacyCopyExists: true,
    })?.action,
    "review_ebay_status",
  );
  assert.equal(
    ebayCopyLinkAttentionDecision({
      hasExactMember: false,
      kind: "individual",
      legacyCopyExists: false,
    })?.action,
    "review_ebay_status",
  );
});

test("a repaired listing stays in attention while its sale state needs review", () => {
  assert.deepEqual(ebayListingStatusAttentionDecision({
    hasExactMember: true,
    lastError: "Listing data needs review: order details conflict.",
    saleState: "needs_review",
  }), {
    action: "review_ebay_status",
    detail: "Listing data needs review: order details conflict.",
  });
});

test("a clean repaired listing leaves the attention queue", () => {
  assert.equal(ebayListingStatusAttentionDecision({
    hasExactMember: true,
    lastError: null,
    saleState: "paid",
  }), null);
});

test("missing members are handled by the Copy-link action without a duplicate status item", () => {
  assert.equal(ebayListingStatusAttentionDecision({
    hasExactMember: false,
    lastError: "Listing data needs review: Copy link missing.",
    saleState: "needs_review",
  }), null);
});

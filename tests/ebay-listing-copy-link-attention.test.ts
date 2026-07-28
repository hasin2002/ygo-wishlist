import assert from "node:assert/strict";
import test from "node:test";
import { ebayCopyLinkAttentionDecision } from "../src/lib/records/ebay-listing-copy-link-attention.ts";

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

export type EbayCopyLinkAttentionInput = {
  hasExactMember: boolean;
  kind: "individual" | "quantity" | "bundle";
  legacyCopyExists: boolean;
};

export type EbayCopyLinkAttentionDecision =
  | { action: "confirm_copy_link"; detail: string }
  | { action: "review_ebay_status"; detail: string }
  | null;

/**
 * A missing member is always worth surfacing. Only an individual Listing with
 * a same-owner legacy Copy anchor is safe to repair without guessing.
 */
export function ebayCopyLinkAttentionDecision(
  input: EbayCopyLinkAttentionInput,
): EbayCopyLinkAttentionDecision {
  if (
    input.hasExactMember
  ) return null;

  if (
    input.kind === "individual"
    && input.legacyCopyExists
  ) {
    return {
      action: "confirm_copy_link",
      detail: "This eBay listing needs its exact physical Copy link confirmed.",
    };
  }

  return {
    action: "review_ebay_status",
    detail: "This eBay listing is missing its physical Copy link and needs investigation.",
  };
}

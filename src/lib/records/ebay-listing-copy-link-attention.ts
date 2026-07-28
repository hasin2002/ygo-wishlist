import { isEbayListingDataReviewMessage } from "./ebay-listing-reconciliation-reason.ts";

export type EbayCopyLinkAttentionInput = {
  hasExactMember: boolean;
  kind: "individual" | "quantity" | "bundle";
  legacyCopyExists: boolean;
};

export type EbayCopyLinkAttentionDecision =
  | { action: "confirm_copy_link"; detail: string }
  | { action: "review_ebay_status"; detail: string }
  | null;

export type EbayListingStatusAttentionInput = {
  hasExactMember: boolean;
  lastError: string | null;
  saleState: "none" | "pending" | "paid" | "cancelled" | "needs_review";
};

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

export function ebayListingStatusAttentionDecision(
  input: EbayListingStatusAttentionInput,
) {
  if (!input.hasExactMember) return null;
  const hasDataSafetyError = isEbayListingDataReviewMessage(input.lastError);
  if (input.saleState !== "needs_review" && !hasDataSafetyError) return null;
  return {
    action: "review_ebay_status" as const,
    detail: input.lastError
      ?? "This eBay sale still needs review after its physical Copy link was confirmed.",
  };
}

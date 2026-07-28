import type { EbayLifecycleTransitionReason } from "@/lib/records/ebay-listing-lifecycle";

export const ebayCompositionReviewReasons = [
  "missing_listing_member",
  "multiple_listing_members",
  "non_single_order_quantity",
  "order_line_identity_conflict",
  "order_line_terminal_regression",
  "order_line_quantity_conflict",
  "paid_order_needs_review",
  "copy_allocation_conflict",
] as const;

const legacyGenericReviewMessage = "eBay returned a listing state that needs review.";

export type EbayCompositionReviewReason =
  typeof ebayCompositionReviewReasons[number];

export type EbayListingReviewReason =
  | EbayLifecycleTransitionReason
  | EbayCompositionReviewReason;

const compositionReviewPriority: EbayCompositionReviewReason[] = [
  "missing_listing_member",
  "multiple_listing_members",
  "non_single_order_quantity",
  "order_line_identity_conflict",
  "order_line_quantity_conflict",
  "copy_allocation_conflict",
  "order_line_terminal_regression",
  "paid_order_needs_review",
];

const reviewMessages: Record<EbayListingReviewReason, string> = {
  conflicting_remote_identifier: "eBay returned order details that conflict with the saved listing history.",
  copy_allocation_conflict: "The paid eBay order is not allocated to this exact physical Copy.",
  duplicate_notification: "The same eBay update was received again.",
  invalid_observation: "eBay returned incomplete listing or sale data.",
  missing_listing_member: "This historical eBay listing is missing its exact physical Copy link.",
  multiple_listing_members: "This eBay listing is linked to more than one physical Copy.",
  newer_observation: "A newer eBay update is available.",
  non_single_order_quantity: "The paid eBay order includes more than one item.",
  older_observation: "An older eBay update was ignored.",
  order_line_identity_conflict: "eBay returned order identifiers that conflict with the saved order line.",
  order_line_quantity_conflict: "eBay returned a different quantity for the saved order line.",
  order_line_terminal_regression: "eBay returned an order state that conflicts with its recorded terminal state.",
  paid_order_needs_review: "The paid eBay order was already marked for review.",
  same_state: "The saved eBay lifecycle already matches this update.",
  same_timestamp_conflict: "eBay returned incompatible updates with the same timestamp.",
  unknown_remote_state: "eBay returned a listing state this app cannot safely interpret.",
};

export function ebayListingReviewMessage(reason: EbayListingReviewReason) {
  return `Listing data needs review: ${reviewMessages[reason]}`;
}

export function preferredEbayCompositionReviewReason(
  reasons: Iterable<EbayCompositionReviewReason>,
) {
  const reasonSet = new Set(reasons);
  return compositionReviewPriority.find((reason) => reasonSet.has(reason)) ?? null;
}

export function isEbayListingDataReviewMessage(message: string | null | undefined) {
  return message === legacyGenericReviewMessage
    || Boolean(message?.startsWith("Listing data needs review:"));
}

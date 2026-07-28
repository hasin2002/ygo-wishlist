export type EbayCopyListingBlockStatus =
  | "active_listing"
  | "payment_pending"
  | "paid"
  | "needs_review"
  | "suspended";

export type EbayCopyListingEligibilityCandidate = {
  createdAt: Date;
  id: string;
  listingState: "active" | "ended" | "suspended" | "unknown";
  relistAllowed: boolean;
  saleState: "none" | "pending" | "paid" | "cancelled" | "needs_review";
};

export type EbayCopyListingEligibilityDecision =
  | {
    blockingListingIds: [];
    eligible: true;
    representativeListingId: string | null;
    status: "eligible";
  }
  | {
    blockingListingIds: string[];
    eligible: false;
    representativeListingId: string;
    status: EbayCopyListingBlockStatus;
  };

function blockStatus(
  listing: EbayCopyListingEligibilityCandidate,
): EbayCopyListingBlockStatus {
  if (listing.saleState === "needs_review") return "needs_review";
  if (listing.saleState === "paid") return "paid";
  if (listing.saleState === "pending") return "payment_pending";
  if (
    listing.listingState === "suspended"
    || listing.listingState === "unknown"
  ) {
    return "suspended";
  }
  return "active_listing";
}

const blockPriority: Record<EbayCopyListingBlockStatus, number> = {
  needs_review: 0,
  paid: 1,
  payment_pending: 2,
  suspended: 3,
  active_listing: 4,
};

function newestFirst(
  left: EbayCopyListingEligibilityCandidate,
  right: EbayCopyListingEligibilityCandidate,
) {
  return right.createdAt.getTime() - left.createdAt.getTime()
    || left.id.localeCompare(right.id);
}

/**
 * Decides Copy eligibility across every related Listing. A single unresolved
 * offer blocks relisting even when a newer offer has definitively ended.
 */
export function decideEbayCopyListingEligibility(
  listings: EbayCopyListingEligibilityCandidate[],
): EbayCopyListingEligibilityDecision {
  const newest = [...listings].sort(newestFirst);
  const blocking = newest.filter((listing) => !listing.relistAllowed);
  if (!blocking.length) {
    return {
      blockingListingIds: [],
      eligible: true,
      representativeListingId: newest[0]?.id ?? null,
      status: "eligible",
    };
  }

  const representative = [...blocking].sort((left, right) => {
    return blockPriority[blockStatus(left)] - blockPriority[blockStatus(right)]
      || newestFirst(left, right);
  })[0];

  return {
    blockingListingIds: blocking.map((listing) => listing.id),
    eligible: false,
    representativeListingId: representative.id,
    status: blockStatus(representative),
  };
}

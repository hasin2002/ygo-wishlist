import type { LibraryCardStatus } from "@/lib/records/types";

export type LibraryCardStatusSummary = {
  status: LibraryCardStatus;
  ownedQuantity: number;
  wantedQuantity: number;
  wishlistRemainingQuantity: number;
};

export function getLibraryCardStatus(
  wantedQuantity: number,
  ownedQuantity: number,
): LibraryCardStatusSummary {
  const wishlistRemainingQuantity = Math.max(0, wantedQuantity - ownedQuantity);
  return {
    status: wishlistRemainingQuantity > 0 ? "wishlist" : "owned",
    ownedQuantity,
    wantedQuantity,
    wishlistRemainingQuantity,
  };
}

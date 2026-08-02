import "server-only";

import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  cardCopies,
  cardPrintings,
  cardTargets,
  ebayListingMembers,
  ebayListings,
  ebayOrderLineAllocations,
  ebayOrderLines,
} from "@/db/schema";
import type { PaidEbaySaleReviewIntent } from "@/lib/navigation-intent";
import { compactRecordName, generatedSaleRecordName } from "@/lib/records/record-name";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type CardCopyRow = typeof cardCopies.$inferSelect;

type PaidEbaySaleReviewFailure = {
  ok: false;
  code:
    | "copy_not_found"
    | "listing_not_found"
    | "already_recorded"
    | "not_paid"
    | "unsupported_listing"
    | "copy_unavailable"
    | "copy_mismatch"
    | "order_mismatch";
  message: string;
};

type PaidEbaySaleReviewSuccess = {
  ok: true;
  copyId: string;
  listingId: string;
  orderLineId: string;
};

export type PaidEbaySaleReviewLock = PaidEbaySaleReviewFailure | PaidEbaySaleReviewSuccess;

export type PaidEbaySaleReviewInspection = PaidEbaySaleReviewFailure | (PaidEbaySaleReviewSuccess & {
  card: {
    imageUrl: string | null;
    name: string;
    rarity: string;
    setCode: string;
    setName: string;
  };
  copy: {
    condition: string;
    id: string;
    location: string | null;
    stickerNumber: string | null;
  };
  paidAt: Date | null;
  recordName: string;
  remote: {
    itemId: string;
    orderId: string | null;
    orderLineItemId: string | null;
    transactionId: string | null;
  };
});

const failure = (
  code: PaidEbaySaleReviewFailure["code"],
  message: string,
): PaidEbaySaleReviewFailure => ({ ok: false, code, message });

/**
 * Validates the complete, local paid-sale handoff while holding rows in the
 * shared deterministic order: Copy, membership, Listing, then order data.
 * Callers may pass the Copy already locked by the Sale selection guard.
 */
export async function lockPaidEbaySaleReviewIntent(
  tx: Transaction,
  ownerId: string,
  intent: PaidEbaySaleReviewIntent,
  alreadyLockedCopy?: CardCopyRow,
): Promise<PaidEbaySaleReviewLock> {
  const copy = alreadyLockedCopy ?? (await tx.select().from(cardCopies).where(and(
    eq(cardCopies.ownerId, ownerId),
    eq(cardCopies.id, intent.copyId),
  )).orderBy(asc(cardCopies.id)).for("update").limit(1))[0];
  if (!copy || copy.id !== intent.copyId) {
    return failure(
      "copy_not_found",
      "The physical Copy in this paid Sale review is missing or belongs to another collection. Return to Listings and open the paid listing again.",
    );
  }

  const members = await tx.select().from(ebayListingMembers).where(and(
    eq(ebayListingMembers.ownerId, ownerId),
    eq(ebayListingMembers.listingId, intent.listingId),
  )).orderBy(
    asc(ebayListingMembers.copyId),
    asc(ebayListingMembers.id),
  ).for("update");

  const [listing] = await tx.select().from(ebayListings).where(and(
    eq(ebayListings.ownerId, ownerId),
    eq(ebayListings.id, intent.listingId),
  )).orderBy(asc(ebayListings.id)).for("update").limit(1);
  if (!listing) {
    return failure(
      "listing_not_found",
      "This eBay listing could not be found in this collection. Return to Listings and open the paid listing again.",
    );
  }
  if (listing.saleRecordId) {
    return failure(
      "already_recorded",
      "This paid eBay listing already has a Sale record. Open the listing and review the linked Sale instead.",
    );
  }
  if (
    listing.saleState !== "paid"
    || listing.listingState !== "ended"
  ) {
    return failure(
      "not_paid",
      "This eBay listing is no longer waiting for a paid Sale record. Refresh Listings and review its latest status.",
    );
  }
  if (listing.kind !== "individual" || listing.quantitySold !== 1) {
    return failure(
      "unsupported_listing",
      "Only a one-card individual eBay listing can start this Sale review. Record quantity or bundle sales from the normal Sale form.",
    );
  }
  if (copy.status !== "available" || copy.soldRecordId !== null) {
    return failure(
      "copy_unavailable",
      "This physical Copy is no longer available for a new Sale. Refresh Listings and review its current record.",
    );
  }
  if (
    listing.copyId !== intent.copyId
    || members.length !== 1
    || members[0]!.copyId !== intent.copyId
  ) {
    return failure(
      "copy_mismatch",
      "The physical Copy in this review link no longer exactly matches the eBay listing. Return to Listings and open the paid listing again.",
    );
  }

  const orderLines = await tx.select().from(ebayOrderLines).where(and(
    eq(ebayOrderLines.ownerId, ownerId),
    eq(ebayOrderLines.listingId, intent.listingId),
  )).orderBy(asc(ebayOrderLines.id)).for("update");
  const paidLines = orderLines.filter((line) => line.paymentState === "paid");
  const paidLine = paidLines[0];
  if (
    paidLines.length !== 1
    || !paidLine
    || paidLine.quantityPurchased !== 1
    || paidLine.saleRecordId !== null
  ) {
    return failure(
      "order_mismatch",
      "The paid eBay order no longer has one unlinked one-card order line. Refresh the listing before recording the Sale.",
    );
  }

  const allocations = await tx.select().from(ebayOrderLineAllocations).where(and(
    eq(ebayOrderLineAllocations.ownerId, ownerId),
    eq(ebayOrderLineAllocations.listingId, intent.listingId),
    isNull(ebayOrderLineAllocations.releasedAt),
  )).orderBy(
    asc(ebayOrderLineAllocations.copyId),
    asc(ebayOrderLineAllocations.id),
  ).for("update");
  const allocation = allocations[0];
  if (
    allocations.length !== 1
    || !allocation
    || allocation.orderLineId !== paidLine.id
    || allocation.listingMemberId !== members[0]!.id
    || allocation.copyId !== intent.copyId
    || allocation.fulfilmentPosition !== members[0]!.fulfilmentPosition
  ) {
    return failure(
      "order_mismatch",
      "The paid eBay order no longer has one exact unreleased Copy allocation. Refresh the listing before recording the Sale.",
    );
  }

  return {
    ok: true,
    copyId: intent.copyId,
    listingId: intent.listingId,
    orderLineId: paidLine.id,
  };
}

export function inspectPaidEbaySaleReviewIntent(
  ownerId: string,
  intent: PaidEbaySaleReviewIntent,
) {
  return db.transaction(async (tx): Promise<PaidEbaySaleReviewInspection> => {
    const inspected = await lockPaidEbaySaleReviewIntent(tx, ownerId, intent);
    if (!inspected.ok) return inspected;

    const [details] = await tx.select({
      copy: cardCopies,
      listing: ebayListings,
      orderLine: ebayOrderLines,
      printing: cardPrintings,
      target: cardTargets,
    }).from(cardCopies)
      .innerJoin(cardPrintings, and(
        eq(cardPrintings.id, cardCopies.printingId),
        eq(cardPrintings.ownerId, cardCopies.ownerId),
      ))
      .innerJoin(cardTargets, and(
        eq(cardTargets.id, cardPrintings.targetId),
        eq(cardTargets.ownerId, cardPrintings.ownerId),
      ))
      .innerJoin(ebayListings, and(
        eq(ebayListings.id, inspected.listingId),
        eq(ebayListings.ownerId, cardCopies.ownerId),
      ))
      .innerJoin(ebayOrderLines, and(
        eq(ebayOrderLines.id, inspected.orderLineId),
        eq(ebayOrderLines.ownerId, cardCopies.ownerId),
      ))
      .where(and(
        eq(cardCopies.id, inspected.copyId),
        eq(cardCopies.ownerId, ownerId),
      )).limit(1);

    if (!details) {
      return failure(
        "copy_mismatch",
        "The card details for this physical Copy could not be loaded. Return to Listings and open the paid listing again.",
      );
    }

    return {
      ...inspected,
      card: {
        imageUrl: details.target.imageUrl ?? details.printing.imageUrl,
        name: details.target.name,
        rarity: details.target.rarity,
        setCode: details.printing.setCode,
        setName: details.printing.setName,
      },
      copy: {
        condition: details.copy.condition,
        id: details.copy.id,
        location: details.copy.location,
        stickerNumber: details.copy.stickerNumber,
      },
      paidAt: details.orderLine.paidAt ?? details.listing.paidAt,
      recordName: compactRecordName("", generatedSaleRecordName([details.target.name])),
      remote: {
        itemId: details.listing.itemId,
        orderId: details.orderLine.orderId,
        orderLineItemId: details.orderLine.orderLineItemId,
        transactionId: details.orderLine.transactionId,
      },
    };
  });
}

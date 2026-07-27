import "server-only";

import { and, desc, eq, getTableColumns, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  ebayListingMembers,
  ebayListings,
  ebayOrderLineAllocations,
  ebayOrderLines,
  type EbayListingRow,
} from "@/db/schema";

const { kind: _kind, ...legacyEbayListingColumns } = getTableColumns(ebayListings);
void _kind;

/**
 * Selecting the new `kind` column before the additive migration would make
 * every compatibility read fail. Synthesize its only legacy-safe value.
 */
export const legacySafeEbayListingSelection = {
  ...legacyEbayListingColumns,
  kind: sql<EbayListingRow["kind"]>`'individual'`.as("kind"),
};

/**
 * Additive tables are deliberately optional until the approved migration has
 * run. Callers use this narrow check to retain the legacy single-Copy path.
 */
export function isMissingEbayCompositionSchema(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:ebay_listing_members|ebay_order_lines|ebay_order_line_allocations).*(?:does not exist|missing)/i.test(message)
    || /relation .*?(?:ebay_listing_members|ebay_order_lines|ebay_order_line_allocations).*? does not exist/i.test(message);
}

function isMissingEbayListingKind(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:column .*?kind|ebay_listings\.kind).*(?:does not exist|missing)/i.test(message);
}

export async function hasEbayCompositionSchema() {
  try {
    await Promise.all([
      db.select({ id: ebayListingMembers.id }).from(ebayListingMembers).limit(1),
      db.select({ id: ebayOrderLines.id }).from(ebayOrderLines).limit(1),
      db.select({ id: ebayOrderLineAllocations.id })
        .from(ebayOrderLineAllocations)
        .limit(1),
      db.select({ kind: ebayListings.kind }).from(ebayListings).limit(1),
    ]);
    return true;
  } catch (error) {
    if (isMissingEbayCompositionSchema(error) || isMissingEbayListingKind(error)) {
      return false;
    }
    throw error;
  }
}

export async function getLatestEbayListingForCopyMembershipFirst(
  ownerId: string,
  copyId: string,
): Promise<EbayListingRow | null> {
  try {
    const [memberListing] = await db
      .select({ listing: ebayListings })
      .from(ebayListingMembers)
      .innerJoin(ebayListings, eq(ebayListingMembers.listingId, ebayListings.id))
      .where(and(
        eq(ebayListingMembers.ownerId, ownerId),
        eq(ebayListingMembers.copyId, copyId),
        eq(ebayListings.ownerId, ownerId),
      ))
      .orderBy(desc(ebayListings.createdAt))
      .limit(1);
    if (memberListing) return memberListing.listing;
  } catch (error) {
    if (!isMissingEbayCompositionSchema(error)) throw error;
  }

  try {
    const [listing] = await db
      .select()
      .from(ebayListings)
      .where(and(
        eq(ebayListings.ownerId, ownerId),
        eq(ebayListings.copyId, copyId),
      ))
      .orderBy(desc(ebayListings.createdAt))
      .limit(1);
    return listing ?? null;
  } catch (error) {
    if (!isMissingEbayListingKind(error)) throw error;
    const [legacyListing] = await db
      .select(legacySafeEbayListingSelection)
      .from(ebayListings)
      .where(and(
        eq(ebayListings.ownerId, ownerId),
        eq(ebayListings.copyId, copyId),
      ))
      .orderBy(desc(ebayListings.createdAt))
      .limit(1);
    return legacyListing ?? null;
  }
}

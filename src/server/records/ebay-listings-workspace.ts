import "server-only";

import { and, desc, eq, exists, ilike, inArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import {
  cardCopies,
  cardPrintings,
  cardTargets,
  ebayListingMembers,
  ebayListings,
  ebayOrderLines,
} from "@/db/schema";
import type { EbayListingCompositionFilter, EbayListingLifecycleFilter } from "@/lib/records/ebay-listings-route-state";
import { hasEbayCompositionSchema } from "@/server/ebay-listing-composition";

const pageSize = 24;

export type EbayListingsWorkspaceInput = {
  composition: EbayListingCompositionFilter;
  lifecycle: EbayListingLifecycleFilter;
  listingId?: string;
  page: number;
  query: string;
};

export type EbayListingsWorkspaceMember = {
  copyId: string;
  copyStatus: "available" | "sold" | "void";
  fulfilmentPosition: number;
  id: string;
  imageUrl: string | null;
  name: string;
  setCode: string;
  setName: string;
  stickerNumber: string | null;
  targetId: string;
};

function lifecyclePredicate(lifecycle: EbayListingLifecycleFilter) {
  switch (lifecycle) {
    case "all": return undefined;
    case "live": return eq(ebayListings.listingState, "active");
    case "pending": return eq(ebayListings.saleState, "pending");
    case "paid": return eq(ebayListings.saleState, "paid");
    case "ended": return and(eq(ebayListings.listingState, "ended"), or(
      eq(ebayListings.saleState, "none"),
      eq(ebayListings.saleState, "cancelled"),
    ));
    case "cancelled": return eq(ebayListings.saleState, "cancelled");
    case "needs_attention": return or(
      eq(ebayListings.saleState, "needs_review"),
      eq(ebayListings.listingState, "unknown"),
      eq(ebayListings.listingState, "suspended"),
      sql`${ebayListings.lastError} is not null`,
      sql`${ebayListings.lastSyncedAt} is null or ${ebayListings.lastSyncedAt} < now() - interval '24 hours'`,
    );
  }
}

function listingSearchPredicate(query: string) {
  if (!query) return undefined;
  const pattern = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
  return or(
    ilike(ebayListings.title, pattern),
    ilike(ebayListings.itemId, pattern),
    exists(db.select({ id: ebayListingMembers.id })
      .from(ebayListingMembers)
      .innerJoin(cardCopies, and(
        eq(cardCopies.id, ebayListingMembers.copyId),
        eq(cardCopies.ownerId, ebayListingMembers.ownerId),
      ))
      .innerJoin(cardPrintings, and(
        eq(cardPrintings.id, cardCopies.printingId),
        eq(cardPrintings.ownerId, cardCopies.ownerId),
      ))
      .innerJoin(cardTargets, and(
        eq(cardTargets.id, cardPrintings.targetId),
        eq(cardTargets.ownerId, cardPrintings.ownerId),
      ))
      .where(and(
        eq(ebayListingMembers.ownerId, ebayListings.ownerId),
        eq(ebayListingMembers.listingId, ebayListings.id),
        or(
          ilike(cardTargets.name, pattern),
          ilike(cardPrintings.setName, pattern),
          ilike(cardPrintings.setCode, pattern),
          ilike(ebayListingMembers.copyId, pattern),
          ilike(cardCopies.stickerNumber, pattern),
        ),
      ))),
  );
}

function listingWhere(ownerId: string, input: EbayListingsWorkspaceInput) {
  return and(
    eq(ebayListings.ownerId, ownerId),
    input.listingId ? eq(ebayListings.id, input.listingId) : undefined,
    input.composition === "all" ? undefined : eq(ebayListings.kind, input.composition),
    lifecyclePredicate(input.lifecycle),
    listingSearchPredicate(input.query),
  );
}

export async function listEbayListingsWorkspace(
  ownerId: string,
  input: EbayListingsWorkspaceInput,
) {
  if (!await hasEbayCompositionSchema()) {
    return { items: [], page: 1, pageCount: 1, pageSize, recoveryMessage: "eBay Listing composition is not ready yet. Refresh after the approved Records migration has completed.", total: 0 };
  }
  const where = listingWhere(ownerId, input);
  const [{ total = 0 } = {}] = await db.select({ total: sql<number>`count(*)::int` })
    .from(ebayListings)
    .where(where);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, input.page), pageCount);
  const parentRows = await db.select({ id: ebayListings.id })
    .from(ebayListings)
    .where(where)
    .orderBy(desc(ebayListings.createdAt), desc(ebayListings.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const listingIds = parentRows.map((row) => row.id);
  if (!listingIds.length) return { items: [], page, pageCount, pageSize, total };

  const [listings, memberCounts, orderLineCounts, previewRows, overlapCounts] = await Promise.all([
    db.select().from(ebayListings).where(and(
      eq(ebayListings.ownerId, ownerId),
      inArray(ebayListings.id, listingIds),
    )),
    db.select({ count: sql<number>`count(*)::int`, listingId: ebayListingMembers.listingId })
      .from(ebayListingMembers)
      .where(and(
        eq(ebayListingMembers.ownerId, ownerId),
        inArray(ebayListingMembers.listingId, listingIds),
      ))
      .groupBy(ebayListingMembers.listingId),
    db.select({ count: sql<number>`count(*)::int`, listingId: ebayOrderLines.listingId })
      .from(ebayOrderLines)
      .where(and(
        eq(ebayOrderLines.ownerId, ownerId),
        inArray(ebayOrderLines.listingId, listingIds),
      ))
      .groupBy(ebayOrderLines.listingId),
    db.select({
      copy: cardCopies,
      listingId: ebayListings.id,
      printing: cardPrintings,
      target: cardTargets,
    }).from(ebayListings)
      .leftJoin(cardCopies, and(eq(cardCopies.id, ebayListings.copyId), eq(cardCopies.ownerId, ebayListings.ownerId)))
      .leftJoin(cardPrintings, and(eq(cardPrintings.id, cardCopies.printingId), eq(cardPrintings.ownerId, cardCopies.ownerId)))
      .leftJoin(cardTargets, and(eq(cardTargets.id, cardPrintings.targetId), eq(cardTargets.ownerId, cardPrintings.ownerId)))
      .where(and(eq(ebayListings.ownerId, ownerId), inArray(ebayListings.id, listingIds))),
    (async () => {
      const relatedMembers = alias(ebayListingMembers, "related_ebay_listing_members");
      const relatedListings = alias(ebayListings, "related_active_ebay_listings");
      return db.select({
        count: sql<number>`count(distinct ${relatedListings.id}) filter (where ${relatedListings.id} <> ${ebayListingMembers.listingId})::int`,
        listingId: ebayListingMembers.listingId,
      }).from(ebayListingMembers)
        .innerJoin(relatedMembers, and(eq(relatedMembers.copyId, ebayListingMembers.copyId), eq(relatedMembers.ownerId, ebayListingMembers.ownerId)))
        .innerJoin(relatedListings, and(eq(relatedListings.id, relatedMembers.listingId), eq(relatedListings.ownerId, relatedMembers.ownerId), eq(relatedListings.listingState, "active")))
        .where(and(eq(ebayListingMembers.ownerId, ownerId), inArray(ebayListingMembers.listingId, listingIds)))
        .groupBy(ebayListingMembers.listingId);
    })(),
  ]);

  const memberRows = input.listingId ? await db.select({
    copy: cardCopies,
    member: ebayListingMembers,
    printing: cardPrintings,
    target: cardTargets,
  }).from(ebayListingMembers)
    .innerJoin(cardCopies, and(eq(cardCopies.id, ebayListingMembers.copyId), eq(cardCopies.ownerId, ebayListingMembers.ownerId)))
    .innerJoin(cardPrintings, and(eq(cardPrintings.id, cardCopies.printingId), eq(cardPrintings.ownerId, cardCopies.ownerId)))
    .innerJoin(cardTargets, and(eq(cardTargets.id, cardPrintings.targetId), eq(cardTargets.ownerId, cardPrintings.ownerId)))
    .where(and(eq(ebayListingMembers.ownerId, ownerId), inArray(ebayListingMembers.listingId, listingIds)))
    .orderBy(ebayListingMembers.fulfilmentPosition) : [];
  const orderLines = input.listingId ? await db.select().from(ebayOrderLines).where(and(
    eq(ebayOrderLines.ownerId, ownerId), inArray(ebayOrderLines.listingId, listingIds),
  )).orderBy(desc(ebayOrderLines.createdAt), desc(ebayOrderLines.id)) : [];

  const membersByListing = new Map<string, EbayListingsWorkspaceMember[]>();
  for (const row of memberRows) {
    const members = membersByListing.get(row.member.listingId) ?? [];
    members.push({
      copyId: row.member.copyId,
      copyStatus: row.copy.status,
      fulfilmentPosition: row.member.fulfilmentPosition,
      id: row.member.id,
      imageUrl: row.target.imageUrl ?? row.printing.imageUrl,
      name: row.target.name,
      setCode: row.printing.setCode,
      setName: row.printing.setName,
      stickerNumber: row.copy.stickerNumber,
      targetId: row.target.id,
    });
    membersByListing.set(row.member.listingId, members);
  }
  const orderLinesByListing = new Map<string, typeof orderLines>();
  for (const line of orderLines) {
    const lines = orderLinesByListing.get(line.listingId) ?? [];
    lines.push(line);
    orderLinesByListing.set(line.listingId, lines);
  }
  const memberCountByListing = new Map(memberCounts.map((row) => [row.listingId, row.count]));
  const orderLineCountByListing = new Map(orderLineCounts.map((row) => [row.listingId, row.count]));
  const previewByListing = new Map(previewRows.map((row) => [row.listingId, row]));
  const overlapCountByListing = new Map(overlapCounts.map((row) => [row.listingId, row.count]));
  const listingById = new Map(listings.map((listing) => [listing.id, listing]));

  return {
    items: listingIds.flatMap((listingId) => {
      const listing = listingById.get(listingId);
      if (!listing) return [];
      const members = membersByListing.get(listingId) ?? [];
      const preview = previewByListing.get(listingId);
      const previewMember = preview?.copy && preview.printing && preview.target ? [{
        copyId: preview.copy.id,
        copyStatus: preview.copy.status,
        fulfilmentPosition: 0,
        id: `preview-${listingId}`,
        imageUrl: preview.target.imageUrl ?? preview.printing.imageUrl,
        name: preview.target.name,
        setCode: preview.printing.setCode,
        setName: preview.printing.setName,
        stickerNumber: preview.copy.stickerNumber,
        targetId: preview.target.id,
      }] : [];
      return [{
        ...listing,
        memberCount: memberCountByListing.get(listingId) ?? 0,
        orderLineCount: orderLineCountByListing.get(listingId) ?? 0,
        members: input.listingId ? members : previewMember,
        orderLines: orderLinesByListing.get(listingId) ?? [],
        overlapCount: overlapCountByListing.get(listingId) ?? 0,
      }];
    }),
    page,
    pageCount,
    pageSize,
    total,
  };
}

export const ebayListingsWorkspacePageSize = pageSize;

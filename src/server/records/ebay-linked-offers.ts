import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/db";
import {
  cardCopies,
  cardPrintings,
  cardTargets,
  ebayListingFamilies,
  ebayListingFamilyOffers,
  ebayListingMembers,
  ebayListings,
  recordEntries,
} from "@/db/schema";
import {
  linkedOfferFingerprint,
  linkedOfferOperations,
  linkedOfferPlanProblem,
  linkedOfferVariantAvailability,
  protectLinkedOfferWishlistCopies,
  selectLinkedOfferCopies,
  type LinkedOffer,
  type LinkedOfferOperation,
} from "@/lib/records/ebay-linked-offers";
import type { CardCondition } from "@/lib/records/types";
import {
  type EbayQuantityListingDetails,
  listingItemXml,
} from "@/server/ebay-listing";
import {
  callEbayTradingApi,
  duplicateEbayItemId,
  ebayXmlContainers,
  ebayXmlEscape,
  ebayXmlText,
  getEbayRemoteListing,
} from "@/server/ebay-trading";
import { CopySelectionError, lockReconciledCopies } from "@/server/records/copy-selection";
import { getEbayListingsForCopiesMembershipFirst } from "@/server/ebay-listing-composition";

export class LinkedOfferError extends Error {}

export type LinkedOfferDetails = EbayQuantityListingDetails;

type SaveOffer = LinkedOfferOperation & {
  details: LinkedOfferDetails;
};

type InspectedActiveOffer = LinkedOffer & {
  blockedReason: string | null;
  listingId: string;
};

function digest(value: unknown) {
  return createHash("sha256").update(linkedOfferFingerprint(value)).digest("hex");
}

function publicationUuid(familyId: string, kind: LinkedOfferOperation["kind"], planFingerprint: string) {
  return createHash("sha256").update(`${familyId}\0${kind}\0${planFingerprint}`).digest("hex").slice(0, 32).toUpperCase();
}

function offerSetSize(kind: LinkedOfferOperation["kind"]) {
  return kind === "x2" ? 2 : kind === "x3" ? 3 : undefined;
}

function activeState(value: string) {
  return value === "active" || value === "unknown" || value === "suspended";
}

function localBuyerActivityReason(listing: typeof ebayListings.$inferSelect) {
  return (listing.quantitySold ?? 0) > 0 || listing.saleState !== "none"
    ? "Buyer activity is recorded for this offer. Review it on eBay before changing or ending it."
    : null;
}

export async function inspectLinkedOfferVariant(ownerId: string, printingId: string, condition: CardCondition) {
  const [printing] = await db.select().from(cardPrintings).where(and(
    eq(cardPrintings.id, printingId),
    eq(cardPrintings.ownerId, ownerId),
  )).limit(1);
  if (!printing) throw new LinkedOfferError("That card Printing no longer exists.");
  const [target] = await db.select().from(cardTargets).where(and(
    eq(cardTargets.id, printing.targetId),
    eq(cardTargets.ownerId, ownerId),
  )).limit(1);
  if (!target) throw new LinkedOfferError("That Wishlist target no longer exists.");

  const targetCopies = await db.select({
    copy: cardCopies,
    acquiredOn: recordEntries.occurredOn,
  }).from(cardCopies)
    .innerJoin(cardPrintings, and(
      eq(cardCopies.printingId, cardPrintings.id),
      eq(cardCopies.ownerId, cardPrintings.ownerId),
    ))
    .innerJoin(recordEntries, and(
      eq(cardCopies.acquiredRecordId, recordEntries.id),
      eq(cardCopies.ownerId, recordEntries.ownerId),
    ))
    .where(and(
      eq(cardCopies.ownerId, ownerId),
      eq(cardPrintings.targetId, target.id),
    ));
  const eligibleTargetCopies = targetCopies.filter(({ copy }) => copy.status === "available" && !copy.soldRecordId);

  const [family] = await db.select().from(ebayListingFamilies).where(and(
    eq(ebayListingFamilies.ownerId, ownerId),
    eq(ebayListingFamilies.printingId, printingId),
    eq(ebayListingFamilies.edition, target.edition),
    eq(ebayListingFamilies.condition, condition),
  )).limit(1);
  const otherFamilies = await db.select({
    id: ebayListingFamilies.id,
    selectedCopyIds: ebayListingFamilies.selectedCopyIds,
  }).from(ebayListingFamilies).where(and(
    eq(ebayListingFamilies.ownerId, ownerId),
    eq(ebayListingFamilies.targetId, target.id),
    family ? ne(ebayListingFamilies.id, family.id) : undefined,
  ));
  const otherIds = otherFamilies.map((candidate) => candidate.id);
  const committedFamilyIds = new Set(otherIds.length ? (await db.select({ familyId: ebayListingFamilyOffers.familyId })
    .from(ebayListingFamilyOffers)
    .where(and(
      eq(ebayListingFamilyOffers.ownerId, ownerId),
      inArray(ebayListingFamilyOffers.familyId, otherIds),
      inArray(ebayListingFamilyOffers.state, ["publishing", "published", "uncertain"]),
    ))).map((row) => row.familyId) : []);
  const committedCopyIds = new Set(otherFamilies
    .filter((candidate) => committedFamilyIds.has(candidate.id))
    .flatMap((candidate) => candidate.selectedCopyIds));
  const protectedTargetCopies = protectLinkedOfferWishlistCopies(eligibleTargetCopies
    .filter(({ copy }) => !committedCopyIds.has(copy.id))
    .map(({ copy, acquiredOn }) => ({
      acquiredAt: `${acquiredOn}T00:00:00.000Z/${copy.createdAt.toISOString()}`,
      condition: copy.condition,
      copyId: copy.id,
      edition: target.edition,
      printingId: copy.printingId,
    })), target.desiredQuantity);
  const protectedById = new Map(protectedTargetCopies.map((copy) => [copy.copyId, copy]));
  const copies = eligibleTargetCopies
    .filter(({ copy }) => copy.printingId === printingId && copy.condition === condition && !committedCopyIds.has(copy.id))
    .map(({ copy, acquiredOn }) => ({
      ...copy,
      acquiredAt: `${acquiredOn}T00:00:00.000Z/${copy.createdAt.toISOString()}`,
      wishlistProtected: protectedById.get(copy.id)?.wishlistProtected ?? false,
    }))
    .sort((left, right) => Number(left.wishlistProtected) - Number(right.wishlistProtected)
      || left.acquiredAt.localeCompare(right.acquiredAt)
      || left.id.localeCompare(right.id));
  const availability = linkedOfferVariantAvailability(copies.map((copy) => ({
    acquiredAt: copy.acquiredAt,
    condition: copy.condition,
    copyId: copy.id,
    edition: target.edition,
    printingId: copy.printingId,
    wishlistProtected: copy.wishlistProtected,
  })));

  const offers = family ? await db.select().from(ebayListingFamilyOffers).where(and(
    eq(ebayListingFamilyOffers.ownerId, ownerId),
    eq(ebayListingFamilyOffers.familyId, family.id),
  )) : [];
  const listingIds = offers.flatMap((offer) => offer.listingId ? [offer.listingId] : []);
  const listings = listingIds.length ? await db.select().from(ebayListings).where(and(
    eq(ebayListings.ownerId, ownerId),
    inArray(ebayListings.id, listingIds),
  )) : [];
  const listingById = new Map(listings.map((listing) => [listing.id, listing]));
  const familyActiveOffers = offers.flatMap((offer): InspectedActiveOffer[] => {
    const listing = offer.listingId ? listingById.get(offer.listingId) : null;
    return listing && activeState(listing.listingState) ? [{
      kind: offer.kind,
      blockedReason: localBuyerActivityReason(listing),
      listingId: listing.id,
      quantity: Math.max(0, offer.desiredQuantity - (listing.quantitySold ?? 0)),
      state: listing.listingState === "active" ? "active" : "unknown",
    }] : [];
  });

  const familyListingIds = new Set(familyActiveOffers.map((offer) => offer.listingId));
  const compatibleCopyIds = targetCopies
    .filter(({ copy }) => copy.printingId === printingId && copy.condition === condition)
    .map(({ copy }) => copy.id);
  const legacyRelations = await getEbayListingsForCopiesMembershipFirst(ownerId, compatibleCopyIds);
  const legacyListings = new Map<string, { listing: typeof ebayListings.$inferSelect; copyIds: Set<string> }>();
  for (const relation of legacyRelations) {
    if (familyListingIds.has(relation.listing.id) || relation.listing.kind === "bundle" || !activeState(relation.listing.listingState)) continue;
    const current = legacyListings.get(relation.listing.id) ?? { listing: relation.listing, copyIds: new Set<string>() };
    current.copyIds.add(relation.copyId);
    legacyListings.set(relation.listing.id, current);
  }
  const activeOffers: InspectedActiveOffer[] = [
    ...familyActiveOffers,
    ...Array.from(legacyListings.values(), ({ listing, copyIds }) => ({
      kind: "individual" as const,
      blockedReason: localBuyerActivityReason(listing),
      listingId: listing.id,
      quantity: Math.max(0, copyIds.size - (listing.quantitySold ?? 0)),
      state: listing.listingState === "active" ? "active" as const : "unknown" as const,
    })),
  ];
  const planProblem = linkedOfferPlanProblem(activeOffers);

  return { activeOffers, availability, copies, family, offers, planProblem, target, printing };
}

function sameOperation(left: LinkedOfferOperation, right: LinkedOfferOperation) {
  return left.action === right.action
    && left.desiredQuantity === right.desiredQuantity
    && left.kind === right.kind
    && left.listingId === right.listingId;
}

export async function saveLinkedOfferPool(input: {
  ownerId: string;
  printingId: string;
  condition: CardCondition;
  copyIds: string[];
  listKeptCopies: boolean;
  mode: "individual" | "linked";
  draft: unknown;
  offers: SaveOffer[];
}) {
  const inspected = await inspectLinkedOfferVariant(input.ownerId, input.printingId, input.condition);
  if (inspected.planProblem) throw new LinkedOfferError(inspected.planProblem);
  const defaultMaximum = Math.min(inspected.copies.length, inspected.availability.toList);
  const maximum = input.listKeptCopies ? inspected.copies.length : defaultMaximum;
  if (input.copyIds.length > maximum) throw new LinkedOfferError(input.listKeptCopies
    ? "The selected quantity exceeds eligible Owned Copies."
    : "Enable List kept copies before selecting beyond the target-wide Wishlist hold.");
  const selected = selectLinkedOfferCopies(inspected.copies.map((copy) => ({
    acquiredAt: copy.acquiredAt,
    condition: copy.condition,
    copyId: copy.id,
    edition: inspected.target.edition,
    printingId: copy.printingId,
    wishlistProtected: copy.wishlistProtected,
  })), input.copyIds.length);
  if (selected.map((copy) => copy.copyId).join("\0") !== input.copyIds.join("\0")) {
    throw new LinkedOfferError("Stock changed or selection is no longer the stable oldest-first exact Copy pool. Refresh and review it again.");
  }
  const expected = linkedOfferOperations(inspected.activeOffers, input.copyIds.length, input.mode);
  const blockedMutation = expected.find((operation) => (
    (operation.action === "update" || operation.action === "end")
    && inspected.activeOffers.find((offer) => offer.listingId === operation.listingId)?.blockedReason
  ));
  if (blockedMutation) {
    throw new LinkedOfferError(inspected.activeOffers.find((offer) => offer.listingId === blockedMutation.listingId)?.blockedReason
      ?? "Buyer activity prevents this offer change.");
  }
  if (expected.length !== input.offers.length || expected.some((operation) => !input.offers.some((offer) => sameOperation(operation, offer)))) {
    throw new LinkedOfferError("The active eBay offers changed. Refresh the change preview before saving this plan.");
  }
  if (input.offers.some((offer) => offer.details.copyIds.join("\0") !== input.copyIds.join("\0") || offer.details.imageDraftCopyId !== input.copyIds[0])) {
    throw new LinkedOfferError("Every offer must retain the reviewed exact Copy pool and its first stable photo-draft Copy.");
  }
  const now = new Date();
  return db.transaction(async (tx) => {
    try {
      await lockReconciledCopies(tx, input.ownerId, input.copyIds);
    } catch (error) {
      throw error instanceof CopySelectionError ? new LinkedOfferError(error.message) : error;
    }
    const [lockedTarget] = await tx.select().from(cardTargets).where(and(
      eq(cardTargets.id, inspected.target.id),
      eq(cardTargets.ownerId, input.ownerId),
    )).limit(1).for("update");
    if (!lockedTarget) throw new LinkedOfferError("That Wishlist target changed before the plan could be saved.");
    const transactionalTargetCopies = await tx.select({
      copy: cardCopies,
      acquiredOn: recordEntries.occurredOn,
    }).from(cardCopies)
      .innerJoin(cardPrintings, and(
        eq(cardCopies.printingId, cardPrintings.id),
        eq(cardCopies.ownerId, cardPrintings.ownerId),
      ))
      .innerJoin(recordEntries, and(
        eq(cardCopies.acquiredRecordId, recordEntries.id),
        eq(cardCopies.ownerId, recordEntries.ownerId),
      ))
      .where(and(
        eq(cardCopies.ownerId, input.ownerId),
        eq(cardPrintings.targetId, lockedTarget.id),
      ));
    const transactionalEligible = transactionalTargetCopies.filter(({ copy }) => copy.status === "available" && !copy.soldRecordId);
    const transactionalOtherFamilies = await tx.select({
      id: ebayListingFamilies.id,
      selectedCopyIds: ebayListingFamilies.selectedCopyIds,
    }).from(ebayListingFamilies).where(and(
      eq(ebayListingFamilies.ownerId, input.ownerId),
      eq(ebayListingFamilies.targetId, lockedTarget.id),
      inspected.family ? ne(ebayListingFamilies.id, inspected.family.id) : undefined,
    ));
    const transactionalOtherIds = transactionalOtherFamilies.map((candidate) => candidate.id);
    const transactionalCommittedIds = new Set(transactionalOtherIds.length ? (await tx.select({ familyId: ebayListingFamilyOffers.familyId })
      .from(ebayListingFamilyOffers)
      .where(and(
        eq(ebayListingFamilyOffers.ownerId, input.ownerId),
        inArray(ebayListingFamilyOffers.familyId, transactionalOtherIds),
        inArray(ebayListingFamilyOffers.state, ["publishing", "published", "uncertain"]),
      ))).map((row) => row.familyId) : []);
    const transactionalCommittedCopyIds = new Set(transactionalOtherFamilies
      .filter((candidate) => transactionalCommittedIds.has(candidate.id))
      .flatMap((candidate) => candidate.selectedCopyIds));
    const transactionalProtected = protectLinkedOfferWishlistCopies(transactionalEligible
      .filter(({ copy }) => !transactionalCommittedCopyIds.has(copy.id))
      .map(({ copy, acquiredOn }) => ({
        acquiredAt: `${acquiredOn}T00:00:00.000Z/${copy.createdAt.toISOString()}`,
        condition: copy.condition,
        copyId: copy.id,
        edition: lockedTarget.edition,
        printingId: copy.printingId,
      })), lockedTarget.desiredQuantity);
    const transactionalCandidates = transactionalProtected
      .filter((copy) => copy.printingId === input.printingId && copy.condition === input.condition);
    const transactionalAvailability = linkedOfferVariantAvailability(transactionalCandidates);
    const transactionalMaximum = input.listKeptCopies
      ? transactionalCandidates.length
      : Math.min(transactionalCandidates.length, transactionalAvailability.toList);
    const transactionalSelection = selectLinkedOfferCopies(transactionalCandidates, input.copyIds.length);
    if (input.copyIds.length > transactionalMaximum || transactionalSelection.map((copy) => copy.copyId).join("\0") !== input.copyIds.join("\0")) {
      throw new LinkedOfferError("Stock, the Wishlist hold, or the stable oldest-first Copy pool changed while saving. Refresh and review the plan again.");
    }
    const planFingerprint = digest({
      copyIds: input.copyIds,
      listKeptCopies: input.listKeptCopies,
      mode: input.mode,
      offers: input.offers.map(({ action, desiredQuantity, kind, listingId, details }) => ({ action, desiredQuantity, kind, listingId, details })),
    });
    const familyId = inspected.family?.id ?? `ebay-listing-family-${randomUUID()}`;
    await tx.insert(ebayListingFamilies).values({
      id: familyId,
      ownerId: input.ownerId,
      targetId: inspected.target.id,
      printingId: input.printingId,
      edition: inspected.target.edition,
      condition: input.condition,
      selectedCopyIds: input.copyIds,
      wishlistOverride: input.listKeptCopies,
      planFingerprint,
      draft: input.draft,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [ebayListingFamilies.ownerId, ebayListingFamilies.printingId, ebayListingFamilies.edition, ebayListingFamilies.condition],
      set: { selectedCopyIds: input.copyIds, wishlistOverride: input.listKeptCopies, planFingerprint, draft: input.draft, updatedAt: now },
    });
    for (const offer of input.offers) {
      const id = `ebay-family-offer-${digest({ familyId, kind: offer.kind }).slice(0, 32)}`;
      const requestFingerprint = digest({
        action: offer.action,
        copyIds: input.copyIds,
        desiredQuantity: offer.desiredQuantity,
        details: offer.details,
        kind: offer.kind,
      });
      const [existing] = await tx.select().from(ebayListingFamilyOffers).where(and(
        eq(ebayListingFamilyOffers.ownerId, input.ownerId),
        eq(ebayListingFamilyOffers.familyId, familyId),
        eq(ebayListingFamilyOffers.kind, offer.kind),
      )).limit(1);
      if (existing && ["publishing", "uncertain"].includes(existing.state) && existing.requestFingerprint !== requestFingerprint) {
        throw new LinkedOfferError("An unresolved eBay operation is bound to the previous details. Retry or resolve it before editing this offer.");
      }
      const nextState = existing?.requestFingerprint === requestFingerprint ? existing.state : "prepared" as const;
      await tx.insert(ebayListingFamilyOffers).values({
        id,
        ownerId: input.ownerId,
        familyId,
        kind: offer.kind,
        action: offer.action,
        desiredQuantity: offer.desiredQuantity,
        listingId: offer.listingId,
        publicationUuid: publicationUuid(familyId, offer.kind, planFingerprint),
        requestFingerprint,
        state: nextState,
        review: nextState === "prepared" ? null : existing?.review ?? null,
        details: offer.details,
        lastError: nextState === "prepared" ? null : existing?.lastError ?? null,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      }).onConflictDoUpdate({
        target: [ebayListingFamilyOffers.ownerId, ebayListingFamilyOffers.familyId, ebayListingFamilyOffers.kind],
        set: {
          action: offer.action,
          desiredQuantity: offer.desiredQuantity,
          listingId: offer.listingId,
          publicationUuid: existing?.requestFingerprint === requestFingerprint ? existing.publicationUuid : publicationUuid(familyId, offer.kind, planFingerprint),
          requestFingerprint,
          state: nextState,
          review: nextState === "prepared" ? null : existing?.review ?? null,
          details: offer.details,
          lastError: nextState === "prepared" ? null : existing?.lastError ?? null,
          updatedAt: now,
        },
      });
    }
    return { familyId, planFingerprint };
  });
}

function reviewResult(xml: string) {
  const errors = ebayXmlContainers(xml, "Errors").map((container) => ({
    code: ebayXmlText(container, "ErrorCode"),
    message: ebayXmlText(container, "LongMessage") ?? ebayXmlText(container, "ShortMessage"),
    severity: ebayXmlText(container, "SeverityCode"),
  }));
  const fees = ebayXmlContainers(xml, "Fee").map((container) => ({
    amount: Number(ebayXmlText(container, "Fee") ?? 0),
    currency: container.match(/<Fee currencyID="([^"]+)"/)?.[1] ?? "GBP",
    name: ebayXmlText(container, "Name"),
  }));
  return { errors, fees, readyToPublish: !errors.some((error) => error.severity === "Error") };
}

function assertSafeRemoteChange(remote: Awaited<ReturnType<typeof getEbayRemoteListing>>) {
  if (remote.quantitySold > 0 || remote.transactions.some((transaction) => !transaction.cancelled)) {
    throw new LinkedOfferError("This offer has buyer activity and cannot be changed safely from the listing plan. Review it on eBay first.");
  }
}

async function familyWithOffers(ownerId: string, familyId: string) {
  const [family] = await db.select().from(ebayListingFamilies).where(and(
    eq(ebayListingFamilies.id, familyId),
    eq(ebayListingFamilies.ownerId, ownerId),
  )).limit(1);
  if (!family) throw new LinkedOfferError("That listing plan no longer exists.");
  const offers = await db.select().from(ebayListingFamilyOffers).where(and(
    eq(ebayListingFamilyOffers.ownerId, ownerId),
    eq(ebayListingFamilyOffers.familyId, familyId),
  ));
  return { family, offers };
}

async function listingForOffer(ownerId: string, listingId: string | null) {
  if (!listingId) throw new LinkedOfferError("The active eBay offer is no longer linked to this plan.");
  const [listing] = await db.select().from(ebayListings).where(and(
    eq(ebayListings.ownerId, ownerId),
    eq(ebayListings.id, listingId),
  )).limit(1);
  if (!listing) throw new LinkedOfferError("The active eBay offer could not be found.");
  return listing;
}

export async function reviewLinkedOfferPlan(ownerId: string, familyId: string) {
  const { offers } = await familyWithOffers(ownerId, familyId);
  const results = [];
  for (const offer of offers) {
    if (offer.state === "published") {
      results.push({ id: offer.id, kind: offer.kind, review: offer.review, state: "published" as const });
      continue;
    }
    let review: unknown = null;
    try {
      if (offer.action === "create") {
        const details = offer.details as LinkedOfferDetails;
        const xml = (await callEbayTradingApi({
          body: listingItemXml(details, details.copyIds.length > 1 ? "quantity" : "individual", offer.publicationUuid, offer.desiredQuantity, offerSetSize(offer.kind)),
          callName: "VerifyAddItem",
          ownerId,
        })).xml;
        review = reviewResult(xml);
        if (!(review as { readyToPublish: boolean }).readyToPublish) throw new LinkedOfferError("eBay did not approve this offer. Review its messages and details.");
      } else if (offer.action === "update" || offer.action === "end") {
        const listing = await listingForOffer(ownerId, offer.listingId);
        const remote = await getEbayRemoteListing(ownerId, listing.itemId);
        assertSafeRemoteChange(remote);
        review = { errors: [], fees: [], readyToPublish: true, remoteState: remote.listingStatus };
      } else {
        review = { errors: [], fees: [], readyToPublish: true };
      }
      await db.update(ebayListingFamilyOffers).set({ review, state: "reviewed", lastError: null, updatedAt: new Date() }).where(and(
        eq(ebayListingFamilyOffers.ownerId, ownerId), eq(ebayListingFamilyOffers.id, offer.id),
      ));
      results.push({ id: offer.id, kind: offer.kind, review, state: "reviewed" as const });
    } catch (error) {
      const message = error instanceof Error ? error.message : "This offer could not be reviewed.";
      await db.update(ebayListingFamilyOffers).set({ review, state: "failed", lastError: message, updatedAt: new Date() }).where(and(
        eq(ebayListingFamilyOffers.ownerId, ownerId), eq(ebayListingFamilyOffers.id, offer.id),
      ));
      results.push({ id: offer.id, kind: offer.kind, error: message, review, state: "failed" as const });
    }
  }
  return results;
}

async function revalidateFamilyPool(ownerId: string, familyId: string, copyIds: string[]) {
  const { family } = await familyWithOffers(ownerId, familyId);
  const inspected = await inspectLinkedOfferVariant(ownerId, family.printingId, family.condition as CardCondition);
  if (inspected.planProblem) throw new LinkedOfferError(inspected.planProblem);
  const maximum = family.wishlistOverride
    ? inspected.copies.length
    : Math.min(inspected.copies.length, inspected.availability.toList);
  if (copyIds.length > maximum) throw new LinkedOfferError(family.wishlistOverride
    ? "The kept-Copy override now exceeds eligible Owned stock. Review the plan again."
    : "The Wishlist hold or available stock changed. Review the listing quantity again.");
  const expectedCopyIds = selectLinkedOfferCopies(inspected.copies.map((copy) => ({
    acquiredAt: copy.acquiredAt,
    condition: copy.condition,
    copyId: copy.id,
    edition: inspected.target.edition,
    printingId: copy.printingId,
    wishlistProtected: copy.wishlistProtected,
  })), copyIds.length).map((copy) => copy.copyId);
  if (expectedCopyIds.join("\0") !== copyIds.join("\0")) {
    throw new LinkedOfferError("The stable oldest-first Copy pool changed. Return to Review before publishing.");
  }
  await db.transaction(async (tx) => {
    await lockReconciledCopies(tx, ownerId, copyIds);
    const siblings = await tx.select({ listingId: ebayListingFamilyOffers.listingId }).from(ebayListingFamilyOffers).where(and(
      eq(ebayListingFamilyOffers.ownerId, ownerId),
      eq(ebayListingFamilyOffers.familyId, familyId),
    ));
    const siblingIds = new Set(siblings.flatMap((row) => row.listingId ? [row.listingId] : []));
    const related = await tx.select({ listingId: ebayListings.id, state: ebayListings.listingState })
      .from(ebayListingMembers)
      .innerJoin(ebayListings, and(
        eq(ebayListingMembers.listingId, ebayListings.id),
        eq(ebayListingMembers.ownerId, ebayListings.ownerId),
      ))
      .where(and(eq(ebayListingMembers.ownerId, ownerId), inArray(ebayListingMembers.copyId, copyIds)));
    if (related.some((row) => !siblingIds.has(row.listingId) && activeState(row.state))) {
      throw new LinkedOfferError("A selected Copy gained an unrelated live or uncertain eBay offer. Refresh the plan before publishing.");
    }
  });
}

async function recordCreatedOffer(ownerId: string, familyId: string, offer: typeof ebayListingFamilyOffers.$inferSelect, itemId: string) {
  const details = offer.details as LinkedOfferDetails;
  const now = new Date();
  const listingId = `ebay-listing-${offer.publicationUuid}`;
  await db.transaction(async (tx) => {
    const [existingByItem] = await tx.select({ id: ebayListings.id, ownerId: ebayListings.ownerId }).from(ebayListings).where(eq(ebayListings.itemId, itemId)).limit(1);
    if (existingByItem && (existingByItem.ownerId !== ownerId || existingByItem.id !== listingId)) {
      throw new LinkedOfferError("The recovered eBay item is already bound to a different local listing.");
    }
    const resolvedListingId = existingByItem?.id ?? listingId;
    if (!existingByItem) {
      await tx.insert(ebayListings).values({
        id: listingId,
        ownerId,
        copyId: details.copyIds[0]!,
        kind: details.copyIds.length > 1 ? "quantity" : "individual",
        itemId,
        listingUrl: `https://www.ebay.co.uk/itm/${itemId}`,
        title: details.title,
        status: "active",
        listingState: "active",
        saleState: "none",
        listingStartedAt: now,
        lastRemoteEventAt: now,
        lastSyncedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      await tx.insert(ebayListingMembers).values(details.copyIds.map((copyId, position) => ({
        id: `ebay-listing-member-${offer.publicationUuid}-${position}`,
        ownerId,
        listingId,
        copyId,
        fulfilmentPosition: position,
        createdAt: now,
        updatedAt: now,
      })));
    }
    await tx.update(ebayListingFamilyOffers).set({
      listingId: resolvedListingId,
      state: "published",
      lastError: null,
      updatedAt: now,
    }).where(and(
      eq(ebayListingFamilyOffers.ownerId, ownerId),
      eq(ebayListingFamilyOffers.familyId, familyId),
      eq(ebayListingFamilyOffers.id, offer.id),
    ));
  });
}

async function publishOne(ownerId: string, familyId: string, offer: typeof ebayListingFamilyOffers.$inferSelect) {
  let remoteAttempted = false;
  try {
    if (offer.action === "no_change") {
      await db.update(ebayListingFamilyOffers).set({ state: "published", lastError: null, updatedAt: new Date() }).where(eq(ebayListingFamilyOffers.id, offer.id));
      return;
    }
    if (offer.action === "create") {
      const details = offer.details as LinkedOfferDetails;
      const itemXml = listingItemXml(details, details.copyIds.length > 1 ? "quantity" : "individual", offer.publicationUuid, offer.desiredQuantity, offerSetSize(offer.kind));
      remoteAttempted = true;
      let itemId: string | null = null;
      try {
        const response = await callEbayTradingApi({
          body: `<MessageID>${offer.publicationUuid}</MessageID>${itemXml}`,
          callName: "AddItem",
          ownerId,
        });
        itemId = ebayXmlText(response.xml, "ItemID");
      } catch (error) {
        itemId = duplicateEbayItemId(error);
        if (!itemId) throw error;
      }
      if (!itemId) throw new LinkedOfferError("eBay did not return an item identity. Review the offer before retrying.");
      await recordCreatedOffer(ownerId, familyId, offer, itemId);
      return;
    }

    const listing = await listingForOffer(ownerId, offer.listingId);
    const remote = await getEbayRemoteListing(ownerId, listing.itemId);
    assertSafeRemoteChange(remote);
    if (offer.action === "update") {
      if (remote.quantityAvailable !== offer.desiredQuantity) {
        remoteAttempted = true;
        await callEbayTradingApi({
          body: `<InventoryStatus><ItemID>${ebayXmlEscape(listing.itemId)}</ItemID><Quantity>${offer.desiredQuantity}</Quantity></InventoryStatus>`,
          callName: "ReviseInventoryStatus",
          ownerId,
        });
        const confirmed = await getEbayRemoteListing(ownerId, listing.itemId);
        if (confirmed.quantityAvailable !== offer.desiredQuantity) throw new LinkedOfferError("eBay did not confirm the requested quantity update.");
      }
    } else if (offer.action === "end" && remote.listingStatus?.toLowerCase() !== "ended") {
      remoteAttempted = true;
      await callEbayTradingApi({
        body: `<ItemID>${ebayXmlEscape(listing.itemId)}</ItemID><EndingReason>NotAvailable</EndingReason>`,
        callName: "EndItem",
        ownerId,
      });
    }
    const now = new Date();
    await db.transaction(async (tx) => {
      if (offer.action === "end") await tx.update(ebayListings).set({ status: "ended", listingState: "ended", listingEndedAt: now, updatedAt: now }).where(eq(ebayListings.id, listing.id));
      await tx.update(ebayListingFamilyOffers).set({ state: "published", lastError: null, updatedAt: now }).where(eq(ebayListingFamilyOffers.id, offer.id));
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The eBay operation failed.";
    await db.update(ebayListingFamilyOffers).set({
      state: remoteAttempted ? "uncertain" : "failed",
      lastError: message,
      updatedAt: new Date(),
    }).where(and(eq(ebayListingFamilyOffers.ownerId, ownerId), eq(ebayListingFamilyOffers.id, offer.id)));
    throw error;
  }
}

export async function publishLinkedOfferPlan(ownerId: string, familyId: string) {
  const { family, offers } = await familyWithOffers(ownerId, familyId);
  await revalidateFamilyPool(ownerId, familyId, family.selectedCopyIds);
  const ordered = [...offers].sort((left, right) => (
    ["end", "update", "create", "no_change"].indexOf(left.action)
      - ["end", "update", "create", "no_change"].indexOf(right.action)
  ));
  const results = [];
  for (const offer of ordered) {
    if (offer.state === "published") {
      results.push({ id: offer.id, kind: offer.kind, state: offer.state });
      continue;
    }
    const reviewed = offer.review as { readyToPublish?: boolean } | null;
    if (!["reviewed", "failed", "uncertain", "publishing"].includes(offer.state) || reviewed?.readyToPublish !== true) {
      results.push({ id: offer.id, kind: offer.kind, error: "Review this offer before publishing.", state: offer.state });
      continue;
    }
    await db.update(ebayListingFamilyOffers).set({ state: "publishing", updatedAt: new Date() }).where(eq(ebayListingFamilyOffers.id, offer.id));
    try {
      await publishOne(ownerId, familyId, offer);
      results.push({ id: offer.id, kind: offer.kind, state: "published" as const });
    } catch (error) {
      const [failed] = await db.select({ state: ebayListingFamilyOffers.state }).from(ebayListingFamilyOffers).where(and(
        eq(ebayListingFamilyOffers.ownerId, ownerId),
        eq(ebayListingFamilyOffers.id, offer.id),
      )).limit(1);
      results.push({ id: offer.id, kind: offer.kind, error: error instanceof Error ? error.message : "Publishing failed.", state: failed?.state ?? "failed" });
      break;
    }
  }
  return results;
}

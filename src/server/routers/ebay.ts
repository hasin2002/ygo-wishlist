import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  cardCopies,
  cardPrintings,
  cardTargets,
  ebayListingPublicationGroups,
  ebayListings,
} from "@/db/schema";
import {
  ebayCardCategory,
  ebayLotCategory,
  ebayListingLanguages,
} from "@/lib/ebay-listing-options";
import {
  EbayAuthorizationError,
  EbayTemporaryError,
  getEbayConnectionStatus,
  isEbayOAuthConfigured,
} from "@/server/ebay-seller";
import { isListingImageArchiveConfigured } from "@/server/ebay-listing-images";
import {
  EbayListingError,
  getEbayListingEligibility,
  publishEbayLotListing,
  publishEbayListing,
  publishEbayQuantityListing,
  verifyEbayLotListing,
  verifyEbayListing,
  verifyEbayQuantityListing,
} from "@/server/ebay-listing";
import {
  ebayCrossListingPlanProblem,
  planEbayCrossListingOfferSeeds,
  stableEbayBatchJson,
} from "@/lib/records/ebay-batch";
import {
  EbayListingReconciliationError,
  ebayListingStatusSummary,
  getLatestEbayListingForCopy,
  reconcileEbayListing,
} from "@/server/ebay-listing-reconciliation";
import {
  ensureEbayNotificationSubscriptions,
  getEbayNotificationSubscriptionStatus,
} from "@/server/ebay-notification-service";
import {
  getEbayCapabilityForSession,
  requireEbayExternalCapability,
} from "@/server/ebay-capabilities";
import { getEbayRemoteListing } from "@/server/ebay-trading";
import { inspectPaidEbaySaleReviewIntent } from "@/server/records/paid-ebay-sale-review";
import { authenticatedProcedure, router } from "@/server/trpc";

const itemSpecificValue = z.string().trim().min(1).max(65);

const listingSchema = z.object({
  copyId: z.string().min(1),
  categoryId: z.literal(ebayCardCategory.id),
  cardConditionDescriptorValueId: z.enum(["400010", "400015", "400016", "400017"]),
  description: z.string().trim().min(20).max(4_000),
  dispatchTimeMax: z.number().int().min(1).max(30),
  images: z.array(z.object({
    archiveKey: z.string().min(1).max(1_024),
    ebayUrl: z.string().url(),
  })).min(1).max(12),
  itemSpecifics: z.object({
    cardNumber: itemSpecificValue,
    cardSize: itemSpecificValue,
    features: itemSpecificValue,
    game: itemSpecificValue,
    manufacturer: itemSpecificValue,
    rarity: itemSpecificValue,
    setName: itemSpecificValue,
  }),
  language: z.enum(ebayListingLanguages),
  location: z.string().trim().max(80),
  postalCode: z.string().trim().min(2).max(16),
  pricePence: z.number().int().min(1).max(10_000_000),
  shippingCostPence: z.number().int().min(0).max(100_000),
  shippingService: z.enum([
    "UK_RoyalMailSecondClassStandard",
    "UK_RoyalMailTracked",
    "UK_RoyalMailFirstClassStandard",
    "UK_RoyalMailNextDay",
    "UK_RoyalMailSpecialDeliveryNextDay",
  ]),
  title: z.string().trim().min(1).max(80),
});

const lotListingSchema = listingSchema.omit({ copyId: true, categoryId: true }).extend({
  categoryId: z.literal(ebayLotCategory.id),
  copyIds: z.array(z.string().min(1)).min(2).max(100),
  imageDraftCopyId: z.string().min(1),
});

const quantityListingSchema = listingSchema.omit({ copyId: true }).extend({
  copyIds: z.array(z.string().min(1)).min(2).max(100),
  imageDraftCopyId: z.string().min(1),
});

const batchPublicationIdentitySchema = z.object({
  batchId: z.string().min(1).max(160),
  offerId: z.string().min(1).max(160),
  publicationId: z.string().regex(/^[A-F0-9]{32}$/),
  plan: z.array(z.object({
    copyIds: z.array(z.string().min(1)).min(1).max(100),
    kind: z.enum(["individual", "quantity", "bundle"]),
    offerId: z.string().min(1).max(160),
  })).min(1).max(100),
});

const batchOfferSchema = z.discriminatedUnion("kind", [
  z.object({ details: listingSchema, identity: batchPublicationIdentitySchema, kind: z.literal("individual") }),
  z.object({ details: quantityListingSchema, identity: batchPublicationIdentitySchema, kind: z.literal("quantity") }),
  z.object({ details: lotListingSchema, identity: batchPublicationIdentitySchema, kind: z.literal("bundle") }),
]);

async function assertBatchPublicationPlan(
  ownerId: string,
  input: z.infer<typeof batchOfferSchema>,
) {
  const offerIds = new Set<string>();
  for (const offer of input.identity.plan) {
    if (offerIds.has(offer.offerId)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Each planned offer must have one stable identity." });
    }
    offerIds.add(offer.offerId);
    if (new Set(offer.copyIds).size !== offer.copyIds.length) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "A physical Copy appears more than once inside one planned offer." });
    }
  }
  const planProblem = ebayCrossListingPlanProblem(input.identity.plan.map((offer) => ({
    ...offer,
    id: offer.offerId,
  })));
  if (planProblem) {
    throw new TRPCError({ code: "BAD_REQUEST", message: planProblem });
  }
  const planned = input.identity.plan.find((offer) => offer.offerId === input.identity.offerId);
  const inputCopyIds = input.kind === "individual" ? [input.details.copyId] : input.details.copyIds;
  if (!planned || planned.kind !== input.kind || planned.copyIds.join("\0") !== inputCopyIds.join("\0")) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "This offer no longer matches the reviewed cross-list plan." });
  }

  const [storedGroup] = await db.select({ plan: ebayListingPublicationGroups.plan })
    .from(ebayListingPublicationGroups)
    .where(and(
      eq(ebayListingPublicationGroups.id, input.identity.batchId),
      eq(ebayListingPublicationGroups.ownerId, ownerId),
    ))
    .limit(1);
  if (storedGroup && stableEbayBatchJson(storedGroup.plan) !== stableEbayBatchJson(input.identity.plan)) {
    throw new TRPCError({ code: "CONFLICT", message: "This cross-list set was already started with a different exact-Copy plan." });
  }

  const lot = input.identity.plan.find((offer) => offer.kind === "bundle")!;
  const rows = await db.select({
    condition: cardCopies.condition,
    copyId: cardCopies.id,
    edition: cardTargets.edition,
    normalizedName: cardTargets.normalizedName,
    printingId: cardCopies.printingId,
  }).from(cardCopies)
    .innerJoin(cardPrintings, and(
      eq(cardPrintings.id, cardCopies.printingId),
      eq(cardPrintings.ownerId, cardCopies.ownerId),
    ))
    .innerJoin(cardTargets, and(
      eq(cardTargets.id, cardPrintings.targetId),
      eq(cardTargets.ownerId, cardPrintings.ownerId),
    ))
    .where(and(
      eq(cardCopies.ownerId, ownerId),
      inArray(cardCopies.id, lot.copyIds),
    ));
  if (rows.length !== lot.copyIds.length || new Set(rows.map((row) => row.normalizedName)).size !== 1) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Choose exact Copies of one card name for this cross-list set." });
  }
  const rowByCopyId = new Map(rows.map((row) => [row.copyId, row]));
  const expected = planEbayCrossListingOfferSeeds(lot.copyIds.map((copyId) => rowByCopyId.get(copyId)!));
  const canonical = (offer: { copyIds: string[]; kind: string }) => `${offer.kind}:${[...offer.copyIds].sort().join("\0")}`;
  const expectedStandalone = expected.filter((offer) => offer.kind !== "bundle").map(canonical).sort();
  const actualStandalone = input.identity.plan.filter((offer) => offer.kind !== "bundle").map(canonical).sort();
  if (stableEbayBatchJson(expectedStandalone) !== stableEbayBatchJson(actualStandalone)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Standalone offers must group identical Printing, edition, and condition Copies into one quantity listing." });
  }
}

function ebayFailure(error: unknown) {
  return new TRPCError({
    code: "BAD_REQUEST",
    message: error instanceof EbayAuthorizationError || error instanceof EbayTemporaryError
      ? error.message
      : error instanceof EbayListingReconciliationError
        ? error.message
      : error instanceof EbayListingError
      ? error.message
      : "The eBay request could not be completed. Try again shortly.",
  });
}

export const ebayRouter = router({
  status: authenticatedProcedure.query(async ({ ctx }) => {
    const capability = await getEbayCapabilityForSession(ctx.session);
    if (ctx.session.user.role !== "admin") return { capability };
    const [connection, notifications] = await Promise.all([
      getEbayConnectionStatus(ctx.session.user.id),
      getEbayNotificationSubscriptionStatus(ctx.session.user.id),
    ]);
    return {
      capability,
      configured: isEbayOAuthConfigured(),
      connection,
      imageArchiveConfigured: isListingImageArchiveConfigured(),
      notifications,
    };
  }),
  eligibility: authenticatedProcedure.input(z.object({ copyId: z.string().min(1) })).query(async ({ ctx, input }) => {
    await requireEbayExternalCapability(ctx.session);
    return getEbayListingEligibility(ctx.session.user.id, input.copyId);
  }),
  listingStatus: authenticatedProcedure.input(z.object({ copyId: z.string().min(1) })).query(async ({ ctx, input }) => {
    const listing = await getLatestEbayListingForCopy(
      ctx.session.user.id,
      input.copyId,
    );
    return listing ? ebayListingStatusSummary(listing) : null;
  }),
  estimatePaidSaleProceeds: authenticatedProcedure.input(z.object({
    copyId: z.string().min(1).max(160),
    listingId: z.string().min(1).max(160),
  })).query(async ({ ctx, input }) => {
    const inspected = await inspectPaidEbaySaleReviewIntent(ctx.collectionOwnerId, input);
    if (!inspected.ok) return inspected;
    await requireEbayExternalCapability(ctx.session);
    try {
      const remote = await getEbayRemoteListing(ctx.collectionOwnerId, inspected.remote.itemId);
      const matches = remote.transactions.filter((transaction) => {
        if (inspected.remote.orderLineItemId) {
          return transaction.orderLineItemId === inspected.remote.orderLineItemId;
        }
        if (inspected.remote.transactionId) {
          return transaction.transactionId === inspected.remote.transactionId;
        }
        return Boolean(
          inspected.remote.orderId
          && transaction.orderId === inspected.remote.orderId,
        );
      });
      const transaction = matches.length === 1 ? matches[0] : null;
      if (
        !transaction
        || transaction.cancelled
        || !transaction.paid
        || transaction.quantityPurchased !== 1
        || transaction.estimatedProceedsPence === null
      ) {
        return {
          ok: false as const,
          code: "estimate_unavailable" as const,
          message: "eBay did not return a reliable amount for this exact paid item. Enter the net proceeds manually.",
        };
      }
      return {
        ok: true as const,
        amountPence: transaction.estimatedProceedsPence,
        includesReportedFee: transaction.estimateIncludesReportedFee,
      };
    } catch (error) {
      throw ebayFailure(error);
    }
  }),
  refreshListingStatus: authenticatedProcedure.input(z.object({ copyId: z.string().min(1) })).mutation(async ({ ctx, input }) => {
    await requireEbayExternalCapability(ctx.session);
    const listing = await getLatestEbayListingForCopy(
      ctx.session.user.id,
      input.copyId,
    );
    if (!listing) return null;
    try {
      return (await reconcileEbayListing({
        listingId: listing.id,
        ownerId: ctx.session.user.id,
      })).listing;
    } catch (error) {
      throw ebayFailure(error);
    }
  }),
  refreshListingStatusById: authenticatedProcedure.input(z.object({ listingId: z.string().min(1) })).mutation(async ({ ctx, input }) => {
    await requireEbayExternalCapability(ctx.session);
    const [listing] = await db.select({ id: ebayListings.id }).from(ebayListings).where(and(
      eq(ebayListings.id, input.listingId),
      eq(ebayListings.ownerId, ctx.collectionOwnerId),
    )).limit(1);
    if (!listing) throw new TRPCError({ code: "NOT_FOUND", message: "That eBay listing was not found." });
    try {
      return (await reconcileEbayListing({
        listingId: listing.id,
        ownerId: ctx.collectionOwnerId,
      })).listing;
    } catch (error) {
      throw ebayFailure(error);
    }
  }),
  repairNotifications: authenticatedProcedure.mutation(async ({ ctx }) => {
    await requireEbayExternalCapability(ctx.session);
    try {
      return await ensureEbayNotificationSubscriptions(ctx.session.user.id);
    } catch (error) {
      throw ebayFailure(error);
    }
  }),
  validate: authenticatedProcedure.input(listingSchema).mutation(async ({ ctx, input }) => {
    await requireEbayExternalCapability(ctx.session);
    try {
      return await verifyEbayListing(ctx.session.user.id, input);
    } catch (error) {
      throw ebayFailure(error);
    }
  }),
  publish: authenticatedProcedure.input(listingSchema).mutation(async ({ ctx, input }) => {
    await requireEbayExternalCapability(ctx.session);
    try {
      return await publishEbayListing(ctx.session.user.id, input);
    } catch (error) {
      throw ebayFailure(error);
    }
  }),
  validateQuantity: authenticatedProcedure.input(quantityListingSchema).mutation(async ({ ctx, input }) => {
    await requireEbayExternalCapability(ctx.session);
    try {
      return await verifyEbayQuantityListing(ctx.collectionOwnerId, input);
    } catch (error) {
      throw ebayFailure(error);
    }
  }),
  publishQuantity: authenticatedProcedure.input(quantityListingSchema).mutation(async ({ ctx, input }) => {
    await requireEbayExternalCapability(ctx.session);
    try {
      return await publishEbayQuantityListing(ctx.collectionOwnerId, input);
    } catch (error) {
      throw ebayFailure(error);
    }
  }),
  validateLot: authenticatedProcedure.input(lotListingSchema).mutation(async ({ ctx, input }) => {
    await requireEbayExternalCapability(ctx.session);
    try {
      return await verifyEbayLotListing(ctx.collectionOwnerId, input);
    } catch (error) {
      throw ebayFailure(error);
    }
  }),
  publishLot: authenticatedProcedure.input(lotListingSchema).mutation(async ({ ctx, input }) => {
    await requireEbayExternalCapability(ctx.session);
    try {
      return await publishEbayLotListing(ctx.collectionOwnerId, input);
    } catch (error) {
      throw ebayFailure(error);
    }
  }),
  validateBatchOffer: authenticatedProcedure.input(batchOfferSchema).mutation(async ({ ctx, input }) => {
    await requireEbayExternalCapability(ctx.session);
    await assertBatchPublicationPlan(ctx.collectionOwnerId, input);
    try {
      if (input.kind === "individual") {
        return await verifyEbayListing(ctx.collectionOwnerId, input.details);
      }
      if (input.kind === "quantity") {
        return await verifyEbayQuantityListing(ctx.collectionOwnerId, input.details, input.identity);
      }
      return await verifyEbayLotListing(ctx.collectionOwnerId, input.details, input.identity);
    } catch (error) {
      throw ebayFailure(error);
    }
  }),
  publishBatchOffer: authenticatedProcedure.input(batchOfferSchema).mutation(async ({ ctx, input }) => {
    await requireEbayExternalCapability(ctx.session);
    await assertBatchPublicationPlan(ctx.collectionOwnerId, input);
    const identity = input.identity;
    try {
      if (input.kind === "individual") {
        return await publishEbayListing(ctx.collectionOwnerId, input.details, identity);
      }
      if (input.kind === "quantity") {
        return await publishEbayQuantityListing(ctx.collectionOwnerId, input.details, identity);
      }
      return await publishEbayLotListing(ctx.collectionOwnerId, input.details, identity);
    } catch (error) {
      throw ebayFailure(error);
    }
  }),
});

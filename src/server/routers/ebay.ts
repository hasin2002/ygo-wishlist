import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { ebayListings } from "@/db/schema";
import {
  ebayCardCategory,
  ebayLotCategory,
  ebayListingLanguages,
} from "@/lib/ebay-listing-options";
import { cardConditions } from "@/lib/records/types";
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
  EbayListingReconciliationError,
  ebayListingStatusSummary,
  getLatestEbayListingForCopy,
  reconcileEbayListing,
} from "@/server/ebay-listing-reconciliation";
import { getEbayTradingNotificationHealth } from "@/server/ebay-trading-notification-service";
import {
  getEbayCapabilityForSession,
  requireEbayExternalCapability,
} from "@/server/ebay-capabilities";
import { getEbayRemoteListing } from "@/server/ebay-trading";
import { inspectPaidEbaySaleReviewIntent } from "@/server/records/paid-ebay-sale-review";
import { inspectLinkedOfferVariant, LinkedOfferError, publishLinkedOfferPlan, reviewLinkedOfferPlan, saveLinkedOfferPool } from "@/server/records/ebay-linked-offers";
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

const linkedOfferDetailsSchema = listingSchema.omit({ copyId: true }).extend({
  copyIds: z.array(z.string().min(1)).min(1).max(100),
  imageDraftCopyId: z.string().min(1),
});

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
  linkedOfferVariant: authenticatedProcedure.input(z.object({ printingId: z.string().min(1), condition: z.enum(cardConditions) })).query(async ({ ctx, input }) => {
    try { return await inspectLinkedOfferVariant(ctx.collectionOwnerId, input.printingId, input.condition); }
    catch (error) { throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof LinkedOfferError ? error.message : "The listing variant could not be loaded." }); }
  }),
  saveLinkedOfferPool: authenticatedProcedure.input(z.object({
    printingId: z.string().min(1), condition: z.enum(cardConditions), copyIds: z.array(z.string().min(1)).min(1).max(100), listKeptCopies: z.boolean(), mode: z.enum(["individual", "linked"]), draft: z.unknown(),
    offers: z.array(z.object({
      action: z.enum(["no_change", "create", "update", "end"]),
      desiredQuantity: z.number().int().min(0).max(100),
      kind: z.enum(["individual", "x2", "x3"]),
      listingId: z.string().min(1).nullable(),
      details: linkedOfferDetailsSchema,
    })).min(1).max(3),
  })).mutation(async ({ ctx, input }) => {
    try { return await saveLinkedOfferPool({ ownerId: ctx.collectionOwnerId, ...input }); }
    catch (error) { throw new TRPCError({ code: "CONFLICT", message: error instanceof LinkedOfferError ? error.message : "The exact Copy pool changed. Refresh and review it again." }); }
  }),
  reviewLinkedOfferPlan: authenticatedProcedure.input(z.object({ familyId: z.string().min(1) })).mutation(async ({ ctx, input }) => {
    await requireEbayExternalCapability(ctx.session);
    try { return await reviewLinkedOfferPlan(ctx.collectionOwnerId, input.familyId); }
    catch (error) { throw ebayFailure(error instanceof LinkedOfferError ? new EbayListingError(error.message) : error); }
  }),
  publishLinkedOfferPlan: authenticatedProcedure.input(z.object({ familyId: z.string().min(1) })).mutation(async ({ ctx, input }) => {
    await requireEbayExternalCapability(ctx.session);
    try { return await publishLinkedOfferPlan(ctx.collectionOwnerId, input.familyId); }
    catch (error) { throw ebayFailure(error instanceof LinkedOfferError ? new EbayListingError(error.message) : error); }
  }),
  status: authenticatedProcedure.query(async ({ ctx }) => {
    const capability = await getEbayCapabilityForSession(ctx.session);
    if (ctx.session.user.role !== "admin") return { capability };
    const [connection, notifications] = await Promise.all([
      getEbayConnectionStatus(ctx.session.user.id),
      getEbayTradingNotificationHealth(ctx.session.user.id),
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
});

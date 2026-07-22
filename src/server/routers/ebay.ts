import { z } from "zod";
import {
  ebayCardCategory,
  ebayListingLanguages,
} from "@/lib/ebay-listing-options";
import {
  EbayAuthorizationError,
  getEbayConnectionStatus,
  isEbayOAuthConfigured,
} from "@/server/ebay-seller";
import { isListingImageArchiveConfigured } from "@/server/ebay-listing-images";
import {
  EbayListingError,
  publishEbayListing,
  verifyEbayListing,
} from "@/server/ebay-listing";
import { adminProcedure, router } from "@/server/trpc";

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

function ebayFailure(error: unknown) {
  return new TRPCError({
    code: "BAD_REQUEST",
    message: error instanceof EbayAuthorizationError
      ? error.message
      : error instanceof EbayListingError
      ? error.message
      : "The eBay request could not be completed. Try again shortly.",
  });
}

export const ebayRouter = router({
  status: adminProcedure.query(async ({ ctx }) => ({
    configured: isEbayOAuthConfigured(),
    connection: await getEbayConnectionStatus(ctx.session.user.id),
    imageArchiveConfigured: isListingImageArchiveConfigured(),
  })),
  validate: adminProcedure.input(listingSchema).mutation(async ({ ctx, input }) => {
    try {
      return await verifyEbayListing(ctx.session.user.id, input);
    } catch (error) {
      throw ebayFailure(error);
    }
  }),
  publish: adminProcedure.input(listingSchema).mutation(async ({ ctx, input }) => {
    try {
      return await publishEbayListing(ctx.session.user.id, input);
    } catch (error) {
      throw ebayFailure(error);
    }
  }),
});
import { TRPCError } from "@trpc/server";

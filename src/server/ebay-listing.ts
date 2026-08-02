import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  cardCopies,
  cardPrintings,
  cardTargets,
  ebayListingMembers,
  ebayListings,
} from "@/db/schema";
import type {
  EbayDeliveryServiceCode,
  EbayListingItemSpecifics,
  EbayListingLanguage,
} from "@/lib/ebay-listing-options";
import { cardConditionOptions } from "@/lib/records/types";
import { decideEbayCopyListingEligibility } from "@/lib/records/ebay-copy-listing-eligibility";
import { ebayLotXmlContract } from "@/lib/records/ebay-lot";
import {
  ebayQuantityXmlContract,
  homogeneousQuantityBounds,
  validateHomogeneousQuantityMembers,
} from "@/lib/records/ebay-quantity-listing";
import {
  copyListingImageDraftsToArchive,
  deleteArchivedListingImages,
  deleteListingImageDraft,
  deleteListingImageDrafts,
  readListingImageDraft,
  storeListingImageDraft,
  storeRemoteListingImageDraft,
  transferListingImageDraft,
} from "@/server/ebay-listing-images";
import { parseApprovedRemoteImageUrl } from "@/server/remote-images";
import { readCardInventoryImage } from "@/server/card-inventory-images";
import { getEbaySellerAccessToken } from "@/server/ebay-seller";
import { CopySelectionError, lockReconciledCopies } from "@/server/records/copy-selection";
import {
  EbayListingReconciliationError,
  ebayListingStatusSummary,
  reconcileEbayListing,
} from "@/server/ebay-listing-reconciliation";
import {
  getEbayListingsForCopiesMembershipFirst,
  hasEbayCompositionSchema,
  legacySafeEbayListingSelection,
  type EbayListingForCopy,
} from "@/server/ebay-listing-composition";
import {
  callEbayTradingApi,
  EbayTradingError,
  ebayXmlContainers,
  ebayXmlEscape,
  ebayXmlText,
} from "@/server/ebay-trading";

const marketplaceId = "EBAY_GB";

export type EbayListingDetails = {
  copyId: string;
  categoryId: string;
  cardConditionDescriptorValueId: "400010" | "400015" | "400016" | "400017";
  description: string;
  dispatchTimeMax: number;
  images: Array<{
    archiveKey: string;
    ebayUrl: string;
  }>;
  itemSpecifics: EbayListingItemSpecifics;
  language: EbayListingLanguage;
  location: string;
  postalCode: string;
  pricePence: number;
  shippingCostPence: number;
  shippingService: EbayDeliveryServiceCode;
  title: string;
};

export type EbayLotListingDetails = Omit<EbayListingDetails, "copyId" | "categoryId"> & {
  categoryId: "183455";
  /** The selected Copy whose private listing-draft prefix owns every image. */
  imageDraftCopyId: string;
  /** Ordered exact membership. */
  copyIds: string[];
};

export type EbayQuantityListingDetails = Omit<EbayListingDetails, "copyId"> & {
  /** The selected Copy whose private listing-draft prefix owns every image. */
  imageDraftCopyId: string;
  /** Ordered exact membership and future fulfilment order. */
  copyIds: string[];
};

type EbayError = {
  code: string | null;
  message: string | null;
  severity: string | null;
};

type EbayFee = {
  amount: number;
  currency: string;
  name: string | null;
};

export type EbayVerification = {
  ack: string | null;
  errors: EbayError[];
  fees: EbayFee[];
  readyToPublish: boolean;
};

export type EbayListingEligibility =
  | {
    eligible: true;
    listing: ReturnType<typeof ebayListingStatusSummary> | null;
    status: "eligible";
  }
  | {
    eligible: false;
    listing?: ReturnType<typeof ebayListingStatusSummary> | null;
    reconnectRequired?: boolean;
    status:
      | "not_owned"
      | "unavailable"
      | "active_listing"
      | "payment_pending"
      | "paid"
      | "needs_review"
      | "suspended"
      | "sync_unavailable";
  };

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class EbayListingError extends Error {}

function errorsFromXml(xml: string): EbayError[] {
  return ebayXmlContainers(xml, "Errors").map((errorXml) => ({
    code: ebayXmlText(errorXml, "ErrorCode"),
    message: ebayXmlText(errorXml, "LongMessage") ?? ebayXmlText(errorXml, "ShortMessage"),
    severity: ebayXmlText(errorXml, "SeverityCode"),
  }));
}

function feesFromXml(xml: string): EbayFee[] {
  return ebayXmlContainers(xml, "Fee").map((feeXml) => ({
    amount: Number(ebayXmlText(feeXml, "Fee") ?? 0),
    currency: feeXml.match(/<Fee currencyID="([^"]+)"/)?.[1] ?? "GBP",
    name: ebayXmlText(feeXml, "Name"),
  }));
}

function formatPrice(pence: number) {
  return (pence / 100).toFixed(2);
}

function descriptionHtml(value: string) {
  const escapedText = String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  return `<![CDATA[${escapedText.replaceAll("\n", "<br />")}]]>`;
}

async function tradingCall(ownerId: string, callName: "AddItem" | "VerifyAddItem", itemXml: string, accessToken?: string) {
  let xml: string;
  try {
    xml = (await callEbayTradingApi({
      body: itemXml,
      callName,
      ownerId,
      accessToken,
    })).xml;
  } catch (error) {
    if (error instanceof EbayTradingError) {
      throw new EbayListingError(error.message);
    }
    throw error;
  }
  const errors = errorsFromXml(xml);
  return {
    ack: ebayXmlText(xml, "Ack"),
    errors,
    fees: feesFromXml(xml),
    itemId: ebayXmlText(xml, "ItemID"),
  };
}

export function listingItemXml(
  details: EbayListingDetails | EbayLotListingDetails | EbayQuantityListingDetails,
  composition: "bundle" | "individual" | "quantity" = "individual",
) {
  const isLot = composition === "bundle";
  const isQuantity = composition === "quantity";
  const pictures = details.images
    .map((image) => `<PictureURL>${ebayXmlEscape(image.ebayUrl)}</PictureURL>`)
    .join("");
  const specificValues: Array<[string, string]> = [
    ["Card Size", details.itemSpecifics.cardSize],
    ["Rarity", details.itemSpecifics.rarity],
    ["Manufacturer", details.itemSpecifics.manufacturer],
    ["Set", details.itemSpecifics.setName],
    ["Game", details.itemSpecifics.game],
    ["Features", details.itemSpecifics.features],
    ["Card Number", details.itemSpecifics.cardNumber],
    ["Language", details.language],
  ];
  const specifics = specificValues
    .map(([name, value]) => `<NameValueList><Name>${ebayXmlEscape(name)}</Name><Value>${ebayXmlEscape(value)}</Value></NameValueList>`)
    .join("");
  const location = details.location
    ? `<Location>${ebayXmlEscape(details.location)}</Location>`
    : "";

  const memberCount = "copyIds" in details ? details.copyIds.length : 1;
  const lotContract = isLot ? ebayLotXmlContract(memberCount) : null;
  const quantityContract = isQuantity ? ebayQuantityXmlContract(memberCount) : null;
  const lotSize = lotContract?.lotSizeXml ?? "";
  const condition = isLot
    ? lotContract!.conditionXml
    : `<ConditionDescriptors><ConditionDescriptor><Name>40001</Name><Value>${details.cardConditionDescriptorValueId}</Value></ConditionDescriptor></ConditionDescriptors><ConditionID>4000</ConditionID>`;
  return `<Item><Title>${ebayXmlEscape(details.title)}</Title><Description>${descriptionHtml(details.description)}</Description><PrimaryCategory><CategoryID>${ebayXmlEscape(details.categoryId)}</CategoryID></PrimaryCategory>${condition}<ItemSpecifics>${specifics}</ItemSpecifics><StartPrice currencyID="GBP">${formatPrice(details.pricePence)}</StartPrice><CategoryMappingAllowed>${lotContract ? String(lotContract.categoryMappingAllowed) : "true"}</CategoryMappingAllowed><Country>GB</Country><Currency>GBP</Currency><DispatchTimeMax>${details.dispatchTimeMax}</DispatchTimeMax><ListingDuration>GTC</ListingDuration><ListingType>FixedPriceItem</ListingType>${location}<PostalCode>${ebayXmlEscape(details.postalCode)}</PostalCode><PictureDetails>${pictures}</PictureDetails>${lotContract?.quantityXml ?? quantityContract?.quantityXml ?? "<Quantity>1</Quantity>"}${lotSize}<ReturnPolicy><ReturnsAcceptedOption>ReturnsNotAccepted</ReturnsAcceptedOption></ReturnPolicy><ShippingDetails><ShippingType>Flat</ShippingType><ShippingServiceOptions><ShippingServicePriority>1</ShippingServicePriority><ShippingService>${ebayXmlEscape(details.shippingService)}</ShippingService><ShippingServiceCost currencyID="GBP">${formatPrice(details.shippingCostPence)}</ShippingServiceCost><FreeShipping>${details.shippingCostPence === 0 ? "true" : "false"}</FreeShipping></ShippingServiceOptions></ShippingDetails><Site>UK</Site><UUID>${crypto.randomUUID().replaceAll("-", "").toUpperCase()}</UUID></Item>`;
}

async function loadOwnedCopy(ownerId: string, copyId: string) {
  const [copy] = await db.select().from(cardCopies).where(and(
    eq(cardCopies.id, copyId),
    eq(cardCopies.ownerId, ownerId),
  )).limit(1);
  if (!copy) throw new EbayListingError("That physical Copy is not in your inventory.");
  return copy;
}

type RelatedEbayListing = Awaited<
  ReturnType<typeof getEbayListingsForCopiesMembershipFirst>
>[number];

function decideRelatedListingEligibility(relatedListings: RelatedEbayListing[]) {
  return decideEbayCopyListingEligibility(relatedListings.map(({ listing }) => ({
    createdAt: listing.createdAt,
    id: listing.id,
    listingState: listing.listingState,
    relistAllowed: ebayListingStatusSummary(listing).relistAllowed,
    saleState: listing.saleState,
  })));
}

function representativeListingSummary(
  relatedListings: RelatedEbayListing[],
  representativeListingId: string | null,
) {
  const representative = relatedListings.find(
    ({ listing }) => listing.id === representativeListingId,
  )?.listing;
  return representative ? ebayListingStatusSummary(representative) : null;
}

async function reconcileBlockingListings(
  ownerId: string,
  listingIds: string[],
) {
  let failed = false;
  let firstError: unknown;
  for (const listingId of listingIds) {
    try {
      await reconcileEbayListing({ listingId, ownerId });
    } catch (error) {
      if (!failed) firstError = error;
      failed = true;
    }
  }
  if (failed) throw firstError;
}

async function loadSellableCopy(
  ownerId: string,
  copyId: string,
  reconcileActiveListing = false,
) {
  const copy = await loadOwnedCopy(ownerId, copyId);
  if (copy.status !== "available") throw new EbayListingError("Only an available physical Copy can be listed.");

  let relatedListings = await getEbayListingsForCopiesMembershipFirst(ownerId, [copyId]);
  let decision = decideRelatedListingEligibility(relatedListings);
  if (decision.eligible) return copy;
  if (reconcileActiveListing) {
    try {
      await reconcileBlockingListings(ownerId, decision.blockingListingIds);
      relatedListings = await getEbayListingsForCopiesMembershipFirst(ownerId, [copyId]);
      decision = decideRelatedListingEligibility(relatedListings);
      if (decision.eligible) return copy;
    } catch (error) {
      if (error instanceof EbayListingReconciliationError) {
        throw new EbayListingError(error.message);
      }
      throw error;
    }
  }
  throw new EbayListingError("This physical Copy already has an unresolved eBay listing.");
}

/**
 * Checks whether an owned physical Copy can enter the eBay listing editor.
 * A locally active listing is reconciled before eligibility is decided, so a
 * listing ended directly on eBay does not block this Copy indefinitely.
 */
export async function getEbayListingEligibility(
  ownerId: string,
  copyId: string,
): Promise<EbayListingEligibility> {
  const [copy] = await db.select({ status: cardCopies.status }).from(cardCopies).where(and(
    eq(cardCopies.id, copyId),
    eq(cardCopies.ownerId, ownerId),
  )).limit(1);
  if (!copy) return { eligible: false, status: "not_owned" };
  if (copy.status !== "available") return { eligible: false, status: "unavailable" };

  let relatedListings = await getEbayListingsForCopiesMembershipFirst(ownerId, [copyId]);
  let decision = decideRelatedListingEligibility(relatedListings);
  if (decision.eligible) {
    return {
      eligible: true,
      listing: representativeListingSummary(
        relatedListings,
        decision.representativeListingId,
      ),
      status: "eligible",
    };
  }

  try {
    await reconcileBlockingListings(ownerId, decision.blockingListingIds);
    relatedListings = await getEbayListingsForCopiesMembershipFirst(ownerId, [copyId]);
    decision = decideRelatedListingEligibility(relatedListings);
    const listing = representativeListingSummary(
      relatedListings,
      decision.representativeListingId,
    );
    if (decision.eligible) {
      return {
        eligible: true,
        listing,
        status: "eligible",
      };
    }
    return {
      eligible: false,
      listing,
      status: decision.status,
    };
  } catch (error) {
    relatedListings = await getEbayListingsForCopiesMembershipFirst(ownerId, [copyId]);
    decision = decideRelatedListingEligibility(relatedListings);
    return {
      eligible: false,
      listing: representativeListingSummary(
        relatedListings,
        decision.representativeListingId,
      ),
      reconnectRequired: error instanceof EbayListingReconciliationError
        && error.reconnectRequired,
      status: "sync_unavailable",
    };
  }
}

function verificationResult(result: Awaited<ReturnType<typeof tradingCall>>): EbayVerification {
  const hasError = result.errors.some((error) => error.severity === "Error");
  const visibleFees = result.fees.filter((fee) => Number.isFinite(fee.amount) && fee.amount !== 0);
  const hasListingFee = visibleFees.some((fee) => fee.amount > 0);
  return {
    ack: result.ack,
    errors: result.errors,
    fees: visibleFees,
    readyToPublish: !hasError && !hasListingFee && ["Success", "Warning"].includes(result.ack ?? ""),
  };
}

export async function verifyEbayListing(ownerId: string, details: EbayListingDetails) {
  await listingCopyMetadata(ownerId, details.copyId);
  const result = await tradingCall(ownerId, "VerifyAddItem", listingItemXml(details));
  return verificationResult(result);
}

export async function publishEbayListing(ownerId: string, details: EbayListingDetails) {
  await listingCopyMetadata(ownerId, details.copyId);
  const itemXml = listingItemXml(details);
  const verification = verificationResult(await tradingCall(ownerId, "VerifyAddItem", itemXml));
  if (!verification.readyToPublish) {
    throw new EbayListingError("eBay has not approved this listing for publishing. Review the validation messages and fees.");
  }

  const compositionAvailable = await hasEbayCompositionSchema();
  const accessToken = await getEbaySellerAccessToken(ownerId);
  const listingId = `ebay-listing-${crypto.randomUUID()}`;
  const draftKeys = details.images.map((image) => image.archiveKey);
  const archivedKeys = await copyListingImageDraftsToArchive({
    copyId: details.copyId,
    draftKeys,
    listingId,
    ownerId,
  });
  const now = new Date();
  let remoteAddAttempted = false;
  let publishedItemId: string | null = null;
  try {
    await db.transaction(async (tx) => {
      const copies = await tx.select().from(cardCopies).where(and(
        eq(cardCopies.ownerId, ownerId),
        eq(cardCopies.id, details.copyId),
      )).for("update");
      if (copies.length !== 1 || copies[0]?.status !== "available") {
        throw new EbayListingError("This Copy changed while its listing was being published. Refresh and review it again.");
      }
      const related: EbayListingForCopy[] = [];
      if (compositionAvailable) {
        const members = await tx.select({
          copyId: ebayListingMembers.copyId,
          fulfilmentPosition: ebayListingMembers.fulfilmentPosition,
          listing: ebayListings,
          memberId: ebayListingMembers.id,
        }).from(ebayListingMembers)
          .innerJoin(ebayListings, and(
            eq(ebayListingMembers.listingId, ebayListings.id),
            eq(ebayListingMembers.ownerId, ebayListings.ownerId),
          ))
          .where(and(
            eq(ebayListingMembers.ownerId, ownerId),
            eq(ebayListings.ownerId, ownerId),
            eq(ebayListingMembers.copyId, details.copyId),
          ));
        related.push(...members.map((row) => ({ ...row, relationSource: "member" as const })));
      }
      const legacy = compositionAvailable
        ? await tx.select().from(ebayListings).where(and(
          eq(ebayListings.ownerId, ownerId),
          eq(ebayListings.copyId, details.copyId),
        )).for("update")
        : await tx.select(legacySafeEbayListingSelection).from(ebayListings).where(and(
          eq(ebayListings.ownerId, ownerId),
          eq(ebayListings.copyId, details.copyId),
        )).for("update");
      for (const listing of legacy) {
        if (!related.some((row) => row.listing.id === listing.id)) {
          related.push({ copyId: details.copyId, fulfilmentPosition: null, listing, memberId: null, relationSource: "legacy" });
        }
      }
      if (!decideRelatedListingEligibility(related).eligible) {
        throw new EbayListingError("This Copy gained eBay exposure while its listing was being published. Refresh and review it again.");
      }

      remoteAddAttempted = true;
      const result = await tradingCall(ownerId, "AddItem", itemXml, accessToken);
      if (!result.itemId || result.errors.some((error) => error.severity === "Error")) {
        throw new EbayListingError(result.errors.find((error) => error.message)?.message ?? "eBay did not publish the listing.");
      }
      publishedItemId = result.itemId;
      const listingUrl = `https://www.ebay.co.uk/itm/${result.itemId}`;
      if (compositionAvailable) {
        await tx.insert(ebayListings).values({
          id: listingId,
          ownerId,
          copyId: details.copyId,
          itemId: result.itemId,
          listingUrl,
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
      } else {
        await tx.execute(sql`
          insert into ${ebayListings} (
            id, owner_id, copy_id, item_id, listing_url, title, status,
            listing_state, sale_state, listing_started_at,
            last_remote_event_at, last_synced_at, created_at, updated_at
          ) values (
            ${listingId}, ${ownerId}, ${details.copyId}, ${result.itemId},
            ${listingUrl}, ${details.title}, 'active', 'active', 'none',
            ${now}, ${now}, ${now}, ${now}, ${now}
          )
        `);
      }
      if (compositionAvailable) {
        await tx.insert(ebayListingMembers).values({
          copyId: details.copyId,
          createdAt: now,
          fulfilmentPosition: 0,
          id: `ebay-listing-member-${crypto.randomUUID()}`,
          listingId,
          ownerId,
          updatedAt: now,
        });
      }
    });
  } catch (error) {
    if (!remoteAddAttempted) {
      await deleteArchivedListingImages(archivedKeys);
      throw error;
    }
    if (publishedItemId) {
      throw new EbayListingError("eBay published this listing but its local Copy link could not be saved. Do not relist; review the eBay offer and contact support.");
    }
    throw new EbayListingError("eBay may have published this listing, but the result could not be confirmed or saved locally. Do not retry until you have reviewed the eBay offer.");
  }
  await deleteListingImageDrafts(ownerId, details.copyId, draftKeys);
  if (!publishedItemId) throw new EbayListingError("eBay did not return an item ID. Do not relist; review the eBay offer.");
  return { archivedImageCount: archivedKeys.length, itemId: publishedItemId, listingUrl: `https://www.ebay.co.uk/itm/${publishedItemId}` };
}

function assertQuantityCopyIds(copyIds: string[], imageDraftCopyId: string) {
  if (copyIds.length < homogeneousQuantityBounds.min) {
    throw new EbayListingError("Choose at least two identical physical Copies for a quantity offer.");
  }
  if (copyIds.length > homogeneousQuantityBounds.max) {
    throw new EbayListingError(`Choose no more than ${homogeneousQuantityBounds.max} physical Copies for a quantity offer.`);
  }
  if (new Set(copyIds).size !== copyIds.length) {
    throw new EbayListingError("Each physical Copy can appear only once in a quantity offer.");
  }
  if (!copyIds.includes(imageDraftCopyId)) {
    throw new EbayListingError("The anchor Copy holding this draft's photos must remain selected.");
  }
}

async function lockHomogeneousQuantityMembers(
  tx: DatabaseTransaction,
  ownerId: string,
  details: EbayQuantityListingDetails,
) {
  let copies: Awaited<ReturnType<typeof lockReconciledCopies>>;
  try {
    copies = await lockReconciledCopies(tx, ownerId, details.copyIds, homogeneousQuantityBounds);
  } catch (error) {
    if (error instanceof CopySelectionError) {
      throw new EbayListingError(`${error.message} Refresh the quantity offer and review it again.`);
    }
    throw error;
  }
  const printingIds = [...new Set(copies.map((copy) => copy.printingId))];
  const printings = await tx.select().from(cardPrintings).where(and(
    eq(cardPrintings.ownerId, ownerId),
    inArray(cardPrintings.id, printingIds),
  ));
  const targetIds = [...new Set(printings.map((printing) => printing.targetId))];
  const targets = await tx.select().from(cardTargets).where(and(
    eq(cardTargets.ownerId, ownerId),
    inArray(cardTargets.id, targetIds),
  ));
  const printingById = new Map(printings.map((printing) => [printing.id, printing]));
  const targetById = new Map(targets.map((target) => [target.id, target]));
  const members = copies.map((copy) => {
    const printing = printingById.get(copy.printingId);
    const target = printing ? targetById.get(printing.targetId) : null;
    if (!printing || !target) {
      throw new EbayListingError("Printing or edition details changed for a selected Copy. Refresh and review the quantity offer again.");
    }
    return { copy, printing, target };
  });
  const incompatibility = validateHomogeneousQuantityMembers(members)[0];
  if (incompatibility) {
    throw new EbayListingError(`Copy #${incompatibility.copyId.slice(-6)} is incompatible: ${incompatibility.message}`);
  }
  const expectedCondition = cardConditionOptions.find(
    (option) => option.value === members[0]!.copy.condition,
  )?.ebayDescriptorValueId;
  if (!expectedCondition || details.cardConditionDescriptorValueId !== expectedCondition) {
    throw new EbayListingError("The shared eBay condition no longer matches every selected Copy. Refresh and review the quantity offer again.");
  }
  return members;
}

async function assertQuantityMembersHaveNoBlockingExposure(
  tx: DatabaseTransaction,
  ownerId: string,
  copyIds: string[],
) {
  const related = await tx.select({
    copyId: ebayListingMembers.copyId,
    fulfilmentPosition: ebayListingMembers.fulfilmentPosition,
    listing: ebayListings,
    memberId: ebayListingMembers.id,
  })
    .from(ebayListingMembers)
    .innerJoin(ebayListings, and(
      eq(ebayListingMembers.listingId, ebayListings.id),
      eq(ebayListingMembers.ownerId, ebayListings.ownerId),
    ))
    .where(and(
      eq(ebayListingMembers.ownerId, ownerId),
      eq(ebayListings.ownerId, ownerId),
      inArray(ebayListingMembers.copyId, copyIds),
    ))
    .for("update");
  const legacy = await tx.select().from(ebayListings).where(and(
    eq(ebayListings.ownerId, ownerId),
    inArray(ebayListings.copyId, copyIds),
  )).for("update");
  const normalized: EbayListingForCopy[] = related.map((row) => ({
    ...row,
    relationSource: "member" as const,
  }));
  for (const listing of legacy) {
    if (!normalized.some((row) => row.copyId === listing.copyId && row.listing.id === listing.id)) {
      normalized.push({
        copyId: listing.copyId,
        fulfilmentPosition: null,
        listing,
        memberId: null,
        relationSource: "legacy",
      });
    }
  }
  if (copyIds.some((copyId) => !decideRelatedListingEligibility(
    normalized.filter((row) => row.copyId === copyId),
  ).eligible)) {
    throw new EbayListingError("A selected Copy is reserved by an order or has a live or unresolved eBay offer. Refresh and replace it before publishing.");
  }
}

async function recheckQuantityMembers(
  ownerId: string,
  details: EbayQuantityListingDetails,
) {
  await db.transaction(async (tx) => {
    await lockHomogeneousQuantityMembers(tx, ownerId, details);
    await assertQuantityMembersHaveNoBlockingExposure(tx, ownerId, details.copyIds);
  });
}

export async function verifyEbayQuantityListing(
  ownerId: string,
  details: EbayQuantityListingDetails,
) {
  assertQuantityCopyIds(details.copyIds, details.imageDraftCopyId);
  if (!await hasEbayCompositionSchema()) {
    throw new EbayListingError("Quantity publishing needs the eBay composition data upgrade.");
  }
  await recheckQuantityMembers(ownerId, details);
  return verificationResult(await tradingCall(
    ownerId,
    "VerifyAddItem",
    listingItemXml(details, "quantity"),
  ));
}

export async function publishEbayQuantityListing(
  ownerId: string,
  details: EbayQuantityListingDetails,
) {
  assertQuantityCopyIds(details.copyIds, details.imageDraftCopyId);
  if (!await hasEbayCompositionSchema()) {
    throw new EbayListingError("Quantity publishing needs the eBay composition data upgrade.");
  }
  await recheckQuantityMembers(ownerId, details);
  const itemXml = listingItemXml(details, "quantity");
  const verification = verificationResult(await tradingCall(ownerId, "VerifyAddItem", itemXml));
  if (!verification.readyToPublish) {
    throw new EbayListingError("eBay has not approved this quantity offer for publishing. Review the validation messages and fees.");
  }

  const listingId = `ebay-listing-${crypto.randomUUID()}`;
  const draftKeys = details.images.map((image) => image.archiveKey);
  const archivedKeys = await copyListingImageDraftsToArchive({
    copyId: details.imageDraftCopyId,
    draftKeys,
    listingId,
    ownerId,
  });
  const accessToken = await getEbaySellerAccessToken(ownerId);
  const now = new Date();
  let remoteAddAttempted = false;
  let publishedItemId: string | null = null;
  try {
    await db.transaction(async (tx) => {
      await lockHomogeneousQuantityMembers(tx, ownerId, details);
      await assertQuantityMembersHaveNoBlockingExposure(tx, ownerId, details.copyIds);
      remoteAddAttempted = true;
      const result = await tradingCall(ownerId, "AddItem", itemXml, accessToken);
      if (!result.itemId || result.errors.some((error) => error.severity === "Error")) {
        throw new EbayListingError(result.errors.find((error) => error.message)?.message ?? "eBay did not publish the quantity offer.");
      }
      publishedItemId = result.itemId;
      const listingUrl = `https://www.ebay.co.uk/itm/${result.itemId}`;
      await tx.insert(ebayListings).values({
        id: listingId,
        ownerId,
        copyId: details.copyIds[0]!,
        kind: "quantity",
        itemId: result.itemId,
        listingUrl,
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
      await tx.insert(ebayListingMembers).values(details.copyIds.map(
        (copyId, fulfilmentPosition) => ({
          id: `ebay-listing-member-${crypto.randomUUID()}`,
          ownerId,
          listingId,
          copyId,
          fulfilmentPosition,
          createdAt: now,
          updatedAt: now,
        }),
      ));
    });
  } catch (error) {
    if (!remoteAddAttempted) {
      await deleteArchivedListingImages(archivedKeys);
      throw error;
    }
    throw new EbayListingError("eBay may have published this quantity offer, but its ordered local membership could not be confirmed. Do not retry until you have reviewed the eBay offer.");
  }
  await deleteListingImageDrafts(ownerId, details.imageDraftCopyId, draftKeys);
  if (!publishedItemId) {
    throw new EbayListingError("eBay did not return an item ID for this quantity offer. Do not relist; review the eBay offer.");
  }
  return {
    archivedImageCount: archivedKeys.length,
    itemId: publishedItemId,
    listingUrl: `https://www.ebay.co.uk/itm/${publishedItemId}`,
  };
}

function assertLotCopyIds(copyIds: string[], imageDraftCopyId: string) {
  if (copyIds.length < 2) throw new EbayListingError("Choose at least two physical Copies for a card lot.");
  if (copyIds.length > 100) throw new EbayListingError("Choose no more than 100 physical Copies for a card lot.");
  if (new Set(copyIds).size !== copyIds.length) throw new EbayListingError("Each physical Copy can appear only once in a card lot.");
  if (!copyIds.includes(imageDraftCopyId)) {
    throw new EbayListingError("The Copy holding this lot's image drafts must remain in the card lot.");
  }
}

async function recheckLotMembers(ownerId: string, copyIds: string[]) {
  await db.transaction(async (tx) => {
    try {
      await lockReconciledCopies(tx, ownerId, copyIds, { min: 2, max: 100 });
    } catch (error) {
      if (error instanceof CopySelectionError) throw new EbayListingError(`${error.message} Refresh the lot and review it again.`);
      throw error;
    }
    const related = await tx.select({ copyId: ebayListingMembers.copyId, fulfilmentPosition: ebayListingMembers.fulfilmentPosition, listing: ebayListings, memberId: ebayListingMembers.id })
      .from(ebayListingMembers)
      .innerJoin(ebayListings, and(eq(ebayListingMembers.listingId, ebayListings.id), eq(ebayListingMembers.ownerId, ebayListings.ownerId)))
      .where(and(eq(ebayListingMembers.ownerId, ownerId), eq(ebayListings.ownerId, ownerId), inArray(ebayListingMembers.copyId, copyIds)));
    const legacy = await tx.select().from(ebayListings).where(and(eq(ebayListings.ownerId, ownerId), inArray(ebayListings.copyId, copyIds))).for("update");
    const normalizedRelated: EbayListingForCopy[] = related.map((row) => ({ ...row, relationSource: "member" as const }));
    for (const listing of legacy) if (!normalizedRelated.some((row) => row.copyId === listing.copyId && row.listing.id === listing.id)) normalizedRelated.push({ copyId: listing.copyId, fulfilmentPosition: null, listing, memberId: null, relationSource: "legacy" });
    for (const copyId of copyIds) {
      if (!decideRelatedListingEligibility(normalizedRelated.filter((row) => row.copyId === copyId)).eligible) {
        throw new EbayListingError("One or more selected Copies has a live or unresolved eBay listing. Remove it before publishing this lot.");
      }
    }
  });
}

export async function verifyEbayLotListing(ownerId: string, details: EbayLotListingDetails) {
  assertLotCopyIds(details.copyIds, details.imageDraftCopyId);
  if (details.categoryId !== "183455") throw new EbayListingError("Use the approved card-lot category for a heterogeneous lot.");
  if (!await hasEbayCompositionSchema()) throw new EbayListingError("Card-lot publishing needs the eBay composition data upgrade.");
  await recheckLotMembers(ownerId, details.copyIds);
  return verificationResult(await tradingCall(ownerId, "VerifyAddItem", listingItemXml(details, "bundle")));
}

export async function publishEbayLotListing(ownerId: string, details: EbayLotListingDetails) {
  assertLotCopyIds(details.copyIds, details.imageDraftCopyId);
  if (details.categoryId !== "183455") throw new EbayListingError("Use the approved card-lot category for a heterogeneous lot.");
  if (!await hasEbayCompositionSchema()) throw new EbayListingError("Card-lot publishing needs the eBay composition data upgrade.");
  await recheckLotMembers(ownerId, details.copyIds);
  const itemXml = listingItemXml(details, "bundle");
  const verification = verificationResult(await tradingCall(ownerId, "VerifyAddItem", itemXml));
  if (!verification.readyToPublish) throw new EbayListingError("eBay has not approved this listing for publishing. Review the validation messages and fees.");

  const listingId = `ebay-listing-${crypto.randomUUID()}`;
  const anchorCopyId = details.copyIds[0]!;
  const draftKeys = details.images.map((image) => image.archiveKey);
  const archivedKeys = await copyListingImageDraftsToArchive({
    copyId: details.imageDraftCopyId,
    draftKeys,
    listingId,
    ownerId,
  });
  // Resolve credentials before taking row locks: this can refresh through the
  // database, whereas the lock-held section must use one DB connection.
  const accessToken = await getEbaySellerAccessToken(ownerId);
  const now = new Date();
  let remoteAddAttempted = false;
  let publishedItemId: string | null = null;
  try {
    await db.transaction(async (tx) => {
      try {
        await lockReconciledCopies(tx, ownerId, details.copyIds, { min: 2, max: 100 });
      } catch (error) {
        if (error instanceof CopySelectionError) throw new EbayListingError(`${error.message} The remote listing needs review.`);
        throw error;
      }
      const related = await tx.select({ copyId: ebayListingMembers.copyId, fulfilmentPosition: ebayListingMembers.fulfilmentPosition, listing: ebayListings, memberId: ebayListingMembers.id })
        .from(ebayListingMembers)
        .innerJoin(ebayListings, and(eq(ebayListingMembers.listingId, ebayListings.id), eq(ebayListingMembers.ownerId, ebayListings.ownerId)))
        .where(and(eq(ebayListingMembers.ownerId, ownerId), eq(ebayListings.ownerId, ownerId), inArray(ebayListingMembers.copyId, details.copyIds)));
      const legacy = await tx.select().from(ebayListings).where(and(eq(ebayListings.ownerId, ownerId), inArray(ebayListings.copyId, details.copyIds))).for("update");
      const normalizedRelated: EbayListingForCopy[] = related.map((row) => ({ ...row, relationSource: "member" as const }));
      for (const listing of legacy) if (!normalizedRelated.some((row) => row.copyId === listing.copyId && row.listing.id === listing.id)) normalizedRelated.push({ copyId: listing.copyId, fulfilmentPosition: null, listing, memberId: null, relationSource: "legacy" });
      if (details.copyIds.some((copyId) => !decideRelatedListingEligibility(normalizedRelated.filter((row) => row.copyId === copyId)).eligible)) throw new EbayListingError("A selected Copy gained eBay exposure while this lot was being published. The remote listing needs review.");
      remoteAddAttempted = true;
      const publishResult = await tradingCall(ownerId, "AddItem", itemXml, accessToken);
      if (!publishResult.itemId || publishResult.errors.some((error) => error.severity === "Error")) throw new EbayListingError(publishResult.errors.find((error) => error.message)?.message ?? "eBay did not publish the listing.");
      publishedItemId = publishResult.itemId;
      await tx.insert(ebayListings).values({ id: listingId, ownerId, copyId: anchorCopyId, kind: "bundle", itemId: publishResult.itemId, listingUrl: `https://www.ebay.co.uk/itm/${publishResult.itemId}`, title: details.title, status: "active", listingState: "active", saleState: "none", listingStartedAt: now, lastRemoteEventAt: now, lastSyncedAt: now, createdAt: now, updatedAt: now });
      await tx.insert(ebayListingMembers).values(details.copyIds.map((copyId, fulfilmentPosition) => ({ id: `ebay-listing-member-${crypto.randomUUID()}`, ownerId, listingId, copyId, fulfilmentPosition, createdAt: now, updatedAt: now })));
    });
  } catch (error) {
    if (!remoteAddAttempted) {
      await deleteArchivedListingImages(archivedKeys);
      throw error;
    }
    // A remote AddItem succeeded but local commit failed: preserve evidence.
    throw new EbayListingError("eBay published this lot but its local manifest could not be saved. Do not relist; review the eBay offer and contact support.");
  }
  await deleteListingImageDrafts(ownerId, details.imageDraftCopyId, draftKeys);
  if (!publishedItemId) throw new EbayListingError("eBay did not return an item ID for this lot. Do not relist; review the eBay offer.");
  return { archivedImageCount: archivedKeys.length, itemId: publishedItemId, listingUrl: `https://www.ebay.co.uk/itm/${publishedItemId}` };
}

export async function uploadEbayImage(ownerId: string, file: File) {
  const accessToken = await getEbaySellerAccessToken(ownerId);
  const form = new FormData();
  form.append("image", file, file.name || "listing-image");
  const response = await fetch(
    "https://apim.ebay.com/commerce/media/v1_beta/image/create_image_from_file",
    {
      body: form,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "X-EBAY-C-MARKETPLACE-ID": marketplaceId,
      },
      method: "POST",
    },
  );
  const text = await response.text();
  let body: { imageUrl?: string } = {};
  try {
    body = JSON.parse(text) as { imageUrl?: string };
  } catch {
    // A non-JSON body is surfaced below without returning it to the browser.
  }
  if (!response.ok || !body.imageUrl) {
    throw new EbayListingError(`eBay could not upload this image (${response.status}).`);
  }
  return {
    imageId: response.headers.get("location")?.split("/").pop() ?? null,
    imageUrl: body.imageUrl,
  };
}

export async function importEbayImage(ownerId: string, sourceUrl: string) {
  try {
    parseApprovedRemoteImageUrl(sourceUrl);
  } catch {
    throw new EbayListingError("Use an approved HTTPS catalogue image.");
  }
  const accessToken = await getEbaySellerAccessToken(ownerId);
  const response = await fetch(
    "https://apim.ebay.com/commerce/media/v1_beta/image/create_image_from_url",
    {
      body: JSON.stringify({ imageUrl: sourceUrl }),
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-EBAY-C-MARKETPLACE-ID": marketplaceId,
      },
      method: "POST",
    },
  );
  const text = await response.text();
  let body: { imageUrl?: string } = {};
  try {
    body = JSON.parse(text) as { imageUrl?: string };
  } catch {
    // A non-JSON body is surfaced below without returning it to the browser.
  }
  if (!response.ok || !body.imageUrl) {
    throw new EbayListingError(`eBay could not import the catalogue image (${response.status}).`);
  }
  return {
    imageId: response.headers.get("location")?.split("/").pop() ?? null,
    imageUrl: body.imageUrl,
  };
}

export async function archiveAndUploadEbayImage(ownerId: string, copyId: string, file: File) {
  await loadSellableCopy(ownerId, copyId);
  let archiveKey: string;
  try {
    archiveKey = await storeListingImageDraft({
      bytes: new Uint8Array(await file.arrayBuffer()),
      contentType: file.type,
      copyId,
      ownerId,
    });
  } catch (error) {
    throw new EbayListingError(error instanceof Error
      ? `S3 could not archive this photo: ${error.message}`
      : "S3 could not archive this photo.");
  }

  try {
    const ebayImage = await uploadEbayImage(ownerId, file);
    return { archiveKey, ebayUrl: ebayImage.imageUrl };
  } catch (error) {
    await deleteListingImageDraft(ownerId, copyId, archiveKey).catch(() => undefined);
    throw error;
  }
}

export async function archiveAndImportInventoryImage(
  ownerId: string,
  copyId: string,
  inventoryKey: string,
  inventoryCopyId = copyId,
) {
  await loadSellableCopy(ownerId, copyId);
  await loadOwnedCopy(ownerId, inventoryCopyId);
  let image: Awaited<ReturnType<typeof readCardInventoryImage>>;
  try {
    image = await readCardInventoryImage(ownerId, inventoryCopyId, inventoryKey);
  } catch {
    throw new EbayListingError("That saved card photo could not be loaded.");
  }

  const fileName = inventoryKey.split("/").at(-1) || "card-photo";
  const fileBytes = new Uint8Array(image.bytes.byteLength);
  fileBytes.set(image.bytes);
  return archiveAndUploadEbayImage(
    ownerId,
    copyId,
    new File([fileBytes.buffer], fileName, { type: image.contentType }),
  );
}

export async function archiveInventoryImageDraft(
  ownerId: string,
  copyId: string,
  inventoryKey: string,
  inventoryCopyId = copyId,
) {
  await loadOwnedCopy(ownerId, copyId);
  await loadOwnedCopy(ownerId, inventoryCopyId);
  let image: Awaited<ReturnType<typeof readCardInventoryImage>>;
  try {
    image = await readCardInventoryImage(
      ownerId,
      inventoryCopyId,
      inventoryKey,
    );
  } catch {
    throw new EbayListingError("That saved card photo could not be loaded.");
  }

  try {
    const archiveKey = await storeListingImageDraft({
      bytes: image.bytes,
      contentType: image.contentType,
      copyId,
      ownerId,
    });
    return { archiveKey };
  } catch (error) {
    throw new EbayListingError(
      error instanceof Error
        ? `S3 could not prepare this saved photo: ${error.message}`
        : "S3 could not prepare this saved photo.",
    );
  }
}

export async function uploadArchivedEbayImage(
  ownerId: string,
  copyId: string,
  archiveKey: string,
) {
  await loadSellableCopy(ownerId, copyId);
  let image: Awaited<ReturnType<typeof readListingImageDraft>>;
  try {
    image = await readListingImageDraft(ownerId, copyId, archiveKey);
  } catch {
    throw new EbayListingError("That prepared listing photo could not be loaded.");
  }

  const fileName = archiveKey.split("/").at(-1) || "card-photo";
  const fileBytes = new Uint8Array(image.bytes.byteLength);
  fileBytes.set(image.bytes);
  const ebayImage = await uploadEbayImage(
    ownerId,
    new File([fileBytes.buffer], fileName, { type: image.contentType }),
  );
  return { archiveKey, ebayUrl: ebayImage.imageUrl };
}

export async function archiveAndImportEbayImage(ownerId: string, copyId: string, sourceUrl: string) {
  await loadSellableCopy(ownerId, copyId);
  let archiveKey: string;
  try {
    archiveKey = await storeRemoteListingImageDraft({ copyId, ownerId, sourceUrl });
  } catch (error) {
    throw new EbayListingError(error instanceof Error
      ? `S3 could not archive the catalogue image: ${error.message}`
      : "S3 could not archive the catalogue image.");
  }

  try {
    const ebayImage = await importEbayImage(ownerId, sourceUrl);
    return { archiveKey, ebayUrl: ebayImage.imageUrl };
  } catch (error) {
    await deleteListingImageDraft(ownerId, copyId, archiveKey).catch(() => undefined);
    throw error;
  }
}

export async function getEbayListingImageDraft(ownerId: string, copyId: string, archiveKey: string) {
  await loadOwnedCopy(ownerId, copyId);
  return readListingImageDraft(ownerId, copyId, archiveKey);
}

export async function removeEbayListingImageDraft(ownerId: string, copyId: string, archiveKey: string) {
  await loadOwnedCopy(ownerId, copyId);
  await deleteListingImageDraft(ownerId, copyId, archiveKey);
}

export async function transferEbayListingImageDraft(
  ownerId: string,
  fromCopyId: string,
  toCopyId: string,
  archiveKey: string,
) {
  await loadOwnedCopy(ownerId, toCopyId);
  return transferListingImageDraft({ fromCopyId, key: archiveKey, ownerId, toCopyId });
}

async function listingCopyMetadata(ownerId: string, copyId: string) {
  const copy = await loadSellableCopy(ownerId, copyId, true);
  const [printing] = await db.select().from(cardPrintings).where(and(
    eq(cardPrintings.id, copy.printingId),
    eq(cardPrintings.ownerId, ownerId),
  )).limit(1);
  if (!printing) throw new EbayListingError("The printing details for this Copy are unavailable.");
  const [target] = await db.select().from(cardTargets).where(and(
    eq(cardTargets.id, printing.targetId),
    eq(cardTargets.ownerId, ownerId),
  )).limit(1);
  if (!target) throw new EbayListingError("The card details for this Copy are unavailable.");
  return { copy, printing, target };
}

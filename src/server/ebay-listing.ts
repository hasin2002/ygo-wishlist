import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  cardCopies,
  cardPrintings,
  cardTargets,
  ebayListings,
} from "@/db/schema";
import type {
  EbayDeliveryServiceCode,
  EbayListingItemSpecifics,
  EbayListingLanguage,
} from "@/lib/ebay-listing-options";
import {
  copyListingImageDraftsToArchive,
  deleteArchivedListingImages,
  deleteListingImageDraft,
  deleteListingImageDrafts,
  readListingImageDraft,
  storeListingImageDraft,
  storeRemoteListingImageDraft,
} from "@/server/ebay-listing-images";
import { readCardInventoryImage } from "@/server/card-inventory-images";
import { getEbaySellerAccessToken } from "@/server/ebay-seller";

const marketplaceId = "EBAY_GB";
const tradingCompatibilityLevel = "1423";
const tradingSiteId = "3";

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

export class EbayListingError extends Error {}

function xmlEscape(value: string | number) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function xmlUnescape(value: string) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function xmlText(xml: string, name: string) {
  const value = xml.match(new RegExp(`<${name}(?: [^>]*)?>([^<]*)</${name}>`))?.[1];
  return value === undefined ? null : xmlUnescape(value);
}

function errorsFromXml(xml: string): EbayError[] {
  return [...xml.matchAll(/<Errors>([\s\S]*?)<\/Errors>/g)].map((match) => ({
    code: xmlText(match[1], "ErrorCode"),
    message: xmlText(match[1], "LongMessage") ?? xmlText(match[1], "ShortMessage"),
    severity: xmlText(match[1], "SeverityCode"),
  }));
}

function feesFromXml(xml: string): EbayFee[] {
  return [...xml.matchAll(/<Fee>([\s\S]*?)<\/Fee>/g)].map((match) => ({
    amount: Number(xmlText(match[1], "Fee") ?? 0),
    currency: match[1].match(/<Fee currencyID="([^"]+)"/)?.[1] ?? "GBP",
    name: xmlText(match[1], "Name"),
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

async function tradingCall(ownerId: string, callName: "AddItem" | "VerifyAddItem", itemXml: string) {
  const accessToken = await getEbaySellerAccessToken(ownerId);
  const response = await fetch("https://api.ebay.com/ws/api.dll", {
    body: `<?xml version="1.0" encoding="utf-8"?><${callName}Request xmlns="urn:ebay:apis:eBLBaseComponents"><RequesterCredentials><eBayAuthToken>${xmlEscape(accessToken)}</eBayAuthToken></RequesterCredentials>${itemXml}</${callName}Request>`,
    headers: {
      "Content-Type": "text/xml",
      "X-EBAY-API-CALL-NAME": callName,
      "X-EBAY-API-COMPATIBILITY-LEVEL": tradingCompatibilityLevel,
      "X-EBAY-API-SITEID": tradingSiteId,
    },
    method: "POST",
  });
  const xml = await response.text();
  const errors = errorsFromXml(xml);
  if (!response.ok && !errors.length) {
    throw new EbayListingError(`eBay could not process the listing (${response.status}).`);
  }
  return {
    ack: xmlText(xml, "Ack"),
    errors,
    fees: feesFromXml(xml),
    itemId: xmlText(xml, "ItemID"),
  };
}

function listingItemXml(details: EbayListingDetails) {
  const pictures = details.images
    .map((image) => `<PictureURL>${xmlEscape(image.ebayUrl)}</PictureURL>`)
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
    .map(([name, value]) => `<NameValueList><Name>${xmlEscape(name)}</Name><Value>${xmlEscape(value)}</Value></NameValueList>`)
    .join("");
  const location = details.location
    ? `<Location>${xmlEscape(details.location)}</Location>`
    : "";

  return `<Item><Title>${xmlEscape(details.title)}</Title><Description>${descriptionHtml(details.description)}</Description><PrimaryCategory><CategoryID>${xmlEscape(details.categoryId)}</CategoryID></PrimaryCategory><ConditionDescriptors><ConditionDescriptor><Name>40001</Name><Value>${details.cardConditionDescriptorValueId}</Value></ConditionDescriptor></ConditionDescriptors><ConditionID>4000</ConditionID><ItemSpecifics>${specifics}</ItemSpecifics><StartPrice currencyID="GBP">${formatPrice(details.pricePence)}</StartPrice><CategoryMappingAllowed>true</CategoryMappingAllowed><Country>GB</Country><Currency>GBP</Currency><DispatchTimeMax>${details.dispatchTimeMax}</DispatchTimeMax><ListingDuration>GTC</ListingDuration><ListingType>FixedPriceItem</ListingType>${location}<PostalCode>${xmlEscape(details.postalCode)}</PostalCode><PictureDetails>${pictures}</PictureDetails><Quantity>1</Quantity><ReturnPolicy><ReturnsAcceptedOption>ReturnsNotAccepted</ReturnsAcceptedOption></ReturnPolicy><ShippingDetails><ShippingType>Flat</ShippingType><ShippingServiceOptions><ShippingServicePriority>1</ShippingServicePriority><ShippingService>${xmlEscape(details.shippingService)}</ShippingService><ShippingServiceCost currencyID="GBP">${formatPrice(details.shippingCostPence)}</ShippingServiceCost><FreeShipping>${details.shippingCostPence === 0 ? "true" : "false"}</FreeShipping></ShippingServiceOptions></ShippingDetails><Site>UK</Site><UUID>${crypto.randomUUID().replaceAll("-", "").toUpperCase()}</UUID></Item>`;
}

async function loadOwnedCopy(ownerId: string, copyId: string) {
  const [copy] = await db.select().from(cardCopies).where(and(
    eq(cardCopies.id, copyId),
    eq(cardCopies.ownerId, ownerId),
  )).limit(1);
  if (!copy) throw new EbayListingError("That physical Copy is not in your inventory.");
  return copy;
}

async function loadSellableCopy(ownerId: string, copyId: string) {
  const copy = await loadOwnedCopy(ownerId, copyId);
  if (copy.status !== "available") throw new EbayListingError("Only an available physical Copy can be listed.");

  const [activeListing] = await db.select({ id: ebayListings.id }).from(ebayListings).where(and(
    eq(ebayListings.ownerId, ownerId),
    eq(ebayListings.copyId, copyId),
    eq(ebayListings.status, "active"),
  )).limit(1);
  if (activeListing) throw new EbayListingError("This physical Copy already has an active eBay listing.");
  return copy;
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

  const listingId = `ebay-listing-${crypto.randomUUID()}`;
  const draftKeys = details.images.map((image) => image.archiveKey);
  const archivedKeys = await copyListingImageDraftsToArchive({
    copyId: details.copyId,
    draftKeys,
    listingId,
    ownerId,
  });

  let result: Awaited<ReturnType<typeof tradingCall>>;
  try {
    result = await tradingCall(ownerId, "AddItem", itemXml);
  } catch (error) {
    await deleteArchivedListingImages(archivedKeys);
    throw error;
  }
  if (!result.itemId || result.errors.some((error) => error.severity === "Error")) {
    await deleteArchivedListingImages(archivedKeys);
    throw new EbayListingError(result.errors.find((error) => error.message)?.message ?? "eBay did not publish the listing.");
  }

  const now = new Date();
  const listingUrl = `https://www.ebay.co.uk/itm/${result.itemId}`;
  await db.insert(ebayListings).values({
    id: listingId,
    ownerId,
    copyId: details.copyId,
    itemId: result.itemId,
    listingUrl,
    title: details.title,
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  await deleteListingImageDrafts(ownerId, details.copyId, draftKeys);
  return { archivedImageCount: archivedKeys.length, itemId: result.itemId, listingUrl };
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
  const parsed = new URL(sourceUrl);
  if (parsed.protocol !== "https:") {
    throw new EbayListingError("Use an HTTPS catalogue image.");
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

export async function archiveAndImportInventoryImage(ownerId: string, copyId: string, inventoryKey: string) {
  await loadSellableCopy(ownerId, copyId);
  let image: Awaited<ReturnType<typeof readCardInventoryImage>>;
  try {
    image = await readCardInventoryImage(ownerId, copyId, inventoryKey);
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

async function listingCopyMetadata(ownerId: string, copyId: string) {
  const copy = await loadSellableCopy(ownerId, copyId);
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

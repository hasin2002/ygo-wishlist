import "server-only";

import { getEbaySellerAccessToken } from "@/server/ebay-seller";
import { suggestEbayPaidSaleProceeds } from "@/lib/records/ebay-paid-sale-proceeds";

const tradingApiUrl = "https://api.ebay.com/ws/api.dll";
const tradingCompatibilityLevel = "1423";
const tradingSiteId = "3";

export type EbayTradingErrorDetail = {
  code: string | null;
  message: string | null;
  severity: string | null;
};

export class EbayTradingError extends Error {
  constructor(
    message: string,
    readonly details: EbayTradingErrorDetail[] = [],
  ) {
    super(message);
  }
}

export type EbayTradingResponse = {
  ack: string | null;
  errors: EbayTradingErrorDetail[];
  xml: string;
};

export function ebayXmlEscape(value: string | number) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function ebayXmlUnescape(value: string) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

export function ebayXmlText(xml: string, name: string) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const value = xml.match(
    new RegExp(`<(?:[A-Za-z0-9_-]+:)?${escapedName}(?: [^>]*)?>([^<]*)</(?:[A-Za-z0-9_-]+:)?${escapedName}>`),
  )?.[1];
  return value === undefined ? null : ebayXmlUnescape(value.trim());
}

export function ebayXmlContainers(xml: string, name: string) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...xml.matchAll(
    new RegExp(
      `<(?:[A-Za-z0-9_-]+:)?${escapedName}(?: [^>]*)?>([\\s\\S]*?)</(?:[A-Za-z0-9_-]+:)?${escapedName}>`,
      "g",
    ),
  )].map((match) => match[1]);
}

function errorsFromXml(xml: string): EbayTradingErrorDetail[] {
  return ebayXmlContainers(xml, "Errors").map((errorXml) => ({
    code: ebayXmlText(errorXml, "ErrorCode"),
    message: ebayXmlText(errorXml, "LongMessage") ?? ebayXmlText(errorXml, "ShortMessage"),
    severity: ebayXmlText(errorXml, "SeverityCode"),
  }));
}

export async function callEbayTradingApi({
  accessToken: suppliedAccessToken,
  body,
  callName,
  ownerId,
}: {
  accessToken?: string;
  body: string;
  callName: string;
  ownerId: string;
}): Promise<EbayTradingResponse> {
  const accessToken = suppliedAccessToken ?? await getEbaySellerAccessToken(ownerId);
  const response = await fetch(tradingApiUrl, {
    body: `<?xml version="1.0" encoding="utf-8"?><${callName}Request xmlns="urn:ebay:apis:eBLBaseComponents">${body}</${callName}Request>`,
    headers: {
      "Content-Type": "text/xml",
      "X-EBAY-API-CALL-NAME": callName,
      "X-EBAY-API-COMPATIBILITY-LEVEL": tradingCompatibilityLevel,
      "X-EBAY-API-IAF-TOKEN": accessToken,
      "X-EBAY-API-SITEID": tradingSiteId,
    },
    method: "POST",
  });
  const xml = await response.text();
  const errors = errorsFromXml(xml);
  const ack = ebayXmlText(xml, "Ack");
  const firstError = errors.find((error) => error.severity === "Error") ?? errors[0];

  if (!response.ok || ack === "Failure" || ack === "PartialFailure") {
    throw new EbayTradingError(
      firstError?.message ?? `eBay ${callName} failed (${response.status}).`,
      errors,
    );
  }

  return { ack, errors, xml };
}

function xmlNumber(xml: string, name: string) {
  const value = ebayXmlText(xml, name);
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function xmlPence(xml: string, name: string) {
  const amount = xmlNumber(xml, name);
  return amount === null || amount < 0 ? null : Math.round(amount * 100);
}

function xmlDate(xml: string, name: string) {
  const value = ebayXmlText(xml, name);
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function xmlBoolean(xml: string, name: string) {
  return ebayXmlText(xml, name)?.toLowerCase() === "true";
}

export type EbayRemoteTransaction = {
  cancelled: boolean;
  checkoutStatus: string | null;
  completeStatus: string | null;
  ebayPaymentStatus: string | null;
  estimatedProceedsPence: number | null;
  estimateIncludesReportedFee: boolean;
  orderId: string | null;
  orderLineItemId: string | null;
  paid: boolean;
  paidAt: Date | null;
  quantityPurchased: number;
  transactionId: string | null;
};

export type EbayRemoteListing = {
  adminEnded: boolean;
  endedAt: Date | null;
  endingReason: string | null;
  itemId: string;
  listingOnHold: boolean;
  listingStatus: string | null;
  quantitySold: number;
  transactions: EbayRemoteTransaction[];
};

function transactionFromXml(xml: string): EbayRemoteTransaction {
  const checkoutStatus = ebayXmlText(xml, "CheckoutStatus");
  const completeStatus = ebayXmlText(xml, "CompleteStatus");
  const ebayPaymentStatus = ebayXmlText(xml, "eBayPaymentStatus");
  const paidAt = xmlDate(xml, "PaidTime");
  const orderStatus = ebayXmlText(xml, "OrderStatus");
  const transactionStatus = ebayXmlText(xml, "TransactionStatus");
  const cancelled = [orderStatus, transactionStatus]
    .some((value) => value?.toLowerCase().includes("cancel"));
  const paid = !cancelled && Boolean(
    paidAt
    || checkoutStatus === "CheckoutComplete"
    || completeStatus === "Complete"
    || ebayPaymentStatus === "NoPaymentFailure",
  );
  const proceeds = suggestEbayPaidSaleProceeds({
    finalValueFeePence: xmlPence(xml, "FinalValueFee"),
    itemPricePence: xmlPence(xml, "TransactionPrice"),
    shippingChargedPence: xmlPence(xml, "ShippingServiceCost"),
  });

  return {
    cancelled,
    checkoutStatus,
    completeStatus,
    ebayPaymentStatus,
    estimatedProceedsPence: proceeds?.amountPence ?? null,
    estimateIncludesReportedFee: proceeds?.includesReportedFee ?? false,
    orderId: ebayXmlText(xml, "OrderID"),
    orderLineItemId: ebayXmlText(xml, "OrderLineItemID"),
    paid,
    paidAt,
    quantityPurchased: xmlNumber(xml, "QuantityPurchased") ?? 1,
    transactionId: ebayXmlText(xml, "TransactionID"),
  };
}

export async function getEbayRemoteListing(ownerId: string, itemId: string) {
  const itemResult = await callEbayTradingApi({
    body: `<ItemID>${ebayXmlEscape(itemId)}</ItemID><DetailLevel>ReturnAll</DetailLevel><IncludeItemSpecifics>false</IncludeItemSpecifics>`,
    callName: "GetItem",
    ownerId,
  });
  const itemXml = ebayXmlContainers(itemResult.xml, "Item")[0] ?? itemResult.xml;
  const quantitySold = xmlNumber(itemXml, "QuantitySold") ?? 0;
  let transactions: EbayRemoteTransaction[] = [];

  if (quantitySold > 0) {
    const transactionResult = await callEbayTradingApi({
      body: `<ItemID>${ebayXmlEscape(itemId)}</ItemID><DetailLevel>ReturnAll</DetailLevel>`,
      callName: "GetItemTransactions",
      ownerId,
    });
    transactions = ebayXmlContainers(transactionResult.xml, "Transaction")
      .map(transactionFromXml);
  }

  return {
    adminEnded: xmlBoolean(itemXml, "AdminEnded"),
    endedAt: xmlDate(itemXml, "EndTime"),
    endingReason: ebayXmlText(itemXml, "EndingReason"),
    itemId,
    listingOnHold: xmlBoolean(itemXml, "ListingOnHold"),
    listingStatus: ebayXmlText(itemXml, "ListingStatus"),
    quantitySold,
    transactions,
  } satisfies EbayRemoteListing;
}

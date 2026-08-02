import type {
  EbayDeliveryServiceCode,
  EbayListingItemSpecifics,
  EbayListingLanguage,
} from "../ebay-listing-options.ts";

export const ebayBatchOfferStatuses = [
  "draft",
  "needs_changes",
  "ready",
  "publishing",
  "published",
  "failed",
] as const;

export type EbayBatchOfferStatus = typeof ebayBatchOfferStatuses[number];
export type EbayBatchOfferKind = "individual" | "quantity" | "bundle";

export type EbayBatchPhoto = {
  archiveKey: string;
  ebayUrl: string | null;
  previewUrl: string;
  sourceInventoryCopyId?: string;
  sourceInventoryKey?: string;
};

export type EbayBatchSharedDefaults = {
  dispatchTimeMax: string;
  language: EbayListingLanguage;
  location: string;
  postalCode: string;
  reusableDescription: string;
  shippingCost: string;
  shippingService: EbayDeliveryServiceCode;
};

export type EbayBatchOfferOverride = Pick<
  EbayBatchSharedDefaults,
  "dispatchTimeMax" | "shippingCost" | "shippingService"
>;

export type EbayBatchVerification = {
  errors: Array<{
    code: string | null;
    message: string | null;
    severity: string | null;
  }>;
  fees: Array<{
    amount: number;
    currency: string;
    name: string | null;
  }>;
  readyToPublish: boolean;
};

export type EbayBatchOffer = {
  copyIds: string[];
  description: string;
  id: string;
  itemSpecifics: EbayListingItemSpecifics;
  kind: EbayBatchOfferKind;
  overrideDefaults: EbayBatchOfferOverride | null;
  photos: EbayBatchPhoto[];
  price: string;
  publicationId: string;
  publishedItemId: string | null;
  publishedUrl: string | null;
  status: EbayBatchOfferStatus;
  statusMessage: string | null;
  title: string;
  validatedFingerprint: string | null;
  verification: EbayBatchVerification | null;
};

export type EbayBatchDraft = {
  id: string;
  manualSaleAcknowledged: boolean;
  offers: EbayBatchOffer[];
  selectedCopyIds: string[];
  sharedDefaults: EbayBatchSharedDefaults;
  step: 1 | 2 | 3;
};

export type EbayBatchPlanningCopy = {
  condition: string;
  copyId: string;
  edition: string;
  printingId: string;
};

export type EbayBatchOfferSeed = {
  copyIds: string[];
  kind: EbayBatchOfferKind;
};

export type EbayBatchPlanOffer = Pick<EbayBatchOffer, "copyIds" | "id" | "kind">;

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stableValue(child)]),
  );
}

/** Stable JSON is shared by client status checks and server request hashing. */
export function stableEbayBatchJson(value: unknown) {
  return JSON.stringify(stableValue(value));
}

export function effectiveEbayBatchDefaults(
  shared: EbayBatchSharedDefaults,
  override: EbayBatchOfferOverride | null,
) {
  return override ? {
    ...shared,
    dispatchTimeMax: override.dispatchTimeMax,
    shippingCost: override.shippingCost,
    shippingService: override.shippingService,
  } : shared;
}

export function ebayBatchOfferFingerprint(
  offer: EbayBatchOffer,
  shared: EbayBatchSharedDefaults,
) {
  const defaults = effectiveEbayBatchDefaults(shared, offer.overrideDefaults);
  return stableEbayBatchJson({
    copyIds: offer.copyIds,
    defaults,
    description: offer.description,
    itemSpecifics: offer.itemSpecifics,
    kind: offer.kind,
    photos: offer.photos.map(({ archiveKey, ebayUrl }) => ({ archiveKey, ebayUrl })),
    price: offer.price,
    title: offer.title,
  });
}

export function ebayBatchOfferIsReady(
  offer: EbayBatchOffer,
  shared: EbayBatchSharedDefaults,
) {
  return offer.status === "ready"
    && offer.verification?.readyToPublish === true
    && offer.validatedFingerprint === ebayBatchOfferFingerprint(offer, shared);
}

export function ebayBatchMemberships(offers: Array<Pick<EbayBatchOffer, "copyIds" | "id">>) {
  const memberships = new Map<string, string[]>();
  for (const offer of offers) {
    for (const copyId of offer.copyIds) {
      const current = memberships.get(copyId) ?? [];
      if (!current.includes(offer.id)) current.push(offer.id);
      memberships.set(copyId, current);
    }
  }
  return memberships;
}

export function ebayBatchOverlaps(offers: Array<Pick<EbayBatchOffer, "copyIds" | "id">>) {
  return Array.from(ebayBatchMemberships(offers), ([copyId, offerIds]) => ({
    copyId,
    offerIds,
  })).filter(({ offerIds }) => offerIds.length > 1);
}

export function ebayBatchPublicationBlock(offers: EbayBatchOffer[]) {
  const planProblem = ebayCrossListingPlanProblem(offers);
  if (planProblem) return planProblem;
  if (!offers.length) return "Add at least one offer before publishing.";
  const pending = offers.filter((offer) => offer.status !== "published");
  const unready = pending.filter((offer) => offer.status !== "ready" && offer.status !== "failed");
  if (unready.length) {
    return `${unready.length} ${unready.length === 1 ? "offer needs" : "offers need"} an independent eBay review before publishing.`;
  }
  return null;
}

/**
 * Policy-identical compatible Copies start as one quantity offer. The returned
 * exact order is also the fulfilment order used by the quantity Listing.
 */
export function planEbayBatchOfferSeeds(copies: EbayBatchPlanningCopy[]) {
  const groups = new Map<string, EbayBatchPlanningCopy[]>();
  for (const copy of copies) {
    const key = stableEbayBatchJson({
      condition: copy.condition,
      edition: copy.edition,
      printingId: copy.printingId,
    });
    groups.set(key, [...(groups.get(key) ?? []), copy]);
  }
  return Array.from(groups.values(), (group): EbayBatchOfferSeed => ({
    copyIds: group.map((copy) => copy.copyId),
    kind: group.length > 1 ? "quantity" : "individual",
  }));
}

/**
 * One cross-list set contains a full mixed lot plus policy-safe standalone
 * offers. Identical Printing/edition/condition Copies share one quantity
 * offer so the generated fixed-price listings comply with eBay's duplicate
 * listing policy.
 */
export function planEbayCrossListingOfferSeeds(copies: EbayBatchPlanningCopy[]) {
  if (copies.length < 2) return [];
  return [
    { copyIds: copies.map((copy) => copy.copyId), kind: "bundle" as const },
    ...planEbayBatchOfferSeeds(copies),
  ];
}

export function ebayCrossListingPlanProblem(
  offers: Array<Pick<EbayBatchOffer, "copyIds" | "id" | "kind">>,
) {
  const bundles = offers.filter((offer) => offer.kind === "bundle");
  if (bundles.length !== 1) return "A cross-list set needs exactly one full mixed-card lot.";
  const lotCopyIds = bundles[0]!.copyIds;
  if (lotCopyIds.length < 2 || new Set(lotCopyIds).size !== lotCopyIds.length) {
    return "The full lot needs at least two different exact Copies.";
  }
  const standalone = offers.filter((offer) => offer.kind !== "bundle");
  if (standalone.length < 2) {
    return "Choose at least two distinct standalone groups, such as different rarities, Printings, editions, or conditions.";
  }
  const standaloneCopyIds = standalone.flatMap((offer) => offer.copyIds);
  if (new Set(standaloneCopyIds).size !== standaloneCopyIds.length) {
    return "Each exact Copy must appear in only one standalone offer.";
  }
  const normalizedLot = [...lotCopyIds].sort().join("\0");
  const normalizedStandalone = [...standaloneCopyIds].sort().join("\0");
  if (normalizedLot !== normalizedStandalone) {
    return "The full lot and standalone offers must represent the same exact Copies.";
  }
  if (standalone.some((offer) => (
    (offer.kind === "individual" && offer.copyIds.length !== 1)
    || (offer.kind === "quantity" && offer.copyIds.length < 2)
  ))) {
    return "Standalone offers no longer match their individual or quantity format.";
  }
  return null;
}

export function ebayBatchStatusLabel(status: EbayBatchOfferStatus) {
  return ({
    draft: "Draft",
    needs_changes: "Needs changes",
    ready: "Ready",
    publishing: "Publishing",
    published: "Published",
    failed: "Failed",
  } as const)[status];
}

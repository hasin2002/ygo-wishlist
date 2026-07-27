import type {
  CardCopy,
  CopyEbayActionState,
  CopyEbayExposureState,
  CopyPhysicalState,
  EbayExposureAggregateState,
  EbayOfferExposure,
  RecordEntry,
} from "@/lib/records/types";

type SourceRecord = Pick<RecordEntry, "id" | "status">;

/** Keeps the exact membership relationship when a legacy parent anchor repeats it. */
export function dedupeEbayOffersMembershipFirst(
  offers: EbayOfferExposure[],
): EbayOfferExposure[] {
  const byPair = new Map<string, EbayOfferExposure>();
  for (const offer of offers) {
    const key = `${offer.copyId}:${offer.listingId}`;
    const current = byPair.get(key);
    if (!current || (current.relationSource === "legacy" && offer.relationSource === "member")) {
      byPair.set(key, offer);
    }
  }
  return [...byPair.values()];
}

function physicalStateFor(copy: CardCopy, sourceRecord: SourceRecord | undefined): CopyPhysicalState {
  if (copy.status === "sold") {
    return { code: "sold", reason: "This physical Copy is recorded as sold.", state: "sold" };
  }
  if (copy.status === "void") {
    return { code: "copy_void", reason: "This physical Copy is unavailable.", state: "unavailable" };
  }
  if (!sourceRecord) {
    return { code: "source_record_unavailable", reason: "This Copy's source Record is unavailable, so it cannot be sold.", state: "unavailable" };
  }
  if (sourceRecord.status === "void") {
    return { code: "source_record_void", reason: "Restore the source Record before selling this Copy.", state: "unavailable" };
  }
  return { code: "owned", reason: "This physical Copy is owned.", state: "owned" };
}

function offerPriority(offer: EbayOfferExposure) {
  if (offer.lastError || offer.listingState === "suspended" || offer.listingState === "unknown") return 0;
  if (offer.saleState === "needs_review") return 1;
  if (offer.saleState === "paid") return 2;
  if (offer.saleState === "pending") return 3;
  if (offer.listingState === "active") return 4;
  if (offer.listingState === "ended") return 5;
  return 0;
}

function aggregateStateFor(
  physical: CopyPhysicalState,
  offers: EbayOfferExposure[],
): EbayExposureAggregateState {
  if (physical.state !== "owned" && offers.some((offer) => offer.listingState === "active")) {
    return "needs_takedown";
  }
  const priority = Math.min(...offers.map(offerPriority));
  switch (priority) {
    case Infinity:
    case 5:
      return "not_listed";
    case 0:
    case 1:
      return "needs_attention";
    case 2:
      return offers.some((offer) => offer.saleState === "paid" && !offer.saleRecordId)
        ? "needs_attention"
        : "paid_sale_recorded";
    case 3:
      return "payment_pending";
    case 4:
      return "live";
    default:
      return "needs_attention";
  }
}

function actionFor(
  physical: CopyPhysicalState,
  aggregateState: EbayExposureAggregateState,
  hasOffers: boolean,
): CopyEbayActionState {
  if (aggregateState === "needs_takedown") {
    return { code: "needs_takedown", disposition: "review", reason: "This Copy is no longer available but is still in a live eBay offer. Review the offer for takedown." };
  }
  if (physical.state === "sold") {
    return { code: "copy_sold", disposition: "blocked", reason: "This Copy is already recorded as sold." };
  }
  if (physical.state === "unavailable") {
    return { code: "copy_unavailable", disposition: "blocked", reason: physical.reason };
  }
  switch (aggregateState) {
    case "not_listed":
      return hasOffers
        ? { code: "only_ended_offers", disposition: "sell", reason: "Every related eBay offer has ended without an unresolved sale." }
        : { code: "no_related_offers", disposition: "sell", reason: "No related eBay offers are recorded for this Copy." };
    case "live":
      return { code: "live_offer", disposition: "review", reason: "This Copy is already in a live eBay offer. Review that offer before selling again." };
    case "payment_pending":
      return { code: "payment_pending", disposition: "review", reason: "An eBay payment is pending for this Copy. Wait for payment or review the offer." };
    case "paid_sale_recorded":
      return { code: "paid_sale_recorded", disposition: "review", reason: "A related eBay offer is paid and its Sale record is linked." };
    case "needs_attention":
      return { code: "needs_attention", disposition: "review", reason: "A related eBay offer needs attention before this Copy can be sold again." };
    case "reserved_by_order":
    case "ending_automatically":
      return { code: "needs_attention", disposition: "review", reason: "A related eBay offer is being protected. Review its status before selling again." };
    default: {
      const exhaustive: never = aggregateState;
      throw new Error(`Unsupported eBay exposure state: ${exhaustive}`);
    }
  }
}

/**
 * Produces a display-safe ownership/exposure state from persisted data only.
 * It intentionally never reconciles eBay or mutates a Copy.
 */
export function buildCopyEbayExposureStates(
  copies: CardCopy[],
  records: SourceRecord[],
  offers: EbayOfferExposure[],
): CopyEbayExposureState[] {
  const recordsById = new Map(records.map((record) => [record.id, record]));
  const offersByCopyId = new Map<string, EbayOfferExposure[]>();
  for (const offer of dedupeEbayOffersMembershipFirst(offers)) {
    const current = offersByCopyId.get(offer.copyId) ?? [];
    current.push(offer);
    offersByCopyId.set(offer.copyId, current);
  }

  return copies.map((copy) => {
    const copyOffers = [...(offersByCopyId.get(copy.id) ?? [])].sort((left, right) => (
      offerPriority(left) - offerPriority(right)
      || right.updatedAt.localeCompare(left.updatedAt)
      || right.listingId.localeCompare(left.listingId)
    ));
    const physical = physicalStateFor(copy, recordsById.get(copy.acquiredRecordId));
    const aggregateState = aggregateStateFor(physical, copyOffers);
    return {
      action: actionFor(physical, aggregateState, copyOffers.length > 0),
      aggregateState,
      copyId: copy.id,
      endedOfferCount: copyOffers.filter((offer) => offer.listingState === "ended").length,
      liveOfferCount: copyOffers.filter((offer) => offer.listingState === "active").length,
      offers: copyOffers,
      physical,
    };
  });
}

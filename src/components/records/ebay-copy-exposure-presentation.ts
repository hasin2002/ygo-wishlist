import type {
  CopyEbayExposureState,
  EbayExposureAggregateState,
} from "@/lib/records/types";

export type EbayExposureTone = "neutral" | "positive" | "info" | "warning" | "danger";

export type EbayExposurePresentation = {
  tone: EbayExposureTone;
  description: string;
  label: string;
};

export type CopyRemovalDecision = {
  available: boolean;
  reason: string | null;
};

function pluralise(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function physicalCopyStateLabel(exposure: Pick<CopyEbayExposureState, "physical">) {
  switch (exposure.physical.state) {
    case "owned": return "Owned";
    case "sold": return "Sold";
    case "unavailable": return "Unavailable";
    default: {
      const exhaustive: never = exposure.physical.state;
      throw new Error(`Unsupported physical Copy state: ${exhaustive}`);
    }
  }
}

export function ebayExposureSummary(exposure: Pick<CopyEbayExposureState, "liveOfferCount" | "endedOfferCount">) {
  return `${pluralise(exposure.liveOfferCount, "live offer")} · ${pluralise(exposure.endedOfferCount, "ended offer")}`;
}

export function copyExposureSelectorLabel(
  copyLabel: string,
  exposure: CopyEbayExposureState | undefined,
) {
  if (!exposure) return `${copyLabel} · eBay exposure unavailable`;
  return `${copyLabel} · ${physicalCopyStateLabel(exposure)} · eBay ${ebayExposureSummary(exposure)}`;
}

export function copyRemovalDecision(
  exposure: CopyEbayExposureState | undefined,
): CopyRemovalDecision {
  if (!exposure) {
    return {
      available: false,
      reason: "eBay listing history could not be confirmed for this Copy. Refresh Inventory before removing it.",
    };
  }
  if (exposure.offers.length) {
    return {
      available: false,
      reason: "This Copy has eBay listing history and cannot be removed because that history must be preserved.",
    };
  }
  return { available: true, reason: null };
}

export function ebayExposurePresentation(
  state: EbayExposureAggregateState,
  liveOfferCount: number,
): EbayExposurePresentation {
  switch (state) {
    case "not_listed":
      return {
        tone: "neutral",
        description: "No live eBay offer is recorded for this Copy.",
        label: "Not listed",
      };
    case "live":
      return {
        tone: "positive",
        description: "This is selling exposure only. The physical Copy remains owned until a Sale is recorded.",
        label: liveOfferCount === 1 ? "Live on eBay" : `Live in ${liveOfferCount} offers`,
      };
    case "payment_pending":
      return {
        tone: "info",
        description: "A related eBay order is pending payment. The physical Copy remains owned until a Sale is recorded.",
        label: "Payment pending",
      };
    case "paid_sale_recorded":
      return {
        tone: "positive",
        description: "A related eBay order is paid and linked to a Sale record.",
        label: "Paid · Sale recorded",
      };
    case "needs_takedown":
      return {
        tone: "danger",
        description: "This Copy is no longer available but still appears in a live eBay offer.",
        label: "Needs takedown",
      };
    case "needs_attention":
      return {
        tone: "warning",
        description: "A related eBay offer needs review before another selling action.",
        label: "Needs attention",
      };
    case "reserved_by_order":
      return {
        tone: "info",
        description: "A related eBay order has reserved this Copy. Its physical ownership has not changed.",
        label: "Reserved by order",
      };
    case "ending_automatically":
      return {
        tone: "warning",
        description: "A related eBay offer is ending automatically. Its physical ownership has not changed.",
        label: "Ending automatically",
      };
    default: {
      const exhaustive: never = state;
      throw new Error(`Unsupported eBay exposure state: ${exhaustive}`);
    }
  }
}

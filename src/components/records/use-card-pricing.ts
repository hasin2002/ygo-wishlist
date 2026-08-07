"use client";

import { useCallback, useRef, useState } from "react";
import type {
  CardContentsDraft,
  CardPricingDraft,
} from "@/components/records/card-contents-editor";
import { cardPricingIdentityKey } from "@/lib/records/card-pricing";
import { trpc } from "@/trpc/client";

function pounds(pence: number) {
  return `£${(pence / 100).toFixed(2)}`;
}

export function useCardPricing(
  updateCardPricing: (cardId: string, pricing: CardPricingDraft) => void,
) {
  const estimatePricing = trpc.library.estimatePricing.useMutation();
  const completed = useRef(new Map<string, CardPricingDraft>());
  const requests = useRef(new Map<string, Promise<CardPricingDraft>>());
  const [pendingCount, setPendingCount] = useState(0);

  const requestPricing = useCallback((card: CardContentsDraft) => {
    const localKey = cardPricingIdentityKey(card);
    if (card.pricing && card.pricing.identityKey === localKey && card.pricing.status !== "failed") {
      completed.current.set(localKey, card.pricing);
      return;
    }
    const cached = completed.current.get(localKey);
    if (cached) {
      updateCardPricing(card.id, cached);
      return;
    }

    updateCardPricing(card.id, {
      ebaySearchUrl: card.pricing?.ebaySearchUrl ?? "",
      estimatedPricePence: card.pricing?.estimatedPricePence ?? null,
      identityKey: localKey,
      message: card.pricing?.estimatedPricePence === null || card.pricing?.estimatedPricePence === undefined
        ? "Checking current UK eBay listings…"
        : `Checking UK eBay; keeping ${pounds(card.pricing.estimatedPricePence)} meanwhile…`,
      sampleSize: card.pricing?.sampleSize ?? 0,
      status: "checking",
    });

    let request = requests.current.get(localKey);
    if (!request) {
      setPendingCount((count) => count + 1);
      request = estimatePricing.mutateAsync({
        edition: card.edition as "1st Edition" | "Unlimited Edition" | "Limited Edition",
        name: card.name,
        rarity: card.rarity,
        selectedTargetId: card.selectedTargetId,
      }).then((result): CardPricingDraft => {
        const pricing: CardPricingDraft = {
          ebaySearchUrl: result.ebaySearchUrl,
          estimatedPricePence: result.estimatedPricePence,
          identityKey: result.identityKey,
          message: result.estimatedPricePence === null
            ? "No usable UK eBay listing estimate found."
            : result.foundNewEstimate
              ? `${pounds(result.estimatedPricePence)} UK eBay estimate from ${result.sampleSize} listing${result.sampleSize === 1 ? "" : "s"}.`
              : `No newer match found; keeping the existing ${pounds(result.estimatedPricePence)} estimate.`,
          sampleSize: result.sampleSize,
          status: result.estimatedPricePence === null ? "no-match" : "estimated",
        };
        completed.current.set(localKey, pricing);
        completed.current.set(result.identityKey, pricing);
        return pricing;
      }).finally(() => {
        requests.current.delete(localKey);
        setPendingCount((count) => Math.max(0, count - 1));
      });
      requests.current.set(localKey, request);
    }

    void request.then((pricing) => {
      updateCardPricing(card.id, pricing);
    }).catch((error: unknown) => {
      updateCardPricing(card.id, {
        ebaySearchUrl: card.pricing?.ebaySearchUrl ?? "",
        estimatedPricePence: card.pricing?.estimatedPricePence ?? null,
        identityKey: localKey,
        message: error instanceof Error
          ? `Estimate unavailable: ${error.message}`
          : "Estimate unavailable. You can retry by editing and finishing this card again.",
        sampleSize: card.pricing?.sampleSize ?? 0,
        status: "failed",
      });
    });
  }, [estimatePricing, updateCardPricing]);

  return { pendingCount, requestPricing };
}

import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  cardCopies,
  cardPricingEstimates,
  cardPrintings,
  cardTargets,
} from "@/db/schema";
import type { CardCondition } from "@/lib/records/types";
import { fetchEbayPricing } from "@/server/ebay-pricing";

export type RecordPricingVariant = {
  condition: CardCondition;
  printingId: string;
};

export function recordPricingVariantKey(variant: RecordPricingVariant) {
  return `${variant.printingId}::${variant.condition}`;
}

export async function listRecordPricingCandidates(ownerId: string) {
  return db
    .selectDistinct({
      condition: cardCopies.condition,
      printingId: cardCopies.printingId,
    })
    .from(cardCopies)
    .where(eq(cardCopies.ownerId, ownerId));
}

export async function refreshRecordPricingEstimate(
  ownerId: string,
  variant: RecordPricingVariant,
) {
  const [identity] = await db
    .select({
      condition: cardCopies.condition,
      name: cardTargets.name,
      printingId: cardPrintings.id,
      rarity: cardTargets.rarity,
      setCode: cardPrintings.setCode,
    })
    .from(cardPrintings)
    .innerJoin(cardTargets, and(
      eq(cardTargets.id, cardPrintings.targetId),
      eq(cardTargets.ownerId, ownerId),
    ))
    .innerJoin(cardCopies, and(
      eq(cardCopies.printingId, cardPrintings.id),
      eq(cardCopies.ownerId, ownerId),
      eq(cardCopies.condition, variant.condition),
    ))
    .where(and(
      eq(cardPrintings.id, variant.printingId),
      eq(cardPrintings.ownerId, ownerId),
    ))
    .limit(1);

  if (!identity) return null;

  const pricing = await fetchEbayPricing({
    condition: variant.condition,
    name: identity.name,
    rarity: identity.rarity,
    setCode: identity.setCode,
  });
  const [existing] = await db
    .select({ estimatedPricePence: cardPricingEstimates.estimatedPricePence })
    .from(cardPricingEstimates)
    .where(and(
      eq(cardPricingEstimates.ownerId, ownerId),
      eq(cardPricingEstimates.printingId, variant.printingId),
      eq(cardPricingEstimates.condition, variant.condition),
    ))
    .limit(1);
  const estimatedPricePence = pricing.estimatedPricePence
    ?? existing?.estimatedPricePence
    ?? null;
  const now = new Date();

  await db
    .insert(cardPricingEstimates)
    .values({
      id: `pricing-${randomUUID()}`,
      ownerId,
      printingId: variant.printingId,
      condition: variant.condition,
      estimatedPricePence,
      ebaySearchUrl: pricing.ebaySearchUrl,
      sampleSize: pricing.sampleSize,
      usedConditionFallback: pricing.usedConditionFallback,
      refreshedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        cardPricingEstimates.ownerId,
        cardPricingEstimates.printingId,
        cardPricingEstimates.condition,
      ],
      set: {
        estimatedPricePence,
        ebaySearchUrl: pricing.ebaySearchUrl,
        sampleSize: pricing.sampleSize,
        usedConditionFallback: pricing.usedConditionFallback,
        refreshedAt: now,
        updatedAt: now,
      },
    });

  return {
    condition: variant.condition,
    ebaySearchUrl: pricing.ebaySearchUrl,
    estimatedPricePence,
    foundNewEstimate: pricing.estimatedPricePence !== null,
    printingId: variant.printingId,
    sampleSize: pricing.sampleSize,
    usedConditionFallback: pricing.usedConditionFallback,
  };
}

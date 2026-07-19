import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { cardTargets } from "@/db/schema";
import { fetchEbayPricing } from "@/server/ebay-pricing";
import { recordPricingRefresh } from "@/server/pricing-refresh-state";
import { getPublicCollectionOwnerId } from "@/server/session";

export const runtime = "nodejs";
export const maxDuration = 300;

const batchSize = 2;
const delayBetweenBatchesMs = 150;

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");

  if (!cronSecret || authorization !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ownerId = await getPublicCollectionOwnerId();
  if (!ownerId) {
    return Response.json(
      { error: "No public collection owner is configured." },
      { status: 400 },
    );
  }

  const targets = await db
    .select()
    .from(cardTargets)
    .where(eq(cardTargets.ownerId, ownerId))
    .orderBy(asc(cardTargets.name));

  let estimated = 0;
  let failed = 0;
  let noMatch = 0;

  for (let index = 0; index < targets.length; index += batchSize) {
    const results = await Promise.allSettled(
      targets.slice(index, index + batchSize).map(async (target) => {
        const pricing = await fetchEbayPricing(target);
        await db
          .update(cardTargets)
          .set({
            estimatedPricePence: pricing.estimatedPricePence,
            ebaySearchUrl: pricing.ebaySearchUrl,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(cardTargets.id, target.id),
              eq(cardTargets.ownerId, ownerId),
            ),
          );

        return pricing.estimatedPricePence === null ? "no-match" : "estimated";
      }),
    );

    for (const result of results) {
      if (result.status === "rejected") {
        failed += 1;
      } else if (result.value === "no-match") {
        noMatch += 1;
      } else {
        estimated += 1;
      }
    }

    if (index + batchSize < targets.length) {
      await wait(delayBetweenBatchesMs);
    }
  }

  const completedAt = await recordPricingRefresh(ownerId);

  return Response.json({
    completedAt,
    estimated,
    failed,
    noMatch,
    refreshed: targets.length,
  });
}

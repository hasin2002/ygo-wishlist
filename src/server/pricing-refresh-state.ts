import "server-only";

import { db } from "@/db";
import { pricingRefreshStates } from "@/db/schema";

export async function recordPricingRefresh(ownerId: string) {
  const now = new Date();

  await db
    .insert(pricingRefreshStates)
    .values({ ownerId, lastRefreshedAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: pricingRefreshStates.ownerId,
      set: { lastRefreshedAt: now, updatedAt: now },
    });

  return now;
}

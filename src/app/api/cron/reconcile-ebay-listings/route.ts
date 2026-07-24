import {
  repairDueEbayNotificationSubscriptions,
  retryDueEbayNotificationEvents,
} from "@/server/ebay-notification-service";
import { reconcileDueEbayListings } from "@/server/ebay-listing-reconciliation";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  if (!cronSecret || authorization !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const eventRetries = await retryDueEbayNotificationEvents({
    limit: 20,
    maxRuntimeMs: 45_000,
  });
  const subscriptionRepairs = await repairDueEbayNotificationSubscriptions({
    limit: 5,
    maxRuntimeMs: 45_000,
  });
  const listings = await reconcileDueEbayListings({
    limit: 50,
    maxRuntimeMs: 150_000,
  });

  return Response.json({
    durationMs: Date.now() - startedAt,
    eventRetries,
    listings,
    subscriptionRepairs,
  });
}

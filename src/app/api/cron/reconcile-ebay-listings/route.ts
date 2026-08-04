import {
  retryDueEbayNotificationEvents,
} from "@/server/ebay-notification-service";
import { reconcileDueEbayListings } from "@/server/ebay-listing-reconciliation";
import { getSingleEbayConnectionOwner } from "@/server/ebay-seller";
import { checkEbayTradingAuthTokenStatus } from "@/server/ebay-trading-notification-service";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  if (!cronSecret || authorization !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const ownerId = await getSingleEbayConnectionOwner();
  const tradingAuthorization = ownerId
    ? await checkEbayTradingAuthTokenStatus(ownerId).catch(() => ({
        checked: false,
        status: "unavailable" as const,
      }))
    : { checked: false, status: "not_connected" as const };
  const eventRetries = await retryDueEbayNotificationEvents({
    limit: 20,
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
    tradingAuthorization,
  });
}

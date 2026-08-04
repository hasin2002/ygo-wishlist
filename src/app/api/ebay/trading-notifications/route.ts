import { after } from "next/server";
import {
  receiveEbayTradingNotification,
} from "@/lib/records/ebay-trading-notification-receiver";
import {
  persistEbayNotification,
  processEbayNotificationEvent,
} from "@/server/ebay-notification-service";

export const runtime = "nodejs";
export const maxDuration = 60;

function notificationCredentials() {
  const devId = process.env.EBAY_DEV_ID?.trim();
  const appId = process.env.EBAY_CLIENT_ID?.trim();
  const certId = process.env.EBAY_CLIENT_SECRET?.trim();
  return devId && appId && certId ? { appId, certId, devId } : null;
}

export async function POST(request: Request) {
  const receipt = await receiveEbayTradingNotification(request, {
    credentials: notificationCredentials(),
    persist: persistEbayNotification,
    process: processEbayNotificationEvent,
  });
  if (receipt.postResponse) {
    after(async () => {
      await receipt.postResponse?.().catch(() => undefined);
    });
  }
  return Response.json(receipt.body, { status: receipt.status });
}

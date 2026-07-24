import { after } from "next/server";
import {
  parseEbayNotificationPayload,
} from "@/lib/records/ebay-notification-event";
import {
  createEbayNotificationClient,
  decodeEbayNotificationSignature,
  verifyEbayNotificationSignature,
} from "@/server/ebay-notification-api";
import {
  ebayChallengeResponse,
  ebayNotificationPayloadHash,
  persistEbayNotification,
  processEbayNotificationEvent,
} from "@/server/ebay-notification-service";
import { getEbayApplicationAccessToken } from "@/server/ebay-seller";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const challengeCode = new URL(request.url).searchParams.get("challenge_code");
  if (!challengeCode?.trim()) {
    return Response.json({ error: "Missing challenge code." }, { status: 400 });
  }
  return Response.json({
    challengeResponse: ebayChallengeResponse(challengeCode),
  });
}

export async function POST(request: Request) {
  const signatureHeader = request.headers.get("x-ebay-signature");
  if (!signatureHeader) {
    return Response.json({ error: "Missing eBay signature." }, { status: 401 });
  }
  let keyId: string;
  try {
    keyId = decodeEbayNotificationSignature(signatureHeader).kid;
  } catch {
    return Response.json({ error: "Invalid eBay signature." }, { status: 412 });
  }

  const rawBody = await request.text();
  let signatureValid = false;
  try {
    const applicationToken = await getEbayApplicationAccessToken();
    const client = createEbayNotificationClient({
      accessToken: applicationToken,
    });
    const publicKey = await client.getPublicKey(keyId);
    signatureValid = verifyEbayNotificationSignature({
      publicKey,
      rawBody,
      signatureHeader,
    });
  } catch {
    return Response.json(
      { error: "The eBay signature could not be verified." },
      { status: 503 },
    );
  }
  if (!signatureValid) {
    return Response.json({ error: "Invalid eBay signature." }, { status: 412 });
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "Invalid notification JSON." }, { status: 400 });
  }
  const parsed = parseEbayNotificationPayload(parsedJson);
  if (!parsed) {
    return Response.json(
      { error: "Unsupported or incomplete eBay notification." },
      { status: 400 },
    );
  }

  const persisted = await persistEbayNotification({
    parsed,
    payloadHash: ebayNotificationPayloadHash(rawBody),
  });
  if (persisted.process && persisted.eventId) {
    after(async () => {
      await processEbayNotificationEvent(persisted.eventId!).catch(() => undefined);
    });
  }

  return Response.json({
    accepted: true,
    duplicate: persisted.duplicate,
  });
}

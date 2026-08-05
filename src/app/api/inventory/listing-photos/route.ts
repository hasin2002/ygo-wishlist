import { and, asc, eq, max } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import {
  cardCopies,
  cardListingPhotoImages,
  cardPrintings,
  cardTargets,
} from "@/db/schema";
import { isCardCondition, type CardCondition } from "@/lib/records/types";
import {
  deleteCardListingPhoto,
  isCardListingPhotoArchiveConfigured,
  readCardListingPhoto,
  storeCardListingPhoto,
} from "@/server/card-listing-photo-images";
import { readCardInventoryImage } from "@/server/card-inventory-images";
import { getSessionFromHeaders } from "@/server/session";

export const runtime = "nodejs";

const allowedImageTypes = new Set([
  "image/avif",
  "image/bmp",
  "image/gif",
  "image/heic",
  "image/jpeg",
  "image/png",
  "image/tiff",
  "image/webp",
]);
const maximumImageBytes = 12 * 1024 * 1024;
const photoKinds = new Set(["individual", "x2", "x3"] as const);
type PhotoKind = "individual" | "x2" | "x3";

type Scope = {
  condition: CardCondition;
  edition: string;
  kind: PhotoKind;
  printingId: string;
};

function previewUrl(key: string) {
  return `/api/inventory/listing-photos?key=${encodeURIComponent(key)}`;
}

function imageJson(image: typeof cardListingPhotoImages.$inferSelect) {
  return {
    key: image.objectKey,
    position: image.position,
    previewUrl: previewUrl(image.objectKey),
    sourceCopyId: image.sourceCopyId,
    sourceInventoryKey: image.sourceInventoryKey,
  };
}

async function ownerSession(request: Request) {
  const session = await getSessionFromHeaders(request.headers);
  if (!session) return { response: NextResponse.json({ message: "Sign in to manage listing photos." }, { status: 401 }) };
  if (process.env.NEXT_PUBLIC_RECORDS_UI_PREVIEW === "1") {
    return { response: NextResponse.json({ message: "Listing photos are unavailable in preview mode. Switch to live Records." }, { status: 403 }) };
  }
  return { session };
}

function scopeFrom(source: URLSearchParams | FormData | Record<string, unknown>): Scope | null {
  const value = (key: string) => {
    if (source instanceof URLSearchParams || source instanceof FormData) {
      const candidate = source.get(key);
      return typeof candidate === "string" ? candidate.trim() : "";
    }
    const candidate = source[key];
    return typeof candidate === "string" ? candidate.trim() : "";
  };
  const printingId = value("printingId");
  const edition = value("edition");
  const condition = value("condition");
  const kind = value("kind");
  if (!printingId || !edition || !isCardCondition(condition) || !photoKinds.has(kind as PhotoKind)) return null;
  return { condition, edition, kind: kind as PhotoKind, printingId };
}

async function ownedScope(ownerId: string, scope: Scope) {
  const [printing] = await db.select({ id: cardPrintings.id }).from(cardPrintings)
    .innerJoin(cardTargets, and(
      eq(cardTargets.id, cardPrintings.targetId),
      eq(cardTargets.ownerId, ownerId),
    ))
    .where(and(
      eq(cardPrintings.id, scope.printingId),
      eq(cardPrintings.ownerId, ownerId),
      eq(cardTargets.edition, scope.edition),
    )).limit(1);
  return printing;
}

function scopeWhere(ownerId: string, scope: Scope) {
  return and(
    eq(cardListingPhotoImages.ownerId, ownerId),
    eq(cardListingPhotoImages.printingId, scope.printingId),
    eq(cardListingPhotoImages.edition, scope.edition),
    eq(cardListingPhotoImages.condition, scope.condition),
    eq(cardListingPhotoImages.kind, scope.kind),
  );
}

async function indexedImages(ownerId: string, scope: Scope) {
  return db.select().from(cardListingPhotoImages)
    .where(scopeWhere(ownerId, scope))
    .orderBy(asc(cardListingPhotoImages.position), asc(cardListingPhotoImages.createdAt));
}

export async function GET(request: Request) {
  const auth = await ownerSession(request);
  if (auth.response) return auth.response;
  const params = new URL(request.url).searchParams;
  const key = params.get("key")?.trim() ?? "";
  const ownerId = auth.session.user.id;

  try {
    if (key) {
      const [indexed] = await db.select({ objectKey: cardListingPhotoImages.objectKey })
        .from(cardListingPhotoImages)
        .where(and(
          eq(cardListingPhotoImages.ownerId, ownerId),
          eq(cardListingPhotoImages.objectKey, key),
        )).limit(1);
      if (!indexed) return NextResponse.json({ message: "That listing photo was not found." }, { status: 404 });
      const image = await readCardListingPhoto(ownerId, key);
      return new Response(new Uint8Array(image.bytes).buffer, {
        headers: { "Cache-Control": "private, max-age=300", "Content-Type": image.contentType },
      });
    }

    const scope = scopeFrom(params);
    if (!scope) return NextResponse.json({ message: "Choose one Printing, edition, condition, and photo set." }, { status: 400 });
    if (!(await ownedScope(ownerId, scope))) return NextResponse.json({ message: "That Printing was not found." }, { status: 404 });
    if (!isCardListingPhotoArchiveConfigured()) return NextResponse.json({ configured: false, images: [] });
    return NextResponse.json({
      configured: true,
      images: (await indexedImages(ownerId, scope)).map(imageJson),
    });
  } catch {
    return NextResponse.json({ message: "The listing-photo archive could not be reached." }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const auth = await ownerSession(request);
  if (auth.response) return auth.response;
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ message: "Choose a listing photo to add." }, { status: 400 });
  }
  const scope = scopeFrom(form);
  if (!scope) return NextResponse.json({ message: "Choose one Printing, edition, condition, and photo set." }, { status: 400 });
  const ownerId = auth.session.user.id;
  if (!(await ownedScope(ownerId, scope))) return NextResponse.json({ message: "That Printing was not found." }, { status: 404 });

  const fileValue = form.get("image");
  const file = fileValue instanceof File ? fileValue : null;
  const sourceCopyId = typeof form.get("sourceCopyId") === "string" ? String(form.get("sourceCopyId")).trim() : "";
  const sourceInventoryKey = typeof form.get("sourceInventoryKey") === "string" ? String(form.get("sourceInventoryKey")).trim() : "";
  if (Boolean(file) === Boolean(sourceCopyId && sourceInventoryKey)) {
    return NextResponse.json({ message: "Choose one uploaded photo or one saved Copy photo." }, { status: 400 });
  }

  let bytes: Uint8Array;
  let contentType: string;
  try {
    if (file) {
      if (!allowedImageTypes.has(file.type)) return NextResponse.json({ message: "Use a JPG, PNG, WEBP, AVIF, HEIC, GIF, BMP, or TIFF image." }, { status: 400 });
      if (!file.size || file.size > maximumImageBytes) return NextResponse.json({ message: "Use an image smaller than 12 MB." }, { status: 400 });
      bytes = new Uint8Array(await file.arrayBuffer());
      contentType = file.type;
    } else {
      const [copy] = await db.select({ id: cardCopies.id }).from(cardCopies).where(and(
        eq(cardCopies.id, sourceCopyId),
        eq(cardCopies.ownerId, ownerId),
        eq(cardCopies.printingId, scope.printingId),
        eq(cardCopies.condition, scope.condition),
      )).limit(1);
      if (!copy) return NextResponse.json({ message: "That saved Copy photo does not match this Printing and condition." }, { status: 400 });
      const inventoryImage = await readCardInventoryImage(ownerId, sourceCopyId, sourceInventoryKey);
      bytes = inventoryImage.bytes;
      contentType = inventoryImage.contentType;
    }

    const objectKey = await storeCardListingPhoto({ bytes, contentType, ownerId });
    try {
      const [last] = await db.select({ value: max(cardListingPhotoImages.position) })
        .from(cardListingPhotoImages).where(scopeWhere(ownerId, scope));
      const position = (last?.value ?? -1) + 1;
      const now = new Date();
      const [created] = await db.insert(cardListingPhotoImages).values({
        condition: scope.condition,
        createdAt: now,
        edition: scope.edition,
        id: crypto.randomUUID(),
        kind: scope.kind,
        objectKey,
        ownerId,
        position,
        printingId: scope.printingId,
        sourceCopyId: sourceCopyId || null,
        sourceInventoryKey: sourceInventoryKey || null,
        updatedAt: now,
      }).returning();
      return NextResponse.json({ image: imageJson(created) });
    } catch (error) {
      await deleteCardListingPhoto(ownerId, objectKey).catch(() => undefined);
      throw error;
    }
  } catch (error) {
    const message = error instanceof Error && !error.message.includes("not configured")
      ? error.message
      : "The listing photo could not be archived.";
    return NextResponse.json({ message }, { status: 502 });
  }
}

export async function DELETE(request: Request) {
  const auth = await ownerSession(request);
  if (auth.response) return auth.response;
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ message: "Choose the listing photo to remove." }, { status: 400 });
  }
  const scope = scopeFrom(body);
  const key = typeof body.key === "string" ? body.key.trim() : "";
  if (!scope || !key) return NextResponse.json({ message: "Choose the listing photo to remove." }, { status: 400 });
  const ownerId = auth.session.user.id;
  try {
    const [removed] = await db.delete(cardListingPhotoImages).where(and(
      scopeWhere(ownerId, scope),
      eq(cardListingPhotoImages.objectKey, key),
    )).returning({ objectKey: cardListingPhotoImages.objectKey });
    if (!removed) return NextResponse.json({ message: "That listing photo was not found." }, { status: 404 });
    await deleteCardListingPhoto(ownerId, key).catch(() => undefined);
    const remaining = await indexedImages(ownerId, scope);
    const now = new Date();
    for (const [position, image] of remaining.entries()) {
      if (image.position === position) continue;
      await db.update(cardListingPhotoImages).set({ position, updatedAt: now }).where(eq(cardListingPhotoImages.id, image.id));
    }
    return NextResponse.json({ removed: true });
  } catch {
    return NextResponse.json({ message: "The listing photo could not be removed." }, { status: 502 });
  }
}

export async function PATCH(request: Request) {
  const auth = await ownerSession(request);
  if (auth.response) return auth.response;
  try {
    const body = await request.json() as Record<string, unknown>;
    const scope = scopeFrom(body);
    const keys = Array.isArray(body.keys) && body.keys.every((key) => typeof key === "string")
      ? body.keys as string[]
      : [];
    if (!scope || !keys.length || new Set(keys).size !== keys.length) throw new Error();
    const ownerId = auth.session.user.id;
    const current = await indexedImages(ownerId, scope);
    if (current.length !== keys.length || current.some((image) => !keys.includes(image.objectKey))) {
      return NextResponse.json({ message: "Photo order is out of date. Reload and try again." }, { status: 409 });
    }
    const now = new Date();
    await db.transaction(async (tx) => {
      for (const [index, key] of keys.entries()) await tx.update(cardListingPhotoImages).set({ position: 1_000_000 + index, updatedAt: now }).where(and(scopeWhere(ownerId, scope), eq(cardListingPhotoImages.objectKey, key)));
      for (const [index, key] of keys.entries()) await tx.update(cardListingPhotoImages).set({ position: index, updatedAt: now }).where(and(scopeWhere(ownerId, scope), eq(cardListingPhotoImages.objectKey, key)));
    });
    return NextResponse.json({ images: (await indexedImages(ownerId, scope)).map(imageJson) });
  } catch {
    return NextResponse.json({ message: "Photo order could not be saved." }, { status: 400 });
  }
}

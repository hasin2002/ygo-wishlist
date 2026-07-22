import { and, asc, eq, inArray, max } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { cardCopies, cardCopyImages } from "@/db/schema";
import {
  deleteCardInventoryImage,
  isCardInventoryImageArchiveConfigured,
  readCardInventoryImage,
  storeCardInventoryImage,
} from "@/server/card-inventory-images";
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

function previewUrl(copyId: string, key: string) {
  return `/api/inventory/card-images?copyId=${encodeURIComponent(copyId)}&key=${encodeURIComponent(key)}`;
}

async function ownedCopy(ownerId: string, copyId: string) {
  const [copy] = await db.select({ id: cardCopies.id }).from(cardCopies).where(and(
    eq(cardCopies.id, copyId),
    eq(cardCopies.ownerId, ownerId),
  )).limit(1);
  return copy;
}

async function indexedImages(ownerId: string, copyId: string) {
  return db.select().from(cardCopyImages).where(and(
    eq(cardCopyImages.ownerId, ownerId), eq(cardCopyImages.copyId, copyId),
  )).orderBy(asc(cardCopyImages.position), asc(cardCopyImages.createdAt));
}

async function adminSession(request: Request) {
  const session = await getSessionFromHeaders(request.headers);
  if (!session) return { response: NextResponse.json({ message: "Sign in to manage card images." }, { status: 401 }) };
  if (session.user.role !== "admin") return { response: NextResponse.json({ message: "Administrator access is required." }, { status: 403 }) };
  return { session };
}

export async function GET(request: Request) {
  const auth = await adminSession(request);
  if (auth.response) return auth.response;
  const copyId = new URL(request.url).searchParams.get("copyId")?.trim() ?? "";
  const copyIds = new URL(request.url).searchParams.get("copyIds")?.split(",").map((id) => id.trim()).filter(Boolean).slice(0, 100) ?? [];
  const key = new URL(request.url).searchParams.get("key")?.trim() ?? "";
  if (copyIds.length) {
    const owned = await db.select({ id: cardCopies.id }).from(cardCopies).where(and(eq(cardCopies.ownerId, auth.session.user.id), inArray(cardCopies.id, copyIds)));
    if (owned.length !== copyIds.length) return NextResponse.json({ message: "One or more physical card Copies were not found." }, { status: 404 });
    if (!isCardInventoryImageArchiveConfigured()) return NextResponse.json({ configured: false, summaries: {} });
    const images = await db.select().from(cardCopyImages).where(and(eq(cardCopyImages.ownerId, auth.session.user.id), inArray(cardCopyImages.copyId, copyIds))).orderBy(asc(cardCopyImages.position));
    const summaries = Object.fromEntries(copyIds.map((id) => { const copyImages = images.filter((image) => image.copyId === id); return [id, { count: copyImages.length, primary: copyImages[0] ? { key: copyImages[0].objectKey, previewUrl: previewUrl(id, copyImages[0].objectKey) } : null }]; }));
    return NextResponse.json({ configured: true, summaries });
  }
  if (!copyId) return NextResponse.json({ message: "Choose a physical card Copy." }, { status: 400 });
  if (!(await ownedCopy(auth.session.user.id, copyId))) return NextResponse.json({ message: "That physical card Copy was not found." }, { status: 404 });

  try {
    if (!isCardInventoryImageArchiveConfigured()) return NextResponse.json({ configured: false, images: [] });
    if (key) {
      const [indexed] = await db.select({ id: cardCopyImages.id }).from(cardCopyImages).where(and(eq(cardCopyImages.ownerId, auth.session.user.id), eq(cardCopyImages.copyId, copyId), eq(cardCopyImages.objectKey, key))).limit(1);
      if (!indexed) return NextResponse.json({ message: "That card image was not found." }, { status: 404 });
      const image = await readCardInventoryImage(auth.session.user.id, copyId, key);
      return new Response(new Uint8Array(image.bytes).buffer, { headers: { "Cache-Control": "private, max-age=300", "Content-Type": image.contentType } });
    }
    const images = await indexedImages(auth.session.user.id, copyId);
    return NextResponse.json({ configured: true, images: images.map((image) => ({ key: image.objectKey, position: image.position, previewUrl: previewUrl(copyId, image.objectKey) })) });
  } catch {
    return NextResponse.json({ message: "The card-image archive could not be reached." }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const auth = await adminSession(request);
  if (auth.response) return auth.response;
  let copyId = "";
  let image: File | null = null;
  try {
    const form = await request.formData();
    copyId = typeof form.get("copyId") === "string" ? String(form.get("copyId")).trim() : "";
    image = form.get("image") instanceof File ? form.get("image") as File : null;
  } catch {
    return NextResponse.json({ message: "Choose an image file to upload." }, { status: 400 });
  }
  if (!copyId) return NextResponse.json({ message: "Choose a physical card Copy." }, { status: 400 });
  if (!(await ownedCopy(auth.session.user.id, copyId))) return NextResponse.json({ message: "That physical card Copy was not found." }, { status: 404 });
  if (!image || !allowedImageTypes.has(image.type)) return NextResponse.json({ message: "Use a JPG, PNG, WEBP, AVIF, HEIC, GIF, BMP, or TIFF image." }, { status: 400 });
  if (image.size === 0 || image.size > maximumImageBytes) return NextResponse.json({ message: "Use an image smaller than 12 MB." }, { status: 400 });
  try {
    const ownerId = auth.session.user.id;
    const key = await storeCardInventoryImage({ bytes: new Uint8Array(await image.arrayBuffer()), contentType: image.type, copyId, ownerId });
    try {
      const [last] = await db.select({ value: max(cardCopyImages.position) }).from(cardCopyImages).where(and(eq(cardCopyImages.ownerId, ownerId), eq(cardCopyImages.copyId, copyId)));
      const position = (last?.value ?? -1) + 1;
      await db.insert(cardCopyImages).values({ id: crypto.randomUUID(), ownerId, copyId, objectKey: key, position, createdAt: new Date() });
      return NextResponse.json({ image: { key, position, previewUrl: previewUrl(copyId, key) } });
    } catch (error) {
      await deleteCardInventoryImage(ownerId, copyId, key).catch(() => undefined);
      throw error;
    }
  } catch (error) {
    const message = error instanceof Error && !error.message.includes("not configured") ? error.message : "The card image could not be archived.";
    return NextResponse.json({ message }, { status: 502 });
  }
}

export async function DELETE(request: Request) {
  const auth = await adminSession(request);
  if (auth.response) return auth.response;
  let copyId = "";
  let key = "";
  try {
    const body = await request.json() as { copyId?: unknown; key?: unknown };
    copyId = typeof body.copyId === "string" ? body.copyId.trim() : "";
    key = typeof body.key === "string" ? body.key.trim() : "";
  } catch {
    return NextResponse.json({ message: "Choose the card image to remove." }, { status: 400 });
  }
  if (!copyId || !key) return NextResponse.json({ message: "Choose the card image to remove." }, { status: 400 });
  if (!(await ownedCopy(auth.session.user.id, copyId))) return NextResponse.json({ message: "That physical card Copy was not found." }, { status: 404 });
  try {
    const [image] = await db.delete(cardCopyImages).where(and(
      eq(cardCopyImages.ownerId, auth.session.user.id), eq(cardCopyImages.copyId, copyId), eq(cardCopyImages.objectKey, key),
    )).returning({ objectKey: cardCopyImages.objectKey });
    if (!image) return NextResponse.json({ message: "That card image was not found." }, { status: 404 });
    await deleteCardInventoryImage(auth.session.user.id, copyId, key).catch(() => undefined);
    return NextResponse.json({ removed: true });
  } catch {
    return NextResponse.json({ message: "The card image could not be removed." }, { status: 502 });
  }
}

export async function PATCH(request: Request) {
  const auth = await adminSession(request);
  if (auth.response) return auth.response;
  try {
    const body = await request.json() as { copyId?: unknown; keys?: unknown };
    const copyId = typeof body.copyId === "string" ? body.copyId.trim() : "";
    const keys = Array.isArray(body.keys) && body.keys.every((key) => typeof key === "string") ? body.keys as string[] : [];
    if (!copyId || !keys.length || new Set(keys).size !== keys.length) throw new Error();
    if (!(await ownedCopy(auth.session.user.id, copyId))) return NextResponse.json({ message: "That physical card Copy was not found." }, { status: 404 });
    const current = await indexedImages(auth.session.user.id, copyId);
    if (current.length !== keys.length || current.some((image) => !keys.includes(image.objectKey))) return NextResponse.json({ message: "Photo order is out of date. Reload and try again." }, { status: 409 });
    await db.transaction(async (tx) => {
      for (const [index, key] of keys.entries()) await tx.update(cardCopyImages).set({ position: 1_000_000 + index }).where(and(eq(cardCopyImages.ownerId, auth.session.user.id), eq(cardCopyImages.copyId, copyId), eq(cardCopyImages.objectKey, key)));
      for (const [index, key] of keys.entries()) await tx.update(cardCopyImages).set({ position: index }).where(and(eq(cardCopyImages.ownerId, auth.session.user.id), eq(cardCopyImages.copyId, copyId), eq(cardCopyImages.objectKey, key)));
    });
    return NextResponse.json({ images: (await indexedImages(auth.session.user.id, copyId)).map((image) => ({ key: image.objectKey, position: image.position, previewUrl: previewUrl(copyId, image.objectKey) })) });
  } catch {
    return NextResponse.json({ message: "Photo order could not be saved." }, { status: 400 });
  }
}

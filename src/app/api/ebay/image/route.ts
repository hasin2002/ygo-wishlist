import { NextResponse } from "next/server";
import {
  archiveAndImportEbayImage,
  archiveAndImportInventoryImage,
  archiveAndUploadEbayImage,
  EbayListingError,
  getEbayListingImageDraft,
  removeEbayListingImageDraft,
} from "@/server/ebay-listing";
import { EbayAuthorizationError } from "@/server/ebay-seller";
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

function previewUrl(copyId: string, archiveKey: string) {
  const params = new URLSearchParams({ copyId, key: archiveKey });
  return `/api/ebay/image?${params}`;
}

export async function GET(request: Request) {
  const session = await getSessionFromHeaders(request.headers);
  if (!session) return NextResponse.json({ message: "Sign in to view a listing image." }, { status: 401 });
  if (session.user.role !== "admin") {
    return NextResponse.json({ message: "Administrator access is required." }, { status: 403 });
  }
  const params = new URL(request.url).searchParams;
  const copyId = params.get("copyId")?.trim() ?? "";
  const archiveKey = params.get("key")?.trim() ?? "";
  if (!copyId || !archiveKey) {
    return NextResponse.json({ message: "The archived listing image is missing." }, { status: 400 });
  }

  try {
    const image = await getEbayListingImageDraft(session.user.id, copyId, archiveKey);
    return new Response(new Uint8Array(image.bytes).buffer, {
      headers: {
        "Cache-Control": "private, max-age=300",
        "Content-Type": image.contentType,
      },
    });
  } catch (error) {
    const message = error instanceof EbayListingError
      ? error.message
      : "The archived listing image could not be loaded.";
    return NextResponse.json({ message }, { status: 404 });
  }
}

export async function POST(request: Request) {
  const session = await getSessionFromHeaders(request.headers);
  if (!session) return NextResponse.json({ message: "Sign in to upload a listing image." }, { status: 401 });
  if (session.user.role !== "admin") {
    return NextResponse.json({ message: "Administrator access is required." }, { status: 403 });
  }

  let image: File | null = null;
  let sourceUrl = "";
  let inventoryKey = "";
  let copyId = "";
  try {
    const form = await request.formData();
    const candidate = form.get("image");
    image = candidate instanceof File ? candidate : null;
    const source = form.get("sourceUrl");
    sourceUrl = typeof source === "string" ? source.trim() : "";
    const savedImage = form.get("inventoryKey");
    inventoryKey = typeof savedImage === "string" ? savedImage.trim() : "";
    const copy = form.get("copyId");
    copyId = typeof copy === "string" ? copy.trim() : "";
  } catch {
    return NextResponse.json({ message: "Choose an image file to upload." }, { status: 400 });
  }
  if (!copyId) return NextResponse.json({ message: "Choose the physical card copy for this listing." }, { status: 400 });
  if (inventoryKey) {
    try {
      const result = await archiveAndImportInventoryImage(session.user.id, copyId, inventoryKey);
      return NextResponse.json({ ...result, previewUrl: previewUrl(copyId, result.archiveKey) });
    } catch (error) {
      if (error instanceof EbayAuthorizationError) {
        return NextResponse.json({ message: "Connect eBay before importing a saved card photo." }, { status: 401 });
      }
      const message = error instanceof EbayListingError
        ? error.message
        : "The saved card photo could not be imported to eBay.";
      return NextResponse.json({ message }, { status: 502 });
    }
  }
  if (sourceUrl) {
    try {
      const result = await archiveAndImportEbayImage(session.user.id, copyId, sourceUrl);
      return NextResponse.json({ ...result, previewUrl: previewUrl(copyId, result.archiveKey) });
    } catch (error) {
      if (error instanceof EbayAuthorizationError) {
        return NextResponse.json({ message: "Connect eBay before importing a listing image." }, { status: 401 });
      }
      const message = error instanceof EbayListingError
        ? error.message
        : "The catalogue image could not be imported to eBay.";
      return NextResponse.json({ message }, { status: 502 });
    }
  }
  if (!image || !allowedImageTypes.has(image.type)) {
    return NextResponse.json({ message: "Use a JPG, PNG, WEBP, AVIF, HEIC, GIF, BMP, or TIFF image." }, { status: 400 });
  }
  if (image.size === 0 || image.size > maximumImageBytes) {
    return NextResponse.json({ message: "Use an image smaller than 12 MB." }, { status: 400 });
  }

  try {
    const result = await archiveAndUploadEbayImage(session.user.id, copyId, image);
    return NextResponse.json({ ...result, previewUrl: previewUrl(copyId, result.archiveKey) });
  } catch (error) {
    if (error instanceof EbayAuthorizationError) {
      return NextResponse.json({ message: "Connect eBay before uploading a listing image." }, { status: 401 });
    }
    const message = error instanceof EbayListingError
      ? error.message
      : "The image could not be uploaded to eBay. Try again shortly.";
    return NextResponse.json({ message }, { status: 502 });
  }
}

export async function DELETE(request: Request) {
  const session = await getSessionFromHeaders(request.headers);
  if (!session) return NextResponse.json({ message: "Sign in to remove a listing image." }, { status: 401 });
  if (session.user.role !== "admin") {
    return NextResponse.json({ message: "Administrator access is required." }, { status: 403 });
  }

  let copyId = "";
  let archiveKey = "";
  try {
    const body = await request.json() as { archiveKey?: unknown; copyId?: unknown };
    copyId = typeof body.copyId === "string" ? body.copyId.trim() : "";
    archiveKey = typeof body.archiveKey === "string" ? body.archiveKey.trim() : "";
  } catch {
    return NextResponse.json({ message: "Choose the listing image to remove." }, { status: 400 });
  }
  if (!copyId || !archiveKey) {
    return NextResponse.json({ message: "Choose the listing image to remove." }, { status: 400 });
  }

  try {
    await removeEbayListingImageDraft(session.user.id, copyId, archiveKey);
    return NextResponse.json({ removed: true });
  } catch (error) {
    const message = error instanceof EbayListingError
      ? error.message
      : "The archived listing image could not be removed.";
    return NextResponse.json({ message }, { status: 502 });
  }
}

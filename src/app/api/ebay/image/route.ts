import { NextResponse } from "next/server";
import {
  EbayImageOperationError,
  executeEbayImagePostOperation,
  parseEbayImagePostOperation,
} from "@/lib/records/ebay-image-operation";
import {
  archiveAndImportEbayImage,
  archiveAndImportInventoryImage,
  archiveInventoryImageDraft,
  archiveListingPhotoSetImageDraft,
  archiveAndUploadEbayImage,
  EbayListingError,
  getEbayListingImageDraft,
  removeEbayListingImageDraft,
  transferEbayListingImageDraft,
  uploadArchivedEbayImage,
} from "@/server/ebay-listing";
import { EbayAuthorizationError } from "@/server/ebay-seller";
import { getEbayCapabilityForSession } from "@/server/ebay-capabilities";
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
  const params = new URL(request.url).searchParams;
  const copyId = params.get("copyId")?.trim() ?? "";
  const archiveKey = params.get("key")?.trim() ?? "";
  if (!copyId || !archiveKey) {
    return NextResponse.json({ message: "The archived listing image is missing." }, { status: 400 });
  }
  const capability = await getEbayCapabilityForSession(session);
  if (!capability.canManageListingPhotoDrafts) {
    return NextResponse.json({ message: capability.mode === "preview"
      ? "Listing photos are unavailable in preview mode. Switch to live Records."
      : session
        ? "Administrator seller permission is required to view listing photos."
        : "Sign in to view a listing image." }, { status: session ? 403 : 401 });
  }
  if (!session) return NextResponse.json({ message: "Sign in to view a listing image." }, { status: 401 });

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
  let parsed: ReturnType<typeof parseEbayImagePostOperation>;
  try {
    const form = await request.formData();
    parsed = parseEbayImagePostOperation(form);
  } catch (error) {
    return NextResponse.json({ message: error instanceof EbayImageOperationError
      ? error.message
      : "Choose one valid listing-photo operation." }, { status: 400 });
  }
  const session = await getSessionFromHeaders(request.headers);
  const capability = await getEbayCapabilityForSession(session);
  const localInventoryStage = parsed.operation.kind === "stage-inventory" || parsed.operation.kind === "stage-listing-photo";
  if (localInventoryStage) {
    if (!capability.canManageListingPhotoDrafts) {
      return NextResponse.json({ message: capability.mode === "preview"
        ? "Listing photos are unavailable in preview mode. Switch to live Records."
        : session
          ? "Administrator seller permission is required to prepare listing photos."
          : "Sign in to prepare listing photos." }, { status: session ? 403 : 401 });
    }
  } else {
    if (!capability.ebay.allowed) {
      return NextResponse.json({
        message: `${capability.ebay.message} ${capability.ebay.remedy}`.trim(),
      }, { status: session ? 403 : 401 });
    }
  }
  if (!session) return NextResponse.json({ message: "Sign in to manage listing photos." }, { status: 401 });
  const { copyId, operation } = parsed;
  if (operation.kind === "upload-file") {
    if (!allowedImageTypes.has(operation.file.type)) {
      return NextResponse.json({ message: "Use a JPG, PNG, WEBP, AVIF, HEIC, GIF, BMP, or TIFF image." }, { status: 400 });
    }
    if (operation.file.size === 0 || operation.file.size > maximumImageBytes) {
      return NextResponse.json({ message: "Use an image smaller than 12 MB." }, { status: 400 });
    }
  }

  try {
    const result = await executeEbayImagePostOperation(parsed, session.user.id, {
      importCatalogue: archiveAndImportEbayImage,
      importInventory: archiveAndImportInventoryImage,
      stageInventory: archiveInventoryImageDraft,
      stageListingPhoto: archiveListingPhotoSetImageDraft,
      uploadArchived: uploadArchivedEbayImage,
      uploadFile: archiveAndUploadEbayImage,
    });
    return NextResponse.json({ ...result, previewUrl: previewUrl(copyId, result.archiveKey) });
  } catch (error) {
    if (error instanceof EbayAuthorizationError) {
      return NextResponse.json({ message: "Reconnect eBay before sending listing photos to eBay." }, { status: 401 });
    }
    const message = error instanceof EbayListingError
      ? error.message
      : localInventoryStage
        ? "The saved card photo could not be prepared."
        : "The image could not be uploaded to eBay. Try again shortly.";
    return NextResponse.json({ message }, { status: 502 });
  }
}

export async function DELETE(request: Request) {
  const session = await getSessionFromHeaders(request.headers);
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
  const capability = await getEbayCapabilityForSession(session);
  if (!capability.canManageListingPhotoDrafts) {
    return NextResponse.json({ message: capability.mode === "preview"
      ? "Listing photos cannot be removed in preview mode. Switch to live Records."
      : session
        ? "Administrator seller permission is required to remove listing photos."
        : "Sign in to remove a listing image." }, { status: session ? 403 : 401 });
  }
  if (!session) return NextResponse.json({ message: "Sign in to remove a listing image." }, { status: 401 });

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

export async function PATCH(request: Request) {
  const session = await getSessionFromHeaders(request.headers);
  const capability = await getEbayCapabilityForSession(session);
  if (!capability.canManageListingPhotoDrafts) {
    return NextResponse.json({ message: capability.mode === "preview"
      ? "Listing photos cannot be moved in preview mode. Switch to live Records."
      : session
        ? "Administrator seller permission is required to move listing photos."
        : "Sign in to move listing photos." }, { status: session ? 403 : 401 });
  }
  if (!session) return NextResponse.json({ message: "Sign in to move listing photos." }, { status: 401 });
  let fromCopyId = "";
  let toCopyId = "";
  let archiveKeys: string[] = [];
  try {
    const body = await request.json() as { archiveKeys?: unknown; fromCopyId?: unknown; toCopyId?: unknown };
    fromCopyId = typeof body.fromCopyId === "string" ? body.fromCopyId.trim() : "";
    toCopyId = typeof body.toCopyId === "string" ? body.toCopyId.trim() : "";
    archiveKeys = Array.isArray(body.archiveKeys) ? body.archiveKeys.filter((key): key is string => typeof key === "string" && Boolean(key.trim())) : [];
  } catch {
    return NextResponse.json({ message: "Choose the staged listing photos to move." }, { status: 400 });
  }
  if (!fromCopyId || !toCopyId || !archiveKeys.length || new Set(archiveKeys).size !== archiveKeys.length) {
    return NextResponse.json({ message: "Choose the staged listing photos to move." }, { status: 400 });
  }
  try {
    const photos = [];
    for (const archiveKey of archiveKeys) {
      const nextKey = await transferEbayListingImageDraft(session.user.id, fromCopyId, toCopyId, archiveKey);
      photos.push({ archiveKey: nextKey, previousArchiveKey: archiveKey, previewUrl: previewUrl(toCopyId, nextKey) });
    }
    return NextResponse.json({ photos });
  } catch (error) {
    return NextResponse.json({
      message: error instanceof EbayListingError
        ? error.message
        : "Listing photos could not be moved safely. Your original staged photos were kept.",
    }, { status: error instanceof EbayListingError ? 400 : 502 });
  }
}

import "server-only";

import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const maximumImageBytes = 12 * 1024 * 1024;

const imageExtensions: Record<string, string> = {
  "image/avif": "avif",
  "image/bmp": "bmp",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/tiff": "tiff",
  "image/webp": "webp",
};

type StoredImage = {
  bytes: Uint8Array;
  contentType: string;
};

let client: S3Client | null = null;

function configuration() {
  const region = process.env.AWS_REGION?.trim();
  const bucket = process.env.S3_BUCKET_NAME?.trim();
  if (!region || !bucket) {
    throw new Error("The S3 listing-photo archive is not configured.");
  }
  client ??= new S3Client({ region });
  return { bucket, client };
}

function draftPrefix(ownerId: string, copyId: string) {
  return `ebay-listing-drafts/${ownerId}/${copyId}`;
}

function archivePrefix(ownerId: string, copyId: string, listingId: string) {
  return `ebay-listings/${ownerId}/${copyId}/${listingId}`;
}

function assertDraftKey(ownerId: string, copyId: string, key: string) {
  if (!key.startsWith(`${draftPrefix(ownerId, copyId)}/`)) {
    throw new Error("That archived listing photo does not belong to this card copy.");
  }
}

function copySource(bucket: string, key: string) {
  return `${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

function contentType(value: string) {
  return value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

export function isListingImageArchiveConfigured() {
  return Boolean(process.env.AWS_REGION?.trim() && process.env.S3_BUCKET_NAME?.trim());
}

export async function storeListingImageDraft({
  bytes,
  contentType: rawContentType,
  copyId,
  ownerId,
}: {
  bytes: Uint8Array;
  contentType: string;
  copyId: string;
  ownerId: string;
}) {
  const normalizedContentType = contentType(rawContentType);
  const extension = imageExtensions[normalizedContentType];
  if (!extension) throw new Error("Use a supported image format.");
  if (!bytes.byteLength || bytes.byteLength > maximumImageBytes) {
    throw new Error("Use an image smaller than 12 MB.");
  }

  const { bucket, client: s3 } = configuration();
  const key = `${draftPrefix(ownerId, copyId)}/${crypto.randomUUID()}.${extension}`;
  await s3.send(new PutObjectCommand({
    Body: bytes,
    Bucket: bucket,
    CacheControl: "private, max-age=300",
    ContentType: normalizedContentType,
    Key: key,
    Metadata: {
      "copy-id": copyId,
      "owner-id": ownerId,
    },
    Tagging: "state=draft",
  }));
  return key;
}

export async function storeRemoteListingImageDraft({
  copyId,
  ownerId,
  sourceUrl,
}: {
  copyId: string;
  ownerId: string;
  sourceUrl: string;
}) {
  const parsed = new URL(sourceUrl);
  if (parsed.protocol !== "https:") throw new Error("Use an HTTPS catalogue image.");

  const response = await fetch(parsed, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; CollectionHub/1.0; listing-image-archive)",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`The catalogue image could not be downloaded (${response.status}).`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  return storeListingImageDraft({
    bytes,
    contentType: response.headers.get("content-type") ?? "",
    copyId,
    ownerId,
  });
}

export async function readListingImageDraft(ownerId: string, copyId: string, key: string): Promise<StoredImage> {
  assertDraftKey(ownerId, copyId, key);
  const { bucket, client: s3 } = configuration();
  const result = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!result.Body) throw new Error("The archived listing photo is unavailable.");
  return {
    bytes: await result.Body.transformToByteArray(),
    contentType: result.ContentType ?? "application/octet-stream",
  };
}

export async function deleteListingImageDraft(ownerId: string, copyId: string, key: string) {
  assertDraftKey(ownerId, copyId, key);
  const { bucket, client: s3 } = configuration();
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

export async function copyListingImageDraftsToArchive({
  copyId,
  draftKeys,
  listingId,
  ownerId,
}: {
  copyId: string;
  draftKeys: string[];
  listingId: string;
  ownerId: string;
}) {
  const { bucket, client: s3 } = configuration();
  const archivedKeys: string[] = [];
  try {
    for (const [index, draftKey] of draftKeys.entries()) {
      assertDraftKey(ownerId, copyId, draftKey);
      const fileName = draftKey.split("/").at(-1);
      if (!fileName) throw new Error("The archived listing photo has an invalid key.");
      const archivedKey = `${archivePrefix(ownerId, copyId, listingId)}/${String(index + 1).padStart(2, "0")}-${fileName}`;
      await s3.send(new CopyObjectCommand({
        Bucket: bucket,
        CopySource: copySource(bucket, draftKey),
        Key: archivedKey,
        Tagging: "state=archived",
        TaggingDirective: "REPLACE",
      }));
      archivedKeys.push(archivedKey);
    }
    return archivedKeys;
  } catch (error) {
    await deleteArchivedListingImages(archivedKeys);
    throw error;
  }
}

export async function deleteListingImageDrafts(ownerId: string, copyId: string, keys: string[]) {
  await Promise.allSettled(keys.map((key) => deleteListingImageDraft(ownerId, copyId, key)));
}

export async function deleteArchivedListingImages(keys: string[]) {
  if (!keys.length) return;
  const { bucket, client: s3 } = configuration();
  await Promise.allSettled(keys.map((key) => s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))));
}

export async function listArchivedListingImageKeys(ownerId: string, copyId: string, listingId: string) {
  const { bucket, client: s3 } = configuration();
  const prefix = `${archivePrefix(ownerId, copyId, listingId)}/`;
  const result = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }));
  return (result.Contents ?? [])
    .flatMap((item) => item.Key ? [item.Key] : [])
    .sort();
}

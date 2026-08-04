import "server-only";

import {
  DeleteObjectCommand,
  GetObjectCommand,
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

type StoredListingPhoto = {
  bytes: Uint8Array;
  contentType: string;
};

let client: S3Client | null = null;

function configuration() {
  const region = process.env.AWS_REGION?.trim();
  const bucket = process.env.S3_BUCKET_NAME?.trim();
  if (!region || !bucket) throw new Error("The private listing-photo archive is not configured.");
  client ??= new S3Client({ region });
  return { bucket, client };
}

function prefix(ownerId: string) {
  return `images/listing-photo-sets/${ownerId}`;
}

function assertKey(ownerId: string, key: string) {
  if (!key.startsWith(`${prefix(ownerId)}/`)) {
    throw new Error("That image does not belong to this listing-photo set.");
  }
}

function normalizeContentType(value: string) {
  return value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

export function isCardListingPhotoArchiveConfigured() {
  return Boolean(process.env.AWS_REGION?.trim() && process.env.S3_BUCKET_NAME?.trim());
}

export async function storeCardListingPhoto({
  bytes,
  contentType: rawContentType,
  ownerId,
}: {
  bytes: Uint8Array;
  contentType: string;
  ownerId: string;
}) {
  const contentType = normalizeContentType(rawContentType);
  const extension = imageExtensions[contentType];
  if (!extension) throw new Error("Use a JPG, PNG, WEBP, AVIF, HEIC, GIF, BMP, or TIFF image.");
  if (!bytes.byteLength || bytes.byteLength > maximumImageBytes) throw new Error("Use an image smaller than 12 MB.");

  const { bucket, client: s3 } = configuration();
  const key = `${prefix(ownerId)}/${crypto.randomUUID()}.${extension}`;
  await s3.send(new PutObjectCommand({
    Body: bytes,
    Bucket: bucket,
    CacheControl: "private, max-age=300",
    ContentType: contentType,
    Key: key,
    Metadata: { "owner-id": ownerId },
    Tagging: "state=listing-photo-set",
  }));
  return key;
}

export async function readCardListingPhoto(ownerId: string, key: string): Promise<StoredListingPhoto> {
  assertKey(ownerId, key);
  const { bucket, client: s3 } = configuration();
  const result = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!result.Body) throw new Error("The listing photo is unavailable.");
  return {
    bytes: await result.Body.transformToByteArray(),
    contentType: result.ContentType ?? "application/octet-stream",
  };
}

export async function deleteCardListingPhoto(ownerId: string, key: string) {
  assertKey(ownerId, key);
  const { bucket, client: s3 } = configuration();
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

import "server-only";

import {
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

type StoredInventoryImage = {
  bytes: Uint8Array;
  contentType: string;
};

let client: S3Client | null = null;

function configuration() {
  const region = process.env.AWS_REGION?.trim();
  const bucket = process.env.S3_BUCKET_NAME?.trim();
  if (!region || !bucket) throw new Error("The private card-image archive is not configured.");
  client ??= new S3Client({ region });
  return { bucket, client };
}

function prefix(ownerId: string, copyId: string) {
  return `images/inventory-cards/${ownerId}/${copyId}`;
}

function assertKey(ownerId: string, copyId: string, key: string) {
  if (!key.startsWith(`${prefix(ownerId, copyId)}/`)) {
    throw new Error("That image does not belong to this physical card Copy.");
  }
}

function normalizeContentType(value: string) {
  return value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

export function isCardInventoryImageArchiveConfigured() {
  return Boolean(process.env.AWS_REGION?.trim() && process.env.S3_BUCKET_NAME?.trim());
}

export async function storeCardInventoryImage({
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
  const contentType = normalizeContentType(rawContentType);
  const extension = imageExtensions[contentType];
  if (!extension) throw new Error("Use a JPG, PNG, WEBP, AVIF, HEIC, GIF, BMP, or TIFF image.");
  if (!bytes.byteLength || bytes.byteLength > maximumImageBytes) throw new Error("Use an image smaller than 12 MB.");

  const { bucket, client: s3 } = configuration();
  const key = `${prefix(ownerId, copyId)}/${crypto.randomUUID()}.${extension}`;
  await s3.send(new PutObjectCommand({
    Body: bytes,
    Bucket: bucket,
    CacheControl: "private, max-age=300",
    ContentType: contentType,
    Key: key,
    Metadata: { "copy-id": copyId, "owner-id": ownerId },
    Tagging: "state=inventory",
  }));
  return key;
}

export async function listCardInventoryImages(ownerId: string, copyId: string) {
  const { bucket, client: s3 } = configuration();
  const result = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: `${prefix(ownerId, copyId)}/` }));
  return (result.Contents ?? []).flatMap((item) => item.Key ? [item.Key] : []).sort();
}

export async function readCardInventoryImage(ownerId: string, copyId: string, key: string): Promise<StoredInventoryImage> {
  assertKey(ownerId, copyId, key);
  const { bucket, client: s3 } = configuration();
  const result = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!result.Body) throw new Error("The card image is unavailable.");
  return { bytes: await result.Body.transformToByteArray(), contentType: result.ContentType ?? "application/octet-stream" };
}

export async function deleteCardInventoryImage(ownerId: string, copyId: string, key: string) {
  assertKey(ownerId, copyId, key);
  const { bucket, client: s3 } = configuration();
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

/** Index legacy private S3 card photos without moving image bytes. Safe to rerun. */
import crypto from "node:crypto";
import fs from "node:fs";
import pg from "pg";
import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";

function env(name) {
  if (process.env[name]) return process.env[name];
  if (!fs.existsSync(".env.local")) return undefined;
  const line = fs.readFileSync(".env.local", "utf8").split(/\r?\n/).find((value) => value.startsWith(`${name}=`));
  return line?.slice(name.length + 1).trim().replace(/^['"]|['"]$/g, "");
}

const apply = process.argv.includes("--apply");
const connectionString = env("DATABASE_URL");
const region = env("AWS_REGION");
const bucket = env("S3_BUCKET_NAME");
if (!connectionString || !region || !bucket) throw new Error("DATABASE_URL, AWS_REGION, and S3_BUCKET_NAME are required.");
const client = new pg.Client({ connectionString });
const s3 = new S3Client({ region });
await client.connect();
try {
  const copies = (await client.query("select id, owner_id from card_copies order by created_at, id")).rows;
  let discovered = 0; let inserted = 0;
  for (const copy of copies) {
    const prefix = `images/inventory-cards/${copy.owner_id}/${copy.id}/`;
    const objects = (await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }))).Contents ?? [];
    const keys = objects.flatMap((object) => object.Key ? [object.Key] : []).sort();
    discovered += keys.length;
    for (const [position, objectKey] of keys.entries()) {
      const existing = await client.query("select id from card_copy_images where object_key = $1", [objectKey]);
      if (existing.rowCount) continue;
      if (apply) await client.query("insert into card_copy_images (id, owner_id, copy_id, object_key, position, created_at) values ($1,$2,$3,$4,$5,$6)", [crypto.randomUUID(), copy.owner_id, copy.id, objectKey, position, new Date()]);
      inserted += 1;
    }
  }
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", copies: copies.length, discovered, missingMetadata: inserted }, null, 2));
} finally { await client.end(); }

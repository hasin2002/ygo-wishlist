import crypto from "node:crypto";
import fs from "node:fs";
import pg from "pg";

function envValue(name) {
  if (process.env[name]) return process.env[name];
  const file = ".env.local";
  if (!fs.existsSync(file)) return undefined;
  const line = fs.readFileSync(file, "utf8").split(/\r?\n/)
    .find((entry) => entry.startsWith(`${name}=`));
  if (!line) return undefined;
  const value = line.slice(name.length + 1).trim();
  return ((value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'")))
    ? value.slice(1, -1)
    : value;
}

function normalize(value) {
  return String(value ?? "").trim().toLocaleLowerCase("en-GB").replace(/\s+/g, " ");
}

function stableId(prefix, value) {
  return `${prefix}-${crypto.createHash("sha1").update(value).digest("hex").slice(0, 24)}`;
}

function canonicalProductUrl(value) {
  try {
    const url = new URL(value);
    return `${url.hostname.replace(/^www\./, "").toLowerCase()}${url.pathname.replace(/\/$/, "")}`;
  } catch {
    return null;
  }
}

function imageUrl(productId) {
  return productId ? `https://tcgplayer-cdn.tcgplayer.com/product/${productId}_in_1000x1000.jpg` : null;
}

function editionFromSource(row) {
  const source = `${row.productUrl ?? ""} ${row.productName ?? ""}`.toLowerCase();
  if (/(?:^|[-\s(])limited[-\s]edition(?:[-\s)?]|$)/i.test(source)) return "Limited Edition";
  if (/(?:^|[-\s(])unlimited[-\s]edition(?:[-\s)?]|$)/i.test(source)) return "Unlimited Edition";
  if (/(?:^|[-\s(])1st[-\s]edition(?:[-\s)?]|$)/i.test(source)) return "1st Edition";
  return "1st Edition";
}

function cardName(row) {
  const productName = String(row.productName ?? "").trim();
  const rarity = String(row.rarity ?? "").trim();
  if (!rarity) return productName || `Product ${row.productId}`;
  const suffix = new RegExp(`\\s*\\(${rarity.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\)\\s*$`, "i");
  return productName.replace(suffix, "").replace(suffix, "").trim() || productName;
}

function metadataNeedsAttention(row) {
  return !row.setName || !row.setCode || !row.rarity || !row.productUrl;
}

const databaseUrl = envValue("DATABASE_URL");
if (!databaseUrl) throw new Error("DATABASE_URL is required.");
const jsonPath = process.argv[2] || "yugioh-combined-card-data.json";
const rows = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
if (!Array.isArray(rows) || rows.length === 0) throw new Error("The combined card JSON must contain at least one row.");

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  const ownerId = process.env.OWNER_ID
    || (await client.query("select id from users order by created_at asc limit 1")).rows[0]?.id;
  if (!ownerId) throw new Error("No user exists to receive the Wishlist entries.");

  const before = (await client.query("select count(*)::int as count from card_targets where owner_id = $1", [ownerId])).rows[0].count;
  const counts = { targets: 0, printings: 0, skipped: 0 };
  const targetIds = new Map();
  await client.query("begin");
  try {
    for (const row of rows) {
      const name = cardName(row);
      const rarity = String(row.rarity ?? "Unknown rarity").trim() || "Unknown rarity";
      const edition = editionFromSource(row);
      const normalizedName = normalize(name);
      const normalizedRarity = normalize(rarity);
      const normalizedEdition = normalize(edition);
      const targetId = stableId("json-target", `${ownerId}|${normalizedName}|${normalizedRarity}|${normalizedEdition}`);
      const now = new Date();
      const targetResult = await client.query({
        text: `insert into card_targets (
          id, owner_id, name, normalized_name, rarity, normalized_rarity, edition,
          normalized_edition, desired_quantity, image_url, tcgplayer_url,
          notes, created_at, updated_at
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,1,$9,$10,$11,$12,$12)
        on conflict (owner_id, normalized_name, normalized_rarity, normalized_edition)
        do update set image_url = coalesce(card_targets.image_url, excluded.image_url),
          tcgplayer_url = coalesce(card_targets.tcgplayer_url, excluded.tcgplayer_url),
          updated_at = excluded.updated_at
        returning id`,
        values: [
          targetId, ownerId, name, normalizedName, rarity, normalizedRarity, edition,
          normalizedEdition, imageUrl(row.productId), row.productUrl || null,
          row.releaseDate ? `TCGplayer release date: ${row.releaseDate}` : "", now,
        ],
      });
      const persistedTargetId = targetResult.rows[0].id;
      targetIds.set(`${row.index}`, persistedTargetId);
      if (targetResult.rowCount === 1) counts.targets += 1;

      const canonicalUrl = canonicalProductUrl(row.productUrl);
      const printingId = stableId("json-printing", `${ownerId}|${persistedTargetId}|${canonicalUrl || row.index}`);
      const printingResult = await client.query({
        text: `insert into card_printings (
          id, owner_id, target_id, set_name, normalized_set_name, set_code,
          normalized_set_code, tcgplayer_url, canonical_tcgplayer_url, image_url,
          metadata_needs_attention, created_at, updated_at
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)
        on conflict (id) do update set set_name = excluded.set_name,
          normalized_set_name = excluded.normalized_set_name, set_code = excluded.set_code,
          normalized_set_code = excluded.normalized_set_code, tcgplayer_url = excluded.tcgplayer_url,
          canonical_tcgplayer_url = excluded.canonical_tcgplayer_url, image_url = excluded.image_url,
          metadata_needs_attention = excluded.metadata_needs_attention, updated_at = excluded.updated_at`,
        values: [
          printingId, ownerId, persistedTargetId, row.setName || "Unknown set", normalize(row.setName || "Unknown set"),
          row.setCode || "Unknown code", normalize(row.setCode || "Unknown code"), row.productUrl || null,
          canonicalUrl, imageUrl(row.productId), metadataNeedsAttention(row), now,
        ],
      });
      if (printingResult.rowCount === 1) counts.printings += 1;
      if (!row.productUrl || !row.setName || !row.setCode || !row.rarity) counts.skipped += 1;
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }

  const after = (await client.query("select count(*)::int as count from card_targets where owner_id = $1", [ownerId])).rows[0].count;
  const printingCount = (await client.query("select count(*)::int as count from card_printings where owner_id = $1", [ownerId])).rows[0].count;
  console.log(JSON.stringify({ mode: "applied", ownerId, sourceRows: rows.length, beforeTargets: before, afterTargets: after, afterPrintings: printingCount, ...counts, editionDefault: "1st Edition", editionOverrides: rows.filter((row) => editionFromSource(row) !== "1st Edition").map((row) => ({ index: row.index, edition: editionFromSource(row) })) }, null, 2));
} finally {
  await client.end();
}

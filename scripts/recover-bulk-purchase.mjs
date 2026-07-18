import crypto from "node:crypto";
import fs from "node:fs";
import pg from "pg";

function envValue(name) {
  if (process.env[name]) return process.env[name];
  if (!fs.existsSync(".env.local")) return undefined;
  const line = fs.readFileSync(".env.local", "utf8").split(/\r?\n/)
    .find((entry) => entry.startsWith(`${name}=`));
  if (!line) return undefined;
  const value = line.slice(name.length + 1).trim();
  return ((value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'")))
    ? value.slice(1, -1)
    : value;
}

function id(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function normalize(value) {
  return String(value ?? "").trim().toLocaleLowerCase("en-GB").replace(/\s+/g, " ");
}

function canonicalProductUrl(value) {
  const url = new URL(value);
  return `${url.hostname.replace(/^www\./, "").toLowerCase()}${url.pathname.replace(/\/$/, "")}`;
}

function allocatePenceAt(totalPence, totalQuantity, index) {
  const base = Math.floor(totalPence / totalQuantity);
  return base + (index < totalPence % totalQuantity ? 1 : 0);
}

function loadDraft(path) {
  const raw = JSON.parse(fs.readFileSync(path, "utf8"));
  const draft = Array.isArray(raw)
    ? raw[0]?.json
    : raw?.["0"]?.json ?? raw?.json ?? raw;
  if (!draft || draft.kind !== "bulk" || !Array.isArray(draft.cards)) {
    throw new Error("The saved draft must contain one Bulk Purchase with cards.");
  }
  if (!draft.recordName || !/^\d{4}-\d{2}-\d{2}$/.test(draft.date)
    || !Number.isInteger(draft.totalPence) || !Number.isInteger(draft.totalCardCount)) {
    throw new Error("The saved draft has invalid purchase details.");
  }
  const identified = draft.cards.reduce((sum, card) => sum + card.quantity, 0);
  if (identified !== draft.totalCardCount) {
    throw new Error(`Expected ${draft.totalCardCount} physical cards but found ${identified} in the saved draft.`);
  }
  for (const card of draft.cards) {
    if (!card.name || !card.rarity || !card.edition || !card.setName || !card.setCode
      || !card.tcgplayerUrl || !Number.isInteger(card.quantity) || card.quantity < 1) {
      throw new Error(`Card ${card.name || "(unnamed)"} is incomplete.`);
    }
  }
  return draft;
}

const databaseUrl = envValue("DATABASE_URL");
if (!databaseUrl) throw new Error("DATABASE_URL is required.");
const jsonPath = process.argv.find((arg) => arg.endsWith(".json")) ?? "bulk.json";
const apply = process.argv.includes("--apply");
const draft = loadDraft(jsonPath);
const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

try {
  const ownerId = process.env.OWNER_ID
    || (await client.query("select id from users order by created_at asc limit 1")).rows[0]?.id;
  if (!ownerId) throw new Error("No user exists to receive the recovered purchase.");

  const duplicate = await client.query(
    `select id from record_entries where owner_id = $1 and title = $2 and occurred_on = $3 and listing_url = $4 limit 1`,
    [ownerId, draft.recordName, draft.date, draft.listingUrl],
  );
  if (duplicate.rowCount) {
    const recordId = duplicate.rows[0].id;
    // A pg Client executes one query at a time. Keep this sequential so the
    // recovery check remains compatible with pg@9 as well as current versions.
    const record = await client.query(`select amount_pence, type, status from record_entries where id = $1`, [recordId]);
    const lines = await client.query(`select count(*)::int as lines, coalesce(sum(quantity), 0)::int as physical_cards
      from record_lines where record_id = $1 and kind = 'card'`, [recordId]);
    const copies = await client.query(`select count(*)::int as copies from card_copies where acquired_record_id = $1`, [recordId]);
    const lot = await client.query(`select total_quantity, itemized_quantity, status from bulk_lots where acquired_record_id = $1`, [recordId]);
    const existing = {
      mode: "existing-record",
      recordId,
      amountPence: record.rows[0]?.amount_pence,
      type: record.rows[0]?.type,
      status: record.rows[0]?.status,
      cardLines: lines.rows[0]?.lines,
      lineQuantity: lines.rows[0]?.physical_cards,
      copies: copies.rows[0]?.copies,
      bulkLot: lot.rows[0] ?? null,
    };
    if (apply) throw new Error(`A matching recovery record already exists: ${JSON.stringify(existing)}. No changes made.`);
    console.log(JSON.stringify(existing, null, 2));
    process.exit(0);
  }

  const summary = {
    mode: apply ? "apply" : "dry-run",
    recordName: draft.recordName,
    date: draft.date,
    source: draft.source,
    totalPence: draft.totalPence,
    totalCardCount: draft.totalCardCount,
    distinctCardEntries: draft.cards.length,
    ownerId,
  };
  if (!apply) {
    console.log(JSON.stringify(summary, null, 2));
    process.exit(0);
  }

  const now = new Date();
  const recordId = id("record");
  const lotId = id("bulk");
  const lotLineId = id("line");
  const lotName = `Bulk lot · ${draft.cards.length} card ${draft.cards.length === 1 ? "type" : "types"}`;
  let createdTargets = 0;
  let createdPrintings = 0;
  let copied = 0;
  await client.query("begin");
  try {
    await client.query(
      `insert into record_entries (
        id, owner_id, type, status, occurred_on, title, title_generated, source,
        listing_url, amount_pence, amount_known, notes, revision, created_at, updated_at
      ) values ($1,$2,'purchase','active',$3,$4,false,$5,$6,$7,true,$8,1,$9,$9)`,
      [recordId, ownerId, draft.date, draft.recordName, draft.source, draft.listingUrl,
        draft.totalPence, draft.notes ?? "", now],
    );
    await client.query(
      `insert into record_lines (
        id, owner_id, record_id, position, kind, name, quantity, allocation_pence, detail, created_at, updated_at
      ) values ($1,$2,$3,0,'bulk',$4,1,null,$5,$6,$6)`,
      [lotLineId, ownerId, recordId, lotName, `${draft.totalCardCount} identified of ${draft.totalCardCount} total cards`, now],
    );
    await client.query(
      `insert into bulk_lots (
        id, owner_id, acquired_record_id, acquired_line_id, name, total_quantity, itemized_quantity, status, created_at, updated_at
      ) values ($1,$2,$3,$4,$5,$6,$6,'itemized',$7,$7)`,
      [lotId, ownerId, recordId, lotLineId, lotName, draft.totalCardCount, now],
    );

    let allocationIndex = 0;
    for (const [position, card] of draft.cards.entries()) {
      const normalizedName = normalize(card.name);
      const normalizedRarity = normalize(card.rarity);
      const normalizedEdition = normalize(card.edition);
      let targetResult = await client.query(
        `select id, image_url, tcgplayer_url from card_targets
         where owner_id=$1 and normalized_name=$2 and normalized_rarity=$3 and normalized_edition=$4 limit 1`,
        [ownerId, normalizedName, normalizedRarity, normalizedEdition],
      );
      let target = targetResult.rows[0];
      if (!target) {
        const inserted = await client.query(
          `insert into card_targets (
            id, owner_id, name, normalized_name, rarity, normalized_rarity, edition, normalized_edition,
            desired_quantity, image_url, tcgplayer_url, notes, created_at, updated_at
          ) values ($1,$2,$3,$4,$5,$6,$7,$8,1,$9,$10,'',$11,$11) returning id, image_url, tcgplayer_url`,
          [id("target"), ownerId, card.name, normalizedName, card.rarity, normalizedRarity,
            card.edition, normalizedEdition, card.imageUrl ?? null, card.tcgplayerUrl, now],
        );
        target = inserted.rows[0];
        createdTargets += 1;
      } else if (!target.image_url || !target.tcgplayer_url) {
        await client.query(
          `update card_targets set image_url=coalesce(image_url,$1), tcgplayer_url=coalesce(tcgplayer_url,$2), updated_at=$3 where id=$4`,
          [card.imageUrl ?? null, card.tcgplayerUrl, now, target.id],
        );
      }

      const canonicalUrl = canonicalProductUrl(card.tcgplayerUrl);
      let printingResult = await client.query(
        `select id from card_printings where owner_id=$1 and target_id=$2 and canonical_tcgplayer_url=$3 limit 1`,
        [ownerId, target.id, canonicalUrl],
      );
      let printing = printingResult.rows[0];
      if (!printing) {
        const inserted = await client.query(
          `insert into card_printings (
            id, owner_id, target_id, set_name, normalized_set_name, set_code, normalized_set_code,
            tcgplayer_url, canonical_tcgplayer_url, image_url, metadata_needs_attention, created_at, updated_at
          ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12) returning id`,
          [id("printing"), ownerId, target.id, card.setName, normalize(card.setName), card.setCode,
            normalize(card.setCode), card.tcgplayerUrl, canonicalUrl, card.imageUrl ?? null,
            Boolean(card.metadataNeedsAttention), now],
        );
        printing = inserted.rows[0];
        createdPrintings += 1;
      }

      const allocations = Array.from({ length: card.quantity }, (_, offset) =>
        allocatePenceAt(draft.totalPence, draft.totalCardCount, allocationIndex + offset),
      );
      const lineId = id("line");
      await client.query(
        `insert into record_lines (
          id, owner_id, record_id, position, kind, name, quantity, allocation_pence, detail, created_at, updated_at
        ) values ($1,$2,$3,$4,'card',$5,$6,$7,$8,$9,$9)`,
        [lineId, ownerId, recordId, position + 1, card.name, card.quantity,
          allocations.reduce((sum, value) => sum + value, 0),
          `${card.setCode} · ${card.edition} · from ${lotName}`, now],
      );
      for (const [offset, allocationPence] of allocations.entries()) {
        await client.query(
          `insert into card_copies (
            id, owner_id, printing_id, acquired_record_id, acquired_line_id, bulk_lot_id,
            allocation_index, allocation_pence, status, condition, created_at, updated_at
          ) values ($1,$2,$3,$4,$5,$6,$7,$8,'available','Near Mint',$9,$9)`,
          [id("copy"), ownerId, printing.id, recordId, lineId, lotId,
            allocationIndex + offset, allocationPence, now],
        );
        copied += 1;
      }
      allocationIndex += card.quantity;
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }

  console.log(JSON.stringify({ ...summary, recordId, lotId, createdTargets, createdPrintings, copies: copied }, null, 2));
} finally {
  await client.end();
}

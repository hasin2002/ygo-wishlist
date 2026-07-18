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

function normalize(value) {
  return String(value ?? "").trim().toLocaleLowerCase("en-GB").replace(/\s+/g, " ");
}

function pricePence(value) {
  const match = String(value ?? "").match(/\d+(?:[,.]\d{1,2})?/);
  if (!match) return null;
  const amount = Number(match[0].replace(",", ""));
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) : null;
}

function canonicalProductUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return `${url.hostname.replace(/^www\./, "").toLowerCase()}${url.pathname.replace(/\/$/, "")}`;
  } catch {
    return null;
  }
}

function stableId(prefix, value) {
  return `${prefix}-${crypto.createHash("sha1").update(value).digest("hex").slice(0, 24)}`;
}

function hasSafeTimestamp(value) {
  const parsed = value instanceof Date ? value : new Date(value);
  const year = parsed.getUTCFullYear();
  return !Number.isNaN(parsed.getTime()) && year >= 1 && year <= 9999;
}

function safeTimestamp(value, fallback = new Date()) {
  return hasSafeTimestamp(value)
    ? (value instanceof Date ? value : new Date(value))
    : fallback;
}

function safeNullableTimestamp(value) {
  return value ? safeTimestamp(value) : null;
}

function occurredOn(card) {
  const month = String(card.purchase_month ?? "");
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return `${month}-01`;
  return safeTimestamp(card.created_at).toISOString().slice(0, 10);
}

function groupLegacyCards(cards) {
  const groups = new Map();
  for (const card of cards.filter((item) => item.owner_id)) {
    const rarity = card.rarity?.trim() || "Unknown rarity";
    const key = [card.owner_id, normalize(card.name), normalize(rarity), "unknown edition"].join("|");
    groups.set(key, [...(groups.get(key) ?? []), card]);
  }
  return groups;
}

function migrationReport(cards, binderSlots, wheelEntries, favourites) {
  const groups = groupLegacyCards(cards);
  const linkByLegacyId = new Map();
  for (const [key, rows] of groups) {
    for (const row of rows) linkByLegacyId.set(row.id, key);
  }
  const binderTargets = new Map();
  const binderPositions = new Set();
  const migratedBinderTargets = new Set();
  let projectedBinderSlots = 0;
  for (const slot of binderSlots) {
    const key = linkByLegacyId.get(slot.card_id);
    if (!key || !slot.owner_id) continue;
    const targetKey = `${slot.owner_id}|${key}`;
    const positionKey = `${slot.owner_id}|${slot.page_index}|${slot.slot_index}`;
    binderTargets.set(targetKey, (binderTargets.get(targetKey) ?? 0) + 1);
    if (migratedBinderTargets.has(targetKey) || binderPositions.has(positionKey)) continue;
    migratedBinderTargets.add(targetKey);
    binderPositions.add(positionKey);
    projectedBinderSlots += 1;
  }
  const wheelTargetCounts = new Map();
  for (const entry of wheelEntries) {
    const key = linkByLegacyId.get(entry.card_id);
    if (!key || !entry.owner_id) continue;
    const targetKey = `${entry.owner_id}|${key}`;
    wheelTargetCounts.set(targetKey, (wheelTargetCounts.get(targetKey) ?? 0) + 1);
  }
  const projectedWheelEntries = wheelTargetCounts.size;
  const projectedFavouriteKeys = new Set(favourites.flatMap((favourite) => {
    const key = linkByLegacyId.get(favourite.card_id);
    return key && favourite.owner_id ? [`${favourite.owner_id}|${favourite.month}`] : [];
  }));
  const mergedGroups = [...groups.values()].filter((rows) => rows.length > 1).map((rows) => ({
    ownerId: rows[0].owner_id,
    name: rows[0].name,
    rarity: rows[0].rarity?.trim() || "Unknown rarity",
    legacyIds: rows.map((row) => row.id),
    states: rows.map((row) => row.status),
    desiredQuantity: rows.length,
  }));
  return {
    mode: "dry-run",
    legacy: {
      rows: cards.length,
      ownerlessRowsSkipped: cards.filter((card) => !card.owner_id).length,
      owners: new Set(cards.flatMap((card) => card.owner_id ? [card.owner_id] : [])).size,
      wishlistRows: cards.filter((card) => card.status === "wishlist").length,
      ownedRows: cards.filter((card) => card.status === "owned").length,
      paidAmountsKnown: cards.filter((card) => card.status === "owned" && pricePence(card.paid_price_text) !== null).length,
      paidAmountsUnknown: cards.filter((card) => card.status === "owned" && pricePence(card.paid_price_text) === null).length,
      missingTcgplayerLinks: cards.filter((card) => !/tcgplayer\.com\/product\/\d+/i.test(card.url ?? "")).length,
      missingRarity: cards.filter((card) => !card.rarity?.trim()).length,
      invalidLegacyTimestamps: cards.filter((card) => !hasSafeTimestamp(card.created_at)).length,
    },
    projected: {
      targets: groups.size,
      mergedTargetGroups: mergedGroups.length,
      mergedGroups,
      importedAcquisitionRecords: cards.filter((card) => card.owner_id && card.status === "owned").length,
      physicalCopies: cards.filter((card) => card.owner_id && card.status === "owned").length,
      binderSlots: projectedBinderSlots,
      binderTargetCollisions: [...binderTargets.values()].filter((count) => count > 1).length,
      wheelEntries: projectedWheelEntries,
      wheelTargetCollisions: [...wheelTargetCounts.values()].filter((count) => count > 1).length,
      monthlyFavourites: projectedFavouriteKeys.size,
      skippedOwnerlessBinderSlots: binderSlots.filter((slot) => !slot.owner_id).length,
      skippedOwnerlessWheelEntries: wheelEntries.filter((entry) => !entry.owner_id).length,
      skippedOwnerlessFavourites: favourites.filter((favourite) => !favourite.owner_id).length,
    },
    rules: {
      legacyEdition: "Unknown edition",
      mergedDesiredQuantity: "number of legacy rows in the normalized target group",
      ownedRow: "one Imported Acquisition and one physical Copy",
      wishlistRow: "Target intent only; no fictional Record Entry",
      paidPrice: "parsed as integer pence; missing values stay unknown rather than £0",
      binderCollision: "the most recently updated legacy slot wins per merged Target",
    },
  };
}

async function loadLegacy(client) {
  // A pg Client executes one query at a time; sequential reads avoid the pg@9
  // deprecation warning without changing the report or database state.
  const cards = await client.query("select * from cards order by owner_id, id");
  const binderSlots = await client.query("select * from binder_slots order by updated_at desc, id");
  const wheelEntries = await client.query("select * from wheel_entries order by sort_order, id");
  const favourites = await client.query("select * from monthly_favorites order by month, id");
  return {
    cards: cards.rows,
    binderSlots: binderSlots.rows,
    wheelEntries: wheelEntries.rows,
    favourites: favourites.rows,
  };
}

async function applyMigration(client, legacy) {
  const groups = groupLegacyCards(legacy.cards);
  const targetByLegacyCardId = new Map();
  await client.query("begin");
  try {
    for (const [groupKey, rows] of groups) {
      const first = rows[0];
      const rarity = first.rarity?.trim() || "Unknown rarity";
      const normalizedName = normalize(first.name);
      const normalizedRarity = normalize(rarity);
      const targetId = stableId("legacy-target", groupKey);
      const desiredQuantity = rows.length;
      const imageUrl = rows.find((row) => row.image_url)?.image_url ?? null;
      const tcgplayerUrl = rows.find((row) => /tcgplayer\.com\/product\/\d+/i.test(row.url ?? ""))?.url ?? null;
      const marketPricePence = rows.map((row) => pricePence(row.market_price_text)).find((value) => value !== null) ?? null;
      const estimatedPricePence = rows.map((row) => pricePence(row.price_text)).find((value) => value !== null) ?? null;
      const notes = [...new Set(rows.map((row) => row.notes?.trim()).filter(Boolean))].join("\n\n");
      const chaseLevel = rows.reduce((highest, row) => Math.max(highest, row.chase_level ?? 0), 0) || null;
      const result = await client.query({
        text: `insert into card_targets (
          id, owner_id, name, normalized_name, rarity, normalized_rarity, edition,
          normalized_edition, desired_quantity, image_url, tcgplayer_url,
          estimated_price_pence, market_price_pence, ebay_search_url, ebay_listing_url,
          card_type, notes, chase_level, created_at, updated_at
        ) values ($1,$2,$3,$4,$5,$6,'Unknown edition','unknown edition',$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
        on conflict (owner_id, normalized_name, normalized_rarity, normalized_edition)
        do update set desired_quantity = greatest(card_targets.desired_quantity, excluded.desired_quantity)
        returning id`,
        values: [
          targetId, first.owner_id, first.name, normalizedName, rarity, normalizedRarity,
          desiredQuantity, imageUrl, tcgplayerUrl, estimatedPricePence, marketPricePence,
          rows.find((row) => row.ebay_search_url)?.ebay_search_url ?? null,
          rows.find((row) => row.ebay_listing_url)?.ebay_listing_url ?? null,
          rows.find((row) => row.card_type)?.card_type ?? null,
          notes, chaseLevel, safeTimestamp(first.created_at), new Date(),
        ],
      });
      const persistedTargetId = result.rows[0].id;
      const printingByCanonicalUrl = new Map();
      for (const card of rows) {
        targetByLegacyCardId.set(card.id, persistedTargetId);
        await client.query({
          text: `insert into legacy_card_target_links (legacy_card_id, owner_id, target_id, created_at)
            values ($1,$2,$3,$4) on conflict (legacy_card_id) do nothing`,
          values: [card.id, card.owner_id, persistedTargetId, new Date()],
        });
        const canonicalUrl = canonicalProductUrl(card.url);
        const printingKey = canonicalUrl ?? "unknown";
        let printingId = printingByCanonicalUrl.get(printingKey);
        if (!printingId) {
          printingId = stableId("legacy-printing", `${groupKey}|${printingKey}`);
          await client.query({
            text: `insert into card_printings (
              id, owner_id, target_id, set_name, normalized_set_name, set_code,
              normalized_set_code, tcgplayer_url, canonical_tcgplayer_url, image_url,
              metadata_needs_attention, created_at, updated_at
            ) values ($1,$2,$3,'Unknown set','unknown set','Unknown code','unknown code',$4,$5,$6,true,$7,$8)
            on conflict (id) do nothing`,
            values: [printingId, card.owner_id, persistedTargetId, card.url, canonicalUrl, card.image_url, safeTimestamp(card.created_at), new Date()],
          });
          printingByCanonicalUrl.set(printingKey, printingId);
        }
        if (card.status !== "owned") continue;
        const recordId = `legacy-import-${card.id}`;
        const lineId = `legacy-line-${card.id}`;
        const copyId = `legacy-copy-${card.id}`;
        const amountPence = pricePence(card.paid_price_text);
        const monthNote = /^\d{4}-(0[1-9]|1[0-2])$/.test(card.purchase_month ?? "")
          ? `Legacy purchase month ${card.purchase_month}; exact day was not recorded.`
          : !hasSafeTimestamp(card.created_at)
            ? "Legacy timestamp was outside the supported range; imported with today's date."
          : "Legacy acquisition date is approximate.";
        await client.query({
          text: `insert into record_entries (
            id, owner_id, type, status, occurred_on, title, title_generated, source,
            listing_url, amount_pence, amount_known, notes, revision, created_at, updated_at
          ) values ($1,$2,'imported-acquisition','active',$3,$4,true,'Legacy Library',$5,$6,$7,$8,1,$9,$10)
          on conflict (id) do nothing`,
          values: [
            recordId, card.owner_id, occurredOn(card), `Imported ${card.name}`.slice(0, 80),
            card.ebay_listing_url, amountPence ?? 0, amountPence !== null,
            [monthNote, card.notes].filter(Boolean).join("\n\n"), safeTimestamp(card.created_at), new Date(),
          ],
        });
        await client.query({
          text: `insert into record_lines (
            id, owner_id, record_id, position, kind, name, quantity, allocation_pence,
            detail, created_at, updated_at
          ) values ($1,$2,$3,0,'card',$4,1,$5,$6,$7,$8) on conflict (id) do nothing`,
          values: [
            lineId, card.owner_id, recordId, card.name, amountPence,
            `Unknown code · Unknown edition · ${rarity} · imported`, safeTimestamp(card.created_at), new Date(),
          ],
        });
        await client.query({
          text: `insert into card_copies (
            id, owner_id, printing_id, acquired_record_id, acquired_line_id,
            allocation_pence, status, condition, created_at, updated_at
          ) values ($1,$2,$3,$4,$5,$6,'available','Unknown',$7,$8) on conflict (id) do nothing`,
          values: [copyId, card.owner_id, printingId, recordId, lineId, amountPence, safeTimestamp(card.created_at), new Date()],
        });
      }
    }

    for (const slot of legacy.binderSlots) {
      const targetId = targetByLegacyCardId.get(slot.card_id);
      if (!targetId || !slot.owner_id) continue;
      await client.query({
        text: `insert into target_binder_slots (owner_id, page_index, slot_index, target_id, updated_at)
          values ($1,$2,$3,$4,$5) on conflict do nothing`,
        values: [slot.owner_id, slot.page_index, slot.slot_index, targetId, safeTimestamp(slot.updated_at)],
      });
    }
    for (const entry of legacy.wheelEntries) {
      const targetId = targetByLegacyCardId.get(entry.card_id);
      if (!targetId || !entry.owner_id) continue;
      await client.query({
        text: `insert into target_wheel_entries (
          owner_id, target_id, sort_order, selected_at, selected_order, created_at, updated_at
        ) values ($1,$2,$3,$4,$5,$6,$7) on conflict do nothing`,
        values: [
          entry.owner_id, targetId, entry.sort_order, safeNullableTimestamp(entry.selected_at),
          entry.selected_order, safeTimestamp(entry.created_at), safeTimestamp(entry.updated_at),
        ],
      });
    }
    for (const favourite of legacy.favourites) {
      const targetId = targetByLegacyCardId.get(favourite.card_id);
      if (!targetId || !favourite.owner_id) continue;
      await client.query({
        text: `insert into target_monthly_favorites (
          owner_id, month, target_id, created_at, updated_at
        ) values ($1,$2,$3,$4,$5) on conflict do nothing`,
        values: [
          favourite.owner_id, favourite.month, targetId,
          safeTimestamp(favourite.created_at), safeTimestamp(favourite.updated_at),
        ],
      });
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

const databaseUrl = envValue("DATABASE_URL");
if (!databaseUrl) throw new Error("DATABASE_URL is required.");
const apply = process.argv.includes("--apply");
const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  const legacy = await loadLegacy(client);
  const report = migrationReport(legacy.cards, legacy.binderSlots, legacy.wheelEntries, legacy.favourites);
  if (!apply) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    await applyMigration(client, legacy);
    process.stdout.write(`${JSON.stringify({ ...report, mode: "applied", appliedAt: new Date().toISOString() }, null, 2)}\n`);
  }
} finally {
  await client.end();
}

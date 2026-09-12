import pg from "pg";
import { setTimeout as delay } from "node:timers/promises";
import { normalizeCatalogueProduct } from "../src/lib/card-catalogue.ts";

// Run manually or daily on the development/deployment host. No user search calls TCGCSV.
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required; load .env.local using --env-file-if-exists.");
const client = new pg.Client({connectionString, connectionTimeoutMillis: 8000, statement_timeout: 120000});
let locked = false;
let lastRequestAt = 0;
async function request(path, json = true) {
  await delay(Math.max(0, 150 - (Date.now() - lastRequestAt)));
  lastRequestAt = Date.now();
  const response = await fetch(`https://tcgcsv.com/${path}`, {headers: {"User-Agent": "YgoWishlist/0.1.0 (catalogue-sync)"}, signal: AbortSignal.timeout(25000)});
  if (!response.ok) throw new Error(`TCGCSV returned ${response.status}; rerun to resume completed groups.`);
  if (!json) return (await response.text()).trim();
  const body = await response.json();
  if (body.success !== true || !Array.isArray(body.results)) throw new Error("TCGCSV response format was not valid; existing catalogue retained.");
  return body.results;
}

try {
  await client.connect();
  locked = (await client.query("select pg_try_advisory_lock(742910, 2) as locked")).rows[0].locked;
  if (!locked) throw new Error("A catalogue sync is already running.");
  await client.query("insert into card_catalogue_sync (id) values ('yugioh') on conflict do nothing");
  let state = (await client.query("select * from card_catalogue_sync where id = 'yugioh'")).rows[0];
  let stamp = state.pending_timestamp;
  let groups = state.pending_groups;
  if (!stamp || !Array.isArray(groups)) {
    if (state.last_attempt_at && Date.now() - new Date(state.last_attempt_at).getTime() < 86400_000) {
      console.log("Catalogue already checked within 24 hours; no remote requests made.");
      process.exitCode = 0;
    } else {
      stamp = await request("last-updated.txt", false);
      if (!Number.isFinite(Date.parse(stamp))) throw new Error("Invalid TCGCSV build timestamp.");
      if (state.source_timestamp && Date.parse(stamp) <= Date.parse(state.source_timestamp)) {
        await client.query("update card_catalogue_sync set last_attempt_at = now() where id = 'yugioh'");
        console.log("The latest TCGCSV build is already imported.");
        stamp = null;
      } else {
        groups = await request("tcgplayer/2/groups");
        if (!groups.length || groups.some((g) => !Number.isSafeInteger(g.groupId) || typeof g.name !== "string" || g.categoryId !== 2)) throw new Error("TCGCSV groups were not valid.");
        await client.query("begin");
        await client.query("delete from card_catalogue_staging");
        await client.query("update card_catalogue_sync set pending_timestamp=$1, pending_groups=$2, last_attempt_at=now(), syncing=true where id='yugioh'", [stamp, JSON.stringify(groups)]);
        await client.query("commit");
      }
    }
  }
  if (stamp && Array.isArray(groups)) {
    await client.query("update card_catalogue_sync set syncing=true where id='yugioh'");
    const completed = new Set((await client.query("select group_id from card_catalogue_staging where source_timestamp=$1", [stamp])).rows.map((r) => r.group_id));
    console.log(`Syncing ${groups.length} groups; ${completed.size} already staged.`);
    let importedGroups = completed.size;
    for (const group of groups) {
      if (completed.has(group.groupId)) continue;
      const raw = await request(`tcgplayer/2/${group.groupId}/products`);
      const normalized = raw.map((product) => normalizeCatalogueProduct(product, group)).filter(Boolean);
      // A product explicitly marked as a single must never be silently dropped by validation.
      const declaredSingles = raw.filter((product) => Array.isArray(product.extendedData) && product.extendedData.some((f) => f.name === "Number" && f.value) && product.extendedData.some((f) => f.name === "Rarity" && f.value && !/^(n\/a|none|unknown)$/i.test(f.value))).length;
      if (normalized.length < declaredSingles) throw new Error(`Invalid single-card metadata in group ${group.groupId}; catalogue retained.`);
      await client.query("insert into card_catalogue_staging (group_id,source_timestamp,products) values ($1,$2,$3) on conflict (group_id) do update set source_timestamp=excluded.source_timestamp, products=excluded.products", [group.groupId, stamp, JSON.stringify(normalized)]);
      importedGroups++;
      if (importedGroups % 25 === 0 || importedGroups === groups.length) console.log(`Staged ${importedGroups}/${groups.length} groups.`);
    }
    const stagedCount = Number((await client.query("select coalesce(sum(jsonb_array_length(products)),0) as total from card_catalogue_staging where source_timestamp=$1", [stamp])).rows[0].total);
    if (!stagedCount || (state.product_count > 1000 && stagedCount < state.product_count * 0.9)) throw new Error("Catalogue is empty or unexpectedly smaller; existing catalogue retained for investigation.");
    await client.query("begin");
    await client.query("delete from card_catalogue_products");
    await client.query(`insert into card_catalogue_products (product_id,group_id,name,image_url,tcgplayer_url,set_code,set_name,rarity,search_text)
      select p."productId",p."groupId",p.name,p."imageUrl",p."tcgplayerUrl",p."setCode",p."setName",p.rarity,p."searchText"
      from card_catalogue_staging s cross join lateral jsonb_to_recordset(s.products) as p("productId" integer,"groupId" integer,name text,"imageUrl" text,"tcgplayerUrl" text,"setCode" text,"setName" text,rarity text,"searchText" text)
      where s.source_timestamp=$1`, [stamp]);
    await client.query("update card_catalogue_sync set source_timestamp=$1,pending_timestamp=null,pending_groups=null,updated_at=now(),product_count=$2,syncing=false where id='yugioh'", [stamp, stagedCount]);
    await client.query("delete from card_catalogue_staging");
    await client.query("commit");
    console.log(`Catalogue ready: ${stagedCount} single-card printings. Existing ownership was unchanged.`);
  }
} catch (error) {
  await client.query("rollback").catch(() => {});
  if (locked) await client.query("update card_catalogue_sync set syncing=false where id='yugioh'").catch(() => {});
  console.error(error instanceof Error ? error.message : "Catalogue sync failed.");
  process.exitCode = 1;
} finally {
  if (locked) await client.query("select pg_advisory_unlock(742910, 2)").catch(() => {});
  await client.end();
}

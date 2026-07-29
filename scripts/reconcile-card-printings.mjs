import pg from "pg";
import { reconcilePlan } from "./lib/card-printing-reconciliation.mjs";

const apply = process.argv.includes("--apply");
const confirmed = process.argv.includes("--confirm-reconcile-printings");
const confirmConfiguredDatabase = process.argv.includes("--confirm-configured-nonloopback-database");
if (apply && !confirmed) throw new Error("Refusing writes: pass --confirm-reconcile-printings with --apply.");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required; it is never printed.");
const databaseUrl = new URL(process.env.DATABASE_URL);
const loopback = ["127.0.0.1", "::1", "localhost"].includes(databaseUrl.hostname);
if (process.env.VERCEL || process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production") {
  throw new Error("Refusing reconciliation in a Vercel or production-marked environment.");
}
if (apply && !loopback && !confirmConfiguredDatabase) {
  throw new Error("Refusing to apply to a configured non-loopback database without --confirm-configured-nonloopback-database.");
}

const client = new pg.Client({ connectionString: databaseUrl.toString() });
await client.connect();
try {
  await client.query("begin isolation level serializable read only");
  const { rows } = await client.query("select * from card_printings order by owner_id, target_id, id");
  const plan = reconcilePlan(rows);
  const affected = [];
  for (const group of plan.auto) {
    const ids = group.duplicateIds;
    const copies = await client.query("select id from card_copies where printing_id = any($1::text[]) order by id", [ids]);
    const copyIds = copies.rows.map((row) => row.id);
    const downstream = copyIds.length ? await client.query(`select
      (select count(*)::int from card_copy_images where copy_id = any($1::text[])) as photos,
      (select count(*)::int from record_line_copies where copy_id = any($1::text[])) as record_links,
      (select count(*)::int from ebay_listings where copy_id = any($1::text[])) as ebay_listings,
      (select count(*)::int from ebay_listing_members where copy_id = any($1::text[])) as ebay_members,
      (select count(*)::int from ebay_order_line_allocations where copy_id = any($1::text[])) as ebay_allocations`, [copyIds]) : { rows: [{ photos: 0, record_links: 0, ebay_listings: 0, ebay_members: 0, ebay_allocations: 0 }] };
    affected.push({ ...group, copies: copyIds, downstream: downstream.rows[0] });
  }
  await client.query("rollback");
  const report = { mode: apply ? "preflight-required-before-apply" : "dry-run", auto: affected, ambiguous: plan.ambiguous };
  console.log(JSON.stringify(report, null, 2));
  if (plan.ambiguous.length) throw new Error("Ambiguous Printings need human review; no writes were made.");
  if (!apply) process.exit(0);

  await client.query("begin isolation level serializable");
  const locked = await client.query("select * from card_printings order by owner_id, target_id, id for update");
  const lockedPlan = reconcilePlan(locked.rows);
  if (lockedPlan.ambiguous.length) throw new Error("Rows changed after preflight; no writes were made.");
  for (const group of lockedPlan.auto) {
    await client.query("update card_copies set printing_id = $1, updated_at = now() where printing_id = any($2::text[])", [group.survivorId, group.duplicateIds]);
    await client.query("delete from card_printings where id = any($1::text[])", [group.duplicateIds]);
  }
  await client.query("commit");
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}

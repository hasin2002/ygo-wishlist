import crypto from "node:crypto";
import pg from "pg";
import {
  assertEbayListingBackfillApplySafe,
  planEbayListingCompositionBackfill,
} from "../src/lib/records/ebay-listing-backfill.ts";

const applyConfirmation = "I_UNDERSTAND_THIS_WRITES_DATABASE";
const additiveTables = [
  "ebay_listing_members",
  "ebay_order_lines",
  "ebay_order_line_allocations",
];
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const environmentArgument = args.find((argument) =>
  argument.startsWith("--environment="));
const environment = environmentArgument?.slice("--environment=".length) ?? "";

if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(environment)) {
  throw new Error(
    "A safe --environment=<label> is required for this backfill report.",
  );
}
if (
  apply
  && !args.includes(
    `--confirm-ebay-listing-composition-backfill=${applyConfirmation}`,
  )
) {
  throw new Error(
    "--apply requires --confirm-ebay-listing-composition-backfill=I_UNDERSTAND_THIS_WRITES_DATABASE.",
  );
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is required. It is never included in backfill output.",
  );
}

function stableId(prefix, identity) {
  const hash = crypto.createHash("sha256").update(identity).digest("hex");
  return `${prefix}-${hash.slice(0, 32)}`;
}

function anonymize(value) {
  const hash = crypto.createHash("sha256").update(value).digest("hex");
  return `[ref:${hash.slice(0, 12)}]`;
}

function dateValue(value) {
  if (value === null || value === undefined) return null;
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`Backfill validation failed for ${label}.`);
  }
}

async function tablePresence(client) {
  const entries = [];
  for (const table of additiveTables) {
    const result = await client.query(
      "select to_regclass($1) as relation",
      [`public.${table}`],
    );
    entries.push([table, result.rows[0]?.relation !== null]);
  }
  return Object.fromEntries(entries);
}

function assertAdditiveSchemaPresent(presence) {
  const missing = additiveTables.filter((table) => !presence[table]);
  if (missing.length) {
    throw new Error(
      `The additive #15 schema is missing ${missing.join(", ")}. No writes were made.`,
    );
  }
}

async function loadBackfillInputs(client, presence) {
  const listingsResult = await client.query(
    `select id, owner_id, copy_id, status, listing_state,
      sale_state, order_id, order_line_item_id, transaction_id, sale_record_id,
      quantity_sold, remote_order_status, payment_pending_at, paid_at,
      cancelled_at, last_remote_event_at
      from ebay_listings order by created_at, id`,
  );
  const copiesResult = await client.query(
    "select id, owner_id from card_copies order by owner_id, id",
  );
  const salesResult = await client.query(
    "select id, owner_id from record_entries order by owner_id, id",
  );
  const saleCopyLinksResult = await client.query(
    `select owner_id, record_id, copy_id from record_line_copies
      where role = 'sale' order by owner_id, record_id, copy_id`,
  );
  const existingMembers = presence.ebay_listing_members
    ? (await client.query(`select member.id, member.owner_id,
        member.listing_id, member.copy_id, member.fulfilment_position,
        (listing.status = 'active' or listing.listing_state = 'active') as active
        from ebay_listing_members member
        join ebay_listings listing
          on listing.owner_id = member.owner_id
          and listing.id = member.listing_id
        order by member.owner_id, member.listing_id,
          member.fulfilment_position`)).rows.map((row) => ({
      id: row.id,
      ownerId: row.owner_id,
      listingId: row.listing_id,
      copyId: row.copy_id,
      fulfilmentPosition: row.fulfilment_position,
      active: row.active,
    }))
    : [];
  const existingOrderLines = presence.ebay_order_lines
    ? (await client.query(`select id, owner_id, listing_id, order_id,
        order_line_item_id, transaction_id, quantity_purchased, payment_state,
        remote_order_status, payment_pending_at, paid_at, cancelled_at,
        last_remote_event_at, sale_record_id
        from ebay_order_lines
        order by owner_id, listing_id, id`)).rows.map((row) => ({
      id: row.id,
      ownerId: row.owner_id,
      listingId: row.listing_id,
      orderId: row.order_id,
      orderLineItemId: row.order_line_item_id,
      transactionId: row.transaction_id,
      quantityPurchased: row.quantity_purchased,
      paymentState: row.payment_state,
      remoteOrderStatus: row.remote_order_status,
      paymentPendingAt: row.payment_pending_at,
      paidAt: row.paid_at,
      cancelledAt: row.cancelled_at,
      lastRemoteEventAt: row.last_remote_event_at,
      saleRecordId: row.sale_record_id,
    }))
    : [];
  const existingAllocations = presence.ebay_order_line_allocations
    ? (await client.query(`select allocation.id, allocation.owner_id,
        allocation.listing_id, allocation.listing_member_id,
        allocation.copy_id, allocation.order_line_id, line.order_id,
        line.order_line_item_id, line.transaction_id,
        allocation.fulfilment_position, allocation.allocated_at,
        allocation.released_at, allocation.release_reason
        from ebay_order_line_allocations allocation
        join ebay_order_lines line
          on line.owner_id = allocation.owner_id
          and line.listing_id = allocation.listing_id
          and line.id = allocation.order_line_id
        order by allocation.owner_id, allocation.listing_id, allocation.id`))
      .rows.map((row) => ({
        id: row.id,
        ownerId: row.owner_id,
        listingMemberId: row.listing_member_id,
        orderLineId: row.order_line_id,
        copyId: row.copy_id,
        listingId: row.listing_id,
        orderLineKey: row.order_id && row.order_line_item_id
          ? `order:${row.owner_id}\u0000${row.order_id}\u0000${row.order_line_item_id}`
          : `transaction:${row.owner_id}\u0000${row.transaction_id}`,
        fulfilmentPosition: row.fulfilment_position,
        allocatedAt: row.allocated_at,
        releasedAt: row.released_at,
        releaseReason: row.release_reason,
      }))
    : [];

  return {
    listings: listingsResult.rows.map((row) => ({
      id: row.id,
      ownerId: row.owner_id,
      copyId: row.copy_id,
      status: row.status,
      listingState: row.listing_state,
      saleState: row.sale_state,
      orderId: row.order_id,
      orderLineItemId: row.order_line_item_id,
      transactionId: row.transaction_id,
      saleRecordId: row.sale_record_id,
      quantitySold: row.quantity_sold,
      remoteOrderStatus: row.remote_order_status,
      paymentPendingAt: row.payment_pending_at,
      paidAt: row.paid_at,
      cancelledAt: row.cancelled_at,
      lastRemoteEventAt: row.last_remote_event_at,
    })),
    copyOwnerById: new Map(
      copiesResult.rows.map((row) => [row.id, row.owner_id]),
    ),
    saleOwnerById: new Map(
      salesResult.rows.map((row) => [row.id, row.owner_id]),
    ),
    saleCopyIdsByOwnerRecord: saleCopyLinksResult.rows.reduce((links, row) => {
      const key = `${row.owner_id}\u0000${row.record_id}`;
      const copyIds = links.get(key) ?? new Set();
      copyIds.add(row.copy_id);
      links.set(key, copyIds);
      return links;
    }, new Map()),
    existingMembers,
    existingOrderLines,
    existingAllocations,
  };
}

function reportFor(plan, presence, mode, writes) {
  const grouped = Object.groupBy(
    plan.anomalies,
    (entry) => entry.category,
  );
  return {
    mode,
    environment,
    databaseFingerprint:
      `sha256:${crypto.createHash("sha256").update(databaseUrl).digest("hex").slice(0, 16)}`,
    additiveTablesPresent: presence,
    counts: plan.counts,
    anomalies: Object.fromEntries(
      Object.entries(grouped).map(([category, entries]) => [category, {
        blocking: entries.some((entry) => entry.blocking),
        count: entries.length,
        examples: entries.slice(0, 3).map((entry) => ({
          listing: anonymize(entry.listingId),
          message: entry.message,
        })),
      }]),
    ),
    representatives: plan.members.slice(0, 8).map((member) => ({
      listing: anonymize(member.listingId),
      memberAction: member.action,
    })),
    safeToApply:
      plan.safeToApply
      && additiveTables.every((table) => presence[table]),
    writes,
  };
}

async function readExactMember(client, member) {
  const result = await client.query({
    text: `select id, owner_id, listing_id, copy_id, fulfilment_position
      from ebay_listing_members
      where owner_id = $1 and listing_id = $2 and copy_id = $3`,
    values: [member.ownerId, member.listingId, member.copyId],
  });
  if (result.rowCount !== 1) {
    throw new Error("Backfill validation found a non-exact Listing member.");
  }
  const row = result.rows[0];
  assertEqual(row.owner_id, member.ownerId, "member owner");
  assertEqual(row.listing_id, member.listingId, "member Listing");
  assertEqual(row.copy_id, member.copyId, "member Copy");
  assertEqual(
    row.fulfilment_position,
    member.fulfilmentPosition,
    "member position",
  );
  assertEqual(member.kind, "individual", "legacy Listing kind");
  return row;
}

async function readExactOrderLine(client, line) {
  const identitySql =
    line.orderId && line.orderLineItemId
      ? "order_id = $3 and order_line_item_id = $4"
      : "transaction_id = $3 and $4::text is null";
  const result = await client.query({
    text: `select id, owner_id, listing_id, order_id, order_line_item_id,
      transaction_id, quantity_purchased, payment_state, remote_order_status,
      payment_pending_at, paid_at, cancelled_at, last_remote_event_at,
      sale_record_id
      from ebay_order_lines
      where owner_id = $1 and listing_id = $2 and ${identitySql}`,
    values: [
      line.ownerId,
      line.listingId,
      line.orderId && line.orderLineItemId
        ? line.orderId
        : line.transactionId,
      line.orderId && line.orderLineItemId ? line.orderLineItemId : null,
    ],
  });
  if (result.rowCount !== 1) {
    throw new Error("Backfill validation found a non-exact eBay order line.");
  }
  const row = result.rows[0];
  assertEqual(row.owner_id, line.ownerId, "order-line owner");
  assertEqual(row.listing_id, line.listingId, "order-line Listing");
  assertEqual(row.order_id, line.orderId, "remote order");
  assertEqual(
    row.order_line_item_id,
    line.orderLineItemId,
    "remote order line",
  );
  assertEqual(row.transaction_id, line.transactionId, "remote transaction");
  assertEqual(
    row.quantity_purchased,
    line.quantityPurchased,
    "purchased quantity",
  );
  assertEqual(row.payment_state, line.paymentState, "payment state");
  assertEqual(
    row.remote_order_status,
    line.remoteOrderStatus,
    "remote order status",
  );
  assertEqual(
    dateValue(row.payment_pending_at),
    dateValue(line.paymentPendingAt),
    "payment-pending time",
  );
  assertEqual(dateValue(row.paid_at), dateValue(line.paidAt), "paid time");
  assertEqual(
    dateValue(row.cancelled_at),
    dateValue(line.cancelledAt),
    "cancelled time",
  );
  assertEqual(
    dateValue(row.last_remote_event_at),
    dateValue(line.lastRemoteEventAt),
    "last remote event",
  );
  assertEqual(row.sale_record_id, line.saleRecordId, "Sale link");
  return row;
}

async function applyPlan(client, plan) {
  assertEbayListingBackfillApplySafe(plan);
  const now = new Date();
  let memberWrites = 0;
  let orderLineWrites = 0;
  let allocationWrites = 0;
  const memberRows = new Map();
  const lineRows = new Map();

  for (const member of plan.members) {
    if (member.action === "create") {
      const id = stableId(
        "ebay-member",
        `${member.ownerId}\u0000${member.listingId}\u0000${member.copyId}\u0000${member.fulfilmentPosition}`,
      );
      await client.query({
        text: `insert into ebay_listing_members (
          id, owner_id, listing_id, copy_id, fulfilment_position,
          created_at, updated_at
        ) values ($1,$2,$3,$4,$5,$6,$6)
        on conflict (id) do update set updated_at = excluded.updated_at`,
        values: [
          id,
          member.ownerId,
          member.listingId,
          member.copyId,
          member.fulfilmentPosition,
          now,
        ],
      });
      memberWrites += 1;
    }
    const row = await readExactMember(client, member);
    memberRows.set(`${member.listingId}\u0000${member.copyId}`, row);
  }

  for (const line of plan.orderLines) {
    if (line.action === "create") {
      const id = stableId("ebay-order-line", line.key);
      await client.query({
        text: `insert into ebay_order_lines (
          id, owner_id, listing_id, order_id, order_line_item_id,
          transaction_id, quantity_purchased, payment_state,
          remote_order_status, payment_pending_at, paid_at, cancelled_at,
          needs_review_at, last_remote_event_at, sale_record_id,
          created_at, updated_at
        ) values (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16
        )
        on conflict (id) do update set updated_at = excluded.updated_at`,
        values: [
          id,
          line.ownerId,
          line.listingId,
          line.orderId,
          line.orderLineItemId,
          line.transactionId,
          line.quantityPurchased,
          line.paymentState,
          line.remoteOrderStatus,
          line.paymentPendingAt,
          line.paidAt,
          line.cancelledAt,
          line.paymentState === "needs_review"
            ? line.lastRemoteEventAt
            : null,
          line.lastRemoteEventAt,
          line.saleRecordId,
          now,
        ],
      });
      orderLineWrites += 1;
    }
    const row = await readExactOrderLine(client, line);
    lineRows.set(line.key, row);
  }

  for (const allocation of plan.allocations) {
    const member = memberRows.get(
      `${allocation.listingId}\u0000${allocation.copyId}`,
    );
    const line = lineRows.get(allocation.orderLineKey);
    if (!member || !line) {
      throw new Error("Backfill allocation lost its exact member or order line.");
    }
    if (allocation.action === "create") {
      const id = stableId(
        "ebay-allocation",
        `${allocation.ownerId}\u0000${allocation.listingId}\u0000${line.id}\u0000${allocation.copyId}`,
      );
      await client.query({
        text: `insert into ebay_order_line_allocations (
          id, owner_id, listing_id, listing_member_id, order_line_id,
          copy_id, fulfilment_position, allocated_at, released_at,
          release_reason, created_at, updated_at
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)
        on conflict (id) do update set updated_at = excluded.updated_at`,
        values: [
          id,
          allocation.ownerId,
          allocation.listingId,
          member.id,
          line.id,
          allocation.copyId,
          allocation.fulfilmentPosition,
          allocation.allocatedAt,
          allocation.releasedAt,
          allocation.releaseReason,
          now,
        ],
      });
      allocationWrites += 1;
    }
    const result = await client.query({
      text: `select owner_id, listing_id, listing_member_id, order_line_id,
        copy_id, fulfilment_position, allocated_at, released_at, release_reason
        from ebay_order_line_allocations
        where owner_id = $1 and listing_id = $2 and order_line_id = $3
          and copy_id = $4`,
      values: [
        allocation.ownerId,
        allocation.listingId,
        line.id,
        allocation.copyId,
      ],
    });
    if (result.rowCount !== 1) {
      throw new Error("Backfill validation found a non-exact allocation.");
    }
    const row = result.rows[0];
    assertEqual(row.listing_member_id, member.id, "allocation member");
    assertEqual(row.order_line_id, line.id, "allocation order line");
    assertEqual(row.copy_id, allocation.copyId, "allocation Copy");
    assertEqual(
      row.fulfilment_position,
      allocation.fulfilmentPosition,
      "allocation position",
    );
    assertEqual(
      dateValue(row.allocated_at),
      dateValue(allocation.allocatedAt),
      "allocated time",
    );
    assertEqual(
      dateValue(row.released_at),
      dateValue(allocation.releasedAt),
      "released time",
    );
    assertEqual(
      row.release_reason,
      allocation.releaseReason,
      "release reason",
    );
  }
  return {
    members: memberWrites,
    orderLines: orderLineWrites,
    allocations: allocationWrites,
    total: memberWrites + orderLineWrites + allocationWrites,
  };
}

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  if (!apply) {
    const presence = await tablePresence(client);
    const inputs = await loadBackfillInputs(client, presence);
    const plan = planEbayListingCompositionBackfill(inputs);
    process.stdout.write(
      `${JSON.stringify(reportFor(plan, presence, "dry-run", 0), null, 2)}\n`,
    );
  } else {
    await client.query("begin");
    try {
      const presence = await tablePresence(client);
      assertAdditiveSchemaPresent(presence);
      await client.query(`lock table ebay_listings, card_copies,
        record_entries, record_line_copies, ebay_listing_members, ebay_order_lines,
        ebay_order_line_allocations in share row exclusive mode`);
      const inputs = await loadBackfillInputs(client, presence);
      const plan = planEbayListingCompositionBackfill(inputs);
      assertEbayListingBackfillApplySafe(plan);
      const writes = await applyPlan(client, plan);
      await client.query("commit");
      process.stdout.write(
        `${JSON.stringify(reportFor(plan, presence, "applied", writes), null, 2)}\n`,
      );
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  }
} finally {
  await client.end();
}

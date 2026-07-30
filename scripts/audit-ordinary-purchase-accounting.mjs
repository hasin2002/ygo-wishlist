import pg from "pg";
import { ordinaryPurchaseDisagreementReasons } from "./lib/ordinary-purchase-accounting-audit.mjs";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for the accounting audit.");

const pool = new pg.Pool({ connectionString, max: 1 });
try {
  // Read-only by design. This report is deliberately separate from any future
  // repair command so operators can inspect disagreements without mutation.
  const { rows } = await pool.query(`
    with line_totals as (
      select owner_id, record_id,
        count(*)::int as line_count,
        json_agg(json_build_object(
        'id', line.id, 'kind', line.kind, 'quantity', line.quantity,
        'allocationPence', line.allocation_pence
        ) order by line.position) as lines
      from record_lines line
      group by owner_id, record_id
    ), copy_totals as (
      select owner_id, acquired_record_id as record_id,
        count(*)::int as copy_count,
        count(*) filter (where allocation_pence is null)::int as null_copy_allocation_count,
        count(*) filter (where not exists (
          select 1 from record_lines source_line
          where source_line.owner_id = card_copies.owner_id
            and source_line.id = card_copies.acquired_line_id
            and source_line.record_id = card_copies.acquired_record_id
        ))::int as invalid_source_line_count,
        coalesce(sum(allocation_pence), 0)::int as copy_allocation_pence
      from card_copies
      group by owner_id, acquired_record_id
    )
    select record.id, record.owner_id, record.status, record.amount_pence, record.amount_known,
      coalesce(line_totals.line_count, 0)::int as line_count,
      coalesce(line_totals.lines, '[]'::json) as lines,
      coalesce(copy_totals.copy_count, 0)::int as copy_count,
      coalesce(copy_totals.null_copy_allocation_count, 0)::int as null_copy_allocation_count,
      coalesce(copy_totals.invalid_source_line_count, 0)::int as invalid_source_line_count,
      coalesce(copy_totals.copy_allocation_pence, 0)::int as copy_allocation_pence
    from record_entries record
    left join bulk_lots lot
      on lot.owner_id = record.owner_id and lot.acquired_record_id = record.id
    left join line_totals
      on line_totals.owner_id = record.owner_id and line_totals.record_id = record.id
    left join copy_totals
      on copy_totals.owner_id = record.owner_id and copy_totals.record_id = record.id
    where record.type = 'purchase' and lot.id is null
    order by record.owner_id, record.id
  `);

  const disagreements = rows.flatMap((row) => {
    const reasons = ordinaryPurchaseDisagreementReasons(row);
    return reasons.length ? [{
      id: row.id,
      ownerId: row.owner_id,
      status: row.status,
      amountKnown: row.amount_known,
      amountPence: row.amount_pence,
      lineCount: row.line_count,
      copyCount: row.copy_count,
      reasons,
    }] : [];
  });
  console.log(JSON.stringify({ mode: "dry-run", checked: rows.length, disagreements }, null, 2));
  if (disagreements.length) process.exitCode = 2;
} finally {
  await pool.end();
}

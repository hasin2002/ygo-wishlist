import pg from "pg";
import { sealedUnitAllocationReport } from "./lib/sealed-unit-cost-allocation-audit.mjs";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for the sealed-unit allocation audit.");

const pool = new pg.Pool({ connectionString, max: 1 });
try {
  // This is intentionally read-only. Historical purchases are reported for a
  // reviewed plan; this command never guesses a per-unit cost from a receipt.
  const { rows } = await pool.query(`
    with line_totals as (
      select owner_id, record_id,
        json_agg(json_build_object('id', id, 'kind', kind, 'quantity', quantity,
          'allocationPence', allocation_pence) order by position) as lines
      from record_lines group by owner_id, record_id
    ), unit_totals as (
      select owner_id, acquired_record_id as record_id,
        count(*)::int as unit_count,
        count(*) filter (where opened_record_id is not null)::int as opened_unit_count,
        count(*) filter (where allocation_index is null)::int as missing_allocation_index_count,
        count(*) filter (where allocation_pence is null)::int as null_unit_allocation_count,
        count(*) filter (where not exists (
          select 1 from record_lines source_line
          where source_line.owner_id = sealed_units.owner_id
            and source_line.id = sealed_units.acquired_line_id
            and source_line.record_id = sealed_units.acquired_record_id
        ))::int as invalid_source_line_count,
        coalesce(sum(allocation_pence), 0)::int as unit_allocation_pence
      from sealed_units group by owner_id, acquired_record_id
    )
    select record.id, record.owner_id, record.amount_known, record.amount_pence,
      coalesce(line_totals.lines, '[]'::json) as lines,
      coalesce(unit_totals.unit_count, 0)::int as unit_count,
      coalesce(unit_totals.opened_unit_count, 0)::int as opened_unit_count,
      coalesce(unit_totals.missing_allocation_index_count, 0)::int as missing_allocation_index_count,
      coalesce(unit_totals.null_unit_allocation_count, 0)::int as null_unit_allocation_count,
      coalesce(unit_totals.invalid_source_line_count, 0)::int as invalid_source_line_count,
      coalesce(unit_totals.unit_allocation_pence, 0)::int as unit_allocation_pence
    from record_entries record
    join unit_totals on unit_totals.owner_id = record.owner_id and unit_totals.record_id = record.id
    left join line_totals on line_totals.owner_id = record.owner_id and line_totals.record_id = record.id
    where record.type in ('purchase', 'imported-acquisition')
    order by record.owner_id, record.id
  `);
  const report = sealedUnitAllocationReport(rows);
  console.log(JSON.stringify({ mode: "dry-run", ...report }, null, 2));
  if (report.disagreements.length) process.exitCode = 2;
} finally {
  await pool.end();
}

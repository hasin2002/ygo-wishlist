import fs from "node:fs";
import pg from "pg";
import { reviewedSealedAllocation } from "./lib/sealed-unit-cost-allocation-reconciliation.mjs";

const apply = process.argv.includes("--apply");
const confirmation = process.argv.includes("--confirm-reviewed-sealed-unit-plan");
const planArgument = process.argv.find((value) => value.startsWith("--reviewed-plan="));
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for sealed-unit allocation reconciliation.");
if (apply && (!confirmation || !planArgument)) {
  throw new Error("Apply requires --confirm-reviewed-sealed-unit-plan and --reviewed-plan=/absolute/path/to/plan.json.");
}

const pool = new pg.Pool({ connectionString, max: 1 });
try {
  if (!apply) {
    console.log(JSON.stringify({ mode: "dry-run", message: "Run records:sealed-unit-costs:dry-run first. Historical unit costs are never inferred automatically." }, null, 2));
  } else {
    const plan = JSON.parse(fs.readFileSync(planArgument.slice("--reviewed-plan=".length), "utf8"));
    if (!Array.isArray(plan.allocations)) throw new Error("Reviewed plan must contain an allocations array.");
    const plannedPurchases = new Set();
    for (const item of plan.allocations) {
      if (!item || typeof item !== "object" || typeof item.ownerId !== "string" || typeof item.recordId !== "string") continue;
      const key = `${item.ownerId}\u0000${item.recordId}`;
      if (plannedPurchases.has(key)) throw new Error(`Reviewed plan names Purchase ${item.recordId} more than once.`);
      plannedPurchases.add(key);
    }
    let applied = 0;
    await pool.query("begin");
    try {
      for (const item of plan.allocations) {
        if (!item || typeof item !== "object" || typeof item.ownerId !== "string" || typeof item.recordId !== "string" || !Array.isArray(item.units)) {
          throw new Error("Every reviewed plan entry needs ownerId, recordId, and units.");
        }
        const { rows: recordRows } = await pool.query(
          "select type, amount_known, amount_pence from record_entries where id = $1 and owner_id = $2 for update",
          [item.recordId, item.ownerId],
        );
        if (recordRows.length !== 1) throw new Error(`Purchase ${item.recordId} was not found.`);
        const { rows: lines } = await pool.query(
          "select id, owner_id, record_id, kind, quantity from record_lines where record_id = $1 and owner_id = $2 order by position for update",
          [item.recordId, item.ownerId],
        );
        const { rows: units } = await pool.query(
          "select id, owner_id, acquired_record_id, acquired_line_id, opened_record_id, allocation_index, allocation_pence, allocation_mode from sealed_units where acquired_record_id = $1 and owner_id = $2 order by id for update",
          [item.recordId, item.ownerId],
        );
        const { sourceLineId, known, total, values } = reviewedSealedAllocation({
          item, record: recordRows[0], lines, units,
        });
        for (const value of values) {
          await pool.query(
            "update sealed_units set allocation_index = $1, allocation_pence = $2, allocation_mode = 'override', updated_at = now() where id = $3 and owner_id = $4 and (allocation_index is distinct from $1 or allocation_pence is distinct from $2 or allocation_mode is distinct from 'override')",
            [value.index, value.allocationPence, value.id, item.ownerId],
          );
        }
        await pool.query(
          "update record_lines set allocation_pence = $1, updated_at = now() where id = $2 and record_id = $3 and owner_id = $4 and kind = 'sealed'",
          [known ? total : null, sourceLineId, item.recordId, item.ownerId],
        );
        applied += 1;
      }
      await pool.query("commit");
    } catch (error) {
      await pool.query("rollback");
      throw error;
    }
    console.log(JSON.stringify({ mode: "apply", applied, idempotent: true }, null, 2));
  }
} finally {
  await pool.end();
}

import fs from "node:fs";
import pg from "pg";

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
    let applied = 0;
    await pool.query("begin");
    try {
      for (const item of plan.allocations) {
        if (!item || typeof item !== "object" || typeof item.ownerId !== "string" || typeof item.recordId !== "string" || !Array.isArray(item.units)) {
          throw new Error("Every reviewed plan entry needs ownerId, recordId, and units.");
        }
        const { rows: recordRows } = await pool.query(
          "select amount_known, amount_pence from record_entries where id = $1 and owner_id = $2 for update",
          [item.recordId, item.ownerId],
        );
        if (recordRows.length !== 1) throw new Error(`Purchase ${item.recordId} was not found.`);
        const { rows: units } = await pool.query(
          "select id, acquired_line_id, opened_record_id, allocation_index, allocation_pence, allocation_mode from sealed_units where acquired_record_id = $1 and owner_id = $2 order by id for update",
          [item.recordId, item.ownerId],
        );
        const supplied = new Map(item.units.map((unit) => [unit.id, unit]));
        if (supplied.size !== units.length || units.some((unit) => !supplied.has(unit.id))) {
          throw new Error(`Reviewed plan for ${item.recordId} must name every exact sealed unit.`);
        }
        const known = recordRows[0].amount_known;
        const total = known ? recordRows[0].amount_pence : 0;
        const values = units.map((unit, index) => {
          const suppliedUnit = supplied.get(unit.id);
          const allocationPence = suppliedUnit?.allocationPence;
          if (known && (!Number.isInteger(allocationPence) || allocationPence < 0)) throw new Error(`Known Purchase ${item.recordId} needs a non-negative whole-pence cost for ${unit.id}.`);
          if (!known && allocationPence !== null) throw new Error(`Unknown Purchase ${item.recordId} must keep ${unit.id} unknown.`);
          return { id: unit.id, index, allocationPence: known ? allocationPence : null };
        });
        if (known && values.reduce((sum, value) => sum + value.allocationPence, 0) !== total) {
          throw new Error(`Reviewed allocations for ${item.recordId} do not equal its Purchase total.`);
        }
        for (const value of values) {
          await pool.query(
            "update sealed_units set allocation_index = $1, allocation_pence = $2, allocation_mode = 'override', updated_at = now() where id = $3 and owner_id = $4 and (allocation_index is distinct from $1 or allocation_pence is distinct from $2 or allocation_mode is distinct from 'override')",
            [value.index, value.allocationPence, value.id, item.ownerId],
          );
        }
        await pool.query(
          "update record_lines set allocation_pence = $1, updated_at = now() where id = (select acquired_line_id from sealed_units where id = $2) and owner_id = $3",
          [known ? total : null, units[0]?.id, item.ownerId],
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

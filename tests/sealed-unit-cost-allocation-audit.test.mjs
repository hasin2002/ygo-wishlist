import assert from "node:assert/strict";
import test from "node:test";
import { sealedUnitAllocationReasons } from "../scripts/lib/sealed-unit-cost-allocation-audit.mjs";

const line = (quantity, allocationPence) => ({ kind: "sealed", quantity, allocationPence });
const valid = (overrides = {}) => ({
  amount_known: true, amount_pence: 15_000, lines: [line(3, 15_000)], unit_count: 3,
  opened_unit_count: 0, missing_allocation_index_count: 0, null_unit_allocation_count: 0,
  invalid_source_line_count: 0, unit_allocation_pence: 15_000, ...overrides,
});

test("sealed allocation audit accepts exact known, remainder, and reviewed override totals", () => {
  assert.deepEqual(sealedUnitAllocationReasons(valid()), []);
  assert.deepEqual(sealedUnitAllocationReasons(valid({ amount_pence: 100, lines: [line(3, 100)], unit_allocation_pence: 100 })), []);
});

test("sealed allocation audit preserves ambiguity for review instead of inventing a historical allocation", () => {
  assert.deepEqual(
    sealedUnitAllocationReasons(valid({ missing_allocation_index_count: 3, null_unit_allocation_count: 3, unit_allocation_pence: 0, opened_unit_count: 1 })),
    ["missing_allocation_index", "known_total_has_unknown_unit_allocation", "unit_total_mismatch", "opened_unit_provenance_requires_review"],
  );
  assert.deepEqual(
    sealedUnitAllocationReasons(valid({ amount_known: false, amount_pence: 0, lines: [line(2, null)], unit_count: 2, null_unit_allocation_count: 2, unit_allocation_pence: 0 })),
    [],
  );
});

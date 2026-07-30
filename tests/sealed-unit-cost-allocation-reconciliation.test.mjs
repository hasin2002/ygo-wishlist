import assert from "node:assert/strict";
import test from "node:test";
import { reviewedSealedAllocation } from "../scripts/lib/sealed-unit-cost-allocation-reconciliation.mjs";

const item = { ownerId: "owner", recordId: "record", units: [{ id: "unit-a", allocationPence: 60 }, { id: "unit-b", allocationPence: 40 }] };
const record = { type: "purchase", amount_known: true, amount_pence: 100 };
const line = { id: "line", owner_id: "owner", record_id: "record", kind: "sealed", quantity: 2 };
const units = [
  { id: "unit-a", owner_id: "owner", acquired_record_id: "record", acquired_line_id: "line", opened_record_id: null },
  { id: "unit-b", owner_id: "owner", acquired_record_id: "record", acquired_line_id: "line", opened_record_id: null },
];

test("reconciliation changes only a complete unopened exact sealed source", () => {
  assert.deepEqual(reviewedSealedAllocation({ item, record, lines: [line], units }), {
    sourceLineId: "line", known: true, total: 100,
    values: [{ id: "unit-a", index: 0, allocationPence: 60 }, { id: "unit-b", index: 1, allocationPence: 40 }],
  });
});

test("reconciliation rejects opened, mixed, malformed, and incorrectly linked plans", () => {
  assert.throws(() => reviewedSealedAllocation({ item, record, lines: [line], units: [{ ...units[0], opened_record_id: "opening" }, units[1]] }), /opened sealed unit/i);
  assert.throws(() => reviewedSealedAllocation({ item, record, lines: [line, { ...line, id: "other" }], units }), /exactly one sealed source line/i);
  assert.throws(() => reviewedSealedAllocation({ item: { ...item, units: [item.units[0], item.units[0]] }, record, lines: [line], units }), /each exact sealed unit once/i);
  assert.throws(() => reviewedSealedAllocation({ item, record, lines: [line], units: [{ ...units[0], acquired_line_id: "other" }, units[1]] }), /link to its one sealed source line/i);
  assert.throws(() => reviewedSealedAllocation({ item, record: { ...record, type: "sale" }, lines: [line], units }), /not a supported sealed Purchase source/i);
});

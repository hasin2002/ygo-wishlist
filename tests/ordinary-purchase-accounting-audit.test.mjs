import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ordinaryPurchaseDisagreementReasons } from "../scripts/lib/ordinary-purchase-accounting-audit.mjs";

const cardLine = (quantity, allocationPence) => ({ kind: "card", quantity, allocationPence });

test("ordinary Purchase dry-run reasons distinguish clean, malformed, and unknown accounting", () => {
  assert.deepEqual(ordinaryPurchaseDisagreementReasons({ amount_known: true, amount_pence: 101, lines: [cardLine(2, 101)], copy_count: 2, null_copy_allocation_count: 0, copy_allocation_pence: 101 }), []);
  assert.deepEqual(ordinaryPurchaseDisagreementReasons({ amount_known: true, amount_pence: 100, lines: [cardLine(1, 100), cardLine(1, 100)], copy_count: 2, null_copy_allocation_count: 0, copy_allocation_pence: 200 }), ["unsupported_multi_line_shape", "line_copy_quantity_mismatch", "copy_total_mismatch"]);
  assert.deepEqual(ordinaryPurchaseDisagreementReasons({ amount_known: true, amount_pence: 100, lines: [cardLine(2, 100)], copy_count: 2, null_copy_allocation_count: 1, copy_allocation_pence: 50 }), ["known_total_has_unknown_copy_allocation", "copy_total_mismatch"]);
  assert.deepEqual(ordinaryPurchaseDisagreementReasons({ amount_known: false, amount_pence: 0, lines: [cardLine(1, 0)], copy_count: 1, null_copy_allocation_count: 0, copy_allocation_pence: 0 }), ["unknown_total_has_known_allocation"]);
  assert.deepEqual(ordinaryPurchaseDisagreementReasons({ amount_known: true, amount_pence: 10, lines: [cardLine(1, 10)], copy_count: 1, null_copy_allocation_count: 0, invalid_source_line_count: 1, copy_allocation_pence: 10 }), ["copy_source_line_mismatch"]);
});

test("ordinary Purchase dry-run audits active and void history", () => {
  const source = readFileSync(
    new URL("../scripts/audit-ordinary-purchase-accounting.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /select record\.id, record\.owner_id, record\.status/);
  assert.match(source, /where record\.type = 'purchase' and lot\.id is null/);
  assert.doesNotMatch(source, /record\.status = 'active'/);
  assert.match(source, /status: row\.status/);
});

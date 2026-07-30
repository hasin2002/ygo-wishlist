export function ordinaryPurchaseDisagreementReasons(row) {
  const lines = row.lines;
  const cardLines = lines.filter((line) => line.kind === "card");
  if (!cardLines.length) return [];
  const reasons = [];
  const [line] = cardLines;
  if (lines.length !== 1 || cardLines.length !== 1) reasons.push("unsupported_multi_line_shape");
  if (!line || line.quantity !== row.copy_count) reasons.push("line_copy_quantity_mismatch");
  if (row.invalid_source_line_count) reasons.push("copy_source_line_mismatch");
  if (row.amount_known) {
    if (line?.allocationPence !== row.amount_pence) reasons.push("line_total_mismatch");
    if (row.null_copy_allocation_count) reasons.push("known_total_has_unknown_copy_allocation");
    if (row.copy_allocation_pence !== row.amount_pence) reasons.push("copy_total_mismatch");
  } else if (line?.allocationPence !== null || row.null_copy_allocation_count !== row.copy_count) {
    reasons.push("unknown_total_has_known_allocation");
  }
  return reasons;
}

export function sealedUnitAllocationReasons(row) {
  const reasons = [];
  const sealedLines = row.lines.filter((line) => line.kind === "sealed");
  if (row.lines.length !== 1 || sealedLines.length !== 1) reasons.push("unsupported_purchase_shape");
  const [line] = sealedLines;
  if (!line || line.quantity !== row.unit_count) reasons.push("line_unit_quantity_mismatch");
  if (row.invalid_source_line_count) reasons.push("unit_source_line_mismatch");
  if (row.missing_allocation_index_count) reasons.push("missing_allocation_index");
  if (row.amount_known) {
    if (row.null_unit_allocation_count) reasons.push("known_total_has_unknown_unit_allocation");
    if (row.unit_allocation_pence !== row.amount_pence) reasons.push("unit_total_mismatch");
    if (line?.allocationPence !== row.amount_pence) reasons.push("line_total_mismatch");
  } else if (row.null_unit_allocation_count !== row.unit_count || line?.allocationPence !== null) {
    reasons.push("unknown_total_has_known_unit_allocation");
  }
  if (row.opened_unit_count && reasons.length) reasons.push("opened_unit_provenance_requires_review");
  return reasons;
}

export function sealedUnitAllocationReport(rows) {
  const disagreements = rows.flatMap((row) => {
    const reasons = sealedUnitAllocationReasons(row);
    return reasons.length ? [{
      id: row.id,
      ownerId: row.owner_id,
      amountKnown: row.amount_known,
      amountPence: row.amount_pence,
      openedUnitCount: row.opened_unit_count,
      reasons,
    }] : [];
  });
  return { checked: rows.length, disagreements };
}

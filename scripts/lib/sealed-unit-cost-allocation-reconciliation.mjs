function fail(message) {
  throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Validates an operator-reviewed allocation against the exact sealed source
 * that was audited.  This deliberately accepts no partial or mixed Purchase:
 * a plan can only change every unopened unit from one sealed source line.
 */
export function reviewedSealedAllocation({ item, record, lines, units }) {
  if (!isRecord(item) || typeof item.ownerId !== "string" || typeof item.recordId !== "string" || !Array.isArray(item.units)) {
    fail("Every reviewed plan entry needs ownerId, recordId, and units.");
  }
  if (!record || !["purchase", "imported-acquisition"].includes(record.type)) {
    fail(`Record ${item.recordId} is not a supported sealed Purchase source.`);
  }
  if (!Array.isArray(lines) || lines.length !== 1 || lines[0]?.kind !== "sealed") {
    fail(`Reviewed plan for ${item.recordId} must have exactly one sealed source line.`);
  }
  const [sourceLine] = lines;
  if (sourceLine.owner_id !== item.ownerId || sourceLine.record_id !== item.recordId) {
    fail(`The sealed source line for ${item.recordId} does not belong to this Purchase.`);
  }
  if (!Array.isArray(units) || units.length !== sourceLine.quantity) {
    fail(`The sealed source line for ${item.recordId} does not match its exact unit count.`);
  }
  if (units.some((unit) => (
    unit.owner_id !== item.ownerId
    || unit.acquired_record_id !== item.recordId
    || unit.acquired_line_id !== sourceLine.id
  ))) {
    fail(`Every sealed unit for ${item.recordId} must link to its one sealed source line.`);
  }
  if (units.some((unit) => unit.opened_record_id !== null)) {
    fail(`Purchase ${item.recordId} includes an opened sealed unit and cannot be reconciled.`);
  }

  const supplied = new Map();
  for (const unit of item.units) {
    if (!isRecord(unit) || typeof unit.id !== "string" || supplied.has(unit.id)) {
      fail(`Reviewed plan for ${item.recordId} must name each exact sealed unit once.`);
    }
    supplied.set(unit.id, unit);
  }
  if (supplied.size !== units.length || units.some((unit) => !supplied.has(unit.id))) {
    fail(`Reviewed plan for ${item.recordId} must name every exact sealed unit.`);
  }

  const known = record.amount_known;
  const total = known ? record.amount_pence : 0;
  const values = units.map((unit, index) => {
    const allocationPence = supplied.get(unit.id).allocationPence;
    if (known && (!Number.isInteger(allocationPence) || allocationPence < 0)) {
      fail(`Known Purchase ${item.recordId} needs a non-negative whole-pence cost for ${unit.id}.`);
    }
    if (!known && allocationPence !== null) {
      fail(`Unknown Purchase ${item.recordId} must keep ${unit.id} unknown.`);
    }
    return { id: unit.id, index, allocationPence: known ? allocationPence : null };
  });
  if (known && values.reduce((sum, value) => sum + value.allocationPence, 0) !== total) {
    fail(`Reviewed allocations for ${item.recordId} do not equal its Purchase total.`);
  }
  return { sourceLineId: sourceLine.id, known, total, values };
}

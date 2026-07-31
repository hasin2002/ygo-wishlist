import { allocatePence } from "./allocation.ts";

export type SealedAllocationMode = "equal" | "override";

/**
 * Cost is attached to each exact sealed unit, never inferred from the whole
 * Purchase after one unit has been selected to open.  Overrides are accepted
 * only as a complete, reviewed allocation of the receipt total.
 */
export function sealedPurchaseUnitAllocations({
  amountKnown,
  amountPence,
  unitCount,
  overrides,
}: {
  amountKnown: boolean;
  amountPence: number;
  unitCount: number;
  overrides?: number[] | null;
}): { allocations: Array<number | null>; mode: SealedAllocationMode } {
  if (!Number.isInteger(unitCount) || unitCount < 1) {
    throw new RangeError("A sealed Purchase must contain at least one exact unit.");
  }
  if (!amountKnown) {
    if (overrides?.length) throw new RangeError("Unknown sealed costs cannot have per-unit overrides.");
    return { allocations: Array<number | null>(unitCount).fill(null), mode: "equal" };
  }
  if (!overrides) return { allocations: allocatePence(amountPence, unitCount), mode: "equal" };
  if (overrides.length !== unitCount || overrides.some((value) => !Number.isInteger(value) || value < 0)) {
    throw new RangeError("Give every sealed unit a non-negative whole-pence allocation.");
  }
  if (overrides.reduce((sum, value) => sum + value, 0) !== amountPence) {
    throw new RangeError("Sealed unit allocations must sum exactly to the Purchase total.");
  }
  return { allocations: overrides, mode: "override" };
}

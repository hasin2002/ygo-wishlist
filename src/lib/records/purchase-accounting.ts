import { allocatePence } from "./allocation.ts";

/**
 * The only allocation policy for an ordinary card Purchase. A known total is
 * spread across its exact physical Copies in stable order; an unknown total
 * deliberately has no allocations at all (it is not a free Purchase).
 */
export function ordinaryPurchaseCopyAllocations({
  amountKnown,
  amountPence,
  copyCount,
}: {
  amountKnown: boolean;
  amountPence: number;
  copyCount: number;
}) {
  if (!Number.isInteger(copyCount) || copyCount < 1) {
    throw new RangeError("An ordinary card Purchase must contain at least one physical Copy.");
  }
  if (!amountKnown) return Array<number | null>(copyCount).fill(null);
  return allocatePence(amountPence, copyCount);
}

export function ordinaryPurchaseLineAllocation({
  amountKnown,
  amountPence,
}: {
  amountKnown: boolean;
  amountPence: number;
}) {
  return amountKnown ? amountPence : null;
}

export function allocatePenceAt(
  totalPence: number,
  totalQuantity: number,
  index: number,
) {
  if (!Number.isInteger(totalPence) || totalPence < 0) {
    throw new RangeError("Total pence must be a non-negative integer.");
  }
  if (!Number.isInteger(totalQuantity) || totalQuantity <= 0) {
    throw new RangeError("Total quantity must be a positive integer.");
  }
  if (!Number.isInteger(index) || index < 0 || index >= totalQuantity) {
    throw new RangeError("Allocation index must identify an item in the total quantity.");
  }

  const base = Math.floor(totalPence / totalQuantity);
  return base + (index < totalPence % totalQuantity ? 1 : 0);
}

export function allocatePence(totalPence: number, totalQuantity: number) {
  return Array.from({ length: totalQuantity }, (_, index) =>
    allocatePenceAt(totalPence, totalQuantity, index),
  );
}

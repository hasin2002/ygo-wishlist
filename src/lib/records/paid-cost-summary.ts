export function paidCostSummary({
  formattedKnownTotal,
  knownCopyCount,
  unknownCopyCount,
}: {
  formattedKnownTotal: string;
  knownCopyCount: number;
  unknownCopyCount: number;
}) {
  if (unknownCopyCount > 0) {
    const unknownLabel = `${unknownCopyCount} cost${unknownCopyCount === 1 ? "" : "s"} unknown`;
    return knownCopyCount > 0
      ? `Known paid ${formattedKnownTotal} · ${unknownLabel}`
      : unknownLabel;
  }

  return knownCopyCount > 0 ? `Paid ${formattedKnownTotal}` : null;
}

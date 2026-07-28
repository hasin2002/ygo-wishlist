export type EbayOrderLinePaymentState =
  | "pending"
  | "paid"
  | "cancelled"
  | "needs_review";

export type EbayOrderLineTerminalEvidence = {
  cancelledAt: Date | null;
  paidAt: Date | null;
  paymentState: EbayOrderLinePaymentState;
  saleRecordId: string | null;
};

/**
 * A review marker is not terminal evidence by itself. It may have been added
 * because a related Copy link was missing and must be allowed to recover once
 * that relationship is repaired. Paid, recorded-Sale, and cancelled evidence
 * remain protected from a contradictory remote observation.
 */
export function hasEbayOrderLineTerminalRegression(
  existing: EbayOrderLineTerminalEvidence | null | undefined,
  incoming: Exclude<EbayOrderLinePaymentState, "needs_review">,
) {
  if (!existing) return false;
  const paidWasRecorded = (
    existing.paymentState === "paid"
    || existing.paidAt !== null
    || existing.saleRecordId !== null
  );
  const cancellationWasRecorded = (
    existing.paymentState === "cancelled"
    || existing.cancelledAt !== null
  );
  return (
    (paidWasRecorded && incoming !== "paid")
    || (cancellationWasRecorded && incoming !== "cancelled")
  );
}

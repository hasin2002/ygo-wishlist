export type EbayPaidSaleAmounts = {
  finalValueFeePence: number | null;
  itemPricePence: number | null;
  shippingChargedPence: number | null;
};

export type EbayPaidSaleProceedsSuggestion = {
  amountPence: number;
  includesReportedFee: boolean;
};

/**
 * Returns the best amount available from the legacy eBay transaction response.
 * It is deliberately only a suggestion: actual postage and other account-level
 * charges are not available from this response and must remain user-editable.
 */
export function suggestEbayPaidSaleProceeds(
  amounts: EbayPaidSaleAmounts,
): EbayPaidSaleProceedsSuggestion | null {
  if (!Number.isInteger(amounts.itemPricePence) || amounts.itemPricePence === null || amounts.itemPricePence < 0) {
    return null;
  }
  const shipping = Number.isInteger(amounts.shippingChargedPence) && amounts.shippingChargedPence !== null && amounts.shippingChargedPence >= 0
    ? amounts.shippingChargedPence
    : 0;
  const feeKnown = Number.isInteger(amounts.finalValueFeePence) && amounts.finalValueFeePence !== null && amounts.finalValueFeePence >= 0;
  const fee = feeKnown ? amounts.finalValueFeePence! : 0;
  return {
    amountPence: Math.max(0, amounts.itemPricePence + shipping - fee),
    includesReportedFee: feeKnown,
  };
}

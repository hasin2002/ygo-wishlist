export type PrintingIdentityInput = {
  canonicalTcgplayerUrl: string | null;
  normalizedSetName: string;
  normalizedSetCode: string;
};

const placeholders = new Set(["", "unknown", "unknown set", "unknown code"]);

export function normalizePrintingValue(value: string | null | undefined) {
  return (value ?? "").trim().toLocaleLowerCase("en-GB").replace(/\s+/g, " ");
}

export function canonicalTcgplayerProductUrl(value: string | null | undefined) {
  if (!value) return null;
  const url = new URL(value);
  return `${url.hostname.replace(/^www\./, "").toLowerCase()}${url.pathname.replace(/\/$/, "")}`;
}

export function hasCompleteSetIdentity(value: PrintingIdentityInput) {
  return !placeholders.has(value.normalizedSetName)
    && !placeholders.has(value.normalizedSetCode);
}

export function canonicalProductIdentity(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized || null;
}

/**
 * A matching product URL or complete set/code can identify the same Printing,
 * but contradictory non-placeholder metadata is never merged automatically.
 */
export function compatiblePrintingIdentity(
  left: PrintingIdentityInput,
  right: PrintingIdentityInput,
) {
  const leftProduct = canonicalProductIdentity(left.canonicalTcgplayerUrl);
  const rightProduct = canonicalProductIdentity(right.canonicalTcgplayerUrl);
  const sameProduct = Boolean(
    leftProduct && rightProduct && leftProduct === rightProduct,
  );
  const sameCompleteSet = hasCompleteSetIdentity(left)
    && hasCompleteSetIdentity(right)
    && left.normalizedSetName === right.normalizedSetName
    && left.normalizedSetCode === right.normalizedSetCode;
  if (!sameProduct && !sameCompleteSet) return false;

  const conflictingProduct = Boolean(
    leftProduct && rightProduct && leftProduct !== rightProduct,
  );
  const conflictingCompleteSet = hasCompleteSetIdentity(left)
    && hasCompleteSetIdentity(right)
    && (left.normalizedSetName !== right.normalizedSetName
      || left.normalizedSetCode !== right.normalizedSetCode);
  return !conflictingProduct && !conflictingCompleteSet;
}

/** A matching non-placeholder identity with incompatible facts needs review. */
export function conflictsWithPrintingIdentity(
  candidate: PrintingIdentityInput,
  requested: PrintingIdentityInput,
) {
  const candidateProduct = canonicalProductIdentity(candidate.canonicalTcgplayerUrl);
  const requestedProduct = canonicalProductIdentity(requested.canonicalTcgplayerUrl);
  const sameProduct = Boolean(candidateProduct && requestedProduct && candidateProduct === requestedProduct);
  const sameCompleteSet = hasCompleteSetIdentity(candidate)
    && hasCompleteSetIdentity(requested)
    && candidate.normalizedSetName === requested.normalizedSetName
    && candidate.normalizedSetCode === requested.normalizedSetCode;
  return (sameProduct || sameCompleteSet)
    && !compatiblePrintingIdentity(candidate, requested);
}

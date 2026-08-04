/**
 * The small, deliberately framework-free part of the linked-offer flow.
 * Keeping this here makes the stock policy usable by both the form and the
 * final transactional server check without treating a grouped row as a Copy.
 */
export type LinkedOfferCopy = {
  acquiredAt: string;
  condition: string;
  copyId: string;
  edition: string;
  printingId: string;
  unavailable?: boolean;
  wishlistProtected?: boolean;
};

export type LinkedOffer = {
  kind: "individual" | "x2" | "x3";
  quantity: number;
  state: "active" | "ended" | "unknown";
};

export type LinkedOfferAction = {
  action: "Create individual offer" | "Create x2 offer" | "Create x3 offer" | "End x2 offer" | "End x3 offer" | "Increase individual quantity" | "Increase x2 quantity" | "Increase x3 quantity" | "Reduce individual quantity" | "Reduce x2 quantity" | "Reduce x3 quantity" | "No change";
  kind: LinkedOffer["kind"];
  reason: string;
};

export function linkedOfferCompatibilityKey(copy: Pick<LinkedOfferCopy, "printingId" | "edition" | "condition">) {
  return [copy.printingId, copy.edition, copy.condition].join("\u0000");
}

const linkedOfferConditionRank = new Map([
  ["Near Mint", 0],
  ["Lightly Played", 1],
  ["Moderately Played", 2],
  ["Heavily Played", 3],
]);

/**
 * Assigns the target-wide Wishlist hold to exact Copies, best condition first.
 * Within one condition the newest Copy is retained, leaving older stock to sell first.
 */
export function protectLinkedOfferWishlistCopies(copies: LinkedOfferCopy[], wantedQuantity: number) {
  const protectedIds = new Set([...copies]
    .filter((copy) => !copy.unavailable)
    .sort((left, right) => (
      (linkedOfferConditionRank.get(left.condition) ?? Number.MAX_SAFE_INTEGER)
        - (linkedOfferConditionRank.get(right.condition) ?? Number.MAX_SAFE_INTEGER)
      || right.acquiredAt.localeCompare(left.acquiredAt)
      || right.copyId.localeCompare(left.copyId)
    ))
    .slice(0, Math.max(0, wantedQuantity))
    .map((copy) => copy.copyId));
  return copies.map((copy) => ({ ...copy, wishlistProtected: protectedIds.has(copy.copyId) }));
}

export function linkedOfferVariantAvailability(copies: LinkedOfferCopy[]) {
  const eligible = copies.filter((copy) => !copy.unavailable);
  const kept = eligible.filter((copy) => copy.wishlistProtected).length;
  return {
    kept,
    otherwiseEligible: eligible.length,
    owned: eligible.length,
    toList: Math.max(0, eligible.length - kept),
  };
}

/** Unprotected stock sells oldest first; protected stock is only added by the explicit override. */
export function selectLinkedOfferCopies(copies: LinkedOfferCopy[], quantity: number) {
  return copies
    .filter((copy) => !copy.unavailable)
    .sort((left, right) => Number(Boolean(left.wishlistProtected)) - Number(Boolean(right.wishlistProtected))
      || left.acquiredAt.localeCompare(right.acquiredAt)
      || left.copyId.localeCompare(right.copyId))
    .slice(0, Math.max(0, quantity));
}

export function linkedOfferAvailability(eligibleOwnedCount: number, targetWishlistAmount: number, unavailableCount = 0) {
  const owned = Math.max(0, eligibleOwnedCount);
  const available = Math.max(0, owned - Math.max(0, unavailableCount));
  const kept = Math.min(available, Math.max(0, targetWishlistAmount));
  return { owned, kept, toList: Math.max(0, available - kept), otherwiseEligible: available };
}

export function linkedOfferQuantities(copyCount: number) {
  const safeCount = Math.max(0, copyCount);
  const setSize = safeCount >= 3 ? 3 : safeCount >= 2 ? 2 : null;
  return {
    individual: safeCount,
    set: setSize ? { kind: setSize === 2 ? "x2" as const : "x3" as const, quantity: Math.floor(safeCount / setSize) } : null,
  };
}

/** Reuses a comparable set's per-card rate; otherwise there is no hidden discount. */
export function linkedOfferPricePrefill(
  kind: LinkedOffer["kind"],
  individualPricePence: number,
  priorSetOffers: Array<{ kind: "x2" | "x3"; pricePence: number }> = [],
) {
  const setSize = kind === "x2" ? 2 : kind === "x3" ? 3 : 1;
  if (setSize === 1) return Math.max(0, Math.round(individualPricePence));
  const prior = priorSetOffers.find((offer) => offer.pricePence > 0);
  if (!prior) return Math.max(0, Math.round(individualPricePence * setSize));
  const priorSize = prior.kind === "x2" ? 2 : 3;
  return Math.max(0, Math.round((prior.pricePence / priorSize) * setSize));
}

export function planLinkedOfferChanges(activeOffers: LinkedOffer[], copyCount: number, mode: "individual" | "linked" = "linked"): LinkedOfferAction[] {
  const desired = linkedOfferQuantities(copyCount);
  const actions: LinkedOfferAction[] = [];
  const active = (kind: LinkedOffer["kind"]) => activeOffers.find((offer) => offer.kind === kind && offer.state !== "ended");
  const individual = active("individual");
  if (!individual) actions.push({ action: "Create individual offer", kind: "individual", reason: "No active individual offer exists for this Copy pool." });
  else if (individual.quantity === desired.individual) actions.push({ action: "No change", kind: "individual", reason: "The active individual offer already matches the selected stock." });
  else actions.push({ action: individual.quantity < desired.individual ? "Increase individual quantity" : "Reduce individual quantity", kind: "individual", reason: `Selected stock changes the individual quantity to ${desired.individual}.` });
  for (const kind of ["x2", "x3"] as const) {
    const current = active(kind);
    const next = mode === "linked" && desired.set?.kind === kind ? desired.set.quantity : 0;
    if (current && !next) actions.push({ action: kind === "x2" ? "End x2 offer" : "End x3 offer", kind, reason: "This set size is not safe for the selected Copy pool." });
    else if (!current && next) actions.push({ action: kind === "x2" ? "Create x2 offer" : "Create x3 offer", kind, reason: `The selected stock safely supports ${next} set offer${next === 1 ? "" : "s"}.` });
    else if (current && current.quantity === next) actions.push({ action: "No change", kind, reason: "The active set offer already matches the selected stock." });
    else if (current && next !== current.quantity) actions.push({
      action: current.quantity < next
        ? kind === "x2" ? "Increase x2 quantity" : "Increase x3 quantity"
        : kind === "x2" ? "Reduce x2 quantity" : "Reduce x3 quantity",
      kind,
      reason: `The selected stock safely supports ${next} sets.`,
    });
  }
  return actions;
}

export type LinkedOfferOperation = {
  action: "no_change" | "create" | "update" | "end";
  desiredQuantity: number;
  kind: LinkedOffer["kind"];
  listingId: string | null;
};

/** Converts the seller-facing preview into durable server operations. */
export function linkedOfferOperations(activeOffers: Array<LinkedOffer & { listingId?: string }>, copyCount: number, mode: "individual" | "linked"): LinkedOfferOperation[] {
  const desired = linkedOfferQuantities(copyCount);
  const result: LinkedOfferOperation[] = [];
  for (const kind of ["individual", "x2", "x3"] as const) {
    const current = activeOffers.find((offer) => offer.kind === kind && offer.state !== "ended");
    const next = kind === "individual"
      ? desired.individual
      : mode === "linked" && desired.set?.kind === kind ? desired.set.quantity : 0;
    if (!current && !next) continue;
    result.push({
      action: current ? next ? current.quantity === next ? "no_change" : "update" : "end" : "create",
      desiredQuantity: next,
      kind,
      listingId: current?.listingId ?? null,
    });
  }
  return result;
}

export function linkedOfferPlanProblem(activeOffers: LinkedOffer[]) {
  const active = activeOffers.filter((offer) => offer.state !== "ended");
  if (active.filter((offer) => offer.kind === "individual").length > 1) return "Only one active individual offer may use a Copy pool.";
  if (active.filter((offer) => offer.kind === "x2" || offer.kind === "x3").length > 1) return "x2 and x3 offers cannot be active together.";
  return null;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stable(child)]));
}

/** Shared by persisted plans and remote-operation retry guards. */
export function linkedOfferFingerprint(value: unknown) { return JSON.stringify(stable(value)); }

export type LinkedOfferDraft = {
  copyIds: string[];
  listKeptCopies: boolean;
  offers: Array<{ id: string; kind: "individual" | "x2" | "x3"; publicationState: "draft" | "reviewed" | "published" | "failed" | "uncertain"; overrides?: Record<string, unknown>; review?: unknown }>;
};

export function restoreLinkedOfferDraft(draft: LinkedOfferDraft, eligibleCopyIds: string[]) {
  if (draft.copyIds.some((copyId) => !eligibleCopyIds.includes(copyId))) return { ok: false as const, message: "Selected stock changed. Review the exact Copies again before publishing." };
  return { ok: true as const, draft };
}

export function photoPolicy({ hasMatchingReusablePhotos, kind }: { hasMatchingReusablePhotos: boolean; kind: "individual" | "x2" | "x3" }) {
  if (hasMatchingReusablePhotos) return {
    mayReuse: true,
    requiresPhotos: false,
    reason: `Reuse the saved ${kind} photos for this exact Printing, edition, and condition.`,
  };
  return {
    mayReuse: false,
    requiresPhotos: true,
    reason: `Add at least one ${kind} photo for this exact Printing, edition, and condition.`,
  };
}

export function recoverLinkedOfferPublication<T extends { publicationUuid: string; state: "prepared" | "publishing" | "published" | "failed" | "uncertain" }>(operations: T[], publicationUuid: string, remoteItemId: string | null) {
  const operation = operations.find((candidate) => candidate.publicationUuid === publicationUuid);
  if (!operation) return { operation: null, retryable: false, state: "missing" as const };
  if (operation.state === "published") return { operation, retryable: false, state: "already_published" as const };
  return { operation, retryable: operation.state === "failed" || operation.state === "uncertain", state: remoteItemId ? "record_remote_success" as const : "retry_remote_call" as const };
}

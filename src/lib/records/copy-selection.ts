/**
 * The client-side contract for a collection of exact physical Copies.  Forms
 * keep the requested IDs (so a restored draft can be repaired), but every
 * summary, readiness check, photo request and final payload uses `selected`.
 */
export type CopySelectionBounds = {
  max: number;
  min: number;
};

export type CopySelectionCandidate<T> = {
  id: string;
  item: T;
  /** An unavailable Copy remains visible to a restored draft, but is not usable. */
  reason?: string | null;
};

export type CopySelectionIssue = {
  code: "blocked" | "duplicate" | "missing" | "too_many";
  copyId?: string;
  message: string;
};

export type ReconciledCopySelection<T> = {
  issues: CopySelectionIssue[];
  requestedIds: string[];
  selected: T[];
  selectedIds: string[];
  valid: boolean;
};

/** One policy used by both workflows for the snapshot's physical/eBay state. */
export function copySelectionAvailabilityReason(input: {
  copyId: string;
  exposure?: { action: { disposition: "blocked" | "review" | "sell"; reason: string } } | undefined;
  status: "available" | "sold" | "void";
}) {
  if (input.status !== "available") {
    return `Copy #${input.copyId.slice(-6)} is ${input.status === "sold" ? "already sold" : "not available"}. Remove or replace it.`;
  }
  if (!input.exposure) {
    return `Copy #${input.copyId.slice(-6)} eligibility could not be confirmed. Refresh Inventory, then remove or replace it if the warning remains.`;
  }
  if (input.exposure.action.disposition !== "sell") {
    return `Copy #${input.copyId.slice(-6)} cannot be selected: ${input.exposure.action.reason}`;
  }
  return null;
}

/** Removes just later duplicate occurrences, preserving the user's first exact selection. */
export function removeDuplicateCopySelectionId(copyIds: string[], copyId: string) {
  let kept = false;
  return copyIds.filter((id) => {
    if (id !== copyId) return true;
    if (!kept) {
      kept = true;
      return true;
    }
    return false;
  });
}

/**
 * Repoints staged lot-photo keys while retaining the exact inventory Copy/key
 * that supplied each saved photo.
 */
export function reanchorCopySelectionPhotos<
  T extends {
    archiveKey: string;
    previewUrl: string;
  },
>(
  photos: T[],
  movedPhotos: Array<{
    archiveKey: string;
    previousArchiveKey: string;
    previewUrl: string;
  }>,
) {
  const movedByKey = new Map(
    movedPhotos.map((photo) => [photo.previousArchiveKey, photo]),
  );
  if (
    movedByKey.size !== photos.length
    || photos.some((photo) => !movedByKey.has(photo.archiveKey))
  ) {
    return null;
  }
  return photos.map((photo) => {
    const moved = movedByKey.get(photo.archiveKey)!;
    return {
      ...photo,
      archiveKey: moved.archiveKey,
      previewUrl: moved.previewUrl,
    };
  });
}

export const mixedLotCopyBounds: CopySelectionBounds = { min: 2, max: 100 };

export function reconcileCopySelection<T>(
  requestedIds: string[],
  candidates: Array<CopySelectionCandidate<T>>,
  bounds: CopySelectionBounds,
): ReconciledCopySelection<T> {
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const issues: CopySelectionIssue[] = [];
  const seen = new Set<string>();
  const selected: T[] = [];
  const selectedIds: string[] = [];

  for (const copyId of requestedIds) {
    if (seen.has(copyId)) {
      issues.push({ code: "duplicate", copyId, message: `Copy #${copyId.slice(-6)} appears more than once. Remove the duplicate.` });
      continue;
    }
    seen.add(copyId);
    const candidate = byId.get(copyId);
    if (!candidate) {
      issues.push({ code: "missing", copyId, message: `Copy #${copyId.slice(-6)} is no longer in this Inventory. Remove or replace it.` });
      continue;
    }
    if (candidate.reason) {
      issues.push({ code: "blocked", copyId, message: candidate.reason });
      continue;
    }
    selected.push(candidate.item);
    selectedIds.push(copyId);
  }

  if (seen.size > bounds.max) {
    issues.push({ code: "too_many", message: `Choose no more than ${bounds.max} physical Copies.` });
  }

  return {
    issues,
    requestedIds,
    selected,
    selectedIds,
    valid: issues.length === 0 && selectedIds.length >= bounds.min && selectedIds.length <= bounds.max,
  };
}

export function filterCopySelectionCandidates<T extends {
  copy: { condition: string; id: string };
  printing: { setCode: string; setName: string };
  target: { edition: string; name: string; rarity: string };
}>(candidates: T[], options: {
  query: string;
  condition: string;
  rarity: string;
  searchTerms?: (candidate: T) => string[];
  selectedIds: string[];
  selectedOnly: boolean;
}) {
  const selected = new Set(options.selectedIds);
  const query = options.query.trim().toLowerCase();
  return candidates.filter((candidate) => {
    if (options.selectedOnly && !selected.has(candidate.copy.id)) return false;
    if (options.condition !== "all" && candidate.copy.condition !== options.condition) return false;
    if (options.rarity !== "all" && candidate.target.rarity !== options.rarity) return false;
    return !query || [
      candidate.target.name,
      candidate.target.rarity,
      candidate.target.edition,
      candidate.printing.setName,
      candidate.printing.setCode,
      candidate.copy.condition,
      candidate.copy.id,
      ...(options.searchTerms?.(candidate) ?? []),
    ].join(" ").toLowerCase().includes(query);
  });
}

export function pageCopySelection<T>(items: T[], page: number, pageSize: number) {
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const currentPage = Math.min(Math.max(1, page), pageCount);
  return {
    currentPage,
    pageCount,
    items: items.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    resultEnd: Math.min(currentPage * pageSize, items.length),
    resultStart: items.length ? (currentPage - 1) * pageSize + 1 : 0,
  };
}

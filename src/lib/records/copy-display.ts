import type { CardCopy } from "@/lib/records/types";

/** Copy ordinals are contextual: stable identity is always the complete ID. */
export function orderCopies(copies: CardCopy[]) {
  return [...copies].sort((left, right) => (
    left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
  ));
}

export function copyShortReference(copyId: string) {
  return copyId.slice(-6).toUpperCase();
}

export function copyDisplayLabel(copies: CardCopy[], copyId: string) {
  const ordered = orderCopies(copies);
  const position = ordered.findIndex((copy) => copy.id === copyId);
  return `Copy ${Math.max(0, position) + 1} of ${ordered.length}`;
}

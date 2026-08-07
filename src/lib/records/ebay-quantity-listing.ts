export type HomogeneousQuantityMember = {
  copy: {
    condition: string;
    id: string;
    printingId: string;
  };
  printing: {
    id: string;
    targetId: string;
  };
  target: {
    edition: string;
    id: string;
  };
};

export type HomogeneousQuantityIssue = {
  code: "condition" | "edition" | "printing";
  message: string;
};

export const homogeneousQuantityBounds = { min: 2, max: 100 } as const;

export type HomogeneousQuantityListingCopy = {
  condition: string;
  edition: string;
  name: string;
  quantity: number;
  rarity: string;
  setCode: string;
  setName: string;
};

function editionAbbreviation(value: string) {
  if (/^1st edition$/i.test(value)) return "1st Ed";
  if (/^unlimited edition$/i.test(value)) return "Unlimited";
  if (/^limited edition$/i.test(value)) return "Limited";
  return value;
}

function conditionAbbreviation(value: string) {
  return ({
    "Near Mint": "NM",
    "Lightly Played": "LP",
    "Moderately Played": "MP",
    "Heavily Played": "HP",
    "Damaged": "DMG",
  } as Record<string, string>)[value] ?? value;
}

export function buildHomogeneousQuantityTitle(input: HomogeneousQuantityListingCopy) {
  const prefix = "Yu-Gi-Oh!";
  const quantity = input.quantity > 1 ? `x${input.quantity}` : "";
  const suffix = [
    quantity,
    input.setCode || input.setName,
    input.rarity,
    editionAbbreviation(input.edition),
    conditionAbbreviation(input.condition),
  ].filter(Boolean).join(" ");
  const nameLength = Math.max(1, 80 - prefix.length - suffix.length - 2);
  return `${prefix} ${input.name.slice(0, nameLength).trim()} ${suffix}`.trim().slice(0, 80);
}

export function buildHomogeneousQuantityDescription(input: HomogeneousQuantityListingCopy) {
  const set = `${input.setName || "Not specified"}${input.setCode ? ` (${input.setCode})` : ""}`;
  if (input.quantity === 1) {
    return [
      `Yu-Gi-Oh! ${input.name}`,
      `Set: ${set}`,
      `Rarity: ${input.rarity}`,
      `Edition: ${input.edition}`,
      `Condition: ${input.condition}`,
      "Please review all photos carefully before buying.",
      "You are buying the card described in the title and shown in the images.",
      "Please feel free to contact me with any questions or to request additional images.",
    ].join("\n");
  }
  return [
    `Yu-Gi-Oh! ${input.name} — quantity ${input.quantity}`,
    "",
    `You will receive ${input.quantity} identical physical copies. The displayed price is per card.`,
    `Set: ${set}`,
    `Rarity: ${input.rarity}`,
    `Edition: ${input.edition}`,
    `Condition: ${input.condition} on every copy`,
    "",
    "The photos show the exact physical copies included in this quantity listing. Please review them carefully before buying.",
    "Orders are allocated from the seller's saved fulfilment order.",
    "Please feel free to contact me with any questions or to request additional images.",
  ].join("\n");
}

/**
 * Listing language and every policy field live once on the shared offer form.
 * This comparison therefore owns the Copy-specific homogeneity rules.
 */
export function homogeneousQuantityIncompatibilities(
  anchor: HomogeneousQuantityMember,
  candidate: HomogeneousQuantityMember,
): HomogeneousQuantityIssue[] {
  const issues: HomogeneousQuantityIssue[] = [];
  if (candidate.copy.printingId !== anchor.copy.printingId) {
    issues.push({
      code: "printing",
      message: "Different Card Printing. Quantity offers require the exact same printing.",
    });
  }
  if (candidate.target.edition !== anchor.target.edition) {
    issues.push({
      code: "edition",
      message: `Different edition (${candidate.target.edition || "missing"}). Quantity offers require ${anchor.target.edition || "the anchor edition"}.`,
    });
  }
  if (candidate.copy.condition !== anchor.copy.condition) {
    issues.push({
      code: "condition",
      message: `Different condition (${candidate.copy.condition || "missing"}). Quantity offers require ${anchor.copy.condition || "the anchor condition"}.`,
    });
  }
  return issues;
}

export function validateHomogeneousQuantityMembers(
  members: HomogeneousQuantityMember[],
) {
  const anchor = members[0];
  if (!anchor) return [];
  return members.slice(1).flatMap((member) =>
    homogeneousQuantityIncompatibilities(anchor, member).map((issue) => ({
      ...issue,
      copyId: member.copy.id,
    })),
  );
}

export function moveHomogeneousQuantityMember(
  copyIds: string[],
  copyId: string,
  offset: -1 | 1,
) {
  const from = copyIds.indexOf(copyId);
  const to = from + offset;
  if (from < 0 || to < 0 || to >= copyIds.length) return copyIds;
  const next = [...copyIds];
  [next[from], next[to]] = [next[to]!, next[from]!];
  return next;
}

export function ebayQuantityXmlContract(memberCount: number) {
  if (!Number.isInteger(memberCount) || memberCount < homogeneousQuantityBounds.min || memberCount > homogeneousQuantityBounds.max) {
    throw new Error(`A quantity offer requires ${homogeneousQuantityBounds.min} to ${homogeneousQuantityBounds.max} exact Copies.`);
  }
  return { quantityXml: `<Quantity>${memberCount}</Quantity>` };
}

/** Primary photo from every selected Copy first, then remaining photos in fulfilment order. */
export function planHomogeneousQuantitySavedPhotos({
  copyIds,
  existingPhotos,
  imagesByCopy,
  maxPhotos = 12,
}: {
  copyIds: string[];
  existingPhotos: Array<{
    sourceInventoryCopyId?: string;
    sourceInventoryKey?: string;
  }>;
  imagesByCopy: Record<string, Array<{ key: string; position: number }>>;
  maxPhotos?: number;
}) {
  const imported = new Set(existingPhotos.flatMap((photo) =>
    photo.sourceInventoryCopyId && photo.sourceInventoryKey
      ? [`${photo.sourceInventoryCopyId}:${photo.sourceInventoryKey}`]
      : [],
  ));
  const orderedByCopy = new Map(copyIds.map((copyId) => [
    copyId,
    [...(imagesByCopy[copyId] ?? [])].sort((left, right) => left.position - right.position),
  ]));
  const candidates = [
    ...copyIds.flatMap((copyId) => orderedByCopy.get(copyId)?.slice(0, 1).map((photo) => ({ copyId, ...photo })) ?? []),
    ...copyIds.flatMap((copyId) => orderedByCopy.get(copyId)?.slice(1).map((photo) => ({ copyId, ...photo })) ?? []),
  ];
  return candidates
    .filter((photo) => !imported.has(`${photo.copyId}:${photo.key}`))
    .slice(0, Math.max(0, maxPhotos - existingPhotos.length));
}

export type EbayLotManifestMember = {
  condition: string;
  copyId: string;
  edition: string;
  name: string;
  printing: string;
  rarity: string;
};

export function buildEbayLotDescription(members: EbayLotManifestMember[]) {
  const cardCount = members.length;
  return [
    `You will receive every physical Yu-Gi-Oh! card listed below in this one lot (${cardCount} ${cardCount === 1 ? "card" : "cards"} total).`,
    "",
    ...members.map((member, index) => `${index + 1}. ${member.name} — ${member.printing || "Printing not specified"}; ${member.rarity || "Rarity not specified"}; ${member.edition || "Edition not specified"}; ${member.condition || "Condition not specified"}; Quantity 1`),
    "",
    "Please review all photos carefully before buying.",
  ].join("\n");
}

export function buildEbayLotTitle(members: EbayLotManifestMember[]) {
  const names = [...new Set(members.map((member) => member.name).filter(Boolean))];
  const summary = names.slice(0, 2).join(" + ") || "Mixed cards";
  const suffix = `${members.length} Card Lot`;
  return `Yu-Gi-Oh! ${summary} ${suffix}`.slice(0, 80).trim();
}

export function moveEbayLotMember(copyIds: string[], copyId: string, offset: -1 | 1) {
  const from = copyIds.indexOf(copyId);
  const to = from + offset;
  if (from < 0 || to < 0 || to >= copyIds.length) return copyIds;
  const next = [...copyIds];
  [next[from], next[to]] = [next[to]!, next[from]!];
  return next;
}

export function estimateEbayLotValue(values: Array<number | null | undefined>) {
  let pricedCopyCount = 0;
  let totalPence = 0;
  let unpricedCopyCount = 0;
  for (const value of values) {
    if (value === null || value === undefined) {
      unpricedCopyCount += 1;
      continue;
    }
    pricedCopyCount += 1;
    totalPence += value;
  }
  return { pricedCopyCount, totalPence, unpricedCopyCount };
}

export type EbayLotSavedPhoto = {
  copyId: string;
  key: string;
  position: number;
};

export function planEbayLotSavedPhotoImports({
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
  const importedSources = new Set(
    existingPhotos.flatMap((photo) =>
      photo.sourceInventoryCopyId && photo.sourceInventoryKey
        ? [`${photo.sourceInventoryCopyId}:${photo.sourceInventoryKey}`]
        : [],
    ),
  );
  const slots = Math.max(0, maxPhotos - existingPhotos.length);

  return copyIds
    .flatMap((copyId) =>
      [...(imagesByCopy[copyId] ?? [])]
        .sort((left, right) => left.position - right.position)
        .map((photo): EbayLotSavedPhoto => ({
          copyId,
          key: photo.key,
          position: photo.position,
        })),
    )
    .filter(
      (photo) => !importedSources.has(`${photo.copyId}:${photo.key}`),
    )
    .slice(0, slots);
}

/** The #14-proven eBay contract for a heterogeneous card lot. */
export function ebayLotXmlContract(memberCount: number) {
  return {
    categoryId: "183455",
    categoryMappingAllowed: false,
    conditionXml: "<ConditionID>3000</ConditionID>",
    lotSizeXml: `<LotSize>${memberCount}</LotSize>`,
    quantityXml: "<Quantity>1</Quantity>",
  };
}

import type { RecordEntry, RecordsSnapshot } from "@/lib/records/types";

export type RecordImagePreview = {
  id: string;
  imageUrl: string | null;
  kind: "card" | "sealed";
  name: string;
};

export function recordImagePreviewsFor(
  record: RecordEntry,
  snapshot: RecordsSnapshot,
): RecordImagePreview[] {
  if (record.type === "pack-opening") {
    const openedProduct = snapshot.sealedUnits.find((unit) => unit.openedRecordId === record.id);

    return openedProduct
      ? [{
          id: openedProduct.id,
          imageUrl: openedProduct.imageUrl ?? null,
          kind: "sealed",
          name: openedProduct.name,
        }]
      : [];
  }

  const copiesById = new Map(snapshot.copies.map((copy) => [copy.id, copy]));
  const printingsById = new Map(snapshot.printings.map((printing) => [printing.id, printing]));
  const targetsById = new Map(snapshot.targets.map((target) => [target.id, target]));
  const seen = new Set<string>();
  const previews: RecordImagePreview[] = [];

  for (const line of record.lines) {
    if (line.kind !== "card") continue;

    const copy = line.entityIds.map((id) => copiesById.get(id)).find(Boolean);
    const printing = copy ? printingsById.get(copy.printingId) : undefined;
    const target = printing ? targetsById.get(printing.targetId) : undefined;
    const id = target?.id ?? line.id;

    if (seen.has(id)) continue;
    seen.add(id);
    previews.push({
      id,
      imageUrl: printing?.imageUrl ?? target?.imageUrl ?? null,
      kind: "card",
      name: target?.name ?? line.name,
    });

    if (previews.length === 3) break;
  }

  return previews;
}

import "server-only";

import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { cardCopies } from "@/db/schema";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class CopySelectionError extends Error {}

/**
 * Reconciles exact Copy IDs while holding their rows. Both a Sale and an eBay
 * lot call this immediately before their irreversible work.
 */
export async function lockReconciledCopies(
  tx: Transaction,
  ownerId: string,
  copyIds: string[],
  { max = 100, min = 1 }: { max?: number; min?: number } = {},
) {
  if (copyIds.length < min) throw new CopySelectionError(`Choose at least ${min} physical ${min === 1 ? "Copy" : "Copies"}.`);
  if (copyIds.length > max) throw new CopySelectionError(`Choose no more than ${max} physical Copies.`);
  if (new Set(copyIds).size !== copyIds.length) throw new CopySelectionError("Each physical Copy can appear only once.");

  const copies = await tx.select().from(cardCopies)
    .where(inArray(cardCopies.id, copyIds))
    .for("update");
  const byId = new Map(copies.map((copy) => [copy.id, copy]));
  for (const copyId of copyIds) {
    const copy = byId.get(copyId);
    if (!copy) throw new CopySelectionError(`Copy #${copyId.slice(-6)} was deleted or no longer exists.`);
    if (copy.ownerId !== ownerId) throw new CopySelectionError(`Copy #${copyId.slice(-6)} does not belong to this collection.`);
    if (copy.status !== "available" || copy.soldRecordId !== null) {
      throw new CopySelectionError(`Copy #${copyId.slice(-6)} is no longer available${copy.status === "sold" ? " because it is already sold" : ""}. Refresh and replace it.`);
    }
  }
  return copyIds.map((copyId) => byId.get(copyId)!);
}

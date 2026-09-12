import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db } from "@/db";
import { cardTargets, cardPrintings } from "@/db/schema";
import type { OwnedCardDraft } from "@/lib/records/owned-cards";
import { canonicalTcgplayerProductUrl, compatibleCataloguePrintingIdentity, compatiblePrintingIdentity, conflictsWithPrintingIdentity, normalizePrintingValue, tcgplayerProductId } from "@/server/printing-identity";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
const normalize = (value: string) => value.trim().toLocaleLowerCase("en-GB").replace(/\s+/g, " ");
const key = (name: string, rarity: string, edition: string) => JSON.stringify([normalize(name), normalize(rarity), normalize(edition)]);
const fail = (message: string): never => { throw new TRPCError({ code: "CONFLICT", message }); };

/** Resolve a whole catalogue selection with bounded database round trips, retaining exact legacy identities. */
export async function resolveCataloguePrintings(tx: Transaction, ownerId: string, cards: OwnedCardDraft[], now: Date) {
  // Scope the read to selected rarities/editions; never read another owner's identities.
  let targets = await tx.select().from(cardTargets).where(and(eq(cardTargets.ownerId, ownerId),
    inArray(cardTargets.normalizedRarity, [...new Set(cards.map((card) => normalize(card.rarity)))]),
    inArray(cardTargets.normalizedEdition, [...new Set(cards.map((card) => normalize(card.edition)))])));
  const printings = targets.length ? await tx.select().from(cardPrintings).where(and(eq(cardPrintings.ownerId, ownerId), inArray(cardPrintings.targetId, targets.map((target) => target.id)))) : [];
  const targetById = new Map(targets.map((target) => [target.id, target]));
  const existingFor = (card: OwnedCardDraft) => {
    const matches = printings.filter((printing) => {
      const target = targetById.get(printing.targetId)!;
      return target.normalizedRarity === normalize(card.rarity) && target.normalizedEdition === normalize(card.edition)
        && tcgplayerProductId(printing.canonicalTcgplayerUrl || printing.tcgplayerUrl) === String(card.productId);
    });
    if (matches.length > 1) fail(`${card.name}: this printing has duplicate records. Review them before adding copies.`);
    if (matches[0] && !compatibleCataloguePrintingIdentity({ ...matches[0], canonicalTcgplayerUrl: matches[0].canonicalTcgplayerUrl || matches[0].tcgplayerUrl }, {
      canonicalTcgplayerUrl: card.tcgplayerUrl, normalizedSetCode: normalizePrintingValue(card.setCode), normalizedSetName: normalizePrintingValue(card.setName),
    })) fail(`${card.name} (${card.setCode}): the existing set code conflicts with this catalogue printing. Review it before adding copies.`);
    return matches[0];
  };
  const targetByKey = new Map(targets.map((target) => [key(target.name, target.rarity, target.edition), target]));
  const missingTargets = new Map<string, typeof cardTargets.$inferInsert>();
  for (const card of cards) {
    const identity = key(card.name, card.rarity, card.edition);
    if (!existingFor(card) && !targetByKey.has(identity)) missingTargets.set(identity, {
      id: `target-${randomUUID()}`, ownerId, name: card.name, normalizedName: normalize(card.name),
      rarity: card.rarity, normalizedRarity: normalize(card.rarity), edition: card.edition, normalizedEdition: normalize(card.edition),
      desiredQuantity: 0, imageUrl: card.imageUrl, tcgplayerUrl: card.tcgplayerUrl, createdAt: now, updatedAt: now,
    });
  }
  if (missingTargets.size) {
    await tx.insert(cardTargets).values([...missingTargets.values()]).onConflictDoNothing();
    // Also resolves a target concurrently created by a Purchase or Library action.
    targets = await tx.select().from(cardTargets).where(and(eq(cardTargets.ownerId, ownerId),
      inArray(cardTargets.normalizedName, [...new Set(cards.map((card) => normalize(card.name)))])));
    for (const target of targets) targetByKey.set(key(target.name, target.rarity, target.edition), target);
  }
  const newPrintings: (typeof cardPrintings.$inferSelect)[] = [];
  const resolved: string[] = [];
  for (const card of cards) {
    const existing = existingFor(card);
    if (existing) { resolved.push(existing.id); continue; }
    const target = targetByKey.get(key(card.name, card.rarity, card.edition))!;
    const identity = { canonicalTcgplayerUrl: canonicalTcgplayerProductUrl(card.tcgplayerUrl), normalizedSetName: normalizePrintingValue(card.setName), normalizedSetCode: normalizePrintingValue(card.setCode) };
    const candidates = [...printings, ...newPrintings].filter((printing) => printing.targetId === target.id);
    const compatible = candidates.filter((printing) => compatiblePrintingIdentity(printing, identity));
    if (compatible.length > 1 || candidates.some((printing) => conflictsWithPrintingIdentity(printing, identity))) fail(`${card.name}: existing Printing metadata conflicts with this catalogue printing. Review it before recording a Copy.`);
    if (compatible[0]) { resolved.push(compatible[0].id!); continue; }
    const printingId = `printing-${randomUUID()}`;
    newPrintings.push({ id: printingId, ownerId, targetId: target.id, ...identity, setName: card.setName, setCode: card.setCode,
      tcgplayerUrl: card.tcgplayerUrl, imageUrl: card.imageUrl, metadataNeedsAttention: false, createdAt: now, updatedAt: now });
    resolved.push(printingId);
  }
  if (newPrintings.length) {
    const inserted = await tx.insert(cardPrintings).values(newPrintings).onConflictDoNothing().returning({ id: cardPrintings.id });
    if (inserted.length !== newPrintings.length) fail("Another save updated these printings. Your list is safe; retry to use the saved identities.");
  }
  return resolved;
}

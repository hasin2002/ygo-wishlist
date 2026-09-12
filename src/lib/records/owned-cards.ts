import { z } from "zod";
import { type RecordsSnapshot, cardConditions } from "./types.ts";

export const ownedCardVariantSchema = z.object({
  productId: z.number().int().positive(),
  edition: z.enum(["1st Edition", "Unlimited Edition", "Limited Edition"]),
  condition: z.enum(cardConditions),
  quantity: z.number().int().min(1).max(1000),
});

export const addOwnedCardsSchema = z.object({
  operationId: z.string().uuid(),
  date: z.iso.date(),
  source: z.string().trim().max(120).default(""),
  notes: z.string().trim().max(4000).default(""),
  cards: z.array(ownedCardVariantSchema).min(1).max(100),
}).refine((input) => input.cards.reduce((sum, card) => sum + card.quantity, 0) <= 1000, {
  message: "Add up to 1,000 physical copies at a time.", path: ["cards"],
});

export type OwnedCardVariant = z.infer<typeof ownedCardVariantSchema>;
export type AddOwnedCardsInput = z.infer<typeof addOwnedCardsSchema>;
export type OwnedCardProduct = {
  productId: number;
  name: string;
  imageUrl: string | null;
  tcgplayerUrl: string;
  setCode: string;
  setName: string;
  rarity: string;
};
export type OwnedCardDraft = OwnedCardVariant & OwnedCardProduct;
export type AddOwnedCardsDraft = Omit<AddOwnedCardsInput, "cards"> & { cards: OwnedCardDraft[] };

export function ownedCardVariantKey(card: OwnedCardVariant) {
  return `${card.productId}:${card.edition}:${card.condition}`;
}

/** Group presentation only: saving still creates one ID for each physical copy. */
export function collapseOwnedCards<T extends OwnedCardVariant>(cards: T[]): T[] {
  const grouped = new Map<string, T>();
  for (const card of cards) {
    const key = ownedCardVariantKey(card);
    const existing = grouped.get(key);
    grouped.set(key, existing ? { ...existing, quantity: existing.quantity + card.quantity } : { ...card });
  }
  return [...grouped.values()];
}

const ownedCardDraftSchema = ownedCardVariantSchema.extend({
  name: z.string().min(1), imageUrl: z.string().nullable(), tcgplayerUrl: z.string().url(),
  setCode: z.string().min(1), setName: z.string().min(1), rarity: z.string().min(1),
});
export const ownedCardsDraftSchema = z.object({
  operationId: z.string().uuid(), date: z.iso.date(), source: z.string().max(120),
  notes: z.string().max(4000), cards: z.array(ownedCardDraftSchema).max(100),
});

/** Returns exact physical IDs; catalogue artwork is not an inventory photo. */
export function matchingOwnedCardCopies(
  snapshot: RecordsSnapshot,
  card: OwnedCardProduct & { edition: string; condition?: string },
) {
  const normalize = (value: string) => value.trim().toLocaleLowerCase("en-GB").replace(/\s+/g, " ");
  const edition = (value: string) => normalize(value) === "unlimited" ? "unlimited edition" : normalize(value);
  const productId = (url: string | null) => {
    if (!url) return null;
    try {
      const parsed = new URL(url);
      if (!/(^|\.)tcgplayer\.com$/.test(parsed.hostname)) return null;
      return parsed.pathname.match(/\/product\/(\d+)(?:\/|$)/)?.[1] ?? null;
    } catch { return null; }
  };
  const targets = new Set(snapshot.targets.filter((target) =>
    normalize(target.rarity) === normalize(card.rarity)
    && edition(target.edition) === edition(card.edition)
  ).map((target) => target.id));
  const printings = new Set(snapshot.printings.filter((printing) => {
    if (!targets.has(printing.targetId)) return false;
    const target = snapshot.targets.find((item) => item.id === printing.targetId)!;
    const id = productId(printing.tcgplayerUrl);
    // Exact catalogue IDs handle alternate naming; a conflicting ID never matches.
    if (id) return id === String(card.productId);
    return normalize(target.name) === normalize(card.name)
      && normalize(printing.setCode) === normalize(card.setCode)
      && normalize(printing.setName) === normalize(card.setName);
  }).map((printing) => printing.id));
  const activeRecords = new Set(snapshot.records.filter((record) => record.status === "active").map((record) => record.id));
  return snapshot.copies.filter((copy) => printings.has(copy.printingId)
    && copy.status === "available" && activeRecords.has(copy.acquiredRecordId)
    && (!card.condition || normalize(copy.condition) === normalize(card.condition)));
}

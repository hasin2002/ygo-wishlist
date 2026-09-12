"use client";

import { OwnedCardSelection } from "@/components/records/owned-cards-app";
import { blankCardContents, type CardContentsDraft } from "@/components/records/card-contents-editor";
import type { OwnedCardDraft } from "@/lib/records/owned-cards";
import type { ProductEdition } from "@/lib/records/types";

type SelectionCard = OwnedCardDraft & { entryId?: string };
const productId = (row: CardContentsDraft) => row.catalogueProductId ?? Number(row.tcgplayerUrl.match(/\/product\/(\d+)/)?.[1]);

/** Preserve receipt line IDs and accounting fields while sharing the owned-card workspace. */
export function PurchaseCardSelection({ rows, onChange, single = false }: {
  rows: CardContentsDraft[];
  onChange: (rows: CardContentsDraft[]) => void;
  single?: boolean;
}) {
  const cards: SelectionCard[] = rows.filter((row) => row.name.trim()).map((row, index) => ({
    entryId: row.id, productId: productId(row) || -(index + 1), name: row.name,
    imageUrl: row.imageUrl, tcgplayerUrl: row.tcgplayerUrl, setCode: row.setCode,
    setName: row.setName, rarity: row.rarity, edition: (row.edition || "1st Edition") as ProductEdition,
    condition: row.condition ?? "Near Mint", quantity: row.quantity,
  }));
  return <OwnedCardSelection cards={cards} single={single} onChange={(next) => {
    onChange(next.map((selection: SelectionCard) => {
      const previous = rows.find((row) => selection.entryId ? row.id === selection.entryId : (
        productId(row) === selection.productId && row.edition === selection.edition && (row.condition ?? "Near Mint") === selection.condition
      ));
      return {
        ...(previous ?? blankCardContents()),
        catalogueProductId: selection.entryId ? previous?.catalogueProductId : selection.productId,
        name: selection.name, imageUrl: selection.imageUrl, tcgplayerUrl: selection.tcgplayerUrl,
        setCode: selection.setCode, setName: selection.setName, rarity: selection.rarity,
        edition: selection.edition, condition: selection.condition, quantity: selection.quantity,
        pricing: previous?.edition === selection.edition && (previous.condition ?? "Near Mint") === selection.condition && previous.name === selection.name ? previous.pricing : undefined,
        ...(!selection.entryId ? { fetchStatus: "resolved" as const, fetchAttempted: true, fetchMessage: "Selected from the card catalogue.", metadataNeedsAttention: false } : {}),
      };
    }));
  }} />;
}

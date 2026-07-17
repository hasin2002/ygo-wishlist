"use client";

import { Check, CirclePlus, Pencil, Trash2 } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import {
  blankProductIdentity,
  isTcgplayerProductUrl,
  ProductIdentityEditor,
  type ProductIdentityDraft,
} from "@/components/records/product-identity-editor";

const fieldClass = "mt-1 h-11 w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 text-base outline-none transition focus:border-[#8a1f2d] focus:bg-white focus:ring-2 focus:ring-[#8a1f2d]/10 sm:text-sm";

export type CardContentsDraft = ProductIdentityDraft & {
  id: string;
  quantity: number;
};

export function blankCardContents(name = ""): CardContentsDraft {
  return {
    id: `card-${crypto.randomUUID()}`,
    quantity: 1,
    ...blankProductIdentity(name),
  };
}

export function cardContentsError(row: CardContentsDraft) {
  if (!isTcgplayerProductUrl(row.tcgplayerUrl)) return "Add a complete TCGplayer product link.";
  if (!row.fetchAttempted) return "Fetch the card details at least once.";
  if (row.fetchStatus === "stale") return "The TCGplayer link changed. Fetch the card details again.";
  if (row.fetchStatus === "fetching") return "Wait for the card details to finish fetching.";
  if (!row.name.trim()) return "Add the card name.";
  if (!row.rarity.trim()) return "Choose the card rarity.";
  if (!Number.isInteger(row.quantity) || row.quantity < 1) return "Quantity must be at least one.";
  return null;
}

export function CardContentsEditor({
  noun = "card",
  onChange,
  rows,
}: {
  noun?: "card" | "pulled card";
  onChange: (rows: CardContentsDraft[]) => void;
  rows: CardContentsDraft[];
}) {
  const [activeId, setActiveId] = useState<string | null>(() => rows.find((row) => !row.name)?.id ?? null);
  const [error, setError] = useState<string | null>(null);
  const active = rows.find((row) => row.id === activeId) ?? null;
  const copyCount = rows.reduce((sum, row) => sum + Math.max(0, row.quantity || 0), 0);

  function update(id: string, change: Partial<CardContentsDraft>) {
    onChange(rows.map((row) => row.id === id ? { ...row, ...change } : row));
  }

  function finishCard() {
    if (!active) return true;
    const problem = cardContentsError(active);
    if (problem) {
      setError(problem);
      return false;
    }
    setError(null);
    setActiveId(null);
    return true;
  }

  function addCard() {
    if (!finishCard()) return;
    const row = blankCardContents();
    onChange([...rows, row]);
    setActiveId(row.id);
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-col gap-1 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
        <strong>{rows.length} {rows.length === 1 ? "card type" : "card types"}</strong>
        <span className="text-sm font-medium text-zinc-500">{copyCount} physical {copyCount === 1 ? "copy" : "copies"}</span>
      </div>

      {rows.map((row, index) => row.id === activeId ? (
        <article className="records-step-enter rounded-lg border border-[#8a1f2d]/40 bg-white p-4 shadow-sm" key={row.id}>
          <div className="mb-4 flex items-center justify-between gap-3">
            <div><p className="text-xs font-black uppercase tracking-[0.12em] text-[#8a1f2d]">{noun} {index + 1}</p><p className="mt-1 text-sm font-medium text-zinc-500">Fetch, check, then collapse this card.</p></div>
            {rows.length > 1 ? (
              <button
                aria-label={`Remove ${noun} ${index + 1}`}
                className="inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-bold text-zinc-500 hover:bg-rose-50 hover:text-rose-700"
                onClick={() => {
                  onChange(rows.filter((item) => item.id !== row.id));
                  setActiveId(null);
                  setError(null);
                }}
                type="button"
              >
                <Trash2 className="size-4" /> Remove
              </button>
            ) : null}
          </div>
          <ProductIdentityEditor kind="card" onChange={(identity) => update(row.id, identity)} value={row} />
          <label className="mt-4 block sm:max-w-52">
            <span className="text-sm font-bold text-zinc-700">Quantity <span className="text-rose-700">*</span></span>
            <input className={fieldClass} min="1" onChange={(event) => update(row.id, { quantity: Number(event.target.value) })} required type="number" value={row.quantity} />
          </label>
          {error ? <p className="mt-3 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-800" role="alert">{error}</p> : null}
          <button className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 text-sm font-bold text-white sm:w-auto" onClick={finishCard} type="button"><Check className="size-4" /> Done with this card</button>
        </article>
      ) : (
        <article className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between" key={row.id}>
          <div className="flex min-w-0 items-center gap-3">
            {row.imageUrl ? (
              <Image alt="" className="size-14 shrink-0 rounded-md object-contain" height={56} src={`/api/image-proxy?url=${encodeURIComponent(row.imageUrl)}`} unoptimized width={56} />
            ) : <span className="grid size-14 shrink-0 place-items-center rounded-md bg-zinc-100 text-xs font-bold text-zinc-400">CARD</span>}
            <div className="min-w-0"><p className="font-bold text-zinc-950">{row.name || `Unnamed ${noun}`}</p><p className="mt-1 text-sm font-medium text-zinc-500">{row.rarity || "Rarity missing"} · Quantity {row.quantity}</p></div>
          </div>
          <div className="flex gap-2">
            <button className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-md border border-zinc-300 px-3 text-sm font-bold text-zinc-700 sm:flex-none" onClick={() => { setActiveId(row.id); setError(null); }} type="button"><Pencil className="size-4" /> Edit</button>
            {rows.length > 1 ? <button aria-label={`Remove ${noun} ${index + 1}`} className="grid size-11 place-items-center rounded-md border border-zinc-300 text-zinc-500 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700" onClick={() => onChange(rows.filter((item) => item.id !== row.id))} type="button"><Trash2 className="size-4" /></button> : null}
          </div>
        </article>
      ))}

      {!active ? (
        <button className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-dashed border-zinc-300 bg-white px-4 text-sm font-bold hover:border-zinc-950" onClick={addCard} type="button"><CirclePlus className="size-4" /> Add another card</button>
      ) : null}
    </div>
  );
}

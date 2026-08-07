"use client";

import { Check, CirclePlus, Pencil, Trash2 } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import {
  DestructiveToast,
  selectNumberOnFocus,
} from "@/components/records/entry-form-ui";
import {
  blankProductIdentity,
  isTcgplayerProductUrl,
  ProductIdentityEditor,
  type ProductIdentityDraft,
} from "@/components/records/product-identity-editor";
import {
  cardConditionOptions,
  isCardCondition,
  type CardCondition,
} from "@/lib/records/types";

const fieldClass = "mt-1 h-11 w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 text-base outline-none transition focus:border-[#8a1f2d] focus:bg-white focus:ring-2 focus:ring-[#8a1f2d]/10 sm:text-sm";

export type CardContentsDraft = ProductIdentityDraft & {
  condition?: CardCondition;
  id: string;
  pricing?: CardPricingDraft;
  quantity: number;
};

export type CardPricingDraft = {
  ebaySearchUrl: string;
  estimatedPricePence: number | null;
  identityKey: string;
  message: string;
  sampleSize: number;
  status: "checking" | "estimated" | "no-match" | "failed";
};

export function blankCardContents(name = ""): CardContentsDraft {
  return {
    id: `card-${crypto.randomUUID()}`,
    condition: "Near Mint",
    quantity: 1,
    ...blankProductIdentity(name, "1st Edition"),
  };
}

// A blank row is created as soon as someone starts adding another card. It is
// safe to discard only while it still exactly matches that untouched state.
// Any edit, fetch attempt, or quantity change means the row must be completed.
export function isUntouchedNewCardContents(row: CardContentsDraft) {
  return row.id.startsWith("card-")
    && row.quantity === 1
    && (row.condition ?? "Near Mint") === "Near Mint"
    && row.selectedTargetId === null
    && !row.tcgplayerUrl
    && !row.name
    && row.imageUrl === null
    && row.edition === "1st Edition"
    && !row.rarity
    && !row.setName
    && !row.setCode
    && !row.cardType
    && row.fetchStatus === "idle"
    && !row.fetchAttempted
    && !row.fetchMessage
    && !row.metadataNeedsAttention
    && !row.pricing
    && !row.editedFields.length;
}

export function cardContentsError(row: CardContentsDraft) {
  if (!isTcgplayerProductUrl(row.tcgplayerUrl)) return "Add a complete TCGplayer product link.";
  if (!row.fetchAttempted) return "Fetch the card details at least once.";
  if (row.fetchStatus === "stale") return "The TCGplayer link changed. Fetch the card details again.";
  if (row.fetchStatus === "fetching") return "Wait for the card details to finish fetching.";
  if (!row.name.trim()) return "Add the card name.";
  if (!row.edition) return "Choose the card edition.";
  if (!row.rarity.trim()) return "Choose the card rarity.";
  if (row.condition !== undefined && !isCardCondition(row.condition)) return "Choose a supported card condition.";
  if (!Number.isInteger(row.quantity) || row.quantity < 1) return "Quantity must be at least one.";
  return null;
}

export function CardContentsEditor({
  allowAdd = true,
  allowExistingIncomplete = false,
  allowRemoveLast = false,
  initialActiveId = null,
  noun = "card",
  onChange,
  onFinishCard,
  rows,
  showCondition = true,
}: {
  allowAdd?: boolean;
  allowExistingIncomplete?: boolean;
  allowRemoveLast?: boolean;
  initialActiveId?: string | null;
  noun?: "card" | "pulled card";
  onChange: (rows: CardContentsDraft[]) => void;
  onFinishCard?: (card: CardContentsDraft) => void;
  rows: CardContentsDraft[];
  showCondition?: boolean;
}) {
  const [activeId, setActiveId] = useState<string | null>(() => (
    rows.some((row) => row.id === initialActiveId)
      ? initialActiveId
      : rows.find((row) => !row.name)?.id ?? null
  ));
  const [error, setError] = useState<string | null>(null);
  const active = rows.find((row) => row.id === activeId) ?? null;
  const copyCount = rows.reduce((sum, row) => sum + Math.max(0, row.quantity || 0), 0);

  function update(id: string, change: Partial<CardContentsDraft>) {
    onChange(rows.map((row) => row.id === id ? { ...row, ...change } : row));
  }

  function finishCard() {
    if (!active) return true;
    const isExistingRow = !active.id.startsWith("card-");
    const problem = allowExistingIncomplete && isExistingRow
      ? (!active.name.trim()
          ? "Add the card name."
          : !active.edition
            ? "Choose the card edition."
            : !active.rarity.trim()
              ? "Choose the card rarity."
              : !Number.isInteger(active.quantity) || active.quantity < 1
                ? "Quantity must be at least one."
                : null)
      : cardContentsError(active);
    if (problem) {
      setError(problem);
      return false;
    }
    setError(null);
    setActiveId(null);
    return true;
  }

  function startAnotherCard() {
    const row = blankCardContents();
    // A newly added card is the immediate next task. Put it above completed
    // cards so its form opens directly below the add action rather than at the
    // bottom of a long Bulk or Pack Opening list.
    onChange([row, ...rows]);
    setActiveId(row.id);
  }

  function addCard() {
    if (!finishCard()) return;
    startAnotherCard();
  }

  function finishAndAddCard() {
    const completed = active;
    if (!finishCard()) return;
    startAnotherCard();
    if (completed) onFinishCard?.(completed);
  }

  return (
    <div className="grid gap-2.5">
      <DestructiveToast message={error} onDismiss={() => setError(null)} />
      <div className="flex flex-col gap-0.5 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
        <strong>{rows.length} {rows.length === 1 ? "card type" : "card types"}</strong>
        <span className="text-sm font-medium text-zinc-500">{copyCount} physical {copyCount === 1 ? "copy" : "copies"}</span>
      </div>

      {!active && allowAdd ? (
        <button className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-dashed border-zinc-300 bg-white px-4 text-sm font-bold hover:border-zinc-950" onClick={addCard} type="button"><CirclePlus className="size-4" /> Add another card</button>
      ) : null}

      {rows.map((row, index) => row.id === activeId ? (
        <article className="records-step-enter rounded-lg border border-[#8a1f2d]/40 bg-white shadow-sm" key={row.id}>
          <div className="sticky top-2 z-10 mb-3 flex flex-wrap items-center justify-between gap-2 rounded-t-lg border-b border-zinc-200 bg-white/95 px-3 py-2 shadow-sm backdrop-blur-sm">
            <div><p className="text-xs font-black uppercase tracking-[0.12em] text-[#8a1f2d]">{noun} {index + 1}</p><p className="text-xs font-medium text-zinc-500">Fetch, check, then finish.</p></div>
            <div className="flex flex-wrap items-center gap-2">
              <button className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 text-sm font-bold text-white transition hover:bg-zinc-800 focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2" onClick={finishAndAddCard} type="button"><Check className="size-4" /> Done &amp; add next</button>
              {rows.length > 1 || allowRemoveLast ? (
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
          </div>
          <div className="px-3 pb-3">
            <ProductIdentityEditor
              cardNameFields={(
                <div className={`grid gap-3 ${showCondition ? "grid-cols-[minmax(0,1.4fr)_minmax(7rem,0.6fr)]" : "sm:ml-auto sm:w-32"}`}>
                  {showCondition ? <label>
                    <span className="text-sm font-bold text-zinc-700">Condition <span className="text-rose-700">*</span></span>
                    <select className={fieldClass} onChange={(event) => update(row.id, { condition: event.target.value as CardCondition })} required value={row.condition ?? "Near Mint"}>
                      {cardConditionOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </label> : null}
                  <label>
                    <span className="text-sm font-bold text-zinc-700">Quantity <span className="text-rose-700">*</span></span>
                    <input className={fieldClass} min="1" onChange={(event) => update(row.id, { quantity: Number(event.target.value) })} onFocus={selectNumberOnFocus} required type="number" value={row.quantity} />
                  </label>
                </div>
              )}
              compact
              kind="card"
              onChange={(identity) => {
                const pricingIdentityChanged = identity.selectedTargetId !== row.selectedTargetId
                  || identity.name !== row.name
                  || identity.rarity !== row.rarity
                  || identity.edition !== row.edition;
                update(row.id, pricingIdentityChanged
                  ? { ...identity, pricing: undefined }
                  : identity);
              }}
              value={row}
            />
          </div>
        </article>
      ) : (
        <article className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-2.5 sm:flex-row sm:items-center sm:justify-between" key={row.id}>
          <div className="flex min-w-0 items-center gap-3">
            {row.imageUrl ? (
              <Image alt="" className="size-12 shrink-0 rounded-md object-contain" height={48} src={`/api/image-proxy?url=${encodeURIComponent(row.imageUrl)}`} unoptimized width={48} />
            ) : <span className="grid size-12 shrink-0 place-items-center rounded-md bg-zinc-100 text-[10px] font-bold text-zinc-400">CARD</span>}
            <div className="min-w-0"><p className="font-bold leading-5 text-zinc-950">{row.name || `Unnamed ${noun}`}</p><p className="mt-0.5 text-sm font-medium leading-5 text-zinc-500">{row.setCode || row.edition || "Printing missing"} · {row.rarity || "Rarity missing"}{showCondition ? ` · ${row.condition ?? "Near Mint"}` : ""} · Qty {row.quantity}</p>{row.pricing ? <p className={`mt-1 text-xs font-bold ${row.pricing.status === "failed" ? "text-rose-700" : row.pricing.status === "estimated" ? "text-emerald-700" : "text-zinc-500"}`}>{row.pricing.message}</p> : null}</div>
          </div>
          <div className="flex gap-2">
            <button className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-md border border-zinc-300 px-3 text-sm font-bold text-zinc-700 sm:flex-none" onClick={() => { setActiveId(row.id); setError(null); }} type="button"><Pencil className="size-4" /> Edit</button>
            {rows.length > 1 || allowRemoveLast ? <button aria-label={`Remove ${noun} ${index + 1}`} className="grid size-11 place-items-center rounded-md border border-zinc-300 text-zinc-500 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700" onClick={() => onChange(rows.filter((item) => item.id !== row.id))} type="button"><Trash2 className="size-4" /></button> : null}
          </div>
        </article>
      ))}
    </div>
  );
}

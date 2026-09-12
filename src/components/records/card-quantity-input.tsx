"use client";

import { Minus, Plus } from "lucide-react";

export function CardQuantityInput({ value, onChange }: { value: number; onChange: (quantity: number) => void }) {
  return <div role="group" aria-label="Quantity" className="mt-1 inline-flex h-11 overflow-hidden rounded-md border border-zinc-300 bg-white">
    <button type="button" aria-label="Decrease quantity" disabled={value <= 1} className="grid w-11 place-items-center hover:bg-zinc-100 disabled:opacity-30" onClick={() => onChange(value - 1)}><Minus className="size-4" /></button>
    <input aria-label="Quantity" className="w-12 min-w-0 border-x border-zinc-200 bg-transparent text-center text-sm font-bold [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" type="number" inputMode="numeric" min={1} required value={value} onFocus={(event) => event.target.select()} onChange={(event) => { const quantity = Number(event.target.value); if (Number.isSafeInteger(quantity) && quantity >= 1) onChange(quantity); }} />
    <button type="button" aria-label="Increase quantity" className="grid w-11 place-items-center hover:bg-zinc-100" onClick={() => onChange(value + 1)}><Plus className="size-4" /></button>
  </div>;
}

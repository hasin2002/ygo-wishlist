"use client";

import { Info, X } from "lucide-react";
import { useState } from "react";
import { rarityAbbreviations } from "@/lib/rarity-abbreviations";

export function RarityGuidePopover() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <span className="relative z-30 inline-flex">
      <button
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-label="View rarity abbreviation guide"
        className="inline-flex size-9 items-center justify-center rounded-md border border-amber-200 bg-amber-50 text-amber-700 shadow-[0_1px_0_rgba(0,0,0,0.03)] transition hover:border-amber-300 hover:bg-amber-100 hover:text-amber-800 focus-visible:bg-amber-100"
        onClick={() => setIsOpen((open) => !open)}
        title="Rarity abbreviation guide"
        type="button"
      >
        <Info aria-hidden="true" className="size-3.5" />
      </button>

      {isOpen ? (
        <>
          <button
            aria-label="Close rarity guide"
            className="fixed inset-0 z-40 cursor-default bg-black/20 sm:bg-transparent"
            onClick={() => setIsOpen(false)}
            type="button"
          />
          <section
            aria-label="Rarity abbreviation guide"
            className="absolute right-0 top-full z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-zinc-200 bg-white p-3 text-left shadow-xl ring-1 ring-black/5 max-sm:fixed max-sm:inset-x-4 max-sm:top-16 max-sm:mt-0 max-sm:w-auto"
            role="dialog"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-[10px] font-black uppercase tracking-[0.16em] text-[#8a1f2d]">
                Rarity guide
              </span>
              <button
                aria-label="Close rarity guide"
                className="grid size-8 place-items-center rounded-md text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-950"
                onClick={() => setIsOpen(false)}
                type="button"
              >
                <X aria-hidden="true" className="size-4" />
              </button>
            </div>
            <div className="mt-2 grid max-h-[min(72dvh,22rem)] grid-cols-1 gap-1 overflow-y-auto pr-1 sm:grid-cols-2">
              {rarityAbbreviations.map((entry) => (
                <div
                  className="flex min-w-0 items-center gap-2 rounded border border-zinc-100 bg-zinc-50 px-2 py-1"
                  key={entry.rarity}
                >
                  <span className="min-w-12 rounded bg-zinc-950 px-1.5 py-1 text-center text-[10px] font-black uppercase tracking-[0.08em] text-white">
                    {entry.abbreviation}
                  </span>
                  <span className="min-w-0 truncate text-xs font-semibold text-zinc-700">
                    {entry.rarity}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </>
      ) : null}
    </span>
  );
}

"use client";

import { Info, X } from "lucide-react";
import { useCallback, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useViewportOverlay } from "@/components/use-viewport-overlay";
import { rarityAbbreviations } from "@/lib/rarity-abbreviations";

export function RarityGuidePopover() {
  const [isOpen, setIsOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  const close = useCallback(() => setIsOpen(false), []);
  const dialogRef = useViewportOverlay<HTMLElement>({
    initialFocusRef: closeButtonRef,
    isOpen,
    onClose: close,
    triggerRef,
  });

  return (
    <>
      <button
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-label="View rarity abbreviation guide"
        className="inline-flex size-11 items-center justify-center rounded-md border border-amber-200 bg-amber-50 text-amber-700 shadow-[0_1px_0_rgba(0,0,0,0.03)] transition hover:border-amber-300 hover:bg-amber-100 hover:text-amber-800 focus-visible:bg-amber-100"
        onClick={() => setIsOpen((open) => !open)}
        ref={triggerRef}
        title="Rarity abbreviation guide"
        type="button"
      >
        <Info aria-hidden="true" className="size-4" />
      </button>

      {isOpen && typeof document !== "undefined" ? createPortal(
        <div
          aria-labelledby={titleId}
          aria-modal="true"
          className="fixed inset-0 z-[70] grid place-items-center bg-zinc-950/35 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) close();
          }}
          role="dialog"
        >
          <section
            className="flex max-h-[min(88dvh,34rem)] w-full max-w-80 flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white p-3 text-left shadow-xl ring-1 ring-black/5"
            ref={dialogRef}
          >
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-[10px] font-black uppercase tracking-[0.16em] text-[#8a1f2d]" id={titleId}>
                Rarity guide
              </h2>
              <button
                aria-label="Close rarity guide"
                className="grid size-11 place-items-center rounded-md text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-950"
                onClick={close}
                ref={closeButtonRef}
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
        </div>,
        document.body,
      ) : null}
    </>
  );
}

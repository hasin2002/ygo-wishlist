"use client";

import { Info } from "lucide-react";
import { useId } from "react";

type CardNoteIndicatorProps = {
  align?: "left" | "right";
  label?: string;
  note: string | null | undefined;
};

export function CardNoteIndicator({
  align = "left",
  label = "View card note",
  note,
}: CardNoteIndicatorProps) {
  const tooltipId = useId();
  const cleanNote = note?.trim();

  if (!cleanNote) {
    return null;
  }

  return (
    <span
      className="group/note relative z-20 inline-flex"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        aria-describedby={tooltipId}
        aria-label={label}
        className="inline-flex size-8 items-center justify-center rounded-md border border-amber-200 bg-amber-50 text-amber-700 shadow-[0_1px_0_rgba(0,0,0,0.03)] transition hover:border-amber-300 hover:bg-amber-100 hover:text-amber-800 focus-visible:bg-amber-100"
        title="View note"
        type="button"
      >
        <Info className="size-3.5" aria-hidden="true" />
      </button>
      <span
        className={`pointer-events-none absolute bottom-full mb-2 w-64 max-w-[min(16rem,calc(100vw-2rem))] rounded-lg border border-zinc-200 bg-white p-3 text-left text-xs leading-5 text-zinc-700 opacity-0 shadow-xl ring-1 ring-black/5 transition duration-150 group-hover/note:pointer-events-auto group-hover/note:translate-y-0 group-hover/note:opacity-100 group-focus-within/note:pointer-events-auto group-focus-within/note:translate-y-0 group-focus-within/note:opacity-100 ${
          align === "right"
            ? "right-0 translate-y-1"
            : "left-0 translate-y-1"
        }`}
        id={tooltipId}
        role="tooltip"
      >
        <span className="block text-[10px] font-black uppercase tracking-[0.16em] text-[#8a1f2d]">
          Note
        </span>
        <span className="mt-1 block max-h-36 overflow-y-auto whitespace-pre-wrap font-semibold">
          {cleanNote}
        </span>
      </span>
    </span>
  );
}

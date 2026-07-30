"use client";

import { Info, type LucideIcon } from "lucide-react";
import { useId } from "react";

/**
 * A deterministic unavailable action with an always-reachable explanation.
 * The action itself cannot run; the adjacent 44px information control works
 * with pointer, keyboard, touch and screen readers.
 */
export function UnavailableAction({
  icon: Icon,
  label,
  reason,
}: {
  icon: LucideIcon;
  label: string;
  reason: string;
}) {
  const reasonId = useId();

  return (
    <div className="group relative min-w-0 w-full sm:w-auto">
      <button
        aria-describedby={reasonId}
        className="inline-flex min-h-11 w-full cursor-not-allowed items-center justify-center gap-2 rounded-md border border-zinc-300 bg-zinc-100 px-3 pr-12 text-sm font-bold text-zinc-500 disabled:opacity-100 sm:w-auto"
        disabled
        type="button"
      >
        <Icon aria-hidden="true" className="size-4" />
        {label}
      </button>
      <button
        aria-describedby={reasonId}
        aria-label={`Why ${label} is unavailable`}
        className="absolute right-0 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-md text-zinc-500 transition hover:bg-zinc-200 hover:text-zinc-700 focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-offset-2"
        title={reason}
        type="button"
      >
        <Info aria-hidden="true" className="size-4" />
      </button>
      <span
        className="pointer-events-none absolute right-0 top-full z-20 mt-2 w-72 rounded-md border border-zinc-300 bg-zinc-950 px-3 py-2 text-xs font-semibold leading-5 text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
        id={reasonId}
        role="tooltip"
      >
        {reason}
      </span>
    </div>
  );
}

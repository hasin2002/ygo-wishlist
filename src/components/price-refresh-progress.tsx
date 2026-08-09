"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { ProgressBar } from "@/components/records/entry-form-ui";
import { useClientReady } from "@/lib/use-client-ready";

export function PriceRefreshProgress({
  batchSize,
  completed,
  failed,
  noMatch = 0,
  onDismiss,
  refreshed,
  running,
  total,
}: {
  batchSize: number;
  completed: number;
  failed: number;
  noMatch?: number;
  onDismiss: () => void;
  refreshed: number;
  running: boolean;
  total: number;
}) {
  const clientReady = useClientReady();
  const [minimized, setMinimized] = useState(true);
  const runningTitle = "Refreshing UK eBay estimates";
  const completeTitle = "Estimate refresh complete";

  if (!clientReady) return null;

  return createPortal(
    <aside
      aria-label="Price refresh progress"
      className={`fixed bottom-4 right-4 z-40 border border-zinc-300 bg-white shadow-xl ${
        minimized
          ? "max-w-[calc(100vw-2rem)] rounded-full p-1"
          : "w-[min(24rem,calc(100vw-2rem))] rounded-lg p-4"
      }`}
    >
      {minimized ? (
        <button
          aria-expanded="false"
          aria-label="Expand price refresh progress"
          className="flex min-h-11 max-w-full items-center gap-3 rounded-full px-3 text-left transition hover:bg-zinc-50 focus-visible:ring-2 focus-visible:ring-[#8a1f2d]"
          onClick={() => setMinimized(false)}
          type="button"
        >
          <span className="truncate text-sm font-bold text-zinc-900">{running ? "Refreshing prices" : "Pricing complete"}</span>
          <span className="shrink-0 text-sm font-black tabular-nums text-[#8a1f2d]">{completed}/{total}</span>
          <span aria-hidden="true" className="shrink-0 text-zinc-400">⌃</span>
        </button>
      ) : (
        <>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-black text-zinc-950">{running ? runningTitle : completeTitle}</p>
              <p className="mt-1 text-sm font-medium text-zinc-600">{completed} of {total} price checks complete</p>
            </div>
            <button
              aria-label="Minimise price refresh progress"
              className="grid size-10 place-items-center rounded-md border border-zinc-300 text-sm font-black text-zinc-600 transition hover:border-zinc-950 hover:text-zinc-950"
              onClick={() => setMinimized(true)}
              type="button"
            >
              −
            </button>
          </div>
          <div className="mt-3">
            <ProgressBar
              label="Price refresh progress"
              max={total}
              value={completed}
              valueText={`${completed} of ${total} price checks complete; ${refreshed} prices refreshed`}
            />
          </div>
          <p className="mt-3 text-xs font-semibold leading-5 text-zinc-600">
            {refreshed} prices refreshed{noMatch ? ` · ${noMatch} no usable listing` : ""} · {failed} failed
          </p>
          <p className="mt-1 text-xs font-medium text-zinc-500">
            Calculating prices for {batchSize} cards at a time.
          </p>
          {!running ? (
            <button
              className="mt-3 min-h-11 rounded-md border border-zinc-300 px-3 text-sm font-bold text-zinc-700 transition hover:border-zinc-950 hover:text-zinc-950"
              onClick={onDismiss}
              type="button"
            >
              Dismiss
            </button>
          ) : null}
        </>
      )}
    </aside>,
    document.body,
  );
}

"use client";

import { RefreshCcw } from "lucide-react";

export function DataLoadError({
  className = "",
  message = "Please try again in a moment. If it keeps happening, come back shortly.",
  onRetry,
  title = "Could not load data",
}: {
  className?: string;
  message?: string;
  onRetry: () => void;
  title?: string;
}) {
  return (
    <div
      className={`grid min-h-40 place-items-center rounded-lg border border-rose-200 bg-rose-50 px-5 py-6 text-center ${className}`}
    >
      <div>
        <p className="text-base font-bold text-rose-950">{title}</p>
        <p className="mt-2 max-w-sm text-sm font-medium leading-6 text-rose-800">
          {message}
        </p>
        <button
          className="mt-4 inline-flex h-10 items-center gap-2 rounded-md border border-rose-200 bg-white px-3 text-sm font-bold text-rose-900 shadow-sm transition hover:border-rose-900"
          onClick={onRetry}
          type="button"
        >
          <RefreshCcw className="size-4" />
          Try again
        </button>
      </div>
    </div>
  );
}

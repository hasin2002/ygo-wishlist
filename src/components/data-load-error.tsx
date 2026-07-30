"use client";

import { RefreshCcw } from "lucide-react";
import { useRef, useState } from "react";

export function DataLoadError({
  className = "",
  message = "Please try again in a moment. If it keeps happening, come back shortly.",
  onRetry,
  title = "Could not load data",
}: {
  className?: string;
  message?: string;
  onRetry: () => void | Promise<unknown>;
  title?: string;
}) {
  const [retrying, setRetrying] = useState(false);
  const retryingRef = useRef(false);
  async function retry() {
    if (retryingRef.current) return;
    retryingRef.current = true;
    setRetrying(true);
    try {
      await onRetry();
    } catch {
      // The caller's query remains in its error state and keeps this recovery UI visible.
    } finally {
      retryingRef.current = false;
      setRetrying(false);
    }
  }
  return (
    <div
      className={`grid min-h-40 place-items-center rounded-lg border border-rose-200 bg-rose-50 px-5 py-6 text-center ${className}`}
      role="alert"
    >
      <div>
        <p className="text-base font-bold text-rose-950">{title}</p>
        <p className="mt-2 max-w-sm text-sm font-medium leading-6 text-rose-800">
          {message}
        </p>
        <button
          className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-md border border-rose-200 bg-white px-3 text-sm font-bold text-rose-900 shadow-sm transition hover:border-rose-900"
          aria-busy={retrying}
          disabled={retrying}
          onClick={() => void retry()}
          type="button"
        >
          <RefreshCcw className="size-4" />
          {retrying ? "Retrying…" : "Try again"}
        </button>
      </div>
    </div>
  );
}

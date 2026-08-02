"use client";

import { RotateCcw, X } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { FormDraftIntent } from "@/lib/records/form-draft-lifecycle";

export type DraftConflictCardSummary = {
  additionalCopies?: number;
  condition: string;
  identifier: string;
  imageUrl: string | null;
  name: string;
  rarity: string;
};

function DraftConflictWorkSummary({
  fallback,
  item,
  label,
}: {
  fallback: string;
  item?: DraftConflictCardSummary;
  label: string;
}) {
  return (
    <article className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
      <div className="relative aspect-[59/86] w-14 overflow-hidden rounded-md border border-zinc-200 bg-white">
        {item?.imageUrl ? (
          <Image
            alt={`${item.name} card`}
            className="object-contain p-1"
            fill
            sizes="56px"
            src={item.imageUrl}
            unoptimized
          />
        ) : (
          <span aria-hidden="true" className="grid h-full place-items-center text-[10px] font-black text-zinc-400">CARD</span>
        )}
      </div>
      <div className="min-w-0 self-center">
        <p className="text-[11px] font-black uppercase tracking-[0.12em] text-zinc-500">{label}</p>
        <p className="mt-0.5 line-clamp-2 text-sm font-black leading-5 text-zinc-950">{item?.name ?? fallback}</p>
        {item ? (
          <>
            <p className="mt-1 text-xs font-semibold text-zinc-600">{item.rarity} · {item.condition}</p>
            <p className="mt-1 truncate text-xs font-bold text-zinc-800" title={item.identifier}>{item.identifier}</p>
            {item.additionalCopies ? <p className="mt-1 text-xs font-semibold text-zinc-500">+{item.additionalCopies} more {item.additionalCopies === 1 ? "Copy" : "Copies"} in this draft</p> : null}
          </>
        ) : null}
      </div>
    </article>
  );
}

export function FormDraftStatus({
  dirty,
  onDiscard,
  recoveryMessage,
  restored,
}: {
  dirty: boolean;
  onDiscard: () => void;
  recoveryMessage?: string | null;
  restored: boolean;
}) {
  return (
    <aside className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm font-medium text-zinc-600">
      <span aria-live="polite">
        {recoveryMessage ?? (restored ? "Draft restored in this tab." : dirty ? "Draft saved in this tab." : "Draft ready in this tab.")}
      </span>
      <button
        className="inline-flex min-h-11 items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-bold text-zinc-700 hover:border-zinc-950"
        onClick={onDiscard}
        type="button"
      >
        <RotateCcw className="size-4" />
        Discard draft
      </button>
    </aside>
  );
}

export function DraftConflictDialog({
  incoming,
  incomingItem,
  onCancel,
  onResume,
  onStartNew,
  previous,
  previousItem,
}: {
  incoming: FormDraftIntent;
  incomingItem?: DraftConflictCardSummary;
  onCancel: () => void;
  onResume: () => void;
  onStartNew: () => void;
  previous: FormDraftIntent;
  previousItem?: DraftConflictCardSummary;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const resumeRef = useRef<HTMLButtonElement>(null);
  const titleId = "form-draft-conflict-title";
  const descriptionId = "form-draft-conflict-description";

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => resumeRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      window.requestAnimationFrame(() => previouslyFocused?.focus());
    };
  }, [onCancel]);

  if (typeof document === "undefined") return null;

  const intentLabel = (intent: FormDraftIntent) => intent.label
    || (intent.kind === "wishlist-target" ? "another Wishlist card"
      : intent.kind === "sealed-unit" ? "another sealed unit"
        : intent.kind === "copy" ? "another physical Copy"
          : "another task");

  return createPortal(
    <div
      aria-describedby={descriptionId}
      aria-labelledby={titleId}
      aria-modal="true"
      className="fixed inset-0 z-[70] grid place-items-center bg-zinc-950/50 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
      role="dialog"
    >
      <section
        className="flex max-h-[88dvh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-zinc-300 bg-white shadow-xl"
        ref={panelRef}
      >
        <header className="flex items-start justify-between gap-4 border-b border-zinc-200 p-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#8a1f2d]">Saved draft</p>
            <h2 className="mt-1 text-xl font-black" id={titleId}>Choose which work to continue</h2>
          </div>
          <button aria-label="Cancel draft choice" className="grid size-11 shrink-0 place-items-center rounded-md border border-zinc-300" onClick={onCancel} type="button">
            <X className="size-4" />
          </button>
        </header>
        <div className="min-h-0 overflow-y-auto p-4" id={descriptionId}>
          <p className="text-sm font-medium leading-6 text-zinc-700">
            Choose which work to continue. Nothing will be replaced until you choose.
          </p>
          {incomingItem || previousItem ? (
            <div className="mt-3 grid gap-2">
              <DraftConflictWorkSummary fallback={intentLabel(previous)} item={previousItem} label="Saved draft" />
              <DraftConflictWorkSummary fallback={intentLabel(incoming)} item={incomingItem} label="Opened now" />
            </div>
          ) : (
            <p className="mt-2 text-sm font-medium leading-6 text-zinc-700">
              This tab has a draft for {intentLabel(previous)}, but you deliberately opened {intentLabel(incoming)}.
            </p>
          )}
        </div>
        <footer className="grid gap-2 border-t border-zinc-200 p-4 sm:grid-cols-3">
          <button className="min-h-11 rounded-md border border-zinc-300 px-3 font-bold" onClick={onCancel} type="button">Cancel</button>
          <button className="min-h-11 rounded-md border border-zinc-300 px-3 font-bold" onClick={onResume} ref={resumeRef} type="button">Resume previous draft</button>
          <button className="min-h-11 rounded-md bg-[#8a1f2d] px-3 font-bold text-white" onClick={onStartNew} type="button">Start new with this item</button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

export function DraftHydrationBoundary({ children, ready }: { children: ReactNode; ready: boolean }) {
  return ready ? children : (
    <div aria-live="polite" className="rounded-lg border border-zinc-200 bg-white p-4 text-sm font-medium text-zinc-600">
      Restoring this tab&apos;s draft…
    </div>
  );
}

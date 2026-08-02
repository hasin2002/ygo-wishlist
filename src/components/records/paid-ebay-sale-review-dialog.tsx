"use client";

import { CheckCircle2, ChevronDown, ChevronUp, LoaderCircle, PencilLine, X } from "lucide-react";
import Image from "next/image";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { copyPhysicalIdentifier } from "@/lib/records/copy-display";
import type { PaidEbaySaleReviewIntent } from "@/lib/navigation-intent";
import { useRecordsDataSource } from "@/components/records/records-preview-provider";
import { trpc } from "@/trpc/client";

function localCalendarDate(value?: Date | string | null) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return localCalendarDate();
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function displayDate(value: string) {
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(parsed);
}

function amountToPence(value: string) {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const pence = Math.round(Number(normalized) * 100);
  return Number.isSafeInteger(pence) && pence >= 0 ? pence : null;
}

type CompactPaidSaleInspection = {
  card: {
    imageUrl: string | null;
    name: string;
    rarity: string;
  };
  copy: {
    condition: string;
    id: string;
    location: string | null;
    stickerNumber: string | null;
  };
  ok: true;
  paidAt: Date | string | null;
  recordName: string;
};

function hasCompactInspectionDetails(value: unknown): value is CompactPaidSaleInspection {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CompactPaidSaleInspection>;
  return candidate.ok === true
    && Boolean(candidate.card && typeof candidate.card === "object")
    && typeof candidate.card?.name === "string"
    && typeof candidate.card?.rarity === "string"
    && (typeof candidate.card?.imageUrl === "string" || candidate.card?.imageUrl === null)
    && Boolean(candidate.copy && typeof candidate.copy === "object")
    && typeof candidate.copy?.id === "string"
    && typeof candidate.copy?.condition === "string"
    && typeof candidate.recordName === "string";
}

export function PaidEbaySaleReviewDialog({
  intent,
  onClose,
  onRecorded,
}: {
  intent: PaidEbaySaleReviewIntent;
  onClose: () => void;
  onRecorded: (recordId: string, warning?: string) => void;
}) {
  const source = useRecordsDataSource();
  const inspection = trpc.records.inspectPaidEbaySaleReview.useQuery(
    { ...intent, responseVersion: 2 },
    {
      refetchOnMount: "always",
      refetchOnWindowFocus: false,
      staleTime: 0,
    },
  );
  const estimate = trpc.ebay.estimatePaidSaleProceeds.useQuery(intent, {
    retry: false,
    staleTime: 0,
  });
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const onCloseRef = useRef(onClose);
  const savingRef = useRef(false);
  const titleId = useId();
  const descriptionId = useId();
  const [recordNameOverride, setRecordNameOverride] = useState<string | null>(null);
  const [netProceedsOverride, setNetProceedsOverride] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    onCloseRef.current = onClose;
    savingRef.current = saving;
  }, [onClose, saving]);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => closeRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !savingRef.current) {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? []);
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
  }, []);

  useEffect(() => {
    if (!detailsOpen) return;
    const frame = window.requestAnimationFrame(() => notesRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [detailsOpen]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaveError(null);
    const inspected = inspection.data;
    if (!inspected?.ok) {
      setSaveError("The exact paid eBay Copy is not ready to record. Close this dialog, refresh the listing, and try again.");
      return;
    }
    const amountPence = amountToPence(netProceeds);
    if (amountPence === null) {
      setSaveError("Enter the net proceeds in pounds, with no more than two decimal places.");
      return;
    }
    if (!recordName.trim()) {
      setSaveError("Enter a Record name.");
      return;
    }
    setSaving(true);
    const result = await source.createSale({
      copyIds: [intent.copyId],
      date,
      netProceedsPence: amountPence,
      notes,
      paidEbayReview: intent,
      recordName: recordName.trim(),
      source: "eBay",
    });
    setSaving(false);
    if (!result.ok) {
      setSaveError(result.message);
      return;
    }
    onRecorded(result.id ?? "", result.warning);
  }

  if (typeof document === "undefined") return null;
  const inspected = hasCompactInspectionDetails(inspection.data) ? inspection.data : null;
  const staleInspectionRefreshing = inspection.data?.ok === true && !inspected && inspection.isFetching;
  const invalidSuccessResponse = inspection.data?.ok === true && !inspected && !inspection.isFetching;
  const recordName = recordNameOverride ?? inspected?.recordName ?? "";
  const netProceeds = netProceedsOverride
    ?? (estimate.data?.ok ? (estimate.data.amountPence / 100).toFixed(2) : "");
  const date = localCalendarDate(inspected?.paidAt);
  const estimateMessage = estimate.isPending
    ? "Checking eBay for an amount…"
    : estimate.isError
      ? "eBay could not provide an amount. Enter the net proceeds manually."
      : estimate.data?.ok
        ? estimate.data.includesReportedFee
          ? "Editable estimate: item price plus buyer-paid postage, less eBay’s reported final-value fee. Adjust for actual postage or other charges."
          : "Editable estimate: item price plus buyer-paid postage. eBay did not report its fee, so adjust this before recording."
        : estimate.data?.message ?? "Enter the net proceeds manually.";

  return createPortal(
    <div
      aria-describedby={descriptionId}
      aria-labelledby={titleId}
      aria-modal="true"
      className="fixed inset-0 z-[80] grid place-items-center bg-zinc-950/55 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
      role="dialog"
    >
      <section className="flex max-h-[88dvh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-zinc-300 bg-white shadow-xl" ref={panelRef}>
        <header className="flex items-start justify-between gap-4 border-b border-zinc-200 p-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#8a1f2d]">Paid on eBay</p>
            <h2 className="mt-1 text-xl font-black text-zinc-950" id={titleId}>Record this Sale</h2>
            <p className="mt-1 text-sm font-medium text-zinc-600" id={descriptionId}>Check the amount, then save. The exact physical Copy is fixed.</p>
          </div>
          <button aria-label="Close Sale review" className="grid size-11 shrink-0 place-items-center rounded-md border border-zinc-300" disabled={saving} onClick={onClose} ref={closeRef} type="button"><X aria-hidden="true" className="size-4" /></button>
        </header>

        <form className="min-h-0 overflow-y-auto" onSubmit={(event) => void submit(event)}>
          <div className="grid gap-4 p-4">
            {inspection.isPending || staleInspectionRefreshing ? <p aria-live="polite" className="flex min-h-24 items-center justify-center gap-2 text-sm font-bold text-zinc-600"><LoaderCircle aria-hidden="true" className="size-4 animate-spin" />Checking the exact paid eBay Copy…</p> : null}
            {inspection.isError ? <p className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm font-semibold text-rose-900" role="alert">The paid Sale details could not be checked. Close this dialog, refresh the listing, and try again.</p> : null}
            {invalidSuccessResponse ? <p className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm font-semibold text-rose-900" role="alert">The paid Sale details were incomplete. Close this dialog, refresh the listing, and try again. Nothing has been recorded.</p> : null}
            {inspection.data && !inspection.data.ok ? <p className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm font-semibold text-rose-900" role="alert">{inspection.data.message}</p> : null}

            {inspected ? (
              <article className="grid grid-cols-[4rem_minmax(0,1fr)] gap-3 rounded-lg border border-emerald-300 bg-emerald-50/70 p-3">
                <div className="relative aspect-[59/86] w-16 overflow-hidden rounded-md border border-emerald-200 bg-white">
                  {inspected.card.imageUrl ? <Image alt={`${inspected.card.name} card`} className="object-contain p-1" fill sizes="64px" src={inspected.card.imageUrl} unoptimized /> : <span aria-hidden="true" className="grid h-full place-items-center text-[10px] font-black text-zinc-400">CARD</span>}
                </div>
                <div className="min-w-0 self-center">
                  <p className="flex items-center gap-1 text-xs font-black text-emerald-800"><CheckCircle2 aria-hidden="true" className="size-4" />Exact Copy selected</p>
                  <p className="mt-1 line-clamp-2 text-sm font-black leading-5 text-zinc-950">{inspected.card.name}</p>
                  <p className="mt-1 text-xs font-semibold text-zinc-600">{inspected.card.rarity} · {inspected.copy.condition}</p>
                  <p className="mt-1 truncate text-xs font-bold text-zinc-800" title={copyPhysicalIdentifier(inspected.copy)}>{copyPhysicalIdentifier(inspected.copy)}</p>
                </div>
              </article>
            ) : null}

            {inspected ? <dl className="grid grid-cols-2 gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm"><div><dt className="font-bold text-zinc-500">Sale date</dt><dd className="mt-1 font-bold text-zinc-900">{displayDate(date)}</dd></div><div><dt className="font-bold text-zinc-500">Marketplace</dt><dd className="mt-1 font-bold text-zinc-900">eBay · Single card</dd></div></dl> : null}

            {inspected ? <>
              <label className="grid gap-1.5 text-sm font-bold text-zinc-800">Record name<input autoFocus className="min-h-11 rounded-md border border-zinc-300 px-3 font-medium outline-none focus:border-[#8a1f2d] focus:ring-2 focus:ring-[#8a1f2d]/20" disabled={saving} maxLength={80} onChange={(event) => setRecordNameOverride(event.target.value)} required type="text" value={recordName} /></label>
              <label className="grid gap-1.5 text-sm font-bold text-zinc-800">Net proceeds (£)<input className="min-h-11 rounded-md border border-zinc-300 px-3 font-medium outline-none focus:border-[#8a1f2d] focus:ring-2 focus:ring-[#8a1f2d]/20" disabled={saving} inputMode="decimal" min="0" onChange={(event) => setNetProceedsOverride(event.target.value)} placeholder="Enter amount" required step="0.01" type="number" value={netProceeds} /><span className="text-xs font-medium leading-5 text-zinc-500">{estimateMessage}</span></label>
              <button
                aria-controls="paid-ebay-sale-extra-details"
                aria-expanded={detailsOpen}
                className="inline-flex min-h-11 items-center justify-between gap-3 rounded-md border border-zinc-300 bg-white px-3 text-sm font-bold text-zinc-800 transition hover:border-[#8a1f2d] hover:text-[#8a1f2d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-offset-2"
                disabled={saving}
                onClick={() => setDetailsOpen((open) => !open)}
                type="button"
              >
                <span className="inline-flex items-center gap-2"><PencilLine aria-hidden="true" className="size-4" />{detailsOpen ? "Done editing notes" : notes ? "Edit notes" : "Add notes"}</span>
                {detailsOpen ? <ChevronUp aria-hidden="true" className="size-4" /> : <ChevronDown aria-hidden="true" className="size-4" />}
              </button>
              {detailsOpen ? (
                <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3" id="paid-ebay-sale-extra-details">
                  <label className="grid gap-1.5 text-sm font-bold text-zinc-800">Notes <span className="font-medium text-zinc-500">(optional)</span><textarea className="min-h-24 resize-y rounded-md border border-zinc-300 bg-white px-3 py-2 font-medium leading-6 outline-none focus:border-[#8a1f2d] focus:ring-2 focus:ring-[#8a1f2d]/20" disabled={saving} maxLength={4_000} onChange={(event) => setNotes(event.target.value)} placeholder="Add anything useful about this Sale" ref={notesRef} rows={3} value={notes} /></label>
                </div>
              ) : null}
            </> : null}
            {saveError ? <p className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm font-semibold text-rose-900" role="alert">{saveError}</p> : null}
          </div>
          <footer className="sticky bottom-0 grid grid-cols-2 gap-2 border-t border-zinc-200 bg-white p-4">
            <button className="min-h-11 rounded-md border border-zinc-300 px-3 font-bold text-zinc-800" disabled={saving} onClick={onClose} type="button">Cancel</button>
            <button className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-[#8a1f2d] px-3 font-bold text-white disabled:cursor-not-allowed disabled:opacity-60" disabled={!inspected || saving} type="submit">{saving ? <><LoaderCircle aria-hidden="true" className="size-4 animate-spin" />Recording…</> : "Record Sale"}</button>
          </footer>
        </form>
      </section>
    </div>,
    document.body,
  );
}

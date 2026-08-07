"use client";

import {
  ArrowLeft,
  Check,
  ChevronRight,
  PackageOpen,
  Plus,
  ReceiptText,
  ShoppingBag,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { AppHeader } from "@/components/app-header";
import { DataLoadError } from "@/components/data-load-error";
import { PreviewNotice } from "@/components/records/entry-form-ui";
import { OpeningForm, PurchaseForm } from "@/components/records/purchase-opening-forms";
import { useRecordsDataSource } from "@/components/records/records-preview-provider";
import { SaleForm } from "@/components/records/sale-form";
import { taskReturnHref } from "@/lib/navigation-intent";
import type { RecordsDataSource, RecordsSnapshot } from "@/lib/records/types";
import { RecordEditorDialog } from "@/components/records/records-app";
import { trpc } from "@/trpc/client";

export type EntryFlow = "purchase" | "pack-opening" | "sale";

const flowContent: Record<EntryFlow, { title: string; description: string; icon: ReactNode }> = {
  purchase: {
    title: "Record purchase",
    description: "Record one card printing, sealed product, bulk lot, or supply purchase with its delivered total.",
    icon: <ShoppingBag className="size-5" />,
  },
  "pack-opening": {
    title: "Record pack opening",
    description: "Identify the product from its TCGplayer link, then record every pulled card without double-counting spend.",
    icon: <PackageOpen className="size-5" />,
  },
  sale: {
    title: "Record sale",
    description: "Choose the exact physical copies sold and enter what you kept after fees and postage.",
    icon: <ReceiptText className="size-5" />,
  },
};

function mergeById<T extends { id: string }>(base: T[], overlay: T[]) {
  const merged = new Map(base.map((item) => [item.id, item]));
  overlay.forEach((item) => merged.set(item.id, item));
  return [...merged.values()];
}

function mergeEditSnapshot(base: RecordsSnapshot, overlay: RecordsSnapshot): RecordsSnapshot {
  const exposures = new Map(base.copyEbayExposures.map((item) => [item.copyId, item]));
  overlay.copyEbayExposures.forEach((item) => exposures.set(item.copyId, item));
  return {
    ...base,
    records: mergeById(base.records, overlay.records),
    targets: mergeById(base.targets, overlay.targets),
    printings: mergeById(base.printings, overlay.printings),
    copies: mergeById(base.copies, overlay.copies),
    copyEbayExposures: [...exposures.values()],
    sealedUnits: mergeById(base.sealedUnits, overlay.sealedUnits),
    bulkLots: mergeById(base.bulkLots, overlay.bulkLots),
    supplies: mergeById(base.supplies, overlay.supplies),
  };
}

function recordMatchesFlow(type: string, flow: EntryFlow) {
  return flow === "purchase"
    ? type === "purchase" || type === "imported-acquisition"
    : flow === "pack-opening"
      ? type === "pack-opening"
      : type === "sale";
}

function SavedState({
  flow,
  mode,
  recordId,
  warning,
  onAddAnother,
}: {
  flow: EntryFlow;
  mode: "preview" | "live";
  recordId: string;
  warning?: string;
  onAddAnother: () => void;
}) {
  const content = flowContent[flow];
  return (
    <section className="grid min-h-[440px] place-items-center rounded-lg border border-zinc-300 bg-white px-5 py-10 text-center shadow-sm">
      <div className="max-w-md">
        <span className="mx-auto grid size-14 place-items-center rounded-full bg-emerald-50 text-emerald-700"><Check className="size-7" /></span>
        <p className="mt-5 text-xs font-bold uppercase tracking-[0.14em] text-emerald-700">{mode === "preview" ? "Preview entry created" : "Record saved"}</p>
        <h2 className="mt-2 text-2xl font-black capitalize">{content.title.replace(/^Record /, "")} saved</h2>
        <p className="mt-2 text-sm font-medium leading-6 text-zinc-500">{mode === "preview" ? "You can inspect the inventory and target effects in this tab. No database data changed." : warning ? "The Record is saved. Do not submit it again; refresh related screens before relying on their current values." : "Library, Inventory, and History now reflect this same saved Record."}</p>
        {warning ? <p className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-left text-sm font-semibold leading-5 text-amber-950" role="alert">{warning}</p> : null}
        <p className="mt-3 font-mono text-xs text-zinc-400">{recordId}</p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <button className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-[#8a1f2d] px-4 text-sm font-bold text-white shadow-sm transition hover:bg-[#741a26] focus:outline-none focus:ring-2 focus:ring-[#8a1f2d] focus:ring-offset-2 sm:col-span-2" onClick={onAddAnother} type="button"><Plus className="size-4" /> Add another record</button>
          <Link className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 text-sm font-bold text-white transition hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-zinc-950 focus:ring-offset-2" href="/records/history">View history <ChevronRight className="size-4" /></Link>
          <Link className="inline-flex min-h-11 items-center justify-center rounded-md border border-zinc-300 px-4 text-sm font-bold text-zinc-700 transition hover:border-zinc-500 hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-400 focus:ring-offset-2" href="/records/inventory">View inventory</Link>
        </div>
      </div>
    </section>
  );
}

export function RecordEntryApp({ flow }: { flow: EntryFlow }) {
  const source = useRecordsDataSource();
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnHref = taskReturnHref(searchParams.get("origin"));
  const editRecordId = searchParams.get("edit");
  const [savedRecord, setSavedRecord] = useState<{ id: string; warning?: string } | null>(null);
  const content = flowContent[flow];
  const editQuery = trpc.records.history.useQuery({
    includeVoid: true,
    page: 1,
    query: "",
    recordId: editRecordId,
    type: "all",
  }, {
    enabled: source.mode === "live" && Boolean(editRecordId),
    // Persisted History data may render immediately with an older Record
    // revision. Wait for this mount's authoritative response before creating
    // an edit draft, otherwise a long edit can only fail with a 409 at save.
    refetchOnMount: "always",
  });
  const editSnapshot = source.mode === "live"
    ? editQuery.data?.snapshot ?? null
    : source.snapshot;
  const editingRecord = editRecordId
    ? editSnapshot?.records.find((record) => record.id === editRecordId) ?? null
    : null;
  const editSource = useMemo<RecordsDataSource | null>(() => editSnapshot
    ? { ...source, snapshot: mergeEditSnapshot(source.snapshot, editSnapshot) }
    : null, [editSnapshot, source]);
  const editing = Boolean(editRecordId);
  const form = source.status === "loading" || (editing && source.mode === "live" && !editQuery.isFetchedAfterMount) ? (
    <div className="grid min-h-64 place-items-center rounded-lg border border-zinc-300 bg-white" role="status">
      <div className="text-center"><p className="font-bold">Preparing Records</p><p className="mt-1 text-sm font-medium text-zinc-500">Loading available copies and inventory…</p></div>
    </div>
  ) : source.status === "error" || (editing && editQuery.isError) ? (
    <DataLoadError
      message={source.errorMessage || editQuery.error?.message || "Your available Records data could not be loaded. Nothing has been saved."}
      onRetry={() => editing && source.mode === "live" ? editQuery.refetch() : source.refresh()}
      title="Could not load the Record entry form"
    />
  ) : editing && (!editingRecord || !editSource || !recordMatchesFlow(editingRecord.type, flow)) ? (
    <DataLoadError
      message="This Record was not found, or it does not belong to this type of entry form. Return to History and open it again."
      onRetry={() => router.push(returnHref)}
      title="Could not open this Record for editing"
    />
  ) : editing && editingRecord && editSource && flow === "purchase" ? (
    <PurchaseForm edit={{ record: editingRecord, snapshot: editSource.snapshot }} onSaved={() => router.push(returnHref)} />
  ) : editing && editingRecord && editSource && flow === "pack-opening" ? (
    <OpeningForm edit={{ record: editingRecord, snapshot: editSource.snapshot }} onSaved={() => router.push(returnHref)} />
  ) : editing && editingRecord && editSource ? (
    <RecordEditorDialog
      backLabel="Back to History"
      onClose={() => router.push(returnHref)}
      onSaved={() => undefined}
      presentation="page"
      record={editingRecord}
      source={editSource}
    />
  ) : flow === "purchase" ? <PurchaseForm onSaved={(id, warning) => setSavedRecord({ id, warning })} /> : flow === "pack-opening" ? <OpeningForm onSaved={(id, warning) => setSavedRecord({ id, warning })} /> : <SaleForm onSaved={(id, warning) => setSavedRecord({ id, warning })} />;

  return (
    <main className="app-page-shell min-h-screen bg-[#f6f4ef] px-4 py-5 text-zinc-950 sm:px-6">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
        <AppHeader title={editing ? content.title.replace("Record ", "Edit ") : content.title} />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <Link className="inline-flex min-h-11 w-fit items-center gap-2 rounded-md text-sm font-bold text-zinc-600 hover:text-zinc-950" href={returnHref} replace><ArrowLeft className="size-4" /> Back to Records</Link>
          <p className="text-xs font-semibold text-zinc-500">{editing ? "Changes update the existing Record; they never create another one." : "Unfinished work is kept in this browser tab."}</p>
        </div>
        <div className="flex items-start gap-3"><span className="grid size-11 shrink-0 place-items-center rounded-lg bg-rose-50 text-[#8a1f2d]">{content.icon}</span><p className="max-w-2xl pt-1 text-sm font-medium leading-6 text-zinc-600">{content.description}</p></div>
        {source.mode === "preview" ? <PreviewNotice>Submitting updates only the resettable preview in this browser tab.</PreviewNotice> : null}
        {!editing && savedRecord ? <SavedState flow={flow} mode={source.mode} recordId={savedRecord.id} warning={savedRecord.warning} onAddAnother={() => setSavedRecord(null)} /> : form}
      </div>
    </main>
  );
}

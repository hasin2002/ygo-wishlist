"use client";

import {
  ArrowLeft,
  Check,
  ChevronRight,
  PackageOpen,
  ReceiptText,
  ShoppingBag,
} from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { AppHeader } from "@/components/app-header";
import { PreviewNotice } from "@/components/records/entry-form-ui";
import { OpeningForm, PurchaseForm } from "@/components/records/purchase-opening-forms";
import { useRecordsDataSource } from "@/components/records/records-preview-provider";
import { SaleForm } from "@/components/records/sale-form";

export type EntryFlow = "purchase" | "pack-opening" | "sale";

const flowContent: Record<EntryFlow, { eyebrow: string; title: string; description: string; icon: ReactNode }> = {
  purchase: {
    eyebrow: "Add record entry",
    title: "Record purchase",
    description: "Record one card printing, sealed product, bulk lot, or supply purchase with its delivered total.",
    icon: <ShoppingBag className="size-5" />,
  },
  "pack-opening": {
    eyebrow: "Add record entry",
    title: "Record pack opening",
    description: "Identify the product from its TCGplayer link, then record every pulled card without double-counting spend.",
    icon: <PackageOpen className="size-5" />,
  },
  sale: {
    eyebrow: "Add record entry",
    title: "Record sale",
    description: "Choose the exact physical copies sold and enter what you kept after fees and postage.",
    icon: <ReceiptText className="size-5" />,
  },
};

function SavedState({ flow, recordId }: { flow: EntryFlow; recordId: string }) {
  const content = flowContent[flow];
  return (
    <section className="grid min-h-[440px] place-items-center rounded-lg border border-zinc-300 bg-white px-5 py-10 text-center shadow-sm">
      <div className="max-w-md">
        <span className="mx-auto grid size-14 place-items-center rounded-full bg-emerald-50 text-emerald-700"><Check className="size-7" /></span>
        <p className="mt-5 text-xs font-bold uppercase tracking-[0.14em] text-emerald-700">Preview entry created</p>
        <h2 className="mt-2 text-2xl font-black capitalize">{content.title.replace(/^Record /, "")} saved</h2>
        <p className="mt-2 text-sm font-medium leading-6 text-zinc-500">You can inspect the inventory and target effects in this tab. No database data changed.</p>
        <p className="mt-3 font-mono text-xs text-zinc-400">{recordId}</p>
        <div className="mt-6 grid gap-2 sm:grid-cols-2">
          <Link className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 text-sm font-bold text-white" href="/records/history">View history <ChevronRight className="size-4" /></Link>
          <Link className="inline-flex min-h-11 items-center justify-center rounded-md border border-zinc-300 px-4 text-sm font-bold text-zinc-700" href="/records/inventory">View inventory</Link>
        </div>
      </div>
    </section>
  );
}

export function RecordEntryApp({ flow }: { flow: EntryFlow }) {
  const source = useRecordsDataSource();
  const [savedRecordId, setSavedRecordId] = useState<string | null>(null);
  const content = flowContent[flow];
  const form = source.status === "loading" ? (
    <div className="grid min-h-64 place-items-center rounded-lg border border-zinc-300 bg-white" role="status">
      <div className="text-center"><p className="font-bold">Preparing your preview</p><p className="mt-1 text-sm font-medium text-zinc-500">Loading available copies and inventory…</p></div>
    </div>
  ) : flow === "purchase" ? <PurchaseForm onSaved={setSavedRecordId} /> : flow === "pack-opening" ? <OpeningForm onSaved={setSavedRecordId} /> : <SaleForm onSaved={setSavedRecordId} />;

  return (
    <main className="app-page-shell min-h-screen bg-[#f6f4ef] px-4 py-5 text-zinc-950 sm:px-6">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
        <AppHeader eyebrow={content.eyebrow} title={content.title} />
        <Link className="inline-flex min-h-11 w-fit items-center gap-2 rounded-md text-sm font-bold text-zinc-600 hover:text-zinc-950" href="/records"><ArrowLeft className="size-4" /> Back to Records</Link>
        <div className="flex items-start gap-3"><span className="grid size-11 shrink-0 place-items-center rounded-lg bg-rose-50 text-[#8a1f2d]">{content.icon}</span><p className="max-w-2xl pt-1 text-sm font-medium leading-6 text-zinc-600">{content.description}</p></div>
        <PreviewNotice>Submitting updates only the resettable preview in this browser tab.</PreviewNotice>
        {savedRecordId ? <SavedState flow={flow} recordId={savedRecordId} /> : form}
      </div>
    </main>
  );
}

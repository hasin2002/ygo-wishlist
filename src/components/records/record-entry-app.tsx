"use client";

import {
  ArrowLeft,
  ArrowRight,
  Boxes,
  Check,
  ChevronRight,
  CirclePlus,
  PackageOpen,
  ReceiptText,
  Scale,
  ShoppingBag,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { AppHeader } from "@/components/app-header";
import {
  fieldClass,
  FormSection,
  poundsToPence,
  PreviewNotice,
  rowId,
  selectNumberOnFocus,
  StepPanel,
  textAreaClass,
  today,
  WizardActions,
  WizardProgress,
} from "@/components/records/entry-form-ui";
import { OpeningForm, PurchaseForm } from "@/components/records/purchase-opening-forms";
import { useRecordsDataSource } from "@/components/records/records-preview-provider";

export type EntryFlow = "purchase" | "pack-opening" | "sale" | "adjustment" | "bulk-itemization";

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
  adjustment: {
    eyebrow: "Add record entry",
    title: "Record adjustment",
    description: "Correct inventory with an explicit reason. Normal purchases and sales belong in their own flows.",
    icon: <Scale className="size-5" />,
  },
  "bulk-itemization": {
    eyebrow: "Add record entry",
    title: "Itemize bulk lot",
    description: "Identify cards inside something you already bought. This creates inventory, not new spend.",
    icon: <Boxes className="size-5" />,
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

type PullRow = { id: string; name: string; quantity: number; setName: string; setCode: string };

function PullRows({ rows, setRows }: { rows: PullRow[]; setRows: (rows: PullRow[]) => void }) {
  function update(id: string, change: Partial<PullRow>) {
    setRows(rows.map((row) => row.id === id ? { ...row, ...change } : row));
  }
  return (
    <div className="grid gap-3">
      {rows.map((row, index) => (
        <article className="rounded-lg border border-zinc-200 bg-zinc-50 p-3" key={row.id}>
          <div className="flex items-center justify-between"><p className="text-xs font-black uppercase tracking-[0.12em] text-zinc-500">Card {index + 1}</p>{rows.length > 1 ? <button aria-label={`Remove card ${index + 1}`} className="grid size-10 place-items-center rounded-md hover:bg-rose-50 hover:text-rose-700" onClick={() => setRows(rows.filter((item) => item.id !== row.id))} type="button"><Trash2 className="size-4" /></button> : null}</div>
          <div className="mt-2 grid gap-3 sm:grid-cols-2"><label className="sm:col-span-2"><span className="text-sm font-bold text-zinc-700">Card name</span><input className={fieldClass} onChange={(event) => update(row.id, { name: event.target.value })} required value={row.name} /></label><label><span className="text-sm font-bold text-zinc-700">Quantity</span><input className={fieldClass} min="1" onChange={(event) => update(row.id, { quantity: Number(event.target.value) })} onFocus={selectNumberOnFocus} required type="number" value={row.quantity} /></label><label><span className="text-sm font-bold text-zinc-700">Set code</span><input className={fieldClass} onChange={(event) => update(row.id, { setCode: event.target.value })} placeholder="RA04-EN001" value={row.setCode} /></label><label className="sm:col-span-2"><span className="text-sm font-bold text-zinc-700">Set name</span><input className={fieldClass} onChange={(event) => update(row.id, { setName: event.target.value })} value={row.setName} /></label></div>
        </article>
      ))}
      <button className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-dashed border-zinc-300 bg-white px-4 text-sm font-bold hover:border-zinc-950" onClick={() => setRows([...rows, { id: rowId("pull"), name: "", quantity: 1, setName: "", setCode: "" }])} type="button"><CirclePlus className="size-4" /> Add another pulled card</button>
    </div>
  );
}

type SaleDraft = { date: string; source: string; proceeds: string; notes: string; copyIds: string[] };

function SaleForm({ onSaved }: { onSaved: (recordId: string) => void }) {
  const source = useRecordsDataSource();
  const stored = source.drafts.sale as SaleDraft | undefined;
  const [draft, setDraft] = useState<SaleDraft>(() => stored ?? { date: today(), source: "eBay", proceeds: "", notes: "", copyIds: [] });
  const [step, setStep] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const availableCopies = source.snapshot.copies.filter((copy) => copy.status === "available").map((copy) => {
    const printing = source.snapshot.printings.find((item) => item.id === copy.printingId)!;
    const target = source.snapshot.targets.find((item) => item.id === printing.targetId)!;
    return { copy, printing, target };
  });
  const reopenTargets = useMemo(() => source.snapshot.targets.filter((target) => {
    const printingIds = source.snapshot.printings.filter((item) => item.targetId === target.id).map((item) => item.id);
    const owned = source.snapshot.copies.filter((copy) => printingIds.includes(copy.printingId) && copy.status === "available").length;
    const selected = availableCopies.filter((item) => item.target.id === target.id && draft.copyIds.includes(item.copy.id)).length;
    return selected > 0 && owned >= target.desiredQuantity && owned - selected < target.desiredQuantity;
  }), [availableCopies, draft.copyIds, source.snapshot]);
  useEffect(() => source.setDraft("sale", draft), [draft, source]);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft.copyIds.length) { setError("Select at least one physical copy."); return; }
    if (!draft.proceeds.trim()) { setError("Enter the net amount you kept."); return; }
    const result = source.createSale({ date: draft.date, source: draft.source, netProceedsPence: poundsToPence(draft.proceeds), notes: draft.notes, copyIds: draft.copyIds });
    if (!result.ok) { setError(result.message); return; }
    source.clearDraft("sale"); onSaved(result.id!);
  }
  function nextStep() {
    if (!draft.copyIds.length) { setError("Select at least one physical copy."); return; }
    setError(null); setStep(2);
  }
  return (
    <form className="grid gap-4" onSubmit={submit}>
      <WizardProgress labels={["Copies", "Proceeds"]} step={step} />
      {step === 1 ? <StepPanel step={step}><FormSection description="Sales operate on real copies, so acquisition history is never erased." number={1} title="Copies sold"><div className="grid gap-2">{availableCopies.map(({ copy, printing, target }) => <label className={`flex min-h-16 cursor-pointer items-center gap-3 rounded-lg border p-3 transition ${draft.copyIds.includes(copy.id) ? "border-[#8a1f2d] bg-rose-50" : "border-zinc-200 bg-zinc-50 hover:border-zinc-400"}`} key={copy.id}><input checked={draft.copyIds.includes(copy.id)} className="size-4 accent-[#8a1f2d]" onChange={(event) => setDraft((current) => ({ ...current, copyIds: event.target.checked ? [...current.copyIds, copy.id] : current.copyIds.filter((id) => id !== copy.id) }))} type="checkbox" /><span className="min-w-0 flex-1"><span className="block font-bold">{target.name}</span><span className="mt-0.5 block text-xs font-semibold text-zinc-500">{printing.setCode} · {copy.condition} · Copy {copy.id.slice(-6)}</span></span></label>)}</div>{reopenTargets.length ? <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-900"><ArrowRight className="mr-2 inline size-4" />This sale reopens {reopenTargets.map((target) => target.name).join(", ")} on your wishlist.</div> : null}</FormSection></StepPanel> : null}
      {step === 2 ? <StepPanel step={step}><FormSection description="Use the amount that reaches you after marketplace fees and postage." number={2} title="Sale details"><div className="mb-4 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm font-bold">{draft.copyIds.length} physical {draft.copyIds.length === 1 ? "copy" : "copies"} selected</div><div className="grid gap-4 sm:grid-cols-2"><label><span className="text-sm font-bold text-zinc-700">Sale date</span><input className={fieldClass} onChange={(event) => setDraft((current) => ({ ...current, date: event.target.value }))} required type="date" value={draft.date} /></label><label><span className="text-sm font-bold text-zinc-700">Marketplace or buyer</span><input className={fieldClass} onChange={(event) => setDraft((current) => ({ ...current, source: event.target.value }))} required value={draft.source} /></label><label className="sm:col-span-2"><span className="text-sm font-bold text-zinc-700">Net proceeds</span><div className="relative mt-1"><span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold text-zinc-500">£</span><input className={`${fieldClass} mt-0 pl-7`} min="0" onChange={(event) => setDraft((current) => ({ ...current, proceeds: event.target.value }))} required step="0.01" type="number" value={draft.proceeds} /></div></label><label className="sm:col-span-2"><span className="text-sm font-bold text-zinc-700">Notes</span><textarea className={textAreaClass} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} value={draft.notes} /></label></div></FormSection></StepPanel> : null}
      {error ? <p className="rounded-md border border-rose-300 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-800" role="alert">{error}</p> : null}<WizardActions finalLabel="Create preview sale" onBack={() => { setError(null); setStep(1); }} onNext={nextStep} step={step} totalSteps={2} />
    </form>
  );
}

type AdjustmentDraft = { date: string; direction: "add" | "remove"; reason: string; notes: string; name: string; quantity: number; setName: string; setCode: string; copyIds: string[] };

function AdjustmentForm({ onSaved }: { onSaved: (recordId: string) => void }) {
  const source = useRecordsDataSource();
  const stored = source.drafts.adjustment as AdjustmentDraft | undefined;
  const [draft, setDraft] = useState<AdjustmentDraft>(() => stored ?? { date: today(), direction: "add", reason: "Inventory count correction", notes: "", name: "", quantity: 1, setName: "", setCode: "", copyIds: [] });
  const [step, setStep] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const copies = source.snapshot.copies.filter((copy) => copy.status === "available").map((copy) => {
    const printing = source.snapshot.printings.find((item) => item.id === copy.printingId)!;
    const target = source.snapshot.targets.find((item) => item.id === printing.targetId)!;
    return { copy, printing, target };
  });
  useEffect(() => source.setDraft("adjustment", draft), [draft, source]);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft.reason.trim()) { setError("Explain why this correction is needed."); return; }
    const selectedName = draft.direction === "remove" ? copies.find((item) => draft.copyIds.includes(item.copy.id))?.target.name ?? "Selected copies" : draft.name;
    const result = source.createAdjustment({ ...draft, name: selectedName, quantity: draft.direction === "remove" ? draft.copyIds.length : draft.quantity });
    if (!result.ok) { setError(result.message); return; }
    source.clearDraft("adjustment"); onSaved(result.id!);
  }
  function nextStep() {
    if (step === 2 && draft.direction === "add" && !draft.name.trim()) { setError("Name the card copies being added."); return; }
    if (step === 2 && draft.direction === "remove" && !draft.copyIds.length) { setError("Choose at least one copy to remove."); return; }
    setError(null); setStep((current) => Math.min(3, current + 1));
  }
  return (
    <form className="grid gap-4" onSubmit={submit}>
      <WizardProgress labels={["Direction", "Copies", "Reason"]} step={step} />
      {step === 1 ? <StepPanel step={step}><FormSection description="Use Add for unexplained stock found during a count; use Remove for loss, damage, or a correction." number={1} title="Correction direction"><div className="grid grid-cols-2 rounded-lg border border-zinc-300 bg-zinc-100 p-1">{(["add", "remove"] as const).map((direction) => <button className={`min-h-11 rounded-md text-sm font-bold capitalize ${draft.direction === direction ? "bg-white shadow-sm" : "text-zinc-600"}`} key={direction} onClick={() => setDraft((current) => ({ ...current, direction, copyIds: [] }))} type="button">{direction}</button>)}</div></FormSection></StepPanel> : null}
      {step === 2 ? <StepPanel step={step}><FormSection description={draft.direction === "add" ? "Describe the physical copies being added." : "Choose the exact physical copies that are no longer held."} number={2} title={draft.direction === "add" ? "Copies found" : "Copies removed"}>{draft.direction === "add" ? <div className="grid gap-4 sm:grid-cols-2"><label className="sm:col-span-2"><span className="text-sm font-bold text-zinc-700">Card name</span><input className={fieldClass} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} required value={draft.name} /></label><label><span className="text-sm font-bold text-zinc-700">Quantity</span><input className={fieldClass} min="1" onChange={(event) => setDraft((current) => ({ ...current, quantity: Number(event.target.value) }))} onFocus={selectNumberOnFocus} required type="number" value={draft.quantity} /></label><label><span className="text-sm font-bold text-zinc-700">Set code</span><input className={fieldClass} onChange={(event) => setDraft((current) => ({ ...current, setCode: event.target.value }))} value={draft.setCode} /></label><label className="sm:col-span-2"><span className="text-sm font-bold text-zinc-700">Set name</span><input className={fieldClass} onChange={(event) => setDraft((current) => ({ ...current, setName: event.target.value }))} value={draft.setName} /></label></div> : <div className="grid gap-2">{copies.map(({ copy, printing, target }) => <label className={`flex min-h-14 items-center gap-3 rounded-md border p-3 ${draft.copyIds.includes(copy.id) ? "border-[#8a1f2d] bg-rose-50" : "border-zinc-200"}`} key={copy.id}><input checked={draft.copyIds.includes(copy.id)} className="size-4 accent-[#8a1f2d]" onChange={(event) => setDraft((current) => ({ ...current, copyIds: event.target.checked ? [...current.copyIds, copy.id] : current.copyIds.filter((id) => id !== copy.id) }))} type="checkbox" /><span><span className="block font-bold">{target.name}</span><span className="text-xs font-semibold text-zinc-500">{printing.setCode} · {copy.condition}</span></span></label>)}</div>}</FormSection></StepPanel> : null}
      {step === 3 ? <StepPanel step={step}><FormSection description="Adjustments must be explainable later and should not replace a purchase or sale." number={3} title="Reason"><div className="grid gap-4 sm:grid-cols-2"><label><span className="text-sm font-bold text-zinc-700">Date</span><input className={fieldClass} onChange={(event) => setDraft((current) => ({ ...current, date: event.target.value }))} required type="date" value={draft.date} /></label><label><span className="text-sm font-bold text-zinc-700">Reason</span><select className={fieldClass} onChange={(event) => setDraft((current) => ({ ...current, reason: event.target.value }))} value={draft.reason}><option>Inventory count correction</option><option>Found in existing collection</option><option>Lost</option><option>Damaged</option><option>Data correction</option></select></label><label className="sm:col-span-2"><span className="text-sm font-bold text-zinc-700">Additional notes</span><textarea className={textAreaClass} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} value={draft.notes} /></label></div></FormSection></StepPanel> : null}
      {error ? <p className="rounded-md border border-rose-300 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-800" role="alert">{error}</p> : null}<WizardActions finalLabel="Create preview adjustment" onBack={() => { setError(null); setStep((current) => Math.max(1, current - 1)); }} onNext={nextStep} step={step} totalSteps={3} />
    </form>
  );
}

type BulkDraft = { date: string; bulkLotId: string; notes: string; items: PullRow[] };

function BulkForm({ onSaved }: { onSaved: (recordId: string) => void }) {
  const source = useRecordsDataSource();
  const searchParams = useSearchParams();
  const lots = source.snapshot.bulkLots.filter((lot) => lot.status !== "void");
  const requested = searchParams.get("bulkId");
  const stored = source.drafts["bulk-itemization"] as BulkDraft | undefined;
  const [draft, setDraft] = useState<BulkDraft>(() => stored ?? { date: today(), bulkLotId: requested && lots.some((lot) => lot.id === requested) ? requested : lots[0]?.id ?? "", notes: "", items: [{ id: "bulk-card-1", name: "", quantity: 1, setName: "", setCode: "" }] });
  const [step, setStep] = useState(1);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => source.setDraft("bulk-itemization", draft), [draft, source]);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft.bulkLotId || draft.items.some((item) => !item.name.trim())) { setError("Choose a bulk lot and name every itemized card."); return; }
    const result = source.itemizeBulk(draft);
    if (!result.ok) { setError(result.message); return; }
    source.clearDraft("bulk-itemization"); onSaved(result.id!);
  }
  function nextStep() {
    if (step === 1 && !draft.bulkLotId) { setError("Choose an existing bulk lot."); return; }
    if (step === 2 && draft.items.some((item) => !item.name.trim())) { setError("Name every itemized card before continuing."); return; }
    setError(null); setStep((current) => Math.min(3, current + 1));
  }
  return (
    <form className="grid gap-4" onSubmit={submit}>
      <div className="rounded-lg border-2 border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-900">£0 new spend — itemization explains the contents of an existing acquisition.</div>
      <WizardProgress labels={["Lot", "Cards", "Review"]} step={step} />
      {step === 1 ? <StepPanel step={step}><FormSection description="Choose the purchase whose unknown contents you are working through." number={1} title="Bulk lot"><div className="grid gap-4 sm:grid-cols-2"><label className="sm:col-span-2"><span className="text-sm font-bold text-zinc-700">Existing lot</span><select className={fieldClass} onChange={(event) => setDraft((current) => ({ ...current, bulkLotId: event.target.value }))} required value={draft.bulkLotId}><option value="">Choose bulk lot</option>{lots.map((lot) => <option key={lot.id} value={lot.id}>{lot.name} · {lot.itemizedQuantity} itemized</option>)}</select></label><label><span className="text-sm font-bold text-zinc-700">Itemization date</span><input className={fieldClass} onChange={(event) => setDraft((current) => ({ ...current, date: event.target.value }))} required type="date" value={draft.date} /></label></div></FormSection></StepPanel> : null}
      {step === 2 ? <StepPanel step={step}><FormSection description="Each quantity becomes physical card copies with provenance back to this lot." number={2} title="Cards identified"><PullRows rows={draft.items} setRows={(items) => setDraft((current) => ({ ...current, items }))} /></FormSection></StepPanel> : null}
      {step === 3 ? <StepPanel step={step}><FormSection description="Confirm the count and add optional context about the batch." number={3} title="Review itemization"><div className="mb-4 rounded-lg border border-zinc-200 bg-zinc-50 p-3"><p className="text-xs font-bold uppercase text-zinc-500">New physical copies</p><p className="mt-1 text-2xl font-black">{draft.items.reduce((sum, item) => sum + item.quantity, 0)}</p><p className="mt-1 text-xs font-bold text-emerald-700">£0 additional spend</p></div><textarea className={textAreaClass} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} value={draft.notes} /></FormSection></StepPanel> : null}
      {error ? <p className="rounded-md border border-rose-300 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-800" role="alert">{error}</p> : null}<WizardActions finalLabel="Create preview itemization" onBack={() => { setError(null); setStep((current) => Math.max(1, current - 1)); }} onNext={nextStep} step={step} totalSteps={3} />
    </form>
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
  ) : flow === "purchase" ? <PurchaseForm onSaved={setSavedRecordId} /> : flow === "pack-opening" ? <OpeningForm onSaved={setSavedRecordId} /> : flow === "sale" ? <SaleForm onSaved={setSavedRecordId} /> : flow === "adjustment" ? <AdjustmentForm onSaved={setSavedRecordId} /> : <BulkForm onSaved={setSavedRecordId} />;

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

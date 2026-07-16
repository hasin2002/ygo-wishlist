"use client";

import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Boxes,
  Check,
  ChevronRight,
  CirclePlus,
  PackageOpen,
  Plus,
  ReceiptText,
  Scale,
  ShoppingBag,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { AppHeader } from "@/components/app-header";
import { useRecordsDataSource } from "@/components/records/records-preview-provider";
import type {
  InventoryKind,
  PurchaseLineInput,
  SupplyCategory,
} from "@/lib/records/types";

export type EntryFlow = "purchase" | "pack-opening" | "sale" | "adjustment" | "bulk-itemization";

const fieldClass = "mt-1 h-11 w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 text-sm outline-none transition focus:border-[#8a1f2d] focus:bg-white focus:ring-2 focus:ring-[#8a1f2d]/10";
const textAreaClass = "mt-1 min-h-24 w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm outline-none transition focus:border-[#8a1f2d] focus:bg-white focus:ring-2 focus:ring-[#8a1f2d]/10";

const flowContent: Record<EntryFlow, { eyebrow: string; title: string; description: string; icon: ReactNode }> = {
  purchase: {
    eyebrow: "Add record entry",
    title: "Record purchase",
    description: "Capture one delivered total, even when the order mixes cards, sealed product, bulk, and supplies.",
    icon: <ShoppingBag className="size-5" />,
  },
  "pack-opening": {
    eyebrow: "Add record entry",
    title: "Record pack opening",
    description: "Turn an existing sealed product into pulled copies without adding spend a second time.",
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

function today() {
  return new Date().toISOString().slice(0, 10);
}

function poundsToPence(value: string) {
  const parsed = Number(value.replace(/[£,]/g, ""));
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed * 100)) : 0;
}

function penceToPounds(value: number) {
  return (value / 100).toFixed(2);
}

function rowId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function FormSection({
  children,
  description,
  number,
  title,
}: {
  children: ReactNode;
  description: string;
  number: number;
  title: string;
}) {
  return (
    <section className="rounded-lg border border-zinc-300 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-zinc-950 text-sm font-black text-white">{number}</span>
        <div>
          <h2 className="text-lg font-bold">{title}</h2>
          <p className="mt-1 text-sm font-medium leading-5 text-zinc-500">{description}</p>
        </div>
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function PreviewNotice({ children }: { children: ReactNode }) {
  return (
    <aside className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium leading-5 text-amber-900">
      <AlertCircle className="mt-0.5 size-5 shrink-0" />
      <div><strong className="font-black">Preview only.</strong> {children}</div>
    </aside>
  );
}

function WizardProgress({ labels, step }: { labels: string[]; step: number }) {
  return (
    <nav aria-label="Form progress" className="rounded-lg border border-zinc-300 bg-white p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between text-xs font-bold text-zinc-500">
        <span>Step {step} of {labels.length}</span>
        <span>{labels[step - 1]}</span>
      </div>
      <ol className="grid gap-2" style={{ gridTemplateColumns: `repeat(${labels.length}, minmax(0, 1fr))` }}>
        {labels.map((label, index) => {
          const number = index + 1;
          return (
            <li className="min-w-0" key={label}>
              <span className={`block h-1.5 rounded-full transition-colors ${number <= step ? "bg-[#8a1f2d]" : "bg-zinc-200"}`} />
              <span className={`mt-2 hidden truncate text-[11px] font-bold sm:block ${number === step ? "text-zinc-950" : "text-zinc-500"}`}>{label}</span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function StepPanel({ children, step }: { children: ReactNode; step: number }) {
  return <div className="records-step-enter" key={step}>{children}</div>;
}

function WizardActions({
  finalLabel,
  onBack,
  onNext,
  step,
  totalSteps,
}: {
  finalLabel: string;
  onBack: () => void;
  onNext: () => void;
  step: number;
  totalSteps: number;
}) {
  return (
    <div className="sticky bottom-3 z-20 flex flex-col-reverse gap-2 rounded-lg border border-zinc-300 bg-white/95 p-3 shadow-lg backdrop-blur sm:flex-row sm:items-center sm:justify-between">
      <button className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-zinc-300 px-4 text-sm font-bold text-zinc-700 hover:border-zinc-950 disabled:opacity-40" disabled={step === 1} onClick={onBack} type="button"><ArrowLeft className="size-4" /> Back</button>
      {step < totalSteps ? (
        <button className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-zinc-950 px-5 text-sm font-bold text-white transition hover:bg-zinc-800" onClick={onNext} type="button">Continue <ArrowRight className="size-4" /></button>
      ) : (
        <button className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-[#8a1f2d] px-5 text-sm font-bold text-white transition hover:bg-[#711826]" type="submit"><Check className="size-4" /> {finalLabel}</button>
      )}
    </div>
  );
}

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

type PurchaseDraft = {
  date: string;
  source: string;
  total: string;
  notes: string;
  nextKind: InventoryKind;
  lines: Array<Omit<PurchaseLineInput, "allocationPence"> & { allocation: string }>;
};

function blankPurchaseLine(kind: InventoryKind, name = ""): PurchaseDraft["lines"][number] {
  return {
    id: rowId("purchase-line"),
    kind,
    name,
    quantity: 1,
    allocation: "",
    setName: "",
    setCode: "",
    category: "other",
    estimatedQuantity: null,
  };
}

function PurchaseForm({ onSaved }: { onSaved: (recordId: string) => void }) {
  const source = useRecordsDataSource();
  const searchParams = useSearchParams();
  const prefilledName = searchParams.get("cardName") ?? "";
  const stored = source.drafts.purchase as PurchaseDraft | undefined;
  const [draft, setDraft] = useState<PurchaseDraft>(() => stored ?? {
    date: today(),
    source: "eBay",
    total: "",
    notes: "",
    nextKind: "card",
    lines: [blankPurchaseLine("card", prefilledName)],
  });
  const [step, setStep] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const allocationPence = draft.lines.reduce((sum, line) => sum + (line.allocation ? poundsToPence(line.allocation) : 0), 0);
  const totalPence = poundsToPence(draft.total);

  useEffect(() => {
    source.setDraft("purchase", draft);
  }, [draft, source]);

  function updateLine(id: string, update: Partial<PurchaseDraft["lines"][number]>) {
    setDraft((current) => ({ ...current, lines: current.lines.map((line) => line.id === id ? { ...line, ...update } : line) }));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft.lines.length || draft.lines.some((line) => !line.name.trim() || line.quantity < 1)) {
      setError("Every line needs a name and quantity of at least one.");
      return;
    }
    if (!draft.total.trim()) {
      setError("Enter the all-in amount you actually paid.");
      return;
    }
    if (allocationPence > totalPence) {
      setError("Line allocations cannot exceed the purchase total. They describe the total; they do not add to it.");
      return;
    }
    const result = source.createPurchase({
      date: draft.date,
      source: draft.source,
      totalPence,
      notes: draft.notes,
      lines: draft.lines.map((line) => ({
        ...line,
        allocationPence: line.allocation ? poundsToPence(line.allocation) : null,
      })),
    });
    if (!result.ok) {
      setError(result.message);
      return;
    }
    source.clearDraft("purchase");
    onSaved(result.id!);
  }

  function nextStep() {
    if (step === 1 && (!draft.date || !draft.source.trim() || !draft.total.trim())) {
      setError("Add the date, source, and all-in amount before continuing.");
      return;
    }
    if (step === 2 && (!draft.lines.length || draft.lines.some((line) => !line.name.trim() || line.quantity < 1))) {
      setError("Every line needs a name and quantity of at least one.");
      return;
    }
    if (step === 2 && allocationPence > totalPence) {
      setError("Line allocations cannot exceed the purchase total.");
      return;
    }
    setError(null);
    setStep((current) => Math.min(3, current + 1));
  }

  return (
    <form className="grid gap-4" onSubmit={submit}>
      <WizardProgress labels={["Purchase", "Items", "Review"]} step={step} />
      {step === 1 ? <StepPanel step={step}>
      <FormSection description="Keep the date and seller on the event, not repeated on each item." number={1} title="Purchase details">
        <div className="grid gap-4 sm:grid-cols-2">
          <label><span className="text-sm font-bold text-zinc-700">Date received</span><input className={fieldClass} onChange={(event) => setDraft((current) => ({ ...current, date: event.target.value }))} required type="date" value={draft.date} /></label>
          <label><span className="text-sm font-bold text-zinc-700">Seller or source</span><input className={fieldClass} onChange={(event) => setDraft((current) => ({ ...current, source: event.target.value }))} placeholder="eBay, local shop, friend…" required value={draft.source} /></label>
          <label className="sm:col-span-2"><span className="text-sm font-bold text-zinc-700">All-in amount paid</span><div className="relative mt-1"><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-bold text-zinc-500">£</span><input className={`${fieldClass} mt-0 pl-7`} inputMode="decimal" min="0" onChange={(event) => setDraft((current) => ({ ...current, total: event.target.value }))} placeholder="0.00" required step="0.01" type="number" value={draft.total} /></div><span className="mt-1 block text-xs font-medium text-zinc-500">Include delivery, fees, and discounts in the amount that left your pocket.</span></label>
        </div>
      </FormSection>
      </StepPanel> : null}

      {step === 2 ? <StepPanel step={step}>
      <FormSection description="A single purchase can contain different kinds of collection items." number={2} title="What you bought">
        <div className="grid gap-3">
          {draft.lines.map((line, index) => (
            <article className="rounded-lg border border-zinc-200 bg-zinc-50 p-3" key={line.id}>
              <div className="flex items-center justify-between gap-3"><p className="text-xs font-black uppercase tracking-[0.12em] text-zinc-500">Line {index + 1} · {line.kind}</p>{draft.lines.length > 1 ? <button aria-label={`Remove line ${index + 1}`} className="grid size-10 place-items-center rounded-md text-zinc-500 hover:bg-rose-50 hover:text-rose-700" onClick={() => setDraft((current) => ({ ...current, lines: current.lines.filter((item) => item.id !== line.id) }))} type="button"><Trash2 className="size-4" /></button> : null}</div>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <label className="sm:col-span-2"><span className="text-sm font-bold text-zinc-700">{line.kind === "card" ? "Card name" : line.kind === "sealed" ? "Product name" : line.kind === "bulk" ? "Lot description" : "Supply name"}</span><input className={fieldClass} onChange={(event) => updateLine(line.id, { name: event.target.value })} placeholder={line.kind === "card" ? "Dark Magician" : "Describe this item"} required value={line.name} /></label>
                <label><span className="text-sm font-bold text-zinc-700">Quantity</span><input className={fieldClass} min="1" onChange={(event) => updateLine(line.id, { quantity: Number(event.target.value) })} required type="number" value={line.quantity} /></label>
                <label><span className="text-sm font-bold text-zinc-700">Optional allocation</span><div className="relative mt-1"><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-bold text-zinc-500">£</span><input className={`${fieldClass} mt-0 pl-7`} inputMode="decimal" min="0" onChange={(event) => updateLine(line.id, { allocation: event.target.value })} placeholder="Not required" step="0.01" type="number" value={line.allocation} /></div></label>
                {line.kind === "card" ? <><label><span className="text-sm font-bold text-zinc-700">Set name</span><input className={fieldClass} onChange={(event) => updateLine(line.id, { setName: event.target.value })} placeholder="Starter Deck: Yugi" value={line.setName} /></label><label><span className="text-sm font-bold text-zinc-700">Set code</span><input className={fieldClass} onChange={(event) => updateLine(line.id, { setCode: event.target.value })} placeholder="SDY-006" value={line.setCode} /></label></> : null}
                {line.kind === "bulk" ? <label><span className="text-sm font-bold text-zinc-700">Estimated card count</span><input className={fieldClass} min="0" onChange={(event) => updateLine(line.id, { estimatedQuantity: event.target.value ? Number(event.target.value) : null })} placeholder="Can be unknown" type="number" value={line.estimatedQuantity ?? ""} /></label> : null}
                {line.kind === "supply" ? <label><span className="text-sm font-bold text-zinc-700">Category</span><select className={fieldClass} onChange={(event) => updateLine(line.id, { category: event.target.value as SupplyCategory })} value={line.category}><option value="sleeves">Sleeves</option><option value="binder">Binder</option><option value="storage">Storage</option><option value="playmat">Playmat</option><option value="other">Other</option></select></label> : null}
              </div>
            </article>
          ))}
          <div className="flex flex-col gap-2 rounded-lg border border-dashed border-zinc-300 p-3 sm:flex-row">
            <select aria-label="Type of purchase line to add" className="h-11 flex-1 rounded-md border border-zinc-300 bg-white px-3 text-sm font-bold" onChange={(event) => setDraft((current) => ({ ...current, nextKind: event.target.value as InventoryKind }))} value={draft.nextKind}><option value="card">Card single</option><option value="sealed">Sealed product</option><option value="bulk">Bulk lot</option><option value="supply">Supply / extra</option></select>
            <button className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-4 text-sm font-bold hover:border-zinc-950" onClick={() => setDraft((current) => ({ ...current, lines: [...current.lines, blankPurchaseLine(current.nextKind)] }))} type="button"><Plus className="size-4" /> Add line</button>
          </div>
          <div className={`flex flex-col gap-1 rounded-md border px-3 py-2 text-sm font-medium sm:flex-row sm:items-center sm:justify-between ${allocationPence > totalPence ? "border-rose-300 bg-rose-50 text-rose-800" : "border-zinc-200 bg-zinc-50 text-zinc-600"}`}>
            <span>Allocated {penceToPounds(allocationPence)} of {penceToPounds(totalPence)}</span><span>Cashflow stays {penceToPounds(totalPence)}</span>
          </div>
        </div>
      </FormSection>
      </StepPanel> : null}

      {step === 3 ? <StepPanel step={step}><FormSection description="Check the cash total and add any context that will help later." number={3} title="Review and notes"><div className="mb-4 grid gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm sm:grid-cols-3"><div><span className="block text-xs font-bold uppercase text-zinc-500">Source</span><strong className="mt-1 block">{draft.source}</strong></div><div><span className="block text-xs font-bold uppercase text-zinc-500">Items</span><strong className="mt-1 block">{draft.lines.reduce((sum, line) => sum + line.quantity, 0)}</strong></div><div><span className="block text-xs font-bold uppercase text-zinc-500">All-in paid</span><strong className="mt-1 block">£{penceToPounds(totalPence)}</strong></div></div><label><span className="text-sm font-bold text-zinc-700">Purchase notes</span><textarea className={textAreaClass} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} placeholder="Condition notes, postage context, why you bought the lot…" value={draft.notes} /></label></FormSection></StepPanel> : null}
      {error ? <p className="rounded-md border border-rose-300 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-800" role="alert">{error}</p> : null}
      <WizardActions finalLabel="Create preview purchase" onBack={() => { setError(null); setStep((current) => Math.max(1, current - 1)); }} onNext={nextStep} step={step} totalSteps={3} />
    </form>
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
          <div className="mt-2 grid gap-3 sm:grid-cols-2"><label className="sm:col-span-2"><span className="text-sm font-bold text-zinc-700">Card name</span><input className={fieldClass} onChange={(event) => update(row.id, { name: event.target.value })} required value={row.name} /></label><label><span className="text-sm font-bold text-zinc-700">Quantity</span><input className={fieldClass} min="1" onChange={(event) => update(row.id, { quantity: Number(event.target.value) })} required type="number" value={row.quantity} /></label><label><span className="text-sm font-bold text-zinc-700">Set code</span><input className={fieldClass} onChange={(event) => update(row.id, { setCode: event.target.value })} placeholder="RA04-EN001" value={row.setCode} /></label><label className="sm:col-span-2"><span className="text-sm font-bold text-zinc-700">Set name</span><input className={fieldClass} onChange={(event) => update(row.id, { setName: event.target.value })} value={row.setName} /></label></div>
        </article>
      ))}
      <button className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-dashed border-zinc-300 bg-white px-4 text-sm font-bold hover:border-zinc-950" onClick={() => setRows([...rows, { id: rowId("pull"), name: "", quantity: 1, setName: "", setCode: "" }])} type="button"><CirclePlus className="size-4" /> Add another pulled card</button>
    </div>
  );
}

type OpeningDraft = { date: string; sealedUnitId: string; notes: string; pulls: PullRow[] };

function OpeningForm({ onSaved }: { onSaved: (recordId: string) => void }) {
  const source = useRecordsDataSource();
  const searchParams = useSearchParams();
  const available = source.snapshot.sealedUnits.filter((item) => item.status === "sealed");
  const requested = searchParams.get("sealedId");
  const stored = source.drafts["pack-opening"] as OpeningDraft | undefined;
  const [draft, setDraft] = useState<OpeningDraft>(() => stored ?? { date: today(), sealedUnitId: requested && available.some((item) => item.id === requested) ? requested : available[0]?.id ?? "", notes: "", pulls: [{ id: "pull-1", name: "", quantity: 1, setName: "", setCode: "" }] });
  const [step, setStep] = useState(1);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => source.setDraft("pack-opening", draft), [draft, source]);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft.sealedUnitId || draft.pulls.some((pull) => !pull.name.trim())) { setError("Choose sealed product and name every pulled card."); return; }
    const result = source.createOpening(draft);
    if (!result.ok) { setError(result.message); return; }
    source.clearDraft("pack-opening"); onSaved(result.id!);
  }
  function nextStep() {
    if (step === 1 && !draft.sealedUnitId) { setError("Choose an unopened sealed product."); return; }
    if (step === 2 && draft.pulls.some((pull) => !pull.name.trim())) { setError("Name every pulled card before continuing."); return; }
    setError(null); setStep((current) => Math.min(3, current + 1));
  }
  return (
    <form className="grid gap-4" onSubmit={submit}>
      <WizardProgress labels={["Product", "Pulls", "Review"]} step={step} />
      {step === 1 ? <StepPanel step={step}><FormSection description="The cost stays with the purchase that brought this product into your collection." number={1} title="What did you open?"><div className="grid gap-4 sm:grid-cols-2"><label className="sm:col-span-2"><span className="text-sm font-bold text-zinc-700">Sealed product</span><select className={fieldClass} onChange={(event) => setDraft((current) => ({ ...current, sealedUnitId: event.target.value }))} required value={draft.sealedUnitId}><option value="">Choose unopened product</option>{available.map((item) => <option key={item.id} value={item.id}>{item.name} × {item.quantity}</option>)}</select></label><label><span className="text-sm font-bold text-zinc-700">Opening date</span><input className={fieldClass} onChange={(event) => setDraft((current) => ({ ...current, date: event.target.value }))} required type="date" value={draft.date} /></label></div></FormSection></StepPanel> : null}
      {step === 2 ? <StepPanel step={step}><FormSection description="Each quantity creates that many physical copies tied to this opening." number={2} title="Pulled cards"><PullRows rows={draft.pulls} setRows={(pulls) => setDraft((current) => ({ ...current, pulls }))} /></FormSection></StepPanel> : null}
      {step === 3 ? <StepPanel step={step}><FormSection description="Confirm the result and add optional condition context." number={3} title="Review opening"><div className="mb-4 rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm"><span className="text-xs font-bold uppercase text-zinc-500">Copies created</span><strong className="mt-1 block text-xl">{draft.pulls.reduce((sum, pull) => sum + pull.quantity, 0)}</strong></div><textarea className={textAreaClass} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} placeholder="Opening or condition notes" value={draft.notes} /></FormSection></StepPanel> : null}
      {error ? <p className="rounded-md border border-rose-300 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-800" role="alert">{error}</p> : null}<WizardActions finalLabel="Create preview opening" onBack={() => { setError(null); setStep((current) => Math.max(1, current - 1)); }} onNext={nextStep} step={step} totalSteps={3} />
    </form>
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
      {step === 2 ? <StepPanel step={step}><FormSection description={draft.direction === "add" ? "Describe the physical copies being added." : "Choose the exact physical copies that are no longer held."} number={2} title={draft.direction === "add" ? "Copies found" : "Copies removed"}>{draft.direction === "add" ? <div className="grid gap-4 sm:grid-cols-2"><label className="sm:col-span-2"><span className="text-sm font-bold text-zinc-700">Card name</span><input className={fieldClass} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} required value={draft.name} /></label><label><span className="text-sm font-bold text-zinc-700">Quantity</span><input className={fieldClass} min="1" onChange={(event) => setDraft((current) => ({ ...current, quantity: Number(event.target.value) }))} required type="number" value={draft.quantity} /></label><label><span className="text-sm font-bold text-zinc-700">Set code</span><input className={fieldClass} onChange={(event) => setDraft((current) => ({ ...current, setCode: event.target.value }))} value={draft.setCode} /></label><label className="sm:col-span-2"><span className="text-sm font-bold text-zinc-700">Set name</span><input className={fieldClass} onChange={(event) => setDraft((current) => ({ ...current, setName: event.target.value }))} value={draft.setName} /></label></div> : <div className="grid gap-2">{copies.map(({ copy, printing, target }) => <label className={`flex min-h-14 items-center gap-3 rounded-md border p-3 ${draft.copyIds.includes(copy.id) ? "border-[#8a1f2d] bg-rose-50" : "border-zinc-200"}`} key={copy.id}><input checked={draft.copyIds.includes(copy.id)} className="size-4 accent-[#8a1f2d]" onChange={(event) => setDraft((current) => ({ ...current, copyIds: event.target.checked ? [...current.copyIds, copy.id] : current.copyIds.filter((id) => id !== copy.id) }))} type="checkbox" /><span><span className="block font-bold">{target.name}</span><span className="text-xs font-semibold text-zinc-500">{printing.setCode} · {copy.condition}</span></span></label>)}</div>}</FormSection></StepPanel> : null}
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

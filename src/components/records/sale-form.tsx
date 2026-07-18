"use client";

import {
  Boxes,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Info,
  Pencil,
  Plus,
  Search,
} from "lucide-react";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import {
  DestructiveToast,
  fieldClass,
  FormSection,
  penceToPounds,
  poundsToPence,
  PreviewNotice,
  StepPanel,
  textAreaClass,
  today,
  WizardActions,
  WizardProgress,
} from "@/components/records/entry-form-ui";
import { useRecordsDataSource } from "@/components/records/records-preview-provider";
import { generatedSaleRecordName } from "@/lib/records/record-name";
import type {
  CardCopy,
  CardPrinting,
  WishlistTarget,
} from "@/lib/records/types";

const salePageSize = 20;

type SaleKind = "single" | "bulk";

type SaleDraft = {
  version: 3;
  kind: SaleKind | null;
  recordName: string;
  date: string;
  source: string;
  proceeds: string;
  notes: string;
  copyIds: string[];
};

type AvailableCopy = {
  copy: CardCopy;
  printing: CardPrinting;
  target: WishlistTarget;
  imageUrl: string | null;
};

type LibraryImpact = {
  after: number;
  before: number;
  target: WishlistTarget;
};

function newSaleDraft(): SaleDraft {
  return {
    version: 3,
    kind: null,
    recordName: "",
    date: today(),
    source: "eBay",
    proceeds: "",
    notes: "",
    copyIds: [],
  };
}

function CopyThumbnail({ eager = false, item }: { eager?: boolean; item: AvailableCopy }) {
  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
      <div className="relative aspect-[3/4] bg-zinc-100">
        {item.imageUrl ? (
          <Image
            alt=""
            className="object-contain p-2"
            fill
            loading={eager ? "eager" : "lazy"}
            sizes="(max-width: 640px) 50vw, (max-width: 1280px) 33vw, 25vw"
            src={`/api/image-proxy?url=${encodeURIComponent(item.imageUrl)}`}
            unoptimized
          />
        ) : (
          <span className="grid h-full place-items-center text-xs font-black text-zinc-400">CARD</span>
        )}
      </div>
      <div className="p-3">
        <p className="line-clamp-2 min-h-10 text-sm font-black leading-5 text-zinc-950">{item.target.name}</p>
        <p className="mt-1 text-xs font-bold text-[#8a1f2d]">{item.target.rarity || "Unknown rarity"}</p>
        <p className="mt-1 text-xs font-medium text-zinc-500">{item.printing.setCode || "Unknown set"} · {item.target.edition || "Unknown edition"} · {item.copy.condition}</p>
      </div>
    </div>
  );
}

function LibraryImpactNotice({ impacts }: { impacts: LibraryImpact[] }) {
  if (!impacts.length) return null;

  return (
    <aside className="mt-4 flex items-start gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-700">
      <Info className="mt-0.5 size-5 shrink-0" />
      <div>
        <strong className="font-black">Library after this sale</strong>
        <ul className="mt-1 grid gap-1 font-medium leading-5">
          {impacts.map(({ after, before, target }) => (
            <li key={target.id}>
              {target.name}: you currently own {before}. After this sale you will own {after}. You are tracking {target.desiredQuantity} wanted {target.desiredQuantity === 1 ? "copy" : "copies"}, so it will appear in Wants.
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}

export function SaleForm({ onSaved }: { onSaved: (recordId: string) => void }) {
  const source = useRecordsDataSource();
  const stored = source.drafts.sale as Partial<SaleDraft> | undefined;
  const legacyDraftReset = Boolean(stored && (stored as { version?: number }).version !== 3);
  const [draft, setDraft] = useState<SaleDraft>(() => (stored as { version?: number } | undefined)?.version === 3 ? stored as SaleDraft : newSaleDraft());
  const [step, setStep] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [query, setQuery] = useState("");
  const [rarity, setRarity] = useState("all");
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [page, setPage] = useState(1);

  const availableCopies = useMemo<AvailableCopy[]>(() => {
    const printings = new Map(source.snapshot.printings.map((printing) => [printing.id, printing]));
    const targets = new Map(source.snapshot.targets.map((target) => [target.id, target]));

    return source.snapshot.copies.flatMap((copy) => {
      if (copy.status !== "available") return [];
      const printing = printings.get(copy.printingId);
      const target = printing ? targets.get(printing.targetId) : undefined;
      if (!printing || !target) return [];
      return [{ copy, printing, target, imageUrl: printing.imageUrl || target.imageUrl }];
    });
  }, [source.snapshot.copies, source.snapshot.printings, source.snapshot.targets]);

  const rarityOptions = useMemo(
    () => Array.from(new Set(availableCopies.map((item) => item.target.rarity).filter(Boolean))).sort((left, right) => left.localeCompare(right)),
    [availableCopies],
  );

  const selectedCopies = useMemo(
    () => availableCopies.filter((item) => draft.copyIds.includes(item.copy.id)),
    [availableCopies, draft.copyIds],
  );

  const filteredCopies = useMemo(() => {
    const search = query.trim().toLowerCase();
    return availableCopies.filter((item) => {
      if (selectedOnly && !draft.copyIds.includes(item.copy.id)) return false;
      if (rarity !== "all" && item.target.rarity !== rarity) return false;
      if (!search) return true;
      return [
        item.target.name,
        item.target.rarity,
        item.target.edition,
        item.printing.setName,
        item.printing.setCode,
        item.copy.condition,
      ].some((value) => value.toLowerCase().includes(search));
    });
  }, [availableCopies, draft.copyIds, query, rarity, selectedOnly]);

  const pageCount = Math.max(1, Math.ceil(filteredCopies.length / salePageSize));
  const visibleCopies = filteredCopies.slice((page - 1) * salePageSize, page * salePageSize);

  const libraryImpacts = useMemo<LibraryImpact[]>(() => source.snapshot.targets.flatMap((target) => {
    const printingIds = source.snapshot.printings
      .filter((printing) => printing.targetId === target.id)
      .map((printing) => printing.id);
    const before = source.snapshot.copies.filter(
      (copy) => printingIds.includes(copy.printingId) && copy.status === "available",
    ).length;
    const selected = selectedCopies.filter((item) => item.target.id === target.id).length;
    const after = before - selected;
    return selected > 0 && before >= target.desiredQuantity && after < target.desiredQuantity
      ? [{ after, before, target }]
      : [];
  }), [selectedCopies, source.snapshot.copies, source.snapshot.printings, source.snapshot.targets]);

  useEffect(() => source.setDraft("sale", draft), [draft, source]);

  function typeError() {
    return draft.kind ? null : "Choose Single card or Bulk cards before continuing.";
  }

  function detailsError() {
    if (!draft.date) return "Add the sale date.";
    if (!draft.source.trim()) return "Add the marketplace or buyer.";
    if (!draft.proceeds.trim()) return "Enter the net amount you kept.";
    return null;
  }

  function selectionError() {
    if (draft.kind === "single" && draft.copyIds.length !== 1) return "Choose exactly one physical copy for a Single card sale.";
    if (draft.kind === "bulk" && draft.copyIds.length < 2) return "Choose at least two physical copies for a Bulk card sale.";
    return null;
  }

  function nextStep() {
    const problem = step === 1 ? typeError() : step === 2 ? detailsError() : selectionError();
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setStep((current) => Math.min(4, current + 1));
  }

  async function submit() {
    if (step !== 4) return;
    const problem = typeError() ?? detailsError() ?? selectionError();
    if (problem) {
      setError(problem);
      return;
    }
    setPending(true);
    const result = await source.createSale({
      recordName: draft.recordName.trim(),
      date: draft.date,
      source: draft.source.trim(),
      netProceedsPence: poundsToPence(draft.proceeds),
      notes: draft.notes.trim(),
      copyIds: draft.copyIds,
    });
    setPending(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    source.clearDraft("sale");
    onSaved(result.id!);
  }

  function chooseType(kind: SaleKind) {
    setDraft((current) => ({
      ...current,
      kind,
      copyIds: current.kind === kind ? current.copyIds : [],
    }));
  }

  function toggleCopy(copyId: string, checked: boolean) {
    setError(null);
    setDraft((current) => ({
      ...current,
      copyIds: checked
        ? current.kind === "single"
          ? [copyId]
          : Array.from(new Set([...current.copyIds, copyId]))
        : current.copyIds.filter((id) => id !== copyId),
    }));
  }

  function switchToSingleSale() {
    setError(null);
    setDraft((current) => ({
      ...current,
      kind: "single",
      // This action is only shown when exactly one Copy is selected, so the
      // selection remains valid when the transaction type changes.
      copyIds: current.copyIds.slice(0, 1),
    }));
  }

  function clearInventoryFilters() {
    setQuery("");
    setRarity("all");
    setSelectedOnly(false);
    setPage(1);
  }

  const saleLabel = draft.kind === "single" ? "Single card" : "Bulk cards";
  const saleRecordName = draft.recordName.trim() || generatedSaleRecordName(selectedCopies.map((item) => item.target.name));
  const requiredCopies = draft.kind === "single" ? 1 : 2;
  const remainingCopies = Math.max(0, requiredCopies - draft.copyIds.length);
  const selectionComplete = draft.kind !== null && remainingCopies === 0;
  const resultStart = filteredCopies.length ? (page - 1) * salePageSize + 1 : 0;
  const resultEnd = Math.min(page * salePageSize, filteredCopies.length);

  return (
    <form autoComplete="off" className="grid gap-4" onSubmit={(event) => event.preventDefault()}>
      <DestructiveToast message={error} onDismiss={() => setError(null)} />
      <WizardProgress labels={["Sale type", "Sale details", "Cards sold", "Review"]} step={step} />
      {legacyDraftReset ? <PreviewNotice label="Draft reset.">Your earlier Sale draft was reset because record names are now available.</PreviewNotice> : null}

      {step === 1 ? (
        <StepPanel step={step}>
          <FormSection
            description="Choose whether this sale contains one tracked card or several cards sold together."
            number={1}
            title="What kind of sale is this?"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              {([
                { kind: "single" as const, label: "Single card", description: "Sell exactly one physical copy already in your Inventory.", icon: CreditCard },
                { kind: "bulk" as const, label: "Bulk cards", description: "Sell two or more tracked card copies in one transaction.", icon: Boxes },
              ]).map((option) => {
                const Icon = option.icon;
                const selected = draft.kind === option.kind;
                return (
                  <button
                    aria-pressed={selected}
                    className={`group flex min-h-32 cursor-pointer items-start gap-4 rounded-lg border p-4 text-left transition focus:outline-none focus:ring-2 focus:ring-[#8a1f2d] focus:ring-offset-2 ${selected ? "border-[#8a1f2d] bg-rose-50 ring-1 ring-[#8a1f2d]" : "border-zinc-300 bg-white hover:border-zinc-500 hover:bg-zinc-50"}`}
                    key={option.kind}
                    onClick={() => chooseType(option.kind)}
                    type="button"
                  >
                    <span className={`grid size-11 shrink-0 place-items-center rounded-lg ${selected ? "bg-[#8a1f2d] text-white" : "bg-zinc-100 text-zinc-700 group-hover:bg-zinc-200"}`}>
                      <Icon className="size-5" />
                    </span>
                    <span>
                      <strong className="block text-base text-zinc-950">{option.label}</strong>
                      <span className="mt-1 block text-sm font-medium leading-5 text-zinc-500">{option.description}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </FormSection>
        </StepPanel>
      ) : null}

      {step === 2 ? (
        <StepPanel step={step}>
          <FormSection
            description="Record the shared facts for this transaction before choosing the cards."
            number={2}
            title="Sale details"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="sm:col-span-2">
                <span className="text-sm font-bold text-zinc-700">Record name <span className="font-medium text-zinc-400">(optional)</span></span>
                <input className={fieldClass} maxLength={80} onChange={(event) => setDraft((current) => ({ ...current, recordName: event.target.value }))} placeholder="e.g. Weekend eBay sales" value={draft.recordName} />
                <span className="mt-1 block text-xs font-medium text-zinc-500">Leave blank to generate a short name from the cards you select.</span>
              </label>
              <label>
                <span className="text-sm font-bold text-zinc-700">Sale date <span className="text-rose-700">*</span></span>
                <input className={fieldClass} onChange={(event) => setDraft((current) => ({ ...current, date: event.target.value }))} required type="date" value={draft.date} />
              </label>
              <label>
                <span className="text-sm font-bold text-zinc-700">Marketplace or buyer <span className="text-rose-700">*</span></span>
                <input className={fieldClass} onChange={(event) => setDraft((current) => ({ ...current, source: event.target.value }))} required value={draft.source} />
              </label>
              <label className="sm:col-span-2">
                <span className="text-sm font-bold text-zinc-700">Net proceeds <span className="text-rose-700">*</span></span>
                <div className="relative mt-1">
                  <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center font-bold leading-none text-zinc-500">£</span>
                  <input className={`${fieldClass} mt-0 pl-7`} inputMode="decimal" min="0" onChange={(event) => setDraft((current) => ({ ...current, proceeds: event.target.value }))} placeholder="0.00" required step="0.01" type="number" value={draft.proceeds} />
                </div>
                <span className="mt-1 block text-xs font-medium text-zinc-500">Enter what you kept after postage and marketplace fees.</span>
              </label>
              <label className="sm:col-span-2">
                <span className="text-sm font-bold text-zinc-700">Sale notes <span className="font-medium text-zinc-400">(optional)</span></span>
                <textarea className={textAreaClass} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} placeholder="Buyer, postage, condition, or sale context" value={draft.notes} />
              </label>
            </div>
          </FormSection>
        </StepPanel>
      ) : null}

      {step === 3 ? (
        <StepPanel step={step}>
          <FormSection
            description="Search your available Inventory and select the exact physical copies included in this transaction."
            number={3}
            title="Cards sold"
          >
            <div className="mb-4 flex flex-col gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-zinc-950 text-white">
                  {draft.kind === "single" ? <CreditCard className="size-5" /> : <Boxes className="size-5" />}
                </span>
                <div>
                  <strong className="block">{saleLabel} sale</strong>
                  <span className="mt-0.5 block text-sm font-medium text-zinc-500">
                    {draft.kind === "single" ? "Select exactly one card copy." : "Select at least two card copies sold together."}
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
                <span className={`inline-flex min-h-9 items-center gap-2 rounded-full px-3 text-sm font-bold ${selectionComplete ? "bg-emerald-50 text-emerald-800" : "bg-amber-100 text-amber-900"}`}>
                  {selectionComplete ? <CheckCircle2 className="size-4" /> : <Info className="size-4" />}
                  {selectionComplete ? "Ready to continue" : `${remainingCopies} more ${remainingCopies === 1 ? "copy" : "copies"} required`}
                </span>
                {draft.kind === "bulk" && draft.copyIds.length === 1 ? (
                  <button
                    className="inline-flex min-h-11 items-center rounded-md border border-zinc-300 bg-white px-3 text-sm font-bold text-zinc-800 transition hover:border-zinc-500 hover:bg-zinc-100"
                    onClick={switchToSingleSale}
                    type="button"
                  >
                    Switch to Single sale
                  </button>
                ) : null}
              </div>
            </div>

            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(180px,0.35fr)_auto] lg:items-end">
              <label>
                <span className="text-sm font-bold text-zinc-700">Search cards</span>
                <div className="relative mt-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
                  <input
                    className={`${fieldClass} mt-0 pl-9`}
                    onChange={(event) => { setQuery(event.target.value); setPage(1); }}
                    placeholder="Name, set, code, edition, rarity, condition"
                    type="search"
                    value={query}
                  />
                </div>
              </label>
              <label>
                <span className="text-sm font-bold text-zinc-700">Rarity</span>
                <select className={fieldClass} onChange={(event) => { setRarity(event.target.value); setPage(1); }} value={rarity}>
                  <option value="all">All rarities</option>
                  {rarityOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </label>
              <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-zinc-300 bg-zinc-50 px-3 text-sm font-bold text-zinc-700">
                <input checked={selectedOnly} className="size-4 accent-[#8a1f2d]" onChange={(event) => { setSelectedOnly(event.target.checked); setPage(1); }} type="checkbox" />
                Selected only
              </label>
            </div>

            <div className="mt-4 flex flex-col gap-1 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <strong>{draft.copyIds.length} {draft.copyIds.length === 1 ? "copy" : "copies"} selected</strong>
                <span className="mt-0.5 block text-sm font-medium text-zinc-500">
                  {selectionComplete
                    ? "Selection complete"
                    : draft.kind === "single"
                      ? "Choose one copy to continue"
                      : draft.copyIds.length === 1
                        ? "Bulk sales need two or more copies. Add another card or switch to Single sale."
                        : `Choose ${remainingCopies} more ${remainingCopies === 1 ? "copy" : "copies"} to continue`}
                </span>
              </div>
              <span className="text-sm font-medium text-zinc-500">Showing {resultStart}–{resultEnd} of {filteredCopies.length}</span>
            </div>

            {visibleCopies.length ? (
              <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
                {visibleCopies.map((item, index) => {
                  const selected = draft.copyIds.includes(item.copy.id);
                  return (
                    <label
                      className={`group relative cursor-pointer overflow-hidden rounded-lg border bg-white transition focus-within:ring-2 focus-within:ring-[#8a1f2d] focus-within:ring-offset-2 ${selected ? "border-[#8a1f2d] ring-1 ring-[#8a1f2d]" : "border-zinc-200 hover:border-zinc-400 hover:shadow-sm"}`}
                      key={item.copy.id}
                    >
                      <div className="relative aspect-[3/4] bg-zinc-100">
                        {item.imageUrl ? (
                          <Image
                            alt=""
                            className="object-contain p-2"
                            fill
                            loading={index < 4 ? "eager" : "lazy"}
                            sizes="(max-width: 768px) 50vw, (max-width: 1280px) 33vw, 25vw"
                            src={`/api/image-proxy?url=${encodeURIComponent(item.imageUrl)}`}
                            unoptimized
                          />
                        ) : (
                          <span className="grid h-full place-items-center text-xs font-black text-zinc-400">CARD</span>
                        )}
                        <input
                          aria-label={`Select ${item.target.name}, ${item.printing.setCode || "unknown set"}, copy ${item.copy.id.slice(-6)}`}
                          checked={selected}
                          className="sr-only"
                          name={draft.kind === "single" ? "sale-copy" : undefined}
                          onChange={(event) => toggleCopy(item.copy.id, event.target.checked)}
                          type={draft.kind === "single" ? "radio" : "checkbox"}
                        />
                        <span aria-hidden="true" className={`absolute right-2 top-2 z-10 grid size-9 place-items-center rounded-full border shadow-sm transition ${selected ? "border-[#8a1f2d] bg-[#8a1f2d] text-white" : "border-zinc-300 bg-white text-zinc-600 group-hover:border-zinc-500"}`}>
                          {selected ? <Check className="size-4" /> : <Plus className="size-4" />}
                        </span>
                        {selected ? (
                          <span className="absolute left-2 top-2 z-10 inline-flex items-center rounded-full bg-[#8a1f2d] px-2 py-1 text-[11px] font-black text-white shadow-sm">
                            Selected
                          </span>
                        ) : null}
                      </div>
                      <span className="block p-3">
                        <span className="line-clamp-2 block min-h-10 text-sm font-black leading-5 text-zinc-950">{item.target.name}</span>
                        <span className="mt-1 block text-xs font-bold text-[#8a1f2d]">{item.target.rarity || "Unknown rarity"}</span>
                        <span className="mt-1 block text-xs font-medium text-zinc-500">{item.printing.setCode || "Unknown set"} · {item.target.edition || "Unknown edition"}</span>
                        <span className="mt-1 block text-xs font-medium text-zinc-500">{item.copy.condition}</span>
                        <span className="mt-1 block text-[11px] font-medium text-zinc-400">Copy {item.copy.id.slice(-6)}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            ) : (
              <div className="mt-3 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-4 py-10 text-center">
                <p className="font-black text-zinc-800">{availableCopies.length ? "No cards match these filters" : "No available card copies"}</p>
                <p className="mt-1 text-sm font-medium text-zinc-500">{availableCopies.length ? "Clear the filters or search for a different card." : "Record an acquisition before creating a Sale."}</p>
                {availableCopies.length ? <button className="mt-4 min-h-11 rounded-md border border-zinc-300 bg-white px-4 text-sm font-bold" onClick={clearInventoryFilters} type="button">Clear filters</button> : null}
              </div>
            )}

            {filteredCopies.length > salePageSize ? (
              <nav aria-label="Card results pages" className="mt-4 flex items-center justify-between gap-3 border-t border-zinc-200 pt-4">
                <button className="inline-flex min-h-11 items-center gap-2 rounded-md border border-zinc-300 px-3 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-40" disabled={page === 1} onClick={() => setPage((current) => Math.max(1, current - 1))} type="button"><ChevronLeft className="size-4" /> Previous</button>
                <span className="text-sm font-bold text-zinc-600">Page {page} of {pageCount}</span>
                <button className="inline-flex min-h-11 items-center gap-2 rounded-md border border-zinc-300 px-3 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-40" disabled={page === pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))} type="button">Next <ChevronRight className="size-4" /></button>
              </nav>
            ) : null}

            <LibraryImpactNotice impacts={libraryImpacts} />
          </FormSection>
        </StepPanel>
      ) : null}

      {step === 4 ? (
        <StepPanel step={step}>
          <div className="grid gap-4">
            <PreviewNotice label={source.mode === "preview" ? "Preview only." : "Review before saving."}>This is a read-only review. Nothing has been saved; only the confirmation button below creates the {source.mode === "preview" ? "preview " : ""}Sale.</PreviewNotice>
            <FormSection
              description="Check the transaction and every selected physical copy before confirming."
              number={4}
              title="Review sale"
            >
              <div className="flex items-start justify-between gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                <div>
                  <span className="text-xs font-bold uppercase text-zinc-500">Record name</span>
                  <p className="mt-1 font-black">{saleRecordName}</p>
                  <p className="mt-1 text-sm font-medium text-zinc-500">{saleLabel} · £{penceToPounds(poundsToPence(draft.proceeds))} · {draft.source} · {draft.date}</p>
                </div>
                <button className="inline-flex min-h-11 items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-bold" onClick={() => setStep(2)} type="button"><Pencil className="size-4" /> Edit</button>
              </div>

              <div className="mt-5 flex items-center justify-between gap-3">
                <div>
                  <h3 className="font-black">Cards sold</h3>
                  <p className="mt-1 text-sm font-medium text-zinc-500">{selectedCopies.length} physical {selectedCopies.length === 1 ? "copy" : "copies"}</p>
                </div>
                <button className="inline-flex min-h-11 items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-bold" onClick={() => setStep(3)} type="button"><Pencil className="size-4" /> Edit</button>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
                {selectedCopies.map((item, index) => <CopyThumbnail eager={index < 4} item={item} key={item.copy.id} />)}
              </div>

              <LibraryImpactNotice impacts={libraryImpacts} />

              <div className="mt-4 rounded-lg border border-zinc-200 p-3">
                <span className="text-xs font-bold uppercase text-zinc-500">Notes</span>
                <p className="mt-1 whitespace-pre-wrap text-sm font-medium text-zinc-700">{draft.notes || "No sale notes."}</p>
              </div>
              <div className="mt-4 rounded-lg border border-[#8a1f2d]/30 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-950">
                <strong className="block font-black">Ready to record?</strong>
                <p className="mt-1">Confirm only after the proceeds and selected copies match the completed sale.</p>
              </div>
            </FormSection>
          </div>
        </StepPanel>
      ) : null}

      <WizardActions
        finalLabel={`Confirm${source.mode === "preview" ? " preview" : ""} sale`}
        onBack={() => { setError(null); setStep((current) => Math.max(1, current - 1)); }}
        onConfirm={submit}
        onNext={nextStep}
        nextDisabled={step === 3 && !selectionComplete}
        pending={pending}
        step={step}
        totalSteps={4}
      />
    </form>
  );
}

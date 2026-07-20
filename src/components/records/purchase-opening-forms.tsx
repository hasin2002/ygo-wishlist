"use client";

import {
  Archive,
  Boxes,
  CreditCard,
  ExternalLink,
  PackageOpen,
  Pencil,
  Search,
} from "lucide-react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  blankCardContents,
  CardContentsEditor,
  cardContentsError,
  type CardContentsDraft,
} from "@/components/records/card-contents-editor";
import {
  DestructiveToast,
  fieldClass,
  FormSection,
  penceToPounds,
  poundsToPence,
  PreviewNotice,
  selectNumberOnFocus,
  StepPanel,
  textAreaClass,
  today,
  WizardActions,
  WizardProgress,
} from "@/components/records/entry-form-ui";
import {
  blankProductIdentity,
  isTcgplayerProductUrl,
  ProductIdentityEditor,
  type ProductIdentityDraft,
} from "@/components/records/product-identity-editor";
import { useRecordsDataSource } from "@/components/records/records-preview-provider";
import type {
  InventoryKind,
  ProductEdition,
  ProductIdentityInput,
  SupplyCategory,
} from "@/lib/records/types";

const sourceOptions = [
  { value: "ebay", label: "eBay" },
  { value: "tcgplayer", label: "TCGplayer" },
  { value: "cardmarket", label: "Cardmarket" },
  { value: "facebook", label: "Facebook Marketplace" },
  { value: "local-shop", label: "Local card shop" },
  { value: "private-seller", label: "Private seller" },
  { value: "gift", label: "Gift" },
  { value: "other", label: "Other" },
] as const;

type SourceOption = (typeof sourceOptions)[number]["value"];
type SourceValue = { sourceOption: SourceOption; sourceOther: string };

function sourceLabel(value: SourceValue) {
  return value.sourceOption === "other"
    ? value.sourceOther.trim()
    : sourceOptions.find((option) => option.value === value.sourceOption)?.label ?? "Other";
}

function sourceValidationError(value: SourceValue) {
  return value.sourceOption === "other" && !value.sourceOther.trim()
    ? "Name the seller or source when Other is selected."
    : null;
}

function SellerSourceField({
  onChange,
  value,
}: {
  onChange: (value: SourceValue) => void;
  value: SourceValue;
}) {
  return (
    <>
      <label>
        <span className="text-sm font-bold text-zinc-700">Seller or source <span className="text-rose-700">*</span></span>
        <select
          className={fieldClass}
          onChange={(event) => onChange({
            sourceOption: event.target.value as SourceOption,
            sourceOther: event.target.value === "other" ? value.sourceOther : "",
          })}
          required
          value={value.sourceOption}
        >
          {sourceOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
      {value.sourceOption === "other" ? (
        <label className="sm:col-span-2">
          <span className="text-sm font-bold text-zinc-700">Seller or source name <span className="text-rose-700">*</span></span>
          <input
            className={fieldClass}
            onChange={(event) => onChange({ ...value, sourceOther: event.target.value })}
            required
            value={value.sourceOther}
          />
        </label>
      ) : null}
    </>
  );
}

const purchaseKindOptions = [
  { kind: "card", label: "Single card", description: "One exact printing, with one or more physical copies.", icon: CreditCard },
  { kind: "sealed", label: "Sealed product", description: "One pack, tin, box, deck, or other unopened product.", icon: PackageOpen },
  { kind: "bulk", label: "Bulk lot", description: "One grouped purchase whose identified cards are tracked inside it.", icon: Boxes },
  { kind: "supply", label: "Supply or extra", description: "Sleeves, binders, storage, playmats, and accessories.", icon: Archive },
] as const;

type SealedDraft = ProductIdentityDraft & { quantity: number };

type PurchaseDraft = {
  version: 6;
  kind: InventoryKind | null;
  recordName: string;
  date: string;
  sourceOption: SourceOption;
  sourceOther: string;
  listingUrl: string;
  total: string;
  notes: string;
  card: CardContentsDraft;
  sealed: SealedDraft;
  bulkTotalCardCount: string;
  bulkCards: CardContentsDraft[];
  supplyCategory: SupplyCategory;
  supplyOther: string;
  supplyQuantity: number;
};

function purchaseDraft(prefilledName: string): PurchaseDraft {
  return {
    version: 6,
    kind: prefilledName ? "card" : null,
    recordName: "",
    date: today(),
    sourceOption: "ebay",
    sourceOther: "",
    listingUrl: "",
    total: "",
    notes: "",
    card: blankCardContents(prefilledName),
    sealed: { ...blankProductIdentity(), quantity: 1 },
    bulkTotalCardCount: "",
    bulkCards: [blankCardContents()],
    supplyCategory: "sleeves",
    supplyOther: "",
    supplyQuantity: 1,
  };
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function productInput(value: ProductIdentityDraft): ProductIdentityInput {
  return {
    selectedTargetId: value.selectedTargetId,
    tcgplayerUrl: value.tcgplayerUrl.trim(),
    name: value.name.trim(),
    imageUrl: value.imageUrl,
    edition: value.edition as ProductEdition,
    rarity: value.rarity.trim(),
    setName: value.setName.trim(),
    setCode: value.setCode.trim(),
    metadataNeedsAttention: value.metadataNeedsAttention,
  };
}

function productError(value: ProductIdentityDraft, kind: "card" | "sealed") {
  if (!isTcgplayerProductUrl(value.tcgplayerUrl)) return "Add a complete TCGplayer product link.";
  if (!value.fetchAttempted) return "Fetch the product details at least once.";
  if (value.fetchStatus === "stale") return "The TCGplayer link changed. Fetch the product details again.";
  if (value.fetchStatus === "fetching") return "Wait for the product details to finish fetching.";
  if (!value.name.trim()) return `Add the ${kind === "card" ? "card" : "product"} name.`;
  if (kind === "card" && !value.edition) return "Choose the card edition.";
  if (kind === "card" && !value.rarity.trim()) return "Choose the card rarity.";
  return null;
}

function ProductReview({ item, kind = "card", quantity }: { item: ProductIdentityDraft; kind?: "card" | "sealed"; quantity: number }) {
  const detail = kind === "sealed"
    ? item.edition || "Edition missing"
    : `${item.edition || "Edition missing"} · ${item.rarity || "Rarity missing"} · ${item.setCode || item.setName || "Printing details incomplete"}`;

  return (
    <div className="flex items-start gap-3 rounded-lg border border-zinc-200 bg-white p-3">
      {item.imageUrl ? (
        <Image alt="" className="size-20 shrink-0 rounded-md object-contain" height={80} src={`/api/image-proxy?url=${encodeURIComponent(item.imageUrl)}`} unoptimized width={80} />
      ) : <span className="grid size-20 shrink-0 place-items-center rounded-md bg-zinc-100 text-xs font-bold text-zinc-400">ITEM</span>}
      <div className="min-w-0"><p className="font-bold text-zinc-950">{item.name}</p><p className="mt-1 text-sm font-medium text-zinc-500">{detail} · Quantity {quantity}</p>{item.metadataNeedsAttention ? <p className="mt-2 text-xs font-bold text-amber-700">Metadata needs attention</p> : null}</div>
    </div>
  );
}

function cardCountSummary(cards: Array<{ quantity: number }>) {
  const copies = cards.reduce((sum, card) => sum + card.quantity, 0);
  return `${cards.length} card ${cards.length === 1 ? "type" : "types"} · ${copies} ${copies === 1 ? "copy" : "copies"}`;
}

export function PurchaseForm({ onSaved }: { onSaved: (recordId: string) => void }) {
  const source = useRecordsDataSource();
  const searchParams = useSearchParams();
  const prefilledName = searchParams.get("cardName") ?? "";
  const prefilledTargetId = searchParams.get("targetId");
  const prefilledTarget = prefilledTargetId
    ? source.snapshot.targets.find((target) => target.id === prefilledTargetId)
    : null;
  const prefilledPrinting = prefilledTarget
    ? source.snapshot.printings.find((printing) => printing.targetId === prefilledTarget.id)
    : null;
  const stored = source.drafts.purchase as Partial<PurchaseDraft> | undefined;
  const legacyDraftReset = Boolean(stored && (stored as { version?: number }).version !== 6);
  const [draft, setDraft] = useState<PurchaseDraft>(() => {
    if ((stored as { version?: number } | undefined)?.version === 6) return stored as PurchaseDraft;
    const initial = purchaseDraft(prefilledTarget?.name || prefilledName);
    if (!prefilledTarget) return initial;
    const edition: ProductEdition = prefilledTarget.edition.toLowerCase().includes("unlimited")
      ? "Unlimited Edition"
      : "1st Edition";
    return {
      ...initial,
      card: {
        ...initial.card,
        tcgplayerUrl: prefilledPrinting?.tcgplayerUrl || prefilledTarget.tcgplayerUrl || "",
        name: prefilledTarget.name,
        imageUrl: prefilledPrinting?.imageUrl || prefilledTarget.imageUrl,
        edition,
        rarity: prefilledTarget.rarity,
        setName: prefilledPrinting?.setName || "",
        setCode: prefilledPrinting?.setCode || "",
        fetchStatus: "resolved",
        fetchAttempted: true,
        fetchMessage: "Loaded from this Library Target.",
        metadataNeedsAttention: !prefilledPrinting?.setCode,
        editedFields: [],
      },
    };
  });
  const [step, setStep] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const giftSelected = draft.sourceOption === "gift";
  const totalPence = giftSelected ? 0 : poundsToPence(draft.total);
  const resolvedSource = sourceLabel(draft);

  useEffect(() => source.setDraft("purchase", draft), [draft, source]);

  function detailsError() {
    if (!draft.recordName.trim()) return "Add a short record name before continuing.";
    if (!draft.date || !draft.total.trim()) return "Add the date and all-in amount before continuing.";
    const sourceProblem = sourceValidationError(draft);
    if (sourceProblem) return sourceProblem;
    if (draft.listingUrl.trim() && !isHttpUrl(draft.listingUrl.trim())) return "Enter a complete purchase listing link beginning with http:// or https://.";
    return null;
  }

  function itemError() {
    if (!draft.kind) return "Choose what kind of item you bought.";
    if (draft.kind === "card") return cardContentsError(draft.card);
    if (draft.kind === "sealed") {
      const problem = productError(draft.sealed, "sealed");
      if (problem) return problem;
      if (!Number.isInteger(draft.sealed.quantity) || draft.sealed.quantity < 1) return "Quantity must be at least one.";
    }
    if (draft.kind === "bulk") {
      if (!draft.bulkCards.length) return "Add at least one identified card.";
      const totalCardCount = Number(draft.bulkTotalCardCount);
      const identifiedCopies = draft.bulkCards.reduce((sum, card) => sum + card.quantity, 0);
      if (!Number.isInteger(totalCardCount) || totalCardCount < 1) return "Add the exact total number of physical cards in the lot.";
      if (totalCardCount < identifiedCopies) return `The lot total cannot be less than the ${identifiedCopies} identified physical copies.`;
      for (const card of draft.bulkCards) {
        const problem = cardContentsError(card);
        if (problem) return `${card.name || "A bulk card"}: ${problem}`;
      }
    }
    if (draft.kind === "supply") {
      if (draft.supplyCategory === "other" && !draft.supplyOther.trim()) return "Name the other supply or extra.";
      if (!Number.isInteger(draft.supplyQuantity) || draft.supplyQuantity < 1) return "Quantity must be at least one.";
    }
    return null;
  }

  function nextStep() {
    const problem = step === 1 ? (!draft.kind ? "Choose what kind of item you bought." : null) : step === 2 ? detailsError() : itemError();
    if (problem) { setError(problem); return; }
    setError(null);
    setStep((current) => Math.min(4, current + 1));
  }

  async function submit() {
    if (step !== 4 || !draft.kind) return;
    const problem = detailsError() ?? itemError();
    if (problem) { setError(problem); return; }
    setPending(true);

    const common = {
      recordName: draft.recordName.trim(),
      date: draft.date,
      source: resolvedSource,
      listingUrl: draft.listingUrl.trim(),
      totalPence,
      notes: draft.notes.trim(),
    };
    const result = await (draft.kind === "card"
      ? source.createPurchase({ ...common, kind: "card", card: { ...productInput(draft.card), id: draft.card.id, quantity: draft.card.quantity } })
      : draft.kind === "sealed"
        ? source.createPurchase({ ...common, kind: "sealed", product: { ...productInput(draft.sealed), quantity: draft.sealed.quantity } })
        : draft.kind === "bulk"
          ? source.createPurchase({ ...common, kind: "bulk", cards: draft.bulkCards.map((card) => ({ ...productInput(card), id: card.id, quantity: card.quantity })), totalCardCount: Number(draft.bulkTotalCardCount) })
          : source.createPurchase({ ...common, kind: "supply", category: draft.supplyCategory, otherName: draft.supplyOther.trim(), quantity: draft.supplyQuantity }));

    setPending(false);
    if (!result.ok) { setError(result.message); return; }
    source.clearDraft("purchase");
    onSaved(result.id!);
  }

  const selectedKind = purchaseKindOptions.find((option) => option.kind === draft.kind);

  return (
    <form autoComplete="off" className="grid gap-4" onSubmit={(event) => event.preventDefault()}>
      <DestructiveToast message={error} onDismiss={() => setError(null)} />
      <WizardProgress labels={["Item type", "Purchase", "Item details", "Review"]} step={step} />
      {legacyDraftReset ? <PreviewNotice label="Draft reset.">Your earlier purchase draft was reset because record names are now required.</PreviewNotice> : null}

      {step === 1 ? <StepPanel step={step}><FormSection description="Choose one acquisition kind. Bulk can contain several identified cards, but the Purchase itself stays one lot." number={1} title="What did you buy?">
        <div className="grid gap-3 sm:grid-cols-2">
          {purchaseKindOptions.map((option) => {
            const Icon = option.icon;
            const selected = draft.kind === option.kind;
            return <button aria-pressed={selected} className={`group flex min-h-32 cursor-pointer items-start gap-4 rounded-lg border p-4 text-left transition focus:outline-none focus:ring-2 focus:ring-[#8a1f2d] focus:ring-offset-2 ${selected ? "border-[#8a1f2d] bg-rose-50 ring-1 ring-[#8a1f2d]" : "border-zinc-300 bg-white hover:border-zinc-500 hover:bg-zinc-50"}`} key={option.kind} onClick={() => setDraft((current) => ({ ...current, kind: option.kind }))} type="button"><span className={`grid size-11 shrink-0 place-items-center rounded-lg ${selected ? "bg-[#8a1f2d] text-white" : "bg-zinc-100 text-zinc-700 group-hover:bg-zinc-200"}`}><Icon className="size-5" /></span><span><strong className="block text-base text-zinc-950">{option.label}</strong><span className="mt-1 block text-sm font-medium leading-5 text-zinc-500">{option.description}</span></span></button>;
          })}
        </div>
      </FormSection></StepPanel> : null}

      {step === 2 ? <StepPanel step={step}><FormSection description={`Record the shared facts for this ${selectedKind?.label.toLowerCase() || "purchase"}.`} number={2} title="Purchase details">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="sm:col-span-2"><span className="text-sm font-bold text-zinc-700">Record name <span className="text-rose-700">*</span></span><input className={fieldClass} maxLength={80} onChange={(event) => setDraft((current) => ({ ...current, recordName: event.target.value }))} placeholder="e.g. July eBay job lot" required value={draft.recordName} /><span className="mt-1 block text-xs font-medium text-zinc-500">A short label you will recognise in Records History.</span></label>
          <label><span className="text-sm font-bold text-zinc-700">Purchase date <span className="text-rose-700">*</span></span><input className={fieldClass} onChange={(event) => setDraft((current) => ({ ...current, date: event.target.value }))} required type="date" value={draft.date} /></label>
          <SellerSourceField onChange={(sourceValue) => setDraft((current) => ({ ...current, ...sourceValue, total: sourceValue.sourceOption === "gift" ? "0.00" : current.total }))} value={draft} />
          <label className="sm:col-span-2"><span className="text-sm font-bold text-zinc-700">Purchase listing link <span className="font-medium text-zinc-400">(optional)</span></span><input className={fieldClass} inputMode="url" onChange={(event) => setDraft((current) => ({ ...current, listingUrl: event.target.value }))} placeholder="https://www.ebay.co.uk/itm/…" type="url" value={draft.listingUrl} /></label>
          <label className="sm:col-span-2"><span className="text-sm font-bold text-zinc-700">All-in amount paid <span className="text-rose-700">*</span></span><div className="relative mt-1"><span className="pointer-events-none absolute inset-y-0 left-3 flex items-center font-bold leading-none text-zinc-500">£</span><input className={`${fieldClass} mt-0 pl-7 read-only:cursor-not-allowed read-only:bg-zinc-100 read-only:text-zinc-500`} inputMode="decimal" min="0" onChange={(event) => setDraft((current) => ({ ...current, total: event.target.value }))} placeholder="0.00" readOnly={giftSelected} required step="0.01" type="number" value={giftSelected ? "0.00" : draft.total} /></div><span className="mt-1 block text-xs font-medium text-zinc-500">{giftSelected ? "Gift selected — amount is fixed at £0.00." : "Include delivery, fees, and discounts."}</span></label>
          <label className="sm:col-span-2"><span className="text-sm font-bold text-zinc-700">Purchase notes <span className="font-medium text-zinc-400">(optional)</span></span><textarea className={textAreaClass} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} placeholder="Condition, postage, or purchase context" value={draft.notes} /></label>
        </div>
      </FormSection></StepPanel> : null}

      {step === 3 ? <StepPanel step={step}><FormSection description="Fetch the TCGplayer details, check the populated fields, and correct anything that is incomplete." number={3} title={`${selectedKind?.label || "Item"} details`}>
        {draft.kind === "card" ? <div className="grid gap-4"><ProductIdentityEditor kind="card" onChange={(identity) => setDraft((current) => ({ ...current, card: { ...current.card, ...identity } }))} value={draft.card} /><label className="sm:max-w-52"><span className="text-sm font-bold text-zinc-700">Quantity <span className="text-rose-700">*</span></span><input className={fieldClass} min="1" onChange={(event) => setDraft((current) => ({ ...current, card: { ...current.card, quantity: Number(event.target.value) } }))} onFocus={selectNumberOnFocus} required type="number" value={draft.card.quantity} /></label></div> : null}
        {draft.kind === "sealed" ? <div className="grid gap-4"><ProductIdentityEditor kind="sealed" onChange={(identity) => setDraft((current) => ({ ...current, sealed: { ...current.sealed, ...identity } }))} value={draft.sealed} /><label className="sm:max-w-52"><span className="text-sm font-bold text-zinc-700">Quantity <span className="text-rose-700">*</span></span><input className={fieldClass} min="1" onChange={(event) => setDraft((current) => ({ ...current, sealed: { ...current.sealed, quantity: Number(event.target.value) } }))} onFocus={selectNumberOnFocus} required type="number" value={draft.sealed.quantity} /></label></div> : null}
        {draft.kind === "bulk" ? <div className="grid gap-5"><label className="max-w-xs"><span className="text-sm font-bold text-zinc-700">Total cards in lot <span className="text-rose-700">*</span></span><input className={fieldClass} inputMode="numeric" min="1" onChange={(event) => setDraft((current) => ({ ...current, bulkTotalCardCount: event.target.value }))} onFocus={selectNumberOnFocus} placeholder="e.g. 100" required type="number" value={draft.bulkTotalCardCount} /><span className="mt-1 block text-xs font-medium leading-5 text-zinc-500">Count every physical card in the lot, even if you only identify some of them now. This fixes each card&apos;s share of the purchase cost.</span></label><CardContentsEditor onChange={(bulkCards) => setDraft((current) => ({ ...current, bulkCards }))} rows={draft.bulkCards} /></div> : null}
        {draft.kind === "supply" ? <div className="grid gap-4 sm:grid-cols-2"><label><span className="text-sm font-bold text-zinc-700">Supply or extra <span className="text-rose-700">*</span></span><select className={fieldClass} onChange={(event) => setDraft((current) => ({ ...current, supplyCategory: event.target.value as SupplyCategory }))} value={draft.supplyCategory}><option value="sleeves">Sleeves</option><option value="binder">Binder</option><option value="storage">Storage</option><option value="playmat">Playmat</option><option value="other">Other</option></select></label><label><span className="text-sm font-bold text-zinc-700">Quantity <span className="text-rose-700">*</span></span><input className={fieldClass} min="1" onChange={(event) => setDraft((current) => ({ ...current, supplyQuantity: Number(event.target.value) }))} onFocus={selectNumberOnFocus} required type="number" value={draft.supplyQuantity} /></label>{draft.supplyCategory === "other" ? <label className="sm:col-span-2"><span className="text-sm font-bold text-zinc-700">What is it? <span className="text-rose-700">*</span></span><input className={fieldClass} onChange={(event) => setDraft((current) => ({ ...current, supplyOther: event.target.value }))} required value={draft.supplyOther} /></label> : null}</div> : null}
      </FormSection></StepPanel> : null}

      {step === 4 ? <StepPanel step={step}><div className="grid gap-4"><PreviewNotice label={source.mode === "preview" ? "Preview only." : "Review before saving."}>This is a read-only review. Nothing has been saved; only the confirmation button below creates the {source.mode === "preview" ? "preview " : ""}purchase.</PreviewNotice><FormSection description="Check the purchase facts and item details. Use Edit to correct a section before confirming." number={4} title="Review purchase">
        <div className="flex items-start justify-between gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3"><div><span className="text-xs font-bold uppercase text-zinc-500">Record name</span><p className="mt-1 font-bold">{draft.recordName}</p><p className="mt-1 text-sm font-medium text-zinc-500">{selectedKind?.label} · £{penceToPounds(totalPence)} · {resolvedSource} · {draft.date}</p></div><button className="inline-flex min-h-11 items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-bold" onClick={() => setStep(2)} type="button"><Pencil className="size-4" /> Edit</button></div>
        {draft.listingUrl ? <a className="mt-3 inline-flex min-h-11 items-center gap-2 break-all text-sm font-bold text-[#8a1f2d]" href={draft.listingUrl} rel="noreferrer" target="_blank">Open original listing <ExternalLink className="size-4 shrink-0" /></a> : null}
        <div className="mt-4 grid gap-3">
          <div className="flex items-center justify-between"><h3 className="font-bold">{selectedKind?.label}</h3><button className="inline-flex min-h-11 items-center gap-2 rounded-md border border-zinc-300 px-3 text-sm font-bold" onClick={() => setStep(3)} type="button"><Pencil className="size-4" /> Edit</button></div>
          {draft.kind === "card" ? <ProductReview item={draft.card} quantity={draft.card.quantity} /> : null}
          {draft.kind === "sealed" ? <ProductReview item={draft.sealed} kind="sealed" quantity={draft.sealed.quantity} /> : null}
          {draft.kind === "bulk" ? <><div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm font-medium"><strong className="font-bold">{cardCountSummary(draft.bulkCards)}</strong><span className="mt-1 block text-zinc-600">{draft.bulkCards.reduce((sum, card) => sum + card.quantity, 0)} identified of {draft.bulkTotalCardCount} total cards · allocation uses £{penceToPounds(totalPence)} ÷ {draft.bulkTotalCardCount}</span></div>{draft.bulkCards.map((card) => <ProductReview item={card} key={card.id} quantity={card.quantity} />)}</> : null}
          {draft.kind === "supply" ? <div className="rounded-lg border border-zinc-200 p-3"><p className="font-bold capitalize">{draft.supplyCategory === "other" ? draft.supplyOther : draft.supplyCategory}</p><p className="mt-1 text-sm font-medium text-zinc-500">Quantity {draft.supplyQuantity}</p></div> : null}
        </div>
        <div className="mt-4 rounded-lg border border-zinc-200 p-3"><span className="text-xs font-bold uppercase text-zinc-500">Notes</span><p className="mt-1 whitespace-pre-wrap text-sm font-medium text-zinc-700">{draft.notes || "No purchase notes."}</p></div>
        <div className="mt-4 rounded-lg border border-[#8a1f2d]/30 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-950"><strong className="block font-black">Ready to record?</strong><p className="mt-1">Confirm only after the summary above matches what you bought.</p></div>
      </FormSection></div></StepPanel> : null}

      <WizardActions finalLabel={`Confirm${source.mode === "preview" ? " preview" : ""} purchase`} onBack={() => { setError(null); setStep((current) => Math.max(1, current - 1)); }} onConfirm={submit} onNext={nextStep} pending={pending} step={step} totalSteps={4} />
    </form>
  );
}

type OpeningDraft = {
  version: 7;
  acquisitionMode: "tracked" | "untracked" | null;
  recordName: string;
  date: string;
  notes: string;
  total: string;
  product: ProductIdentityDraft;
  sealedUnitId: string | null;
  sourceOption: SourceOption;
  sourceOther: string;
  pulls: CardContentsDraft[];
};

export function OpeningForm({ onSaved }: { onSaved: (recordId: string) => void }) {
  const source = useRecordsDataSource();
  const searchParams = useSearchParams();
  const requested = searchParams.get("sealedId");
  const requestedUnit = source.snapshot.sealedUnits.find((unit) => unit.id === requested && unit.status === "sealed");
  const stored = source.drafts["pack-opening"] as Partial<OpeningDraft> | undefined;
  const legacyDraftReset = Boolean(stored && (stored as { version?: number }).version !== 7);
  const [draft, setDraft] = useState<OpeningDraft>(() => (stored as { version?: number } | undefined)?.version === 7 ? stored as OpeningDraft : {
    version: 7,
    acquisitionMode: requestedUnit ? "tracked" : null,
    recordName: "",
    date: today(),
    notes: "",
    total: requestedUnit ? ((source.snapshot.records.find((record) => record.id === requestedUnit.acquiredRecordId)?.amountPence ?? 0) / 100).toFixed(2) : "",
    product: {
      ...blankProductIdentity(requestedUnit?.name || ""),
      tcgplayerUrl: requestedUnit?.tcgplayerUrl || "",
      imageUrl: requestedUnit?.imageUrl || null,
      edition: requestedUnit?.edition || "",
      editedFields: [],
    },
    sealedUnitId: requestedUnit?.id || null,
    sourceOption: "ebay",
    sourceOther: "",
    pulls: [blankCardContents()],
  });
  const [step, setStep] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [sealedQuery, setSealedQuery] = useState("");
  const resolvedSource = sourceLabel(draft);
  const giftSelected = draft.sourceOption === "gift";
  const selectedTrackedUnit = draft.acquisitionMode === "tracked"
    ? source.snapshot.sealedUnits.find((unit) => unit.id === draft.sealedUnitId && unit.status === "sealed")
    : null;
  const selectedAcquisition = selectedTrackedUnit
    ? source.snapshot.records.find((record) => record.id === selectedTrackedUnit.acquiredRecordId)
    : null;
  const openingSource = selectedAcquisition?.source ?? resolvedSource;
  const openingTotalPence = selectedAcquisition?.amountPence ?? (giftSelected ? 0 : poundsToPence(draft.total));
  const matchingSealedUnits = source.snapshot.sealedUnits.filter((unit) => {
    if (unit.status !== "sealed") return false;
    const acquisition = source.snapshot.records.find((record) => record.id === unit.acquiredRecordId);
    const query = sealedQuery.trim().toLowerCase();
    return !query || [unit.name, unit.edition, acquisition?.source, acquisition?.title].filter(Boolean).join(" ").toLowerCase().includes(query);
  });

  useEffect(() => source.setDraft("pack-opening", draft), [draft, source]);

  function selectTrackedUnit(sealedUnitId: string) {
    const unit = source.snapshot.sealedUnits.find((item) => item.id === sealedUnitId && item.status === "sealed");
    const acquisition = unit ? source.snapshot.records.find((record) => record.id === unit.acquiredRecordId) : null;
    if (!unit || !acquisition) return;
    setDraft((current) => ({ ...current, acquisitionMode: "tracked", sealedUnitId: unit.id,
      sourceOption: sourceOptions.find((option) => option.label === acquisition.source)?.value ?? "other",
      sourceOther: sourceOptions.some((option) => option.label === acquisition.source) ? "" : acquisition.source,
      total: (acquisition.amountPence / 100).toFixed(2),
      product: { ...current.product, name: unit.name, tcgplayerUrl: unit.tcgplayerUrl || "", imageUrl: unit.imageUrl || null, edition: unit.edition || "", fetchAttempted: true, fetchStatus: "resolved", fetchMessage: "Loaded from tracked sealed stock." },
    }));
  }

  function updateOpeningEdition(edition: ProductEdition | "") {
    setDraft((current) => ({ ...current, product: { ...current.product, edition } }));
  }

  function productStepError() {
    if (!draft.recordName.trim()) return "Add a short record name before continuing.";
    if (draft.acquisitionMode === "tracked" && !selectedTrackedUnit) return "Choose one sealed product from your tracked stock.";
    if (draft.acquisitionMode === "untracked") {
      const problem = productError(draft.product, "sealed");
      if (problem) return problem;
      if (!giftSelected && !draft.total.trim()) return "Add the all-in amount paid, or choose Gift.";
    }
    if (!draft.date) return "Add the opening date.";
    const sourceProblem = sourceValidationError(draft);
    if (sourceProblem) return sourceProblem;
    return null;
  }

  function openingTypeError() {
    return draft.acquisitionMode ? null : "Choose whether this opening uses tracked sealed stock or is untracked.";
  }

  function pullsError() {
    if (!draft.pulls.length) return "Add at least one pulled card.";
    for (const pull of draft.pulls) {
      const problem = cardContentsError(pull);
      if (problem) return `${pull.name || "A pulled card"}: ${problem}`;
    }
    return null;
  }

  function nextStep() {
    const problem = step === 1 ? openingTypeError() : step === 2 ? productStepError() : pullsError();
    if (problem) { setError(problem); return; }
    setError(null);
    setStep((current) => Math.min(4, current + 1));
  }

  async function submit() {
    if (step !== 4) return;
    const problem = openingTypeError() ?? productStepError() ?? pullsError();
    if (problem) { setError(problem); return; }
    setPending(true);
    const result = await source.createOpening({
      recordName: draft.recordName.trim(),
      date: draft.date,
      notes: draft.notes.trim(),
      product: productInput(draft.product),
      sealedUnitId: draft.sealedUnitId,
      source: openingSource,
      totalPence: openingTotalPence,
      useTrackedStock: draft.acquisitionMode === "tracked",
      pulls: draft.pulls.map((pull) => ({ ...productInput(pull), id: pull.id, quantity: pull.quantity })),
    });
    setPending(false);
    if (!result.ok) { setError(result.message); return; }
    source.clearDraft("pack-opening");
    onSaved(result.id!);
  }

  return (
    <form autoComplete="off" className="grid gap-4" onSubmit={(event) => event.preventDefault()}>
      <DestructiveToast message={error} onDismiss={() => setError(null)} />
      <WizardProgress labels={["Opening type", "Product", "Pulled cards", "Review"]} step={step} />
      {legacyDraftReset ? <PreviewNotice label="Draft reset.">Your earlier opening draft was reset because the opening type is now a separate first step.</PreviewNotice> : null}

      {step === 1 ? <StepPanel step={step}><FormSection description="Choose the kind of opening before adding any product details." number={1} title="How are you recording this opening?"><div className="grid gap-3 sm:grid-cols-2"><button aria-pressed={draft.acquisitionMode === "tracked"} className={`group flex min-h-32 items-start gap-4 rounded-lg border p-5 text-left ${draft.acquisitionMode === "tracked" ? "border-[#8a1f2d] bg-rose-50" : "border-zinc-300 bg-white hover:border-zinc-500 hover:bg-zinc-50"}`} onClick={() => setDraft((current) => ({ ...current, acquisitionMode: "tracked", sealedUnitId: null }))} type="button"><span className={`grid size-12 shrink-0 place-items-center rounded-lg ${draft.acquisitionMode === "tracked" ? "bg-[#8a1f2d] text-white" : "bg-zinc-100 text-zinc-700 group-hover:bg-zinc-200"}`}><Archive className="size-6" /></span><span><strong className="block text-lg">Tracked sealed stock</strong><span className="mt-2 block text-sm font-medium text-zinc-500">Choose one product already in your sealed Inventory.</span></span></button><button aria-pressed={draft.acquisitionMode === "untracked"} className={`group flex min-h-32 items-start gap-4 rounded-lg border p-5 text-left ${draft.acquisitionMode === "untracked" ? "border-[#8a1f2d] bg-rose-50" : "border-zinc-300 bg-white hover:border-zinc-500 hover:bg-zinc-50"}`} onClick={() => setDraft((current) => ({ ...current, acquisitionMode: "untracked", sealedUnitId: null }))} type="button"><span className={`grid size-12 shrink-0 place-items-center rounded-lg ${draft.acquisitionMode === "untracked" ? "bg-[#8a1f2d] text-white" : "bg-zinc-100 text-zinc-700 group-hover:bg-zinc-200"}`}><PackageOpen className="size-6" /></span><span><strong className="block text-lg">Untracked opening</strong><span className="mt-2 block text-sm font-medium text-zinc-500">Record the sealed product, source, and full cost now.</span></span></button></div></FormSection></StepPanel> : null}

      {step === 2 ? <StepPanel step={step}><FormSection description={draft.acquisitionMode === "tracked" ? "Find the exact sealed unit you are opening." : "Add the sealed product and the shared details for this opening."} number={2} title="Opening details">
        {draft.acquisitionMode === "tracked" ? <div className="grid gap-4"><label><span className="text-sm font-bold text-zinc-700">Find sealed product <span className="text-rose-700">*</span></span><span className="relative mt-1 block"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" /><input autoFocus className={`${fieldClass} mt-0 pl-9`} onChange={(event) => setSealedQuery(event.target.value)} placeholder="Search product, edition, source, or purchase name" value={sealedQuery} /></span></label><div className="max-h-72 overflow-y-auto rounded-lg border border-zinc-200 bg-white p-2">{matchingSealedUnits.length ? matchingSealedUnits.map((unit) => { const acquisition = source.snapshot.records.find((record) => record.id === unit.acquiredRecordId); const selected = unit.id === draft.sealedUnitId; return <button aria-pressed={selected} className={`w-full rounded-md border p-3 text-left transition ${selected ? "border-[#8a1f2d] bg-rose-50" : "border-transparent hover:border-zinc-300 hover:bg-zinc-50"}`} key={unit.id} onClick={() => selectTrackedUnit(unit.id)} type="button"><span className="block font-bold text-zinc-950">{unit.name}</span><span className="mt-1 block text-sm font-medium text-zinc-500">{unit.edition || "Edition unknown"} · {acquisition ? `£${(acquisition.amountPence / 100).toFixed(2)} · ${acquisition.source} · ${acquisition.date}` : "Purchase details unavailable"}</span></button>; }) : <p className="px-3 py-6 text-center text-sm font-medium text-zinc-500">No available sealed products match that search.</p>}</div>{selectedAcquisition ? <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm"><strong className="block">Cost from the original sealed purchase</strong><p className="mt-1 font-medium text-zinc-600">£{(selectedAcquisition.amountPence / 100).toFixed(2)} · {selectedAcquisition.source} · {selectedAcquisition.date}</p><p className="mt-1 text-zinc-500">This opening will use one sealed unit. The cost is already counted on that purchase.</p></div> : null}</div> : <div className="grid gap-5"><ProductIdentityEditor hideSealedEdition kind="sealed" onChange={(product) => setDraft((current) => ({ ...current, product }))} value={draft.product} /><label><span className="text-sm font-bold text-zinc-700">Record name <span className="text-rose-700">*</span></span><input className={fieldClass} maxLength={80} onChange={(event) => setDraft((current) => ({ ...current, recordName: event.target.value }))} placeholder="e.g. Spellcasters Command opening" required value={draft.recordName} /></label><div className="grid gap-4 sm:grid-cols-2"><label><span className="text-sm font-bold text-zinc-700">Product edition <span className="font-medium text-zinc-400">(optional)</span></span><select className={fieldClass} onChange={(event) => updateOpeningEdition(event.target.value as ProductEdition | "")} value={draft.product.edition}><option value="">Not specified</option><option value="1st Edition">1st Edition</option><option value="Unlimited Edition">Unlimited Edition</option><option value="Limited Edition">Limited Edition</option></select></label><SellerSourceField onChange={(sourceValue) => setDraft((current) => ({ ...current, ...sourceValue, total: sourceValue.sourceOption === "gift" ? "0.00" : current.total }))} value={draft} /></div><div className="grid gap-4 sm:grid-cols-2"><label><span className="text-sm font-bold text-zinc-700">All-in amount paid <span className="text-rose-700">*</span></span><div className="relative mt-1"><span className="pointer-events-none absolute inset-y-0 left-3 flex items-center font-bold text-zinc-500">£</span><input className={`${fieldClass} mt-0 pl-7 read-only:bg-zinc-100`} inputMode="decimal" min="0" onChange={(event) => setDraft((current) => ({ ...current, total: event.target.value }))} readOnly={giftSelected} required step="0.01" type="number" value={giftSelected ? "0.00" : draft.total} /></div><span className="mt-1 block text-xs font-medium text-zinc-500">{giftSelected ? "Gift selected — amount is fixed at £0.00." : "Include delivery, fees, and discounts."}</span></label><label><span className="text-sm font-bold text-zinc-700">Opening date <span className="text-rose-700">*</span></span><input className={fieldClass} onChange={(event) => setDraft((current) => ({ ...current, date: event.target.value }))} required type="date" value={draft.date} /></label></div><label><span className="text-sm font-bold text-zinc-700">Opening notes <span className="font-medium text-zinc-400">(optional)</span></span><textarea className={textAreaClass} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} placeholder="Condition, pull, or opening context" value={draft.notes} /></label></div>}
      </FormSection></StepPanel> : null}

      {step === 3 ? <StepPanel step={step}><FormSection description="Each row creates physical Copies tied to this opening. Fetch and check every card before reviewing." number={3} title="Pulled cards"><CardContentsEditor noun="pulled card" onChange={(pulls) => setDraft((current) => ({ ...current, pulls }))} rows={draft.pulls} /></FormSection></StepPanel> : null}

      {step === 4 ? <StepPanel step={step}><div className="grid gap-4"><PreviewNotice label={source.mode === "preview" ? "Preview only." : "Review before saving."}>This is a read-only review. Nothing has been saved; only the confirmation button below creates the {source.mode === "preview" ? "preview " : ""}opening.</PreviewNotice><FormSection description="Check the product, source, date, pulled cards, and notes. Use Edit to correct a section." number={4} title="Review opening">
        <div className="flex items-start justify-between gap-3"><div><span className="text-xs font-bold uppercase text-zinc-500">Record name</span><h3 className="mt-1 font-bold">{draft.recordName}</h3><p className="mt-1 text-sm font-medium text-zinc-500">Opened product · {openingSource} · {draft.date}</p></div><button className="inline-flex min-h-11 items-center gap-2 rounded-md border border-zinc-300 px-3 text-sm font-bold" onClick={() => setStep(2)} type="button"><Pencil className="size-4" /> Edit</button></div><div className="mt-3"><ProductReview item={draft.product} kind="sealed" quantity={1} /></div>
        <div className="mt-5 flex items-start justify-between gap-3"><div><h3 className="font-bold">Pulled cards</h3><p className="mt-1 text-sm font-medium text-zinc-500">{cardCountSummary(draft.pulls)}</p></div><button className="inline-flex min-h-11 items-center gap-2 rounded-md border border-zinc-300 px-3 text-sm font-bold" onClick={() => setStep(3)} type="button"><Pencil className="size-4" /> Edit</button></div><div className="mt-3 grid gap-3">{draft.pulls.map((pull) => <ProductReview item={pull} key={pull.id} quantity={pull.quantity} />)}</div>
        <div className="mt-4 rounded-lg border border-zinc-200 p-3"><span className="text-xs font-bold uppercase text-zinc-500">Notes</span><p className="mt-1 whitespace-pre-wrap text-sm font-medium text-zinc-700">{draft.notes || "No opening notes."}</p></div>
        <div className="mt-4 rounded-lg border border-[#8a1f2d]/30 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-950"><strong className="block font-black">Ready to record?</strong><p className="mt-1">Confirm only after the product and every pulled card are correct.</p></div>
      </FormSection></div></StepPanel> : null}

      <WizardActions finalLabel={`Confirm${source.mode === "preview" ? " preview" : ""} opening`} onBack={() => { setError(null); setStep((current) => Math.max(1, current - 1)); }} onConfirm={submit} onNext={nextStep} pending={pending} step={step} totalSteps={4} />
    </form>
  );
}

"use client";

import {
  Archive,
  Boxes,
  CreditCard,
  ExternalLink,
  PackageOpen,
  Pencil,
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
  version: 3;
  kind: InventoryKind | null;
  date: string;
  sourceOption: SourceOption;
  sourceOther: string;
  listingUrl: string;
  total: string;
  notes: string;
  card: CardContentsDraft;
  sealed: SealedDraft;
  bulkCards: CardContentsDraft[];
  moreToItemize: boolean | null;
  supplyCategory: SupplyCategory;
  supplyOther: string;
  supplyQuantity: number;
};

function purchaseDraft(prefilledName: string): PurchaseDraft {
  return {
    version: 3,
    kind: prefilledName ? "card" : null,
    date: today(),
    sourceOption: "ebay",
    sourceOther: "",
    listingUrl: "",
    total: "",
    notes: "",
    card: blankCardContents(prefilledName),
    sealed: { ...blankProductIdentity(), quantity: 1 },
    bulkCards: [blankCardContents()],
    moreToItemize: null,
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
    tcgplayerUrl: value.tcgplayerUrl.trim(),
    name: value.name.trim(),
    imageUrl: value.imageUrl,
    edition: value.edition,
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
  if (kind === "card" && !value.rarity.trim()) return "Choose the card rarity.";
  if (kind === "sealed" && !value.edition) return "Choose the product edition.";
  return null;
}

function ProductReview({ item, kind = "card", quantity }: { item: ProductIdentityDraft; kind?: "card" | "sealed"; quantity: number }) {
  const detail = kind === "sealed"
    ? item.edition || "Edition missing"
    : `${item.rarity ? `${item.rarity} · ` : ""}${item.setCode || item.setName || "Product details incomplete"}`;

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
  const stored = source.drafts.purchase as Partial<PurchaseDraft> | undefined;
  const legacyDraftReset = Boolean(stored && stored.version !== 3);
  const [draft, setDraft] = useState<PurchaseDraft>(() => stored?.version === 3 ? stored as PurchaseDraft : purchaseDraft(prefilledName));
  const [step, setStep] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const totalPence = poundsToPence(draft.total);
  const resolvedSource = sourceLabel(draft);

  useEffect(() => source.setDraft("purchase", draft), [draft, source]);

  function detailsError() {
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
      for (const card of draft.bulkCards) {
        const problem = cardContentsError(card);
        if (problem) return `${card.name || "A bulk card"}: ${problem}`;
      }
      if (draft.moreToItemize === null) return "Say whether more cards remain to itemize.";
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

  function submit() {
    if (step !== 4 || !draft.kind) return;
    const problem = detailsError() ?? itemError();
    if (problem) { setError(problem); return; }
    setPending(true);

    const common = {
      date: draft.date,
      source: resolvedSource,
      listingUrl: draft.listingUrl.trim(),
      totalPence,
      notes: draft.notes.trim(),
    };
    const result = draft.kind === "card"
      ? source.createPurchase({ ...common, kind: "card", card: { ...productInput(draft.card), id: draft.card.id, quantity: draft.card.quantity } })
      : draft.kind === "sealed"
        ? source.createPurchase({ ...common, kind: "sealed", product: { ...productInput(draft.sealed), quantity: draft.sealed.quantity } })
        : draft.kind === "bulk"
          ? source.createPurchase({ ...common, kind: "bulk", cards: draft.bulkCards.map((card) => ({ ...productInput(card), id: card.id, quantity: card.quantity })), moreToItemize: draft.moreToItemize === true })
          : source.createPurchase({ ...common, kind: "supply", category: draft.supplyCategory, otherName: draft.supplyOther.trim(), quantity: draft.supplyQuantity });

    setPending(false);
    if (!result.ok) { setError(result.message); return; }
    source.clearDraft("purchase");
    onSaved(result.id!);
  }

  const selectedKind = purchaseKindOptions.find((option) => option.kind === draft.kind);

  return (
    <form className="grid gap-4" onSubmit={(event) => event.preventDefault()}>
      <DestructiveToast message={error} onDismiss={() => setError(null)} />
      <WizardProgress labels={["Item type", "Purchase", "Item details", "Review"]} step={step} />
      {legacyDraftReset ? <PreviewNotice>The earlier purchase draft used the replaced mixed-item format, so only that draft was reset.</PreviewNotice> : null}

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
          <label><span className="text-sm font-bold text-zinc-700">Purchase date <span className="text-rose-700">*</span></span><input className={fieldClass} onChange={(event) => setDraft((current) => ({ ...current, date: event.target.value }))} required type="date" value={draft.date} /></label>
          <SellerSourceField onChange={(sourceValue) => setDraft((current) => ({ ...current, ...sourceValue }))} value={draft} />
          <label className="sm:col-span-2"><span className="text-sm font-bold text-zinc-700">Purchase listing link <span className="font-medium text-zinc-400">(optional)</span></span><input className={fieldClass} inputMode="url" onChange={(event) => setDraft((current) => ({ ...current, listingUrl: event.target.value }))} placeholder="https://www.ebay.co.uk/itm/…" type="url" value={draft.listingUrl} /></label>
          <label className="sm:col-span-2"><span className="text-sm font-bold text-zinc-700">All-in amount paid <span className="text-rose-700">*</span></span><div className="relative mt-1"><span className="pointer-events-none absolute inset-y-0 left-3 flex items-center font-bold leading-none text-zinc-500">£</span><input className={`${fieldClass} mt-0 pl-7`} inputMode="decimal" min="0" onChange={(event) => setDraft((current) => ({ ...current, total: event.target.value }))} placeholder="0.00" required step="0.01" type="number" value={draft.total} /></div><span className="mt-1 block text-xs font-medium text-zinc-500">Include delivery, fees, and discounts.</span></label>
          <label className="sm:col-span-2"><span className="text-sm font-bold text-zinc-700">Purchase notes <span className="font-medium text-zinc-400">(optional)</span></span><textarea className={textAreaClass} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} placeholder="Condition, postage, or purchase context" value={draft.notes} /></label>
        </div>
      </FormSection></StepPanel> : null}

      {step === 3 ? <StepPanel step={step}><FormSection description="Fetch the TCGplayer details, check the populated fields, and correct anything that is incomplete." number={3} title={`${selectedKind?.label || "Item"} details`}>
        {draft.kind === "card" ? <div className="grid gap-4"><ProductIdentityEditor kind="card" onChange={(identity) => setDraft((current) => ({ ...current, card: { ...current.card, ...identity } }))} value={draft.card} /><label className="sm:max-w-52"><span className="text-sm font-bold text-zinc-700">Quantity <span className="text-rose-700">*</span></span><input className={fieldClass} min="1" onChange={(event) => setDraft((current) => ({ ...current, card: { ...current.card, quantity: Number(event.target.value) } }))} required type="number" value={draft.card.quantity} /></label></div> : null}
        {draft.kind === "sealed" ? <div className="grid gap-4"><ProductIdentityEditor kind="sealed" onChange={(identity) => setDraft((current) => ({ ...current, sealed: { ...current.sealed, ...identity } }))} value={draft.sealed} /><label className="sm:max-w-52"><span className="text-sm font-bold text-zinc-700">Quantity <span className="text-rose-700">*</span></span><input className={fieldClass} min="1" onChange={(event) => setDraft((current) => ({ ...current, sealed: { ...current.sealed, quantity: Number(event.target.value) } }))} required type="number" value={draft.sealed.quantity} /></label></div> : null}
        {draft.kind === "bulk" ? <div className="grid gap-4"><CardContentsEditor onChange={(bulkCards) => setDraft((current) => ({ ...current, bulkCards }))} rows={draft.bulkCards} /><fieldset className="rounded-lg border border-zinc-200 bg-zinc-50 p-3"><legend className="px-1 text-sm font-bold text-zinc-700">Are there more cards to identify? <span className="text-rose-700">*</span></legend><div className="mt-2 grid gap-2 sm:grid-cols-2">{[{ value: true, label: "Yes, keep this lot open", hint: "Add or correct cards later without new spend." }, { value: false, label: "No, this lot is complete", hint: "Everything currently known has been entered." }].map((option) => <button aria-pressed={draft.moreToItemize === option.value} className={`min-h-20 rounded-md border p-3 text-left ${draft.moreToItemize === option.value ? "border-[#8a1f2d] bg-rose-50" : "border-zinc-300 bg-white"}`} key={String(option.value)} onClick={() => setDraft((current) => ({ ...current, moreToItemize: option.value }))} type="button"><strong className="block">{option.label}</strong><span className="mt-1 block text-xs font-medium text-zinc-500">{option.hint}</span></button>)}</div></fieldset></div> : null}
        {draft.kind === "supply" ? <div className="grid gap-4 sm:grid-cols-2"><label><span className="text-sm font-bold text-zinc-700">Supply or extra <span className="text-rose-700">*</span></span><select className={fieldClass} onChange={(event) => setDraft((current) => ({ ...current, supplyCategory: event.target.value as SupplyCategory }))} value={draft.supplyCategory}><option value="sleeves">Sleeves</option><option value="binder">Binder</option><option value="storage">Storage</option><option value="playmat">Playmat</option><option value="other">Other</option></select></label><label><span className="text-sm font-bold text-zinc-700">Quantity <span className="text-rose-700">*</span></span><input className={fieldClass} min="1" onChange={(event) => setDraft((current) => ({ ...current, supplyQuantity: Number(event.target.value) }))} required type="number" value={draft.supplyQuantity} /></label>{draft.supplyCategory === "other" ? <label className="sm:col-span-2"><span className="text-sm font-bold text-zinc-700">What is it? <span className="text-rose-700">*</span></span><input className={fieldClass} onChange={(event) => setDraft((current) => ({ ...current, supplyOther: event.target.value }))} required value={draft.supplyOther} /></label> : null}</div> : null}
      </FormSection></StepPanel> : null}

      {step === 4 ? <StepPanel step={step}><div className="grid gap-4"><PreviewNotice>This is a read-only review. Nothing has been saved; only the confirmation button below creates the preview purchase.</PreviewNotice><FormSection description="Check the purchase facts and item details. Use Edit to correct a section before confirming." number={4} title="Review purchase">
        <div className="flex items-start justify-between gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3"><div><span className="text-xs font-bold uppercase text-zinc-500">Purchase</span><p className="mt-1 font-bold">{selectedKind?.label} · £{penceToPounds(totalPence)}</p><p className="mt-1 text-sm font-medium text-zinc-500">{resolvedSource} · {draft.date}</p></div><button className="inline-flex min-h-11 items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-bold" onClick={() => setStep(2)} type="button"><Pencil className="size-4" /> Edit</button></div>
        {draft.listingUrl ? <a className="mt-3 inline-flex min-h-11 items-center gap-2 break-all text-sm font-bold text-[#8a1f2d]" href={draft.listingUrl} rel="noreferrer" target="_blank">Open original listing <ExternalLink className="size-4 shrink-0" /></a> : null}
        <div className="mt-4 grid gap-3">
          <div className="flex items-center justify-between"><h3 className="font-bold">{selectedKind?.label}</h3><button className="inline-flex min-h-11 items-center gap-2 rounded-md border border-zinc-300 px-3 text-sm font-bold" onClick={() => setStep(3)} type="button"><Pencil className="size-4" /> Edit</button></div>
          {draft.kind === "card" ? <ProductReview item={draft.card} quantity={draft.card.quantity} /> : null}
          {draft.kind === "sealed" ? <ProductReview item={draft.sealed} kind="sealed" quantity={draft.sealed.quantity} /> : null}
          {draft.kind === "bulk" ? <><div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm font-medium">{cardCountSummary(draft.bulkCards)} · {draft.moreToItemize ? "More remain to itemize" : "Lot complete"}</div>{draft.bulkCards.map((card) => <ProductReview item={card} key={card.id} quantity={card.quantity} />)}</> : null}
          {draft.kind === "supply" ? <div className="rounded-lg border border-zinc-200 p-3"><p className="font-bold capitalize">{draft.supplyCategory === "other" ? draft.supplyOther : draft.supplyCategory}</p><p className="mt-1 text-sm font-medium text-zinc-500">Quantity {draft.supplyQuantity}</p></div> : null}
        </div>
        <div className="mt-4 rounded-lg border border-zinc-200 p-3"><span className="text-xs font-bold uppercase text-zinc-500">Notes</span><p className="mt-1 whitespace-pre-wrap text-sm font-medium text-zinc-700">{draft.notes || "No purchase notes."}</p></div>
        <div className="mt-4 rounded-lg border border-[#8a1f2d]/30 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-950"><strong className="block font-black">Ready to record?</strong><p className="mt-1">Confirm only after the summary above matches what you bought.</p></div>
      </FormSection></div></StepPanel> : null}

      <WizardActions finalLabel="Confirm preview purchase" onBack={() => { setError(null); setStep((current) => Math.max(1, current - 1)); }} onConfirm={submit} onNext={nextStep} pending={pending} step={step} totalSteps={4} />
    </form>
  );
}

type OpeningDraft = {
  version: 3;
  date: string;
  notes: string;
  product: ProductIdentityDraft;
  sealedUnitId: string | null;
  sourceOption: SourceOption;
  sourceOther: string;
  pulls: CardContentsDraft[];
};

function canonicalProductUrl(value: string | null | undefined) {
  if (!value) return "";
  try {
    const url = new URL(value);
    return `${url.hostname.replace(/^www\./, "").toLowerCase()}${url.pathname.replace(/\/$/, "")}`;
  } catch {
    return value.trim().toLowerCase();
  }
}

export function OpeningForm({ onSaved }: { onSaved: (recordId: string) => void }) {
  const source = useRecordsDataSource();
  const searchParams = useSearchParams();
  const requested = searchParams.get("sealedId");
  const requestedUnit = source.snapshot.sealedUnits.find((unit) => unit.id === requested && unit.status === "sealed");
  const stored = source.drafts["pack-opening"] as Partial<OpeningDraft> | undefined;
  const legacyDraftReset = Boolean(stored && stored.version !== 3);
  const [draft, setDraft] = useState<OpeningDraft>(() => stored?.version === 3 ? stored as OpeningDraft : {
    version: 3,
    date: today(),
    notes: "",
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
  const resolvedSource = sourceLabel(draft);

  useEffect(() => source.setDraft("pack-opening", draft), [draft, source]);

  function updateOpeningProduct(product: ProductIdentityDraft) {
    const key = canonicalProductUrl(product.tcgplayerUrl);
    const matchingUnit = key
      ? source.snapshot.sealedUnits.find((unit) => unit.status === "sealed" && canonicalProductUrl(unit.tcgplayerUrl) === key)
      : undefined;
    setDraft((current) => ({
      ...current,
      product,
      sealedUnitId: matchingUnit?.id || null,
    }));
  }

  function productStepError() {
    const problem = productError(draft.product, "sealed");
    if (problem) return problem;
    if (!draft.date) return "Add the opening date.";
    const sourceProblem = sourceValidationError(draft);
    if (sourceProblem) return sourceProblem;
    return null;
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
    const problem = step === 1 ? productStepError() : pullsError();
    if (problem) { setError(problem); return; }
    setError(null);
    setStep((current) => Math.min(3, current + 1));
  }

  function submit() {
    if (step !== 3) return;
    const problem = productStepError() ?? pullsError();
    if (problem) { setError(problem); return; }
    setPending(true);
    const result = source.createOpening({
      date: draft.date,
      notes: draft.notes.trim(),
      product: productInput(draft.product),
      sealedUnitId: draft.sealedUnitId,
      source: resolvedSource,
      pulls: draft.pulls.map((pull) => ({ ...productInput(pull), id: pull.id, quantity: pull.quantity })),
    });
    setPending(false);
    if (!result.ok) { setError(result.message); return; }
    source.clearDraft("pack-opening");
    onSaved(result.id!);
  }

  return (
    <form className="grid gap-4" onSubmit={(event) => event.preventDefault()}>
      <DestructiveToast message={error} onDismiss={() => setError(null)} />
      <WizardProgress labels={["Product", "Pulled cards", "Review"]} step={step} />
      {legacyDraftReset ? <PreviewNotice>The earlier opening draft used the replaced product-selection format, so only that draft was reset.</PreviewNotice> : null}

      {step === 1 ? <StepPanel step={step}><FormSection description="Fetch the sealed product details, then record when it was opened and where it came from." number={1} title="What did you open?">
        <ProductIdentityEditor kind="sealed" onChange={updateOpeningProduct} value={draft.product} />
        <div className="mt-4 grid gap-4 sm:grid-cols-2"><label><span className="text-sm font-bold text-zinc-700">Opening date <span className="text-rose-700">*</span></span><input className={fieldClass} onChange={(event) => setDraft((current) => ({ ...current, date: event.target.value }))} required type="date" value={draft.date} /></label><SellerSourceField onChange={(sourceValue) => setDraft((current) => ({ ...current, ...sourceValue }))} value={draft} /><label className="sm:col-span-2"><span className="text-sm font-bold text-zinc-700">Opening notes <span className="font-medium text-zinc-400">(optional)</span></span><textarea className={textAreaClass} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} placeholder="Condition, pull, or opening context" value={draft.notes} /></label></div>
      </FormSection></StepPanel> : null}

      {step === 2 ? <StepPanel step={step}><FormSection description="Each row creates physical Copies tied to this opening. Fetch and check every card before reviewing." number={2} title="Pulled cards"><CardContentsEditor noun="pulled card" onChange={(pulls) => setDraft((current) => ({ ...current, pulls }))} rows={draft.pulls} /></FormSection></StepPanel> : null}

      {step === 3 ? <StepPanel step={step}><div className="grid gap-4"><PreviewNotice>This is a read-only review. Nothing has been saved; only the confirmation button below creates the preview opening.</PreviewNotice><FormSection description="Check the product, source, date, pulled cards, and notes. Use Edit to correct a section." number={3} title="Review opening">
        <div className="flex items-start justify-between gap-3"><div><h3 className="font-bold">Opened product</h3><p className="mt-1 text-sm font-medium text-zinc-500">{resolvedSource} · {draft.date}</p></div><button className="inline-flex min-h-11 items-center gap-2 rounded-md border border-zinc-300 px-3 text-sm font-bold" onClick={() => setStep(1)} type="button"><Pencil className="size-4" /> Edit</button></div><div className="mt-3"><ProductReview item={draft.product} kind="sealed" quantity={1} /></div>
        <div className="mt-5 flex items-start justify-between gap-3"><div><h3 className="font-bold">Pulled cards</h3><p className="mt-1 text-sm font-medium text-zinc-500">{cardCountSummary(draft.pulls)}</p></div><button className="inline-flex min-h-11 items-center gap-2 rounded-md border border-zinc-300 px-3 text-sm font-bold" onClick={() => setStep(2)} type="button"><Pencil className="size-4" /> Edit</button></div><div className="mt-3 grid gap-3">{draft.pulls.map((pull) => <ProductReview item={pull} key={pull.id} quantity={pull.quantity} />)}</div>
        <div className="mt-4 rounded-lg border border-zinc-200 p-3"><span className="text-xs font-bold uppercase text-zinc-500">Notes</span><p className="mt-1 whitespace-pre-wrap text-sm font-medium text-zinc-700">{draft.notes || "No opening notes."}</p></div>
        <div className="mt-4 rounded-lg border border-[#8a1f2d]/30 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-950"><strong className="block font-black">Ready to record?</strong><p className="mt-1">Confirm only after the product and every pulled card are correct.</p></div>
      </FormSection></div></StepPanel> : null}

      <WizardActions finalLabel="Confirm preview opening" onBack={() => { setError(null); setStep((current) => Math.max(1, current - 1)); }} onConfirm={submit} onNext={nextStep} pending={pending} step={step} totalSteps={3} />
    </form>
  );
}

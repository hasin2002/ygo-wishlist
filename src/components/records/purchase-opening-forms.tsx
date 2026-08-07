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
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  blankCardContents,
  CardContentsEditor,
  cardContentsError,
  isUntouchedNewCardContents,
  type CardContentsDraft,
  type CardPricingDraft,
} from "@/components/records/card-contents-editor";
import {
  DestructiveToast,
  fieldClass,
  parsePoundsToPence,
  FormSection,
  penceToPounds,
  PreviewNotice,
  selectNumberOnFocus,
  StepPanel,
  textAreaClass,
  today,
  WizardActions,
  WizardProgress,
} from "@/components/records/entry-form-ui";
import { allocatePence } from "@/lib/records/allocation";
import { cardPricingIdentityKey } from "@/lib/records/card-pricing";
import {
  DraftConflictDialog,
  DraftHydrationBoundary,
  FormDraftStatus,
} from "@/components/records/form-draft-ui";
import {
  blankProductIdentity,
  isTcgplayerProductUrl,
  ProductIdentityEditor,
  type ProductIdentityDraft,
} from "@/components/records/product-identity-editor";
import { useFormDraftLifecycle } from "@/lib/records/use-form-draft-lifecycle";
import { taskReturnHref } from "@/lib/navigation-intent";
import {
  hasFields,
  isCardContentsDraft,
  isInteger,
  isNullableString,
  isOneOf,
  isProductIdentityDraft,
  isRecord,
  isString,
} from "@/lib/records/form-draft-validators";
import { useRecordsDataSource } from "@/components/records/records-preview-provider";
import { useCardPricing } from "@/components/records/use-card-pricing";
import {
  cardConditionOptions,
  type CardCondition,
  type CardContentsInput,
  type DataSourceResult,
  type InventoryKind,
  type ProductEdition,
  type ProductIdentityInput,
  type RecordEntry,
  type RecordsSnapshot,
  type SupplyCategory,
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
  version: 8;
  /** Added to version 8 drafts without invalidating drafts saved before this field existed. */
  submissionId?: string;
  kind: InventoryKind | null;
  recordName: string;
  date: string;
  sourceOption: SourceOption;
  sourceOther: string;
  listingUrl: string;
  total: string;
  amountKnown: boolean;
  notes: string;
  card: CardContentsDraft;
  sealed: SealedDraft;
  useSealedOverrides: boolean;
  sealedUnitAllocations: string[];
  sealedAllocationsReviewed: boolean;
  bulkTotalCardCount: string;
  bulkCards: CardContentsDraft[];
  supplyCategory: SupplyCategory;
  supplyOther: string;
  supplyQuantity: number;
};

function isPurchaseDraft(value: unknown): value is PurchaseDraft {
  if (!isRecord(value) || !hasFields(value, [
    "version", "kind", "recordName", "date", "sourceOption", "sourceOther", "listingUrl", "total",
    "amountKnown", "notes", "card", "sealed", "useSealedOverrides", "sealedUnitAllocations", "sealedAllocationsReviewed", "bulkTotalCardCount", "bulkCards", "supplyCategory", "supplyOther", "supplyQuantity",
  ])) return false;
  return value.version === 8
    && (value.submissionId === undefined || isString(value.submissionId))
    && (value.kind === null || isOneOf(value.kind, ["card", "sealed", "bulk", "supply"] as const))
    && isString(value.recordName)
    && isString(value.date)
    && isOneOf(value.sourceOption, sourceOptions.map((option) => option.value))
    && isString(value.sourceOther)
    && isString(value.listingUrl)
    && isString(value.total)
    && typeof value.amountKnown === "boolean"
    && isString(value.notes)
    && isCardContentsDraft(value.card)
    && isProductIdentityDraft(value.sealed)
    && isInteger(value.sealed.quantity)
    && typeof value.useSealedOverrides === "boolean"
    && Array.isArray(value.sealedUnitAllocations)
    && value.sealedUnitAllocations.every(isString)
    && typeof value.sealedAllocationsReviewed === "boolean"
    && isString(value.bulkTotalCardCount)
    && Array.isArray(value.bulkCards)
    && value.bulkCards.every(isCardContentsDraft)
    && isOneOf(value.supplyCategory, ["sleeves", "binder", "storage", "playmat", "other"] as const)
    && isString(value.supplyOther)
    && isInteger(value.supplyQuantity);
}

function purchaseDraft(prefilledName: string, submissionId: string): PurchaseDraft {
  return {
    version: 8,
    submissionId,
    kind: prefilledName ? "card" : null,
    recordName: "",
    date: today(),
    sourceOption: "ebay",
    sourceOther: "",
    listingUrl: "",
    total: "",
    amountKnown: true,
    notes: "",
    card: blankCardContents(prefilledName),
    sealed: { ...blankProductIdentity(), quantity: 1 },
    useSealedOverrides: false,
    sealedUnitAllocations: [],
    sealedAllocationsReviewed: false,
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

function cardInput(value: CardContentsDraft): CardContentsInput {
  const completedPricing = value.pricing
    && value.pricing.status !== "checking"
    && value.pricing.status !== "failed"
    && value.pricing.ebaySearchUrl
    ? {
        estimatedPricePence: value.pricing.estimatedPricePence,
        ebaySearchUrl: value.pricing.ebaySearchUrl,
      }
    : undefined;
  return {
    ...productInput(value),
    condition: value.condition ?? "Near Mint",
    id: value.id,
    pricing: completedPricing,
    quantity: value.quantity,
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

function ProductReview({ item, kind = "card", quantity }: { item: ProductIdentityDraft & { condition?: string; pricing?: CardPricingDraft }; kind?: "card" | "sealed"; quantity: number }) {
  const detail = kind === "sealed"
    ? item.edition || "Edition missing"
    : `${item.edition || "Edition missing"} · ${item.rarity || "Rarity missing"} · ${item.setCode || item.setName || "Printing details incomplete"} · ${item.condition ?? "Near Mint"}`;

  return (
    <div className="flex items-start gap-3 rounded-lg border border-zinc-200 bg-white p-3">
      {item.imageUrl ? (
        <Image alt="" className="size-20 shrink-0 rounded-md object-contain" height={80} src={`/api/image-proxy?url=${encodeURIComponent(item.imageUrl)}`} unoptimized width={80} />
      ) : <span className="grid size-20 shrink-0 place-items-center rounded-md bg-zinc-100 text-xs font-bold text-zinc-400">ITEM</span>}
      <div className="min-w-0"><p className="font-bold text-zinc-950">{item.name}</p><p className="mt-1 text-sm font-medium text-zinc-500">{detail} · Quantity {quantity}</p>{item.pricing ? <p className={`mt-1 text-xs font-bold ${item.pricing.status === "failed" ? "text-rose-700" : item.pricing.status === "estimated" ? "text-emerald-700" : "text-zinc-500"}`}>{item.pricing.message}</p> : null}{item.metadataNeedsAttention ? <p className="mt-2 text-xs font-bold text-amber-700">Metadata needs attention</p> : null}</div>
    </div>
  );
}

function cardCountSummary(cards: Array<{ quantity: number }>) {
  const copies = cards.reduce((sum, card) => sum + card.quantity, 0);
  return `${cards.length} card ${cards.length === 1 ? "type" : "types"} · ${copies} ${copies === 1 ? "copy" : "copies"}`;
}

function completedCardContents(rows: CardContentsDraft[]) {
  const completed = rows.filter((row) => !isUntouchedNewCardContents(row));
  // The first card is still required. Later untouched rows are merely an
  // abandoned "Add another card" draft and should not block the wizard.
  return completed.length ? completed : rows;
}

type RecordFormEdit = {
  record: RecordEntry;
  snapshot: RecordsSnapshot;
};

function sourceValue(source: string): SourceValue {
  const option = sourceOptions.find((candidate) => candidate.label.toLowerCase() === source.toLowerCase());
  return option
    ? { sourceOption: option.value, sourceOther: "" }
    : { sourceOption: "other", sourceOther: source };
}

function editionValue(value: string | null | undefined): ProductEdition {
  const normalized = value?.toLowerCase() ?? "";
  if (normalized.includes("unlimited")) return "Unlimited Edition";
  if (normalized.includes("limited")) return "Limited Edition";
  return "1st Edition";
}

function existingCardDrafts(record: RecordEntry, snapshot: RecordsSnapshot): CardContentsDraft[] {
  return record.lines.filter((line) => line.kind === "card").map((line) => {
    const copy = snapshot.copies.find((candidate) => line.entityIds.includes(candidate.id));
    const printing = copy ? snapshot.printings.find((candidate) => candidate.id === copy.printingId) : null;
    const target = printing ? snapshot.targets.find((candidate) => candidate.id === printing.targetId) : null;
    const tcgplayerUrl = printing?.tcgplayerUrl || target?.tcgplayerUrl || "";
    return {
      id: line.id,
      selectedTargetId: target?.id ?? null,
      condition: cardConditionOptions.some((option) => option.value === copy?.condition)
        ? copy!.condition as CardCondition
        : "Near Mint",
      quantity: line.quantity,
      tcgplayerUrl,
      name: target?.name || line.name,
      imageUrl: printing?.imageUrl || target?.imageUrl || null,
      edition: editionValue(target?.edition),
      rarity: target?.rarity || "Unknown rarity",
      setName: printing?.setName || "Unknown set",
      setCode: printing?.setCode || "Unknown code",
      cardType: "",
      fetchStatus: isTcgplayerProductUrl(tcgplayerUrl) ? "resolved" : "attention",
      fetchAttempted: true,
      fetchMessage: "Loaded from this existing Record.",
      metadataNeedsAttention: !isTcgplayerProductUrl(tcgplayerUrl),
      editedFields: [],
    };
  });
}

function existingCardError(card: CardContentsDraft) {
  if (card.id.startsWith("card-")) return cardContentsError(card);
  if (!card.name.trim()) return "Add the card name.";
  if (!card.edition) return "Choose the card edition.";
  if (!card.rarity.trim()) return "Choose the card rarity.";
  if (!Number.isInteger(card.quantity) || card.quantity < 1) return "Quantity must be at least one.";
  return null;
}

function purchaseEditDraft(record: RecordEntry, snapshot: RecordsSnapshot, submissionId: string): PurchaseDraft {
  const initial = purchaseDraft("", submissionId);
  const cards = existingCardDrafts(record, snapshot);
  const bulkLot = snapshot.bulkLots.find((lot) => lot.acquiredRecordId === record.id);
  const supply = snapshot.supplies.find((item) => item.acquiredRecordId === record.id);
  const sealedUnits = snapshot.sealedUnits.filter((unit) => unit.acquiredRecordId === record.id);
  const sealedLine = record.lines.find((line) => line.kind === "sealed");
  const supplyLine = record.lines.find((line) => line.kind === "supply");
  const kind: InventoryKind = bulkLot
    ? "bulk"
    : sealedLine
      ? "sealed"
      : supplyLine
        ? "supply"
        : "card";
  const sealedUnit = sealedUnits[0];
  const sealedUrl = sealedUnit?.tcgplayerUrl || "";
  const source = sourceValue(record.source);
  return {
    ...initial,
    ...source,
    kind,
    recordName: record.title,
    date: record.date,
    listingUrl: record.listingUrl ?? "",
    total: record.amountKnown === false ? "" : (record.amountPence / 100).toFixed(2),
    amountKnown: record.amountKnown !== false,
    notes: record.notes,
    card: cards[0] ?? initial.card,
    bulkCards: cards.length ? cards : initial.bulkCards,
    bulkTotalCardCount: bulkLot ? String(bulkLot.totalQuantity) : "",
    sealed: {
      ...initial.sealed,
      selectedTargetId: null,
      tcgplayerUrl: sealedUrl,
      name: sealedUnit?.name || sealedLine?.name || "",
      imageUrl: sealedUnit?.imageUrl || null,
      edition: sealedUnit?.edition || editionValue(sealedLine?.detail),
      quantity: sealedLine?.quantity ?? (sealedUnits.length || 1),
      fetchStatus: isTcgplayerProductUrl(sealedUrl) ? "resolved" : "attention",
      fetchAttempted: true,
      fetchMessage: "Loaded from this existing Purchase.",
      metadataNeedsAttention: !isTcgplayerProductUrl(sealedUrl),
      editedFields: [],
    },
    useSealedOverrides: sealedUnits.some((unit) => unit.allocationMode === "override"),
    sealedUnitAllocations: sealedUnits.map((unit) => unit.allocationPence === null || unit.allocationPence === undefined
      ? ""
      : (unit.allocationPence / 100).toFixed(2)),
    sealedAllocationsReviewed: sealedUnits.some((unit) => unit.allocationMode === "override"),
    supplyCategory: supply?.category ?? "other",
    supplyOther: supply?.category === "other" ? supply.name : "",
    supplyQuantity: supply?.quantity ?? supplyLine?.quantity ?? 1,
  };
}

export function PurchaseForm({ edit, onSaved }: { edit?: RecordFormEdit; onSaved: (recordId: string, warning?: string) => void }) {
  const source = useRecordsDataSource();
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnHref = taskReturnHref(searchParams.get("origin"));
  const prefilledName = searchParams.get("cardName") ?? "";
  const prefilledTargetId = searchParams.get("targetId");
  const prefilledTarget = prefilledTargetId
    ? source.snapshot.targets.find((target) => target.id === prefilledTargetId)
    : null;
  const prefilledPrinting = prefilledTarget
    ? source.snapshot.printings.find((printing) => printing.targetId === prefilledTarget.id)
    : null;
  const [formSubmissionId] = useState(() => crypto.randomUUID());
  const initialDraft = useMemo<PurchaseDraft>(() => {
    if (edit) return purchaseEditDraft(edit.record, edit.snapshot, formSubmissionId);
    const initial = purchaseDraft(prefilledTarget?.name || prefilledName, formSubmissionId);
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
  }, [edit, formSubmissionId, prefilledName, prefilledPrinting, prefilledTarget]);
  const launchIntent = useMemo(() => ({
    kind: prefilledTargetId ? "wishlist-target" as const : "none" as const,
    id: prefilledTargetId,
    label: prefilledTarget?.name || prefilledName || undefined,
  }), [prefilledName, prefilledTarget?.name, prefilledTargetId]);
  const lifecycle = useFormDraftLifecycle({
    workflow: "purchase",
    ownerScope: source.draftOwnerScope,
    origin: `/records/new/purchase${searchParams.size ? `?${searchParams.toString()}` : ""}`,
    intent: launchIntent,
    initialData: initialDraft,
    identity: edit?.record.id,
    isValidData: isPurchaseDraft,
  });
  const { data: draft, setData: setDraft } = lifecycle;
  const updateCardPricing = useCallback((cardId: string, pricing: CardPricingDraft) => {
    setDraft((current) => ({
      ...current,
      card: current.card.id === cardId && cardPricingIdentityKey(current.card) === pricing.identityKey
        ? { ...current.card, pricing }
        : current.card,
      bulkCards: current.bulkCards.map((card) => card.id === cardId && cardPricingIdentityKey(card) === pricing.identityKey
        ? { ...card, pricing }
        : card),
    }));
  }, [setDraft]);
  const cardPricing = useCardPricing(updateCardPricing);
  // Edit mode starts where the useful work is: item details. Its internal
  // step numbers remain shared with creation, while the progress display
  // deliberately omits the immutable item-type step.
  const [step, setStep] = useState(() => edit ? 3 : 1);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const firstVisibleStep = edit ? 2 : 1;
  const wizardLabels = edit
    ? ["Purchase", "Item details", "Review"]
    : ["Item type", "Purchase", "Item details", "Review"];
  const wizardStep = edit ? step - 1 : step;
  const wizardTotalSteps = edit ? 3 : 4;
  const giftSelected = draft.sourceOption === "gift";
  const amountKnown = giftSelected || draft.amountKnown;
  const parsedTotalPence = parsePoundsToPence(draft.total);
  const totalPence = amountKnown ? (giftSelected ? 0 : parsedTotalPence ?? 0) : 0;
  const resolvedSource = sourceLabel(draft);
  const equalSealedUnitAllocations = amountKnown && draft.sealed.quantity > 0
    ? allocatePence(totalPence, draft.sealed.quantity).map(penceToPounds)
    : [];

  useEffect(() => {
    if (!lifecycle.hydrated || draft.submissionId) return;
    setDraft((current) => current.submissionId
      ? current
      : { ...current, submissionId: formSubmissionId });
  }, [draft.submissionId, formSubmissionId, lifecycle.hydrated, setDraft]);

  function detailsError() {
    if (!draft.recordName.trim()) return "Add a short record name before continuing.";
    if (!draft.date) return "Add the purchase date before continuing.";
    if (amountKnown && !giftSelected && parsedTotalPence === null) return "Enter an amount such as 12 or 12.34, or mark the cost as unknown.";
    const sourceProblem = sourceValidationError(draft);
    if (sourceProblem) return sourceProblem;
    if (draft.listingUrl.trim() && !isHttpUrl(draft.listingUrl.trim())) return "Enter a complete purchase listing link beginning with http:// or https://.";
    return null;
  }

  function itemError() {
    if (!draft.kind) return "Choose what kind of item you bought.";
    if (draft.kind === "card") return edit ? existingCardError(draft.card) : cardContentsError(draft.card);
    if (draft.kind === "sealed") {
      const problem = edit && !draft.sealed.name.trim()
        ? "Add the sealed product name."
        : edit
          ? null
          : productError(draft.sealed, "sealed");
      if (problem) return problem;
      if (!Number.isInteger(draft.sealed.quantity) || draft.sealed.quantity < 1) return "Quantity must be at least one.";
      if (draft.useSealedOverrides) {
        const allocations = draft.sealedUnitAllocations.map(parsePoundsToPence);
        if (!amountKnown) return "Unknown costs cannot have per-unit allocations.";
        if (
          allocations.length !== draft.sealed.quantity
          || !allocations.every((value): value is number => value !== null)
        ) return "Enter a valid amount for every sealed unit.";
        if (allocations.reduce((sum, value) => sum + value, 0) !== totalPence) return "Individual sealed-unit costs must add up exactly to the purchase total.";
        if (!draft.sealedAllocationsReviewed) return "Review and confirm the unequal sealed-unit costs before continuing.";
      }
    }
    if (draft.kind === "bulk") {
      const bulkCards = completedCardContents(draft.bulkCards);
      if (!bulkCards.length) return "Add at least one identified card.";
      const totalCardCount = Number(draft.bulkTotalCardCount);
      const identifiedCopies = bulkCards.reduce((sum, card) => sum + card.quantity, 0);
      if (!Number.isInteger(totalCardCount) || totalCardCount < 1) return "Add the exact total number of physical cards in the lot.";
      if (totalCardCount < identifiedCopies) return `The lot total cannot be less than the ${identifiedCopies} identified physical copies.`;
      for (const card of bulkCards) {
        const problem = edit ? existingCardError(card) : cardContentsError(card);
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
    if (step === 3 && source.mode === "live") {
      if (draft.kind === "card") cardPricing.requestPricing(draft.card);
      if (draft.kind === "bulk") completedCardContents(draft.bulkCards).forEach(cardPricing.requestPricing);
    }
    setStep((current) => Math.min(4, current + 1));
  }

  async function submit() {
    if (step !== 4 || !draft.kind) return;
    const problem = detailsError() ?? itemError();
    if (problem) { setError(problem); return; }
    setPending(true);

    const common = {
      operationId: draft.submissionId ?? formSubmissionId,
      recordName: draft.recordName.trim(),
      date: draft.date,
      source: resolvedSource,
      listingUrl: draft.listingUrl.trim(),
      totalPence,
      amountKnown,
      notes: draft.notes.trim(),
    };
    if (edit) {
      let revision = edit.record.revision;
      let savedPart = false;
      const warnings: string[] = [];
      const accept = (result: DataSourceResult) => {
        if (!result.ok) {
          setError(`${result.message}${savedPart ? " Some item changes were already saved; retry to finish the remaining update." : ""}`);
          return false;
        }
        savedPart = true;
        revision += 1;
        if (result.warning) warnings.push(result.warning);
        return true;
      };
      const bulkLine = edit.record.lines.find((line) => line.kind === "bulk");
      const itemLine = edit.record.lines.find((line) => line.kind === draft.kind);
      if (draft.kind === "bulk" && bulkLine) {
        const result = await source.updateRecordLine(edit.record.id, bulkLine.id, {
          name: bulkLine.name,
          quantity: bulkLine.quantity,
          detail: bulkLine.detail ?? "",
          totalQuantity: Number(draft.bulkTotalCardCount),
        }, revision);
        if (!accept(result)) { setPending(false); return; }
      }
      if (draft.kind === "card" || draft.kind === "bulk") {
        const cards = draft.kind === "card" ? [draft.card] : completedCardContents(draft.bulkCards);
        const result = await source.replaceRecordCards(edit.record.id, cards.map(cardInput), revision);
        if (!accept(result)) { setPending(false); return; }
      } else if (itemLine) {
        const itemName = draft.kind === "sealed"
          ? draft.sealed.name.trim()
          : draft.supplyCategory === "other"
            ? draft.supplyOther.trim()
            : draft.supplyCategory.charAt(0).toUpperCase() + draft.supplyCategory.slice(1);
        const itemQuantity = draft.kind === "sealed" ? draft.sealed.quantity : draft.supplyQuantity;
        const result = await source.updateRecordLine(edit.record.id, itemLine.id, {
          name: itemName,
          quantity: itemQuantity,
          detail: draft.kind === "sealed" ? draft.sealed.edition : itemLine.detail ?? "Supply or extra",
          edition: draft.kind === "sealed" && draft.sealed.edition ? draft.sealed.edition : undefined,
          category: draft.kind === "supply" ? draft.supplyCategory : undefined,
        }, revision);
        if (!accept(result)) { setPending(false); return; }
      }
      const detailsResult = await source.updateRecordDetails(edit.record.id, {
        title: common.recordName,
        date: common.date,
        source: common.source,
        listingUrl: common.listingUrl || null,
        amountPence: common.totalPence,
        amountKnown: common.amountKnown,
        notes: common.notes,
        sealedAllocationOverrideConfirmed: draft.kind === "sealed" && draft.sealedAllocationsReviewed,
      }, revision);
      setPending(false);
      if (!accept(detailsResult)) return;
      lifecycle.discard();
      onSaved(edit.record.id, warnings.filter(Boolean).join(" ") || undefined);
      return;
    }

    const result = await (draft.kind === "card"
      ? source.createPurchase({ ...common, kind: "card", card: cardInput(draft.card) })
      : draft.kind === "sealed"
        ? source.createPurchase({ ...common, kind: "sealed", product: {
          ...productInput(draft.sealed),
          quantity: draft.sealed.quantity,
          unitAllocations: draft.useSealedOverrides ? draft.sealedUnitAllocations.map((value) => parsePoundsToPence(value) ?? 0) : undefined,
          unitAllocationsReviewed: draft.useSealedOverrides ? draft.sealedAllocationsReviewed : undefined,
        } })
        : draft.kind === "bulk"
          ? source.createPurchase({ ...common, kind: "bulk", cards: completedCardContents(draft.bulkCards).map(cardInput), totalCardCount: Number(draft.bulkTotalCardCount) })
          : source.createPurchase({ ...common, kind: "supply", category: draft.supplyCategory, otherName: draft.supplyOther.trim(), quantity: draft.supplyQuantity }));

    setPending(false);
    if (!result.ok) { setError(result.message); return; }
    lifecycle.discard();
    onSaved(result.id!, result.warning);
  }

  const selectedKind = purchaseKindOptions.find((option) => option.kind === draft.kind);

  return (
    <DraftHydrationBoundary ready={lifecycle.hydrated}>
    <form autoComplete="off" className="grid gap-4" onSubmit={(event) => event.preventDefault()}>
      <DestructiveToast message={error} onDismiss={() => setError(null)} />
      {lifecycle.conflict ? <DraftConflictDialog incoming={launchIntent} onCancel={() => router.replace(returnHref)} onResume={lifecycle.resumePrevious} onStartNew={lifecycle.startNew} previous={lifecycle.conflict.intent} /> : null}
      <FormDraftStatus dirty={lifecycle.dirty} onDiscard={() => {
        if (!window.confirm("Discard this Purchase draft and start again?")) return;
        lifecycle.discard();
        setStep(edit ? 3 : 1);
      }} recoveryMessage={lifecycle.recoveryMessage} restored={lifecycle.restored} />
      <WizardProgress labels={wizardLabels} step={wizardStep} />

      {step === 1 ? <StepPanel step={step}><FormSection description="Choose one acquisition kind. Bulk can contain several identified cards, but the Purchase itself stays one lot." number={1} title="What did you buy?">
        {edit ? <PreviewNotice label="Editing existing Purchase.">The original item type is fixed so this update cannot silently turn one kind of inventory into another.</PreviewNotice> : null}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-purchase-kind-options>
          {purchaseKindOptions.map((option) => {
            const Icon = option.icon;
            const selected = draft.kind === option.kind;
            return <button aria-pressed={selected} className={`group flex h-full items-start gap-3 rounded-lg border p-4 text-left transition focus:outline-none focus:ring-2 focus:ring-[#8a1f2d] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-45 ${selected ? "border-[#8a1f2d] bg-rose-50 ring-1 ring-[#8a1f2d]" : "border-zinc-300 bg-white hover:border-zinc-500 hover:bg-zinc-50"}`} disabled={Boolean(edit)} key={option.kind} onClick={() => setDraft((current) => ({ ...current, kind: option.kind }))} type="button"><span className={`grid size-10 shrink-0 place-items-center rounded-lg ${selected ? "bg-[#8a1f2d] text-white" : "bg-zinc-100 text-zinc-700 group-hover:bg-zinc-200"}`}><Icon className="size-5" /></span><span><strong className="block text-base text-zinc-950">{option.label}</strong><span className="mt-1 block text-sm font-medium leading-5 text-zinc-500">{option.description}</span></span></button>;
          })}
        </div>
      </FormSection></StepPanel> : null}

      {step === 2 ? <StepPanel step={step}><FormSection description={`Record the shared facts for this ${selectedKind?.label.toLowerCase() || "purchase"}.`} number={2} title="Purchase details">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="sm:col-span-2"><span className="text-sm font-bold text-zinc-700">Record name <span className="text-rose-700">*</span></span><input className={fieldClass} maxLength={80} onChange={(event) => setDraft((current) => ({ ...current, recordName: event.target.value }))} placeholder="e.g. July eBay job lot" required value={draft.recordName} /><span className="mt-1 block text-xs font-medium text-zinc-500">A short label you will recognise in Records History.</span></label>
          <label><span className="text-sm font-bold text-zinc-700">Purchase date <span className="text-rose-700">*</span></span><input className={fieldClass} onChange={(event) => setDraft((current) => ({ ...current, date: event.target.value }))} required type="date" value={draft.date} /></label>
          <SellerSourceField onChange={(sourceValue) => setDraft((current) => ({ ...current, ...sourceValue, total: sourceValue.sourceOption === "gift" ? "0.00" : current.total, amountKnown: sourceValue.sourceOption === "gift" ? true : current.amountKnown }))} value={draft} />
          <label className="sm:col-span-2"><span className="text-sm font-bold text-zinc-700">Purchase listing link <span className="font-medium text-zinc-400">(optional)</span></span><input className={fieldClass} inputMode="url" onChange={(event) => setDraft((current) => ({ ...current, listingUrl: event.target.value }))} placeholder="https://www.ebay.co.uk/itm/…" type="url" value={draft.listingUrl} /></label>
          <label className="sm:col-span-2"><span className="text-sm font-bold text-zinc-700">All-in amount paid {amountKnown ? <span className="text-rose-700">*</span> : null}</span><div className="relative mt-1"><span className="pointer-events-none absolute inset-y-0 left-3 flex items-center font-bold leading-none text-zinc-500">£</span><input className={`${fieldClass} mt-0 pl-7 read-only:cursor-not-allowed read-only:bg-zinc-100 read-only:text-zinc-500`} disabled={!amountKnown} inputMode="decimal" min="0" onChange={(event) => setDraft((current) => ({ ...current, total: event.target.value }))} placeholder="0.00" readOnly={giftSelected} required={amountKnown} step="0.01" type="number" value={giftSelected ? "0.00" : draft.total} /></div><span className="mt-1 block text-xs font-medium text-zinc-500">{giftSelected ? "Gift selected — amount is fixed at £0.00." : amountKnown ? "Include delivery, fees, and discounts." : "The cost will remain unknown, not £0.00."}</span><span className="mt-2 flex items-center gap-2 text-sm font-semibold text-zinc-700"><input checked={!amountKnown} disabled={giftSelected} onChange={(event) => setDraft((current) => ({ ...current, amountKnown: !event.target.checked, total: event.target.checked ? "" : current.total }))} type="checkbox" /> Cost unknown</span></label>
          <label className="sm:col-span-2"><span className="text-sm font-bold text-zinc-700">Purchase notes <span className="font-medium text-zinc-400">(optional)</span></span><textarea className={textAreaClass} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} placeholder="Condition, postage, or purchase context" value={draft.notes} /></label>
        </div>
      </FormSection></StepPanel> : null}

      {step === 3 ? <StepPanel step={step}><FormSection description="Fetch the TCGplayer details, check the populated fields, and correct anything that is incomplete." number={3} title={`${selectedKind?.label || "Item"} details`}>
        {draft.kind === "card" ? <ProductIdentityEditor cardNameFields={<div className="grid grid-cols-[minmax(0,1.4fr)_minmax(7rem,0.6fr)] gap-3"><label><span className="text-sm font-bold text-zinc-700">Condition <span className="text-rose-700">*</span></span><select className={fieldClass} onChange={(event) => setDraft((current) => ({ ...current, card: { ...current.card, condition: event.target.value as CardCondition } }))} required value={draft.card.condition ?? "Near Mint"}>{cardConditionOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label><span className="text-sm font-bold text-zinc-700">Quantity <span className="text-rose-700">*</span></span><input className={fieldClass} min="1" onChange={(event) => setDraft((current) => ({ ...current, card: { ...current.card, quantity: Number(event.target.value) } }))} onFocus={selectNumberOnFocus} required type="number" value={draft.card.quantity} /></label></div>} compact kind="card" onChange={(identity) => setDraft((current) => { const changed = identity.selectedTargetId !== current.card.selectedTargetId || identity.name !== current.card.name || identity.rarity !== current.card.rarity || identity.edition !== current.card.edition; return { ...current, card: { ...current.card, ...identity, pricing: changed ? undefined : current.card.pricing } }; })} value={draft.card} /> : null}
        {draft.kind === "sealed" ? <div className="grid gap-4"><ProductIdentityEditor kind="sealed" onChange={(identity) => setDraft((current) => ({ ...current, sealed: { ...current.sealed, ...identity } }))} value={draft.sealed} /><label className="sm:max-w-52"><span className="text-sm font-bold text-zinc-700">Quantity <span className="text-rose-700">*</span></span><input className={fieldClass} min="1" onChange={(event) => setDraft((current) => ({ ...current, sealed: { ...current.sealed, quantity: Number(event.target.value) }, sealedUnitAllocations: [], sealedAllocationsReviewed: false }))} onFocus={selectNumberOnFocus} required type="number" value={draft.sealed.quantity} /></label>{amountKnown && draft.sealed.quantity > 1 ? <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3"><label className="flex items-start gap-2 text-sm font-semibold text-zinc-800"><input checked={draft.useSealedOverrides} onChange={(event) => setDraft((current) => ({ ...current, useSealedOverrides: event.target.checked, sealedUnitAllocations: event.target.checked ? Array.from({ length: current.sealed.quantity }, (_, index) => current.sealedUnitAllocations[index] ?? equalSealedUnitAllocations[index] ?? "0.00") : [], sealedAllocationsReviewed: false }))} type="checkbox" />Allocate different costs to the exact sealed units</label><p className="mt-1 text-xs font-medium text-zinc-500">The normal policy splits the receipt evenly, including any one-penny remainder. Use this only when you have reviewed a different cost for each physical unit.</p>{draft.useSealedOverrides ? <div className="mt-3 grid gap-2"><div className="grid gap-2 sm:grid-cols-3">{Array.from({ length: draft.sealed.quantity }, (_, index) => <label key={index}><span className="text-xs font-bold text-zinc-600">Unit {index + 1}</span><div className="relative mt-1"><span className="pointer-events-none absolute inset-y-0 left-3 flex items-center font-bold text-zinc-500">£</span><input className={`${fieldClass} mt-0 pl-7`} inputMode="decimal" min="0" onChange={(event) => setDraft((current) => ({ ...current, sealedUnitAllocations: Array.from({ length: current.sealed.quantity }, (_, currentIndex) => currentIndex === index ? event.target.value : current.sealedUnitAllocations[currentIndex] ?? equalSealedUnitAllocations[currentIndex] ?? "0.00"), sealedAllocationsReviewed: false }))} step="0.01" type="number" value={draft.sealedUnitAllocations[index] ?? equalSealedUnitAllocations[index] ?? "0.00"} /></div></label>)}</div><label className="flex items-start gap-2 text-sm font-semibold text-zinc-800"><input checked={draft.sealedAllocationsReviewed} onChange={(event) => setDraft((current) => ({ ...current, sealedAllocationsReviewed: event.target.checked }))} type="checkbox" />I reviewed these exact unit costs and they add up to the purchase total.</label></div> : null}</div> : null}</div> : null}
        {draft.kind === "bulk" ? <div className="grid gap-5"><label className="max-w-xs"><span className="text-sm font-bold text-zinc-700">Total cards in lot <span className="text-rose-700">*</span></span><input className={fieldClass} inputMode="numeric" min="1" onChange={(event) => setDraft((current) => ({ ...current, bulkTotalCardCount: event.target.value }))} onFocus={selectNumberOnFocus} placeholder="e.g. 100" required type="number" value={draft.bulkTotalCardCount} /><span className="mt-1 block text-xs font-medium leading-5 text-zinc-500">Count every physical card in the lot, even if you only identify some of them now. This fixes each card&apos;s share of the purchase cost.</span></label><CardContentsEditor allowExistingIncomplete={Boolean(edit)} onChange={(bulkCards) => setDraft((current) => ({ ...current, bulkCards }))} onFinishCard={source.mode === "live" ? cardPricing.requestPricing : undefined} rows={draft.bulkCards} /></div> : null}
        {draft.kind === "supply" ? <div className="grid gap-4 sm:grid-cols-2"><label><span className="text-sm font-bold text-zinc-700">Supply or extra <span className="text-rose-700">*</span></span><select className={fieldClass} onChange={(event) => setDraft((current) => ({ ...current, supplyCategory: event.target.value as SupplyCategory }))} value={draft.supplyCategory}><option value="sleeves">Sleeves</option><option value="binder">Binder</option><option value="storage">Storage</option><option value="playmat">Playmat</option><option value="other">Other</option></select></label><label><span className="text-sm font-bold text-zinc-700">Quantity <span className="text-rose-700">*</span></span><input className={fieldClass} min="1" onChange={(event) => setDraft((current) => ({ ...current, supplyQuantity: Number(event.target.value) }))} onFocus={selectNumberOnFocus} required type="number" value={draft.supplyQuantity} /></label>{draft.supplyCategory === "other" ? <label className="sm:col-span-2"><span className="text-sm font-bold text-zinc-700">What is it? <span className="text-rose-700">*</span></span><input className={fieldClass} onChange={(event) => setDraft((current) => ({ ...current, supplyOther: event.target.value }))} required value={draft.supplyOther} /></label> : null}</div> : null}
      </FormSection></StepPanel> : null}

      {step === 4 ? <StepPanel step={step}><div className="grid gap-4"><PreviewNotice label={source.mode === "preview" ? "Preview only." : "Review before saving."}>This is a read-only review. Nothing has been saved; only the confirmation button below {edit ? "updates this existing Purchase" : `creates the ${source.mode === "preview" ? "preview " : ""}purchase`}.</PreviewNotice><FormSection description="Check the purchase facts and item details. Use Edit to correct a section before confirming." number={4} title="Review purchase">
        <div className="flex items-start justify-between gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3"><div><span className="text-xs font-bold uppercase text-zinc-500">Record name</span><p className="mt-1 font-bold">{draft.recordName}</p><p className="mt-1 text-sm font-medium text-zinc-500">{selectedKind?.label} · {amountKnown ? `£${penceToPounds(totalPence)}` : "Cost unknown"} · {resolvedSource} · {draft.date}</p></div><button className="inline-flex min-h-11 items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-bold" onClick={() => setStep(2)} type="button"><Pencil className="size-4" /> Edit</button></div>
        {draft.listingUrl ? <a className="mt-3 inline-flex min-h-11 items-center gap-2 break-all text-sm font-bold text-[#8a1f2d]" href={draft.listingUrl} rel="noreferrer" target="_blank">Open original listing <ExternalLink className="size-4 shrink-0" /></a> : null}
        <div className="mt-4 grid gap-3">
          <div className="flex items-center justify-between"><h3 className="font-bold">{selectedKind?.label}</h3><button className="inline-flex min-h-11 items-center gap-2 rounded-md border border-zinc-300 px-3 text-sm font-bold" onClick={() => setStep(3)} type="button"><Pencil className="size-4" /> Edit</button></div>
          {draft.kind === "card" ? <ProductReview item={draft.card} quantity={draft.card.quantity} /> : null}
          {draft.kind === "sealed" ? <><ProductReview item={draft.sealed} kind="sealed" quantity={draft.sealed.quantity} />{draft.useSealedOverrides ? <p className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm font-medium text-zinc-700">Reviewed unit costs: {draft.sealedUnitAllocations.map((value, index) => `Unit ${index + 1}: £${value || "0.00"}`).join(" · ")}</p> : amountKnown ? <p className="text-sm font-medium text-zinc-600">Each exact unit: {equalSealedUnitAllocations.map((value) => `£${value}`).join(" · ")}</p> : <p className="text-sm font-medium text-zinc-600">Each exact unit cost remains unknown.</p>}</> : null}
          {draft.kind === "bulk" ? <><div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm font-medium"><strong className="font-bold">{cardCountSummary(completedCardContents(draft.bulkCards))}</strong><span className="mt-1 block text-zinc-600">{completedCardContents(draft.bulkCards).reduce((sum, card) => sum + card.quantity, 0)} identified of {draft.bulkTotalCardCount} total cards · allocation uses £{penceToPounds(totalPence)} ÷ {draft.bulkTotalCardCount}</span></div>{completedCardContents(draft.bulkCards).map((card) => <ProductReview item={card} key={card.id} quantity={card.quantity} />)}</> : null}
          {draft.kind === "supply" ? <div className="rounded-lg border border-zinc-200 p-3"><p className="font-bold capitalize">{draft.supplyCategory === "other" ? draft.supplyOther : draft.supplyCategory}</p><p className="mt-1 text-sm font-medium text-zinc-500">Quantity {draft.supplyQuantity}</p></div> : null}
        </div>
        <div className="mt-4 rounded-lg border border-zinc-200 p-3"><span className="text-xs font-bold uppercase text-zinc-500">Notes</span><p className="mt-1 whitespace-pre-wrap text-sm font-medium text-zinc-700">{draft.notes || "No purchase notes."}</p></div>
        <div className="mt-4 rounded-lg border border-[#8a1f2d]/30 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-950"><strong className="block font-black">{edit ? "Ready to update?" : "Ready to record?"}</strong><p className="mt-1">Confirm only after the summary above matches what you bought.</p></div>
      </FormSection></div></StepPanel> : null}

      <WizardActions finalLabel={edit ? "Update purchase" : `Confirm${source.mode === "preview" ? " preview" : ""} purchase`} onBack={() => { setError(null); setStep((current) => Math.max(firstVisibleStep, current - 1)); }} onConfirm={submit} onNext={nextStep} pending={pending || (step === 4 && cardPricing.pendingCount > 0)} pendingLabel={cardPricing.pendingCount > 0 && !pending ? "Finishing estimates…" : "Saving…"} step={wizardStep} totalSteps={wizardTotalSteps} />
    </form>
    </DraftHydrationBoundary>
  );
}

type OpeningDraft = {
  version: 8;
  acquisitionMode: "tracked" | "untracked" | null;
  recordName: string;
  date: string;
  notes: string;
  total: string;
  amountKnown: boolean;
  product: ProductIdentityDraft;
  sealedUnitId: string | null;
  sourceOption: SourceOption;
  sourceOther: string;
  pulls: CardContentsDraft[];
};

function isOpeningDraft(value: unknown): value is OpeningDraft {
  if (!isRecord(value) || !hasFields(value, [
    "version", "acquisitionMode", "recordName", "date", "notes", "total", "product", "sealedUnitId",
    "amountKnown", "sourceOption", "sourceOther", "pulls",
  ])) return false;
  return value.version === 8
    && (value.acquisitionMode === null || value.acquisitionMode === "tracked" || value.acquisitionMode === "untracked")
    && isString(value.recordName)
    && isString(value.date)
    && isString(value.notes)
    && isString(value.total)
    && typeof value.amountKnown === "boolean"
    && isProductIdentityDraft(value.product)
    && isNullableString(value.sealedUnitId)
    && isOneOf(value.sourceOption, sourceOptions.map((option) => option.value))
    && isString(value.sourceOther)
    && Array.isArray(value.pulls)
    && value.pulls.every(isCardContentsDraft);
}

function openingEditDraft(record: RecordEntry, snapshot: RecordsSnapshot): OpeningDraft {
  const openedUnit = snapshot.sealedUnits.find((unit) => unit.openedRecordId === record.id);
  const acquisition = openedUnit
    ? snapshot.records.find((candidate) => candidate.id === openedUnit.acquiredRecordId)
    : null;
  const source = sourceValue(acquisition?.source ?? record.source);
  const tcgplayerUrl = openedUnit?.tcgplayerUrl || "";
  return {
    version: 8,
    acquisitionMode: acquisition?.type === "imported-acquisition" ? "untracked" : "tracked",
    recordName: record.title,
    date: record.date,
    notes: record.notes,
    total: openedUnit?.allocationPence === null || openedUnit?.allocationPence === undefined
      ? ""
      : (openedUnit.allocationPence / 100).toFixed(2),
    amountKnown: openedUnit?.allocationPence !== null && openedUnit?.allocationPence !== undefined,
    product: {
      ...blankProductIdentity(openedUnit?.name || "", openedUnit?.edition || ""),
      tcgplayerUrl,
      imageUrl: openedUnit?.imageUrl || null,
      fetchStatus: isTcgplayerProductUrl(tcgplayerUrl) ? "resolved" : "attention",
      fetchAttempted: true,
      fetchMessage: "Loaded from this existing Pack Opening.",
      metadataNeedsAttention: !isTcgplayerProductUrl(tcgplayerUrl),
      editedFields: [],
    },
    sealedUnitId: openedUnit?.id ?? null,
    ...source,
    pulls: existingCardDrafts(record, snapshot),
  };
}

export function OpeningForm({ edit, onSaved }: { edit?: RecordFormEdit; onSaved: (recordId: string, warning?: string) => void }) {
  const source = useRecordsDataSource();
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnHref = taskReturnHref(searchParams.get("origin"));
  const requested = searchParams.get("sealedId");
  const requestedUnit = source.snapshot.sealedUnits.find((unit) => unit.id === requested && unit.status === "sealed");
  const initialDraft = useMemo<OpeningDraft>(() => ({
    ...(edit ? openingEditDraft(edit.record, edit.snapshot) : {
    version: 8,
    acquisitionMode: requestedUnit ? "tracked" : null,
    recordName: "",
    date: today(),
    notes: "",
    total: requestedUnit?.allocationPence !== null && requestedUnit?.allocationPence !== undefined ? (requestedUnit.allocationPence / 100).toFixed(2) : "",
    amountKnown: requestedUnit ? requestedUnit.allocationPence !== null && requestedUnit.allocationPence !== undefined : true,
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
    }),
  }), [edit, requestedUnit]);
  const launchIntent = useMemo(() => ({
    kind: requested ? "sealed-unit" as const : "none" as const,
    id: requested,
    label: requestedUnit?.name || (requested ? "the requested sealed unit" : undefined),
  }), [requested, requestedUnit?.name]);
  const lifecycle = useFormDraftLifecycle({
    workflow: "pack-opening",
    ownerScope: source.draftOwnerScope,
    origin: `/records/new/opening${searchParams.size ? `?${searchParams.toString()}` : ""}`,
    intent: launchIntent,
    initialData: initialDraft,
    identity: edit?.record.id,
    isValidData: isOpeningDraft,
  });
  const { data: draft, setData: setDraft } = lifecycle;
  const updatePullPricing = useCallback((cardId: string, pricing: CardPricingDraft) => {
    setDraft((current) => ({
      ...current,
      pulls: current.pulls.map((pull) => pull.id === cardId && cardPricingIdentityKey(pull) === pricing.identityKey
        ? { ...pull, pricing }
        : pull),
    }));
  }, [setDraft]);
  const cardPricing = useCardPricing(updatePullPricing);
  // Keep canonical step numbers so validation and saving stay shared with
  // creation, but begin edits on the pulled-card details page.
  const [step, setStep] = useState(() => edit ? 3 : 1);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [sealedQuery, setSealedQuery] = useState("");
  const firstVisibleStep = edit ? 2 : 1;
  const wizardLabels = edit
    ? ["Product", "Pulled cards", "Review"]
    : ["Opening type", "Product", "Pulled cards", "Review"];
  const wizardStep = edit ? step - 1 : step;
  const wizardTotalSteps = edit ? 3 : 4;
  const formSnapshot = edit?.snapshot ?? source.snapshot;
  const resolvedSource = sourceLabel(draft);
  const giftSelected = draft.sourceOption === "gift";
  const selectedTrackedUnit = draft.acquisitionMode === "tracked"
    ? formSnapshot.sealedUnits.find((unit) => unit.id === draft.sealedUnitId && (
        unit.status === "sealed" || (edit && unit.openedRecordId === edit.record.id)
      ))
    : null;
  const selectedAcquisition = selectedTrackedUnit
    ? formSnapshot.records.find((record) => record.id === selectedTrackedUnit.acquiredRecordId)
    : null;
  const openingSource = selectedAcquisition?.source ?? resolvedSource;
  const selectedUnitAmountKnown = selectedTrackedUnit?.allocationPence !== null && selectedTrackedUnit?.allocationPence !== undefined;
  const openingAmountKnown = selectedTrackedUnit ? selectedUnitAmountKnown : giftSelected || draft.amountKnown;
  const openingTotalPence = selectedTrackedUnit?.allocationPence ?? (openingAmountKnown ? (giftSelected ? 0 : parsePoundsToPence(draft.total) ?? 0) : 0);
  const matchingSealedUnits = formSnapshot.sealedUnits.filter((unit) => {
    if (unit.status !== "sealed") return false;
    const acquisition = formSnapshot.records.find((record) => record.id === unit.acquiredRecordId);
    const query = sealedQuery.trim().toLowerCase();
    return !query || [unit.name, unit.edition, acquisition?.source, acquisition?.title].filter(Boolean).join(" ").toLowerCase().includes(query);
  });

  function selectTrackedUnit(sealedUnitId: string) {
    const unit = formSnapshot.sealedUnits.find((item) => item.id === sealedUnitId && item.status === "sealed");
    const acquisition = unit ? formSnapshot.records.find((record) => record.id === unit.acquiredRecordId) : null;
    if (!unit || !acquisition) return;
    setDraft((current) => ({ ...current, acquisitionMode: "tracked", sealedUnitId: unit.id,
      sourceOption: sourceOptions.find((option) => option.label === acquisition.source)?.value ?? "other",
      sourceOther: sourceOptions.some((option) => option.label === acquisition.source) ? "" : acquisition.source,
      total: unit.allocationPence !== null && unit.allocationPence !== undefined ? (unit.allocationPence / 100).toFixed(2) : "",
      amountKnown: unit.allocationPence !== null && unit.allocationPence !== undefined,
      product: { ...current.product, name: unit.name, tcgplayerUrl: unit.tcgplayerUrl || "", imageUrl: unit.imageUrl || null, edition: unit.edition || "", fetchAttempted: true, fetchStatus: "resolved", fetchMessage: "Loaded from tracked sealed stock." },
    }));
  }

  function updateOpeningEdition(edition: ProductEdition | "") {
    setDraft((current) => ({ ...current, product: { ...current.product, edition } }));
  }

  function productStepError() {
    if (!draft.recordName.trim()) return "Add a short record name before continuing.";
    if (edit) {
      if (!draft.date) return "Add the opening date.";
      return null;
    }
    if (draft.acquisitionMode === "tracked" && !selectedTrackedUnit) return "Choose one sealed product from your tracked stock.";
    if (draft.acquisitionMode === "untracked") {
      const problem = productError(draft.product, "sealed");
      if (problem) return problem;
      if (openingAmountKnown && !giftSelected && parsePoundsToPence(draft.total) === null) return "Enter an amount such as 12.34, or mark the cost as unknown.";
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
    const pulls = completedCardContents(draft.pulls);
    if (!pulls.length) return "Add at least one pulled card.";
    for (const pull of pulls) {
      const problem = edit ? existingCardError(pull) : cardContentsError(pull);
      if (problem) return `${pull.name || "A pulled card"}: ${problem}`;
    }
    return null;
  }

  function nextStep() {
    const problem = step === 1 ? openingTypeError() : step === 2 ? productStepError() : pullsError();
    if (problem) { setError(problem); return; }
    setError(null);
    if (step === 3 && source.mode === "live") completedCardContents(draft.pulls).forEach(cardPricing.requestPricing);
    setStep((current) => Math.min(4, current + 1));
  }

  async function submit() {
    if (step !== 4) return;
    const problem = openingTypeError() ?? productStepError() ?? pullsError();
    if (problem) { setError(problem); return; }
    setPending(true);
    if (edit) {
      const cardsResult = await source.replaceRecordCards(
        edit.record.id,
        completedCardContents(draft.pulls).map(cardInput),
        edit.record.revision,
      );
      if (!cardsResult.ok) {
        setPending(false);
        setError(cardsResult.message);
        return;
      }
      const detailsResult = await source.updateRecordDetails(edit.record.id, {
        title: draft.recordName.trim(),
        date: draft.date,
        source: openingSource,
        listingUrl: null,
        amountPence: edit.record.amountPence,
        amountKnown: edit.record.amountKnown !== false,
        notes: draft.notes.trim(),
        sealedAllocationOverrideConfirmed: false,
      }, edit.record.revision + 1);
      setPending(false);
      if (!detailsResult.ok) {
        setError(`${detailsResult.message} The pulled-card changes were saved; retry to finish the Record details.`);
        return;
      }
      lifecycle.discard();
      onSaved(edit.record.id, [cardsResult.warning, detailsResult.warning].filter(Boolean).join(" ") || undefined);
      return;
    }
    const result = await source.createOpening({
      recordName: draft.recordName.trim(),
      date: draft.date,
      notes: draft.notes.trim(),
      product: productInput(draft.product),
      sealedUnitId: draft.sealedUnitId,
      source: openingSource,
      totalPence: openingTotalPence,
      amountKnown: openingAmountKnown,
      useTrackedStock: draft.acquisitionMode === "tracked",
      pulls: completedCardContents(draft.pulls).map(cardInput),
    });
    setPending(false);
    if (!result.ok) { setError(result.message); return; }
    lifecycle.discard();
    onSaved(result.id!, result.warning);
  }

  const editingOpeningDetails = edit ? (
    <div className="grid gap-5">
      <PreviewNotice label="Opened product is fixed.">The product and its acquisition cost are historical source data. This edit updates the Pack Opening name, date, notes, and pulled cards.</PreviewNotice>
      <ProductReview item={draft.product} kind="sealed" quantity={1} />
      <label><span className="text-sm font-bold text-zinc-700">Record name <span className="text-rose-700">*</span></span><input className={fieldClass} maxLength={80} onChange={(event) => setDraft((current) => ({ ...current, recordName: event.target.value }))} required value={draft.recordName} /></label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label><span className="text-sm font-bold text-zinc-700">Opening date <span className="text-rose-700">*</span></span><input className={fieldClass} onChange={(event) => setDraft((current) => ({ ...current, date: event.target.value }))} required type="date" value={draft.date} /></label>
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm"><strong className="block">Original source</strong><p className="mt-1 font-medium text-zinc-600">{openingSource} · {openingAmountKnown ? `£${(openingTotalPence / 100).toFixed(2)}` : "Cost unknown"}</p></div>
      </div>
      <label><span className="text-sm font-bold text-zinc-700">Opening notes <span className="font-medium text-zinc-400">(optional)</span></span><textarea className={textAreaClass} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} value={draft.notes} /></label>
    </div>
  ) : null;

  return (
    <DraftHydrationBoundary ready={lifecycle.hydrated}>
    <form autoComplete="off" className="grid gap-4" onSubmit={(event) => event.preventDefault()}>
      <DestructiveToast message={error} onDismiss={() => setError(null)} />
      {lifecycle.conflict ? <DraftConflictDialog incoming={launchIntent} onCancel={() => router.replace(returnHref)} onResume={lifecycle.resumePrevious} onStartNew={lifecycle.startNew} previous={lifecycle.conflict.intent} /> : null}
      <FormDraftStatus dirty={lifecycle.dirty} onDiscard={() => {
        if (!window.confirm("Discard this Pack Opening draft and start again?")) return;
        lifecycle.discard();
        setStep(edit ? 3 : 1);
      }} recoveryMessage={lifecycle.recoveryMessage} restored={lifecycle.restored} />
      <WizardProgress labels={wizardLabels} step={wizardStep} />

      {step === 1 ? <StepPanel step={step}><FormSection description="Choose the kind of opening before adding any product details." number={1} title="How are you recording this opening?">
        {edit ? <PreviewNotice label="Editing existing Pack Opening.">The original opening type and exact sealed source are fixed so this update cannot consume another sealed unit.</PreviewNotice> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <button aria-pressed={draft.acquisitionMode === "tracked"} className={`group flex min-h-32 items-start gap-4 rounded-lg border p-5 text-left disabled:cursor-not-allowed disabled:opacity-45 ${draft.acquisitionMode === "tracked" ? "border-[#8a1f2d] bg-rose-50" : "border-zinc-300 bg-white hover:border-zinc-500 hover:bg-zinc-50"}`} disabled={Boolean(edit)} onClick={() => setDraft((current) => ({ ...current, acquisitionMode: "tracked", sealedUnitId: null }))} type="button"><span className={`grid size-12 shrink-0 place-items-center rounded-lg ${draft.acquisitionMode === "tracked" ? "bg-[#8a1f2d] text-white" : "bg-zinc-100 text-zinc-700 group-hover:bg-zinc-200"}`}><Archive className="size-6" /></span><span><strong className="block text-lg">Tracked sealed stock</strong><span className="mt-2 block text-sm font-medium text-zinc-500">Choose one product already in your sealed Inventory.</span></span></button>
          <button aria-pressed={draft.acquisitionMode === "untracked"} className={`group flex min-h-32 items-start gap-4 rounded-lg border p-5 text-left disabled:cursor-not-allowed disabled:opacity-45 ${draft.acquisitionMode === "untracked" ? "border-[#8a1f2d] bg-rose-50" : "border-zinc-300 bg-white hover:border-zinc-500 hover:bg-zinc-50"}`} disabled={Boolean(edit)} onClick={() => setDraft((current) => ({ ...current, acquisitionMode: "untracked", sealedUnitId: null }))} type="button"><span className={`grid size-12 shrink-0 place-items-center rounded-lg ${draft.acquisitionMode === "untracked" ? "bg-[#8a1f2d] text-white" : "bg-zinc-100 text-zinc-700 group-hover:bg-zinc-200"}`}><PackageOpen className="size-6" /></span><span><strong className="block text-lg">Untracked opening</strong><span className="mt-2 block text-sm font-medium text-zinc-500">Record the sealed product, source, and full cost now.</span></span></button>
        </div>
      </FormSection></StepPanel> : null}

      {step === 2 ? <StepPanel step={step}><FormSection description={draft.acquisitionMode === "tracked" ? "Find the exact sealed unit you are opening." : "Add the sealed product and the shared details for this opening."} number={2} title="Opening details">
        {edit ? editingOpeningDetails : null}
        {!edit ? <div className="contents">
        {draft.acquisitionMode === "tracked" ? <div className="grid gap-4"><label><span className="text-sm font-bold text-zinc-700">Find sealed product <span className="text-rose-700">*</span></span><span className="relative mt-1 block"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" /><input autoFocus className={`${fieldClass} mt-0 pl-9`} onChange={(event) => setSealedQuery(event.target.value)} placeholder="Search product, edition, source, or purchase name" value={sealedQuery} /></span></label><div className="max-h-72 overflow-y-auto rounded-lg border border-zinc-200 bg-white p-2">{matchingSealedUnits.length ? matchingSealedUnits.map((unit) => { const acquisition = source.snapshot.records.find((record) => record.id === unit.acquiredRecordId); const selected = unit.id === draft.sealedUnitId; return <button aria-pressed={selected} className={`w-full rounded-md border p-3 text-left transition ${selected ? "border-[#8a1f2d] bg-rose-50" : "border-transparent hover:border-zinc-300 hover:bg-zinc-50"}`} key={unit.id} onClick={() => selectTrackedUnit(unit.id)} type="button"><span className="block font-bold text-zinc-950">{unit.name}</span><span className="mt-1 block text-sm font-medium text-zinc-500">{unit.edition || "Edition unknown"} · {acquisition ? `${unit.allocationPence === null || unit.allocationPence === undefined ? "Cost unknown" : `£${(unit.allocationPence / 100).toFixed(2)}`} · ${acquisition.source} · ${acquisition.date}` : "Purchase details unavailable"}</span></button>; }) : <p className="px-3 py-6 text-center text-sm font-medium text-zinc-500">No available sealed products match that search.</p>}</div>{selectedAcquisition && selectedTrackedUnit ? <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm"><strong className="block">Cost for this exact sealed unit</strong><p className="mt-1 font-medium text-zinc-600">{selectedTrackedUnit.allocationPence === null || selectedTrackedUnit.allocationPence === undefined ? "Cost unknown" : `£${(selectedTrackedUnit.allocationPence / 100).toFixed(2)}`} · {selectedAcquisition.source} · {selectedAcquisition.date}</p><p className="mt-1 text-zinc-500">This opening uses one selected unit; it never uses the whole Purchase total.</p></div> : null}</div> : <div className="grid gap-5"><ProductIdentityEditor hideSealedEdition kind="sealed" onChange={(product) => setDraft((current) => ({ ...current, product }))} value={draft.product} /><label><span className="text-sm font-bold text-zinc-700">Record name <span className="text-rose-700">*</span></span><input className={fieldClass} maxLength={80} onChange={(event) => setDraft((current) => ({ ...current, recordName: event.target.value }))} placeholder="e.g. Spellcasters Command opening" required value={draft.recordName} /></label><div className="grid gap-4 sm:grid-cols-2"><label><span className="text-sm font-bold text-zinc-700">Product edition <span className="font-medium text-zinc-400">(optional)</span></span><select className={fieldClass} onChange={(event) => updateOpeningEdition(event.target.value as ProductEdition | "")} value={draft.product.edition}><option value="">Not specified</option><option value="1st Edition">1st Edition</option><option value="Unlimited Edition">Unlimited Edition</option><option value="Limited Edition">Limited Edition</option></select></label><SellerSourceField onChange={(sourceValue) => setDraft((current) => ({ ...current, ...sourceValue, total: sourceValue.sourceOption === "gift" ? "0.00" : current.total, amountKnown: sourceValue.sourceOption === "gift" ? true : current.amountKnown }))} value={draft} /></div><div className="grid gap-4 sm:grid-cols-2"><label><span className="text-sm font-bold text-zinc-700">All-in amount paid {openingAmountKnown ? <span className="text-rose-700">*</span> : null}</span><div className="relative mt-1"><span className="pointer-events-none absolute inset-y-0 left-3 flex items-center font-bold text-zinc-500">£</span><input className={`${fieldClass} mt-0 pl-7 read-only:bg-zinc-100`} disabled={!openingAmountKnown} inputMode="decimal" min="0" onChange={(event) => setDraft((current) => ({ ...current, total: event.target.value }))} readOnly={giftSelected} required={openingAmountKnown} step="0.01" type="number" value={giftSelected ? "0.00" : draft.total} /></div><span className="mt-1 block text-xs font-medium text-zinc-500">{giftSelected ? "Gift selected — amount is fixed at £0.00." : openingAmountKnown ? "Include delivery, fees, and discounts." : "The cost will remain unknown, not £0.00."}</span><span className="mt-2 flex items-center gap-2 text-sm font-semibold"><input checked={!openingAmountKnown} disabled={giftSelected} onChange={(event) => setDraft((current) => ({ ...current, amountKnown: !event.target.checked, total: event.target.checked ? "" : current.total }))} type="checkbox" /> Cost unknown</span></label><label><span className="text-sm font-bold text-zinc-700">Opening date <span className="text-rose-700">*</span></span><input className={fieldClass} onChange={(event) => setDraft((current) => ({ ...current, date: event.target.value }))} required type="date" value={draft.date} /></label></div><label><span className="text-sm font-bold text-zinc-700">Opening notes <span className="font-medium text-zinc-400">(optional)</span></span><textarea className={textAreaClass} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} placeholder="Condition, pull, or opening context" value={draft.notes} /></label></div>}
        </div> : null}
      </FormSection></StepPanel> : null}

      {step === 3 ? <StepPanel step={step}><FormSection description="Each row creates physical Copies tied to this opening. Fetch and check every card before reviewing." number={3} title="Pulled cards"><CardContentsEditor allowExistingIncomplete={Boolean(edit)} noun="pulled card" onChange={(pulls) => setDraft((current) => ({ ...current, pulls }))} onFinishCard={source.mode === "live" ? cardPricing.requestPricing : undefined} rows={draft.pulls} /></FormSection></StepPanel> : null}

      {step === 4 ? <StepPanel step={step}><div className="grid gap-4"><PreviewNotice label={source.mode === "preview" ? "Preview only." : "Review before saving."}>This is a read-only review. Nothing has been saved; only the confirmation button below {edit ? "updates this existing Pack Opening" : `creates the ${source.mode === "preview" ? "preview " : ""}opening`}.</PreviewNotice><FormSection description="Check the product, source, date, pulled cards, and notes. Use Edit to correct a section." number={4} title="Review opening">
        <div className="flex items-start justify-between gap-3"><div><span className="text-xs font-bold uppercase text-zinc-500">Record name</span><h3 className="mt-1 font-bold">{draft.recordName}</h3><p className="mt-1 text-sm font-medium text-zinc-500">Opened product · {openingSource} · {draft.date}</p></div><button className="inline-flex min-h-11 items-center gap-2 rounded-md border border-zinc-300 px-3 text-sm font-bold" onClick={() => setStep(2)} type="button"><Pencil className="size-4" /> Edit</button></div><div className="mt-3"><ProductReview item={draft.product} kind="sealed" quantity={1} /></div>
        <div className="mt-5 flex items-start justify-between gap-3"><div><h3 className="font-bold">Pulled cards</h3><p className="mt-1 text-sm font-medium text-zinc-500">{cardCountSummary(completedCardContents(draft.pulls))}</p></div><button className="inline-flex min-h-11 items-center gap-2 rounded-md border border-zinc-300 px-3 text-sm font-bold" onClick={() => setStep(3)} type="button"><Pencil className="size-4" /> Edit</button></div><div className="mt-3 grid gap-3">{completedCardContents(draft.pulls).map((pull) => <ProductReview item={pull} key={pull.id} quantity={pull.quantity} />)}</div>
        <div className="mt-4 rounded-lg border border-zinc-200 p-3"><span className="text-xs font-bold uppercase text-zinc-500">Notes</span><p className="mt-1 whitespace-pre-wrap text-sm font-medium text-zinc-700">{draft.notes || "No opening notes."}</p></div>
        <div className="mt-4 rounded-lg border border-[#8a1f2d]/30 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-950"><strong className="block font-black">{edit ? "Ready to update?" : "Ready to record?"}</strong><p className="mt-1">Confirm only after the product and every pulled card are correct.</p></div>
      </FormSection></div></StepPanel> : null}

      <WizardActions finalLabel={edit ? "Update opening" : `Confirm${source.mode === "preview" ? " preview" : ""} opening`} onBack={() => { setError(null); setStep((current) => Math.max(firstVisibleStep, current - 1)); }} onConfirm={submit} onNext={nextStep} pending={pending || (step === 4 && cardPricing.pendingCount > 0)} pendingLabel={cardPricing.pendingCount > 0 && !pending ? "Finishing estimates…" : "Saving…"} step={wizardStep} totalSteps={wizardTotalSteps} />
    </form>
    </DraftHydrationBoundary>
  );
}

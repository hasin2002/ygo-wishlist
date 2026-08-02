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
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
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
  DraftConflictDialog,
  DraftHydrationBoundary,
  FormDraftStatus,
  type DraftConflictCardSummary,
} from "@/components/records/form-draft-ui";
import { useRecordsDataSource } from "@/components/records/records-preview-provider";
import {
  copyExposureSelectorLabel,
  ebayExposurePresentation,
  ebayExposureSummary,
  physicalCopyStateLabel,
} from "@/components/records/ebay-copy-exposure-presentation";
import { generatedSaleRecordName } from "@/lib/records/record-name";
import { useFormDraftLifecycle } from "@/lib/records/use-form-draft-lifecycle";
import {
  paidEbaySaleReviewIntentName,
  parsePaidEbaySaleReviewIntent,
  taskReturnHref,
  type PaidEbaySaleReviewIntent,
} from "@/lib/navigation-intent";
import { hasFields, isOneOf, isRecord, isString } from "@/lib/records/form-draft-validators";
import { copyDisplayLabel, copyPhysicalIdentifier, copyShortReference } from "@/lib/records/copy-display";
import { copySelectionAvailabilityReason, filterCopySelectionCandidates, pageCopySelection, reconcileCopySelection, removeDuplicateCopySelectionId } from "@/lib/records/copy-selection";
import type {
  CardCopy,
  CardPrinting,
  CopyEbayExposureState,
  WishlistTarget,
} from "@/lib/records/types";
import { trpc } from "@/trpc/client";

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
  exposure: CopyEbayExposureState | undefined;
  printing: CardPrinting;
  target: WishlistTarget;
  imageUrl: string | null;
};

type CopyPhotoSummary = {
  count: number;
  primary: { key: string; previewUrl: string } | null;
};

type LibraryImpact = {
  after: number;
  before: number;
  target: WishlistTarget;
};

function draftConflictCardSummary(
  item: AvailableCopy,
  photo: CopyPhotoSummary | undefined,
  additionalCopies = 0,
): DraftConflictCardSummary {
  return {
    additionalCopies,
    condition: item.copy.condition,
    identifier: copyPhysicalIdentifier(item.copy),
    imageUrl: photo?.primary?.previewUrl
      || (item.imageUrl ? `/api/image-proxy?url=${encodeURIComponent(item.imageUrl)}` : null),
    name: item.target.name,
    rarity: item.target.rarity || "Unknown rarity",
  };
}

function newSaleDraft(copyId?: string | null): SaleDraft {
  return {
    version: 3,
    kind: copyId ? "single" : null,
    recordName: "",
    date: today(),
    source: "eBay",
    proceeds: "",
    notes: "",
    copyIds: copyId ? [copyId] : [],
  };
}

function isSaleDraft(value: unknown): value is SaleDraft {
  if (!isRecord(value) || !hasFields(value, ["version", "kind", "recordName", "date", "source", "proceeds", "notes", "copyIds"])) return false;
  return value.version === 3
    && (value.kind === null || isOneOf(value.kind, ["single", "bulk"] as const))
    && isString(value.recordName)
    && isString(value.date)
    && isString(value.source)
    && isString(value.proceeds)
    && isString(value.notes)
    && Array.isArray(value.copyIds)
    && value.copyIds.every(isString);
}

function CopyThumbnail({ eager = false, item, primaryPhotoUrl }: { eager?: boolean; item: AvailableCopy; primaryPhotoUrl?: string | null }) {
  const imageUrl = primaryPhotoUrl || (item.imageUrl ? `/api/image-proxy?url=${encodeURIComponent(item.imageUrl)}` : null);
  const exposurePresentation = item.exposure
    ? ebayExposurePresentation(item.exposure.aggregateState, item.exposure.liveOfferCount)
    : null;
  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
      <div className="relative aspect-[3/4] bg-zinc-100">
        {imageUrl ? (
          <Image
            alt=""
            className="object-contain p-2"
            fill
            loading={eager ? "eager" : "lazy"}
            sizes="(max-width: 640px) 50vw, (max-width: 1280px) 33vw, 25vw"
            src={imageUrl}
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
        <p className="mt-2 text-xs font-bold text-zinc-700">Physical · {item.exposure ? physicalCopyStateLabel(item.exposure) : "Status unavailable"}</p>
        <p className="mt-1 text-xs font-bold text-zinc-700">eBay exposure · {exposurePresentation?.label ?? "Unavailable"}{item.exposure ? ` · ${ebayExposureSummary(item.exposure)}` : ""}</p>
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

export function SaleForm({ onSaved }: { onSaved: (recordId: string, warning?: string) => void }) {
  const source = useRecordsDataSource();
  const searchParams = useSearchParams();
  const paidReviewRequested = searchParams.getAll("intent").includes(paidEbaySaleReviewIntentName);
  const paidReviewIntent = useMemo(
    () => parsePaidEbaySaleReviewIntent(searchParams),
    [searchParams],
  );
  const inspection = trpc.records.inspectPaidEbaySaleReview.useQuery(
    paidReviewIntent ?? { copyId: "_invalid", listingId: "_invalid" },
    {
      enabled: source.mode === "live" && paidReviewRequested && paidReviewIntent !== null,
      staleTime: 0,
    },
  );

  if (
    source.mode === "live"
    && paidReviewRequested
    && paidReviewIntent
    && inspection.isPending
  ) {
    return (
      <div aria-live="polite" className="rounded-lg border border-zinc-200 bg-white p-4 text-sm font-medium text-zinc-600">
        Checking the exact paid eBay Copy…
      </div>
    );
  }

  const recoveryMessage = !paidReviewRequested
    ? null
    : !paidReviewIntent
      ? "This paid Sale review link is incomplete. Return to the eBay listing and choose Review Sale record again."
      : source.mode !== "live"
        ? "Paid eBay Sale review is available in live Records. No physical Copy has been selected in preview."
        : inspection.isError
          ? "The paid eBay Sale review could not be checked. Return to Listings, refresh the paid listing, and try again."
          : inspection.data && !inspection.data.ok
            ? inspection.data.message
            : null;
  const paidReviewReady = Boolean(
    paidReviewIntent
    && source.mode === "live"
    && inspection.data?.ok,
  );

  return (
    <SaleFormWorkflow
      onSaved={onSaved}
      paidReviewIntent={paidReviewRequested ? paidReviewIntent : null}
      paidReviewRequested={paidReviewRequested}
      paidReviewReady={paidReviewReady}
      recoveryMessage={recoveryMessage}
    />
  );
}

function SaleFormWorkflow({
  onSaved,
  paidReviewIntent,
  paidReviewRequested,
  paidReviewReady,
  recoveryMessage,
}: {
  onSaved: (recordId: string, warning?: string) => void;
  paidReviewIntent: PaidEbaySaleReviewIntent | null;
  paidReviewRequested: boolean;
  paidReviewReady: boolean;
  recoveryMessage: string | null;
}) {
  const source = useRecordsDataSource();
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnHref = taskReturnHref(searchParams.get("origin"));
  const requestedCopyId = paidReviewRequested
    ? paidReviewReady && paidReviewIntent ? paidReviewIntent.copyId : null
    : searchParams.get("copyId");
  const initialDraft = useMemo(() => newSaleDraft(requestedCopyId), [requestedCopyId]);
  const launchIntent = useMemo(() => ({
    kind: paidReviewRequested || requestedCopyId ? "copy" as const : "none" as const,
    id: paidReviewRequested
      ? paidReviewIntent
        ? `${paidEbaySaleReviewIntentName}:${paidReviewIntent.listingId}:${paidReviewIntent.copyId}`
        : `${paidEbaySaleReviewIntentName}:invalid`
      : requestedCopyId,
    label: paidReviewRequested
      ? paidReviewIntent
        ? `paid eBay listing for physical Copy #${copyShortReference(paidReviewIntent.copyId)}`
        : "incomplete paid eBay Sale review"
      : requestedCopyId ? `physical Copy #${copyShortReference(requestedCopyId)}` : undefined,
  }), [paidReviewIntent, paidReviewRequested, requestedCopyId]);
  const lifecycle = useFormDraftLifecycle({
    workflow: "sale",
    ownerScope: source.draftOwnerScope,
    origin: `/records/new/sale${searchParams.size ? `?${searchParams.toString()}` : ""}`,
    intent: launchIntent,
    initialData: initialDraft,
    isValidData: isSaleDraft,
  });
  const { data: draft, setData: setDraft } = lifecycle;
  const [step, setStep] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [paidReviewActive, setPaidReviewActive] = useState(paidReviewReady);
  const [query, setQuery] = useState("");
  const [condition, setCondition] = useState("all");
  const [rarity, setRarity] = useState("all");
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [photoSummaries, setPhotoSummaries] = useState<Record<string, CopyPhotoSummary>>({});

  const allCopies = useMemo<AvailableCopy[]>(() => {
    const printings = new Map(source.snapshot.printings.map((printing) => [printing.id, printing]));
    const targets = new Map(source.snapshot.targets.map((target) => [target.id, target]));
    const exposures = new Map(source.snapshot.copyEbayExposures.map((exposure) => [exposure.copyId, exposure]));

    return source.snapshot.copies.flatMap((copy) => {
      const printing = printings.get(copy.printingId);
      const target = printing ? targets.get(printing.targetId) : undefined;
      if (!printing || !target) return [];
      return [{ copy, exposure: exposures.get(copy.id), printing, target, imageUrl: printing.imageUrl || target.imageUrl }];
    });
  }, [source.snapshot.copies, source.snapshot.copyEbayExposures, source.snapshot.printings, source.snapshot.targets]);

  const selectionReason = useCallback((item: AvailableCopy) => (
    paidReviewActive && paidReviewIntent?.copyId === item.copy.id
      ? null
      : copySelectionAvailabilityReason({
          copyId: item.copy.id,
          exposure: item.exposure,
          status: item.copy.status,
        })
  ), [paidReviewActive, paidReviewIntent]);
  const selection = useMemo(() => reconcileCopySelection(
    draft.copyIds,
    allCopies.map((item) => ({
      id: item.copy.id,
      item,
      reason: selectionReason(item),
    })),
    { min: draft.kind === "single" ? 1 : 2, max: 100 },
  ), [allCopies, draft.copyIds, draft.kind, selectionReason]);
  const availableCopies = useMemo(() => allCopies.filter((item) => (
    selectionReason(item) === null
  )), [allCopies, selectionReason]);
  const rarityOptions = useMemo(
    () => Array.from(new Set(availableCopies.map((item) => item.target.rarity).filter(Boolean))).sort((left, right) => left.localeCompare(right)),
    [availableCopies],
  );
  const conditionOptions = useMemo(
    () => Array.from(new Set(availableCopies.map((item) => item.copy.condition))).sort((left, right) => left.localeCompare(right)),
    [availableCopies],
  );

  const selectedCopies = selection.selected;
  const copiesForTarget = (item: AvailableCopy) => source.snapshot.copies.filter((copy) => {
    const printing = source.snapshot.printings.find((candidate) => candidate.id === copy.printingId);
    return printing?.targetId === item.target.id;
  });

  const filteredCopies = useMemo(() => filterCopySelectionCandidates(availableCopies, {
    condition, query, rarity, selectedIds: selection.selectedIds, selectedOnly,
    searchTerms: (item) => item.exposure
      ? [ebayExposurePresentation(item.exposure.aggregateState, item.exposure.liveOfferCount).label, ebayExposureSummary(item.exposure)]
      : ["exposure unavailable"],
  }), [availableCopies, condition, query, rarity, selectedOnly, selection.selectedIds]);
  const pagination = pageCopySelection(filteredCopies, page, salePageSize);
  const { currentPage, items: visibleCopies, pageCount, resultEnd, resultStart } = pagination;
  const conflictCopyIds = lifecycle.conflict?.data.copyIds ?? [];
  const photoCopyIds = Array.from(new Set([
    ...visibleCopies.map((item) => item.copy.id),
    ...selectedCopies.map((item) => item.copy.id),
    ...conflictCopyIds,
    ...(requestedCopyId ? [requestedCopyId] : []),
  ])).join(",");

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

  useEffect(() => {
    if (source.mode !== "live" || !photoCopyIds) return;
    let active = true;
    void fetch(`/api/inventory/card-images?copyIds=${encodeURIComponent(photoCopyIds)}`)
      .then(async (response) => {
        const payload = await response.json() as { summaries?: Record<string, CopyPhotoSummary> };
        if (!response.ok) throw new Error();
        if (active) setPhotoSummaries(payload.summaries ?? {});
      })
      .catch(() => { if (active) setPhotoSummaries({}); });
    return () => { active = false; };
  }, [photoCopyIds, source.mode]);

  function typeError() {
    return draft.kind ? null : "Choose Single card or Bulk cards before continuing.";
  }

  function detailsError() {
    if (!draft.date) return "Add the sale date.";
    if (!(paidReviewActive ? "eBay" : draft.source).trim()) return "Add the marketplace or buyer.";
    if (!draft.proceeds.trim()) return "Enter the net amount you kept.";
    return null;
  }

  function selectionError() {
    if (selection.issues.length) return selection.issues[0]!.message;
    if (draft.kind === "single" && selection.selectedIds.length !== 1) return "Choose exactly one physical copy for a Single card sale.";
    if (draft.kind === "bulk" && selection.selectedIds.length < 2) return "Choose at least two physical copies for a Bulk card sale.";
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
      source: paidReviewActive ? "eBay" : draft.source.trim(),
      netProceedsPence: poundsToPence(draft.proceeds),
      notes: draft.notes.trim(),
      copyIds: selection.selectedIds,
      ...(paidReviewActive && paidReviewIntent
        ? { paidEbayReview: paidReviewIntent }
        : {}),
    });
    setPending(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    lifecycle.discard();
    onSaved(result.id!, result.warning);
  }

  function chooseType(kind: SaleKind) {
    if (paidReviewActive && kind !== "single") return;
    setDraft((current) => ({
      ...current,
      kind,
      copyIds: current.kind === kind ? current.copyIds : [],
    }));
  }

  function toggleCopy(copyId: string, checked: boolean) {
    if (paidReviewActive) return;
    if (checked && draft.kind === "bulk" && selection.selectedIds.length >= 100) {
      setError("A Bulk card sale can contain no more than 100 physical Copies.");
      return;
    }
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
    setCondition("all");
    setRarity("all");
    setSelectedOnly(false);
    setPage(1);
  }

  const saleLabel = draft.kind === "single" ? "Single card" : "Bulk cards";
  const saleSource = paidReviewActive ? "eBay" : draft.source;
  const saleRecordName = draft.recordName.trim() || generatedSaleRecordName(selectedCopies.map((item) => item.target.name));
  const requiredCopies = draft.kind === "single" ? 1 : 2;
  const remainingCopies = Math.max(0, requiredCopies - selection.selectedIds.length);
  const selectionComplete = draft.kind !== null && selection.valid;
  const previousConflictCopy = allCopies.find((item) => item.copy.id === conflictCopyIds[0]);
  const incomingConflictCopy = allCopies.find((item) => item.copy.id === requestedCopyId);
  const previousConflictItem = previousConflictCopy
    ? draftConflictCardSummary(
        previousConflictCopy,
        photoSummaries[previousConflictCopy.copy.id],
        Math.max(0, conflictCopyIds.length - 1),
      )
    : undefined;
  const incomingConflictItem = incomingConflictCopy
    ? draftConflictCardSummary(incomingConflictCopy, photoSummaries[incomingConflictCopy.copy.id])
    : undefined;

  return (
    <DraftHydrationBoundary ready={lifecycle.hydrated}>
    <form autoComplete="off" className="grid gap-4" onSubmit={(event) => event.preventDefault()}>
      <DestructiveToast message={error} onDismiss={() => setError(null)} />
      {lifecycle.conflict ? <DraftConflictDialog incoming={launchIntent} incomingItem={incomingConflictItem} onCancel={() => router.replace(returnHref)} onResume={() => {
        setPaidReviewActive(false);
        lifecycle.resumePrevious();
      }} onStartNew={() => {
        setPaidReviewActive(paidReviewReady);
        lifecycle.startNew();
      }} previous={lifecycle.conflict.intent} previousItem={previousConflictItem} /> : null}
      {recoveryMessage ? <aside className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold leading-6 text-amber-950" role="status">{recoveryMessage}</aside> : null}
      {paidReviewActive ? <aside className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-semibold leading-6 text-emerald-950">The exact paid eBay Copy is selected. Enter the Sale details, review them, and explicitly save the Record.</aside> : null}
      <FormDraftStatus dirty={lifecycle.dirty} onDiscard={() => {
        if (!window.confirm("Discard this Sale draft and start again?")) return;
        lifecycle.discard();
        setStep(1);
      }} recoveryMessage={lifecycle.recoveryMessage} restored={lifecycle.restored} />
      <WizardProgress labels={["Sale type", "Sale details", "Cards sold", "Review"]} step={step} />

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
                    disabled={paidReviewActive && option.kind !== "single"}
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
                <input className={fieldClass} onChange={(event) => setDraft((current) => ({ ...current, source: event.target.value }))} readOnly={paidReviewActive} required value={saleSource} />
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
                {draft.kind === "bulk" && selection.selectedIds.length === 1 ? (
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

            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(160px,0.3fr)_minmax(180px,0.35fr)_auto] lg:items-end">
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
                <span className="text-sm font-bold text-zinc-700">Condition</span>
                <select className={fieldClass} onChange={(event) => { setCondition(event.target.value); setPage(1); }} value={condition}>
                  <option value="all">All conditions</option>
                  {conditionOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
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

            <div aria-atomic="true" aria-live="polite" className="mt-4 flex flex-col gap-1 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <strong>{selection.selectedIds.length} {selection.selectedIds.length === 1 ? "copy" : "copies"} selected</strong>
                <span className="mt-0.5 block text-sm font-medium text-zinc-500">
                  {selectionComplete
                    ? "Selection complete"
                    : draft.kind === "single"
                      ? "Choose one copy to continue"
                      : selection.selectedIds.length === 1
                        ? "Bulk sales need two or more copies. Add another card or switch to Single sale."
                        : `Choose ${remainingCopies} more ${remainingCopies === 1 ? "copy" : "copies"} to continue`}
                </span>
              </div>
              <span className="text-sm font-medium text-zinc-500">Showing {resultStart}–{resultEnd} of {filteredCopies.length}</span>
            </div>

            {selection.issues.length ? (
              <div aria-live="assertive" className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-950">
                <strong className="block">Selected Copies need attention</strong>
                <ul className="mt-2 grid gap-2">
                  {selection.issues.map((issue, index) => <li className="flex flex-wrap items-center justify-between gap-2" key={`${issue.code}:${issue.copyId ?? "selection"}:${index}`}>
                    <span>{issue.message}</span>
                    {issue.copyId ? <button className="min-h-11 rounded-md border border-rose-300 bg-white px-3 font-bold" onClick={() => {
                      if (issue.code === "duplicate") setDraft((current) => ({ ...current, copyIds: removeDuplicateCopySelectionId(current.copyIds, issue.copyId!) }));
                      else toggleCopy(issue.copyId!, false);
                    }} type="button">{issue.code === "duplicate" ? "Remove duplicate" : "Remove"}</button> : null}
                  </li>)}
                </ul>
              </div>
            ) : null}

            {visibleCopies.length ? (
              <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
                {visibleCopies.map((item, index) => {
                  const selected = selection.selectedIds.includes(item.copy.id);
                  const exposurePresentation = item.exposure
                    ? ebayExposurePresentation(item.exposure.aggregateState, item.exposure.liveOfferCount)
                    : null;
                  const copyLabel = `${item.target.name}, ${item.printing.setCode || "unknown set"}, Copy ${item.copy.id.slice(-6)}`;
                  return (
                    <label
                      className={`group relative cursor-pointer overflow-hidden rounded-lg border bg-white transition focus-within:ring-2 focus-within:ring-[#8a1f2d] focus-within:ring-offset-2 ${selected ? "border-[#8a1f2d] ring-1 ring-[#8a1f2d]" : "border-zinc-200 hover:border-zinc-400 hover:shadow-sm"}`}
                      key={item.copy.id}
                    >
                      <div className="relative aspect-[3/4] bg-zinc-100">
                        {photoSummaries[item.copy.id]?.primary?.previewUrl || item.imageUrl ? (
                          <Image
                            alt=""
                            className="object-contain p-2"
                            fill
                            loading={index < 4 ? "eager" : "lazy"}
                            sizes="(max-width: 768px) 50vw, (max-width: 1280px) 33vw, 25vw"
                            src={photoSummaries[item.copy.id]?.primary?.previewUrl || `/api/image-proxy?url=${encodeURIComponent(item.imageUrl!)}`}
                            unoptimized
                          />
                        ) : (
                          <span className="grid h-full place-items-center text-xs font-black text-zinc-400">CARD</span>
                        )}
                        <input
                          aria-label={`Select ${copyExposureSelectorLabel(copyLabel, item.exposure)}. eBay status ${exposurePresentation?.label ?? "Unavailable"}.`}
                          checked={selected}
                          className="sr-only"
                          disabled={paidReviewActive}
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
                        {photoSummaries[item.copy.id]?.primary ? <span className="absolute bottom-2 left-2 z-10 rounded-full bg-zinc-950/80 px-2 py-1 text-[10px] font-black text-white">Copy photo</span> : null}
                      </div>
                      <span className="block p-3">
                        <span className="line-clamp-2 block min-h-10 text-sm font-black leading-5 text-zinc-950">{item.target.name}</span>
                        <span className="mt-1 block text-xs font-bold text-[#8a1f2d]">{item.target.rarity || "Unknown rarity"}</span>
                        <span className="mt-1 block text-xs font-medium text-zinc-500">{item.printing.setCode || "Unknown set"} · {item.target.edition || "Unknown edition"}</span>
                        <span className="mt-1 block text-xs font-medium text-zinc-500">{copyDisplayLabel(copiesForTarget(item), item.copy.id)} · #{copyShortReference(item.copy.id)} · {item.copy.condition}</span>
                        <span className="mt-2 block text-xs font-bold text-zinc-700">Physical · {item.exposure ? physicalCopyStateLabel(item.exposure) : "Status unavailable"}</span>
                        <span className="mt-1 block break-words text-xs font-bold text-zinc-700">eBay exposure · {exposurePresentation?.label ?? "Unavailable"}{item.exposure ? ` · ${ebayExposureSummary(item.exposure)}` : ""}</span>
                        {item.copy.privateNote ? <span className="mt-1 block text-[11px] font-medium text-zinc-500">{item.copy.privateNote}</span> : null}
                        {photoSummaries[item.copy.id]?.count ? <span className="mt-1 block text-[11px] font-bold text-zinc-500">{photoSummaries[item.copy.id].count} saved {photoSummaries[item.copy.id].count === 1 ? "photo" : "photos"}</span> : null}
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
                <button className="inline-flex min-h-11 items-center gap-2 rounded-md border border-zinc-300 px-3 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-40" disabled={currentPage === 1} onClick={() => setPage((current) => Math.max(1, current - 1))} type="button"><ChevronLeft className="size-4" /> Previous</button>
                <span className="text-sm font-bold text-zinc-600">Page {currentPage} of {pageCount}</span>
                <button className="inline-flex min-h-11 items-center gap-2 rounded-md border border-zinc-300 px-3 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-40" disabled={currentPage === pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))} type="button">Next <ChevronRight className="size-4" /></button>
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
                  <p className="mt-1 text-sm font-medium text-zinc-500">{saleLabel} · £{penceToPounds(poundsToPence(draft.proceeds))} · {saleSource} · {draft.date}</p>
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
                {selectedCopies.map((item, index) => <CopyThumbnail eager={index < 4} item={item} key={item.copy.id} primaryPhotoUrl={photoSummaries[item.copy.id]?.primary?.previewUrl} />)}
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
    </DraftHydrationBoundary>
  );
}

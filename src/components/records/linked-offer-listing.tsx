"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  ChevronDown,
  ImageIcon,
  Layers3,
  Loader2,
  PackageCheck,
  RotateCcw,
  Tag,
  Trash2,
  Truck,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useViewportOverlay } from "@/components/use-viewport-overlay";
import { CardImagePreviewDialog } from "@/components/records/card-image-preview-dialog";
import {
  ListingPhotoSetManager,
  type ListingPhotoSetImage,
} from "@/components/records/listing-photo-set-manager";
import { useRecordsDataSource } from "@/components/records/records-preview-provider";
import { SearchablePicklist } from "@/components/records/searchable-picklist";
import {
  fieldClass,
  StepPanel,
  textAreaClass,
  WizardActions,
  WizardProgress,
} from "@/components/records/entry-form-ui";
import {
  ebayCardCategory,
  ebayDeliveryServices,
  type EbayDeliveryServiceCode,
  type EbayListingItemSpecifics,
} from "@/lib/ebay-listing-options";
import {
  linkedOfferCompatibilityKey,
  linkedOfferOperations,
  linkedOfferPricePrefill,
  linkedOfferQuantities,
  linkedOfferVariantAvailability,
  planLinkedOfferChanges,
  protectLinkedOfferWishlistCopies,
  selectLinkedOfferCopies,
  type LinkedOffer,
} from "@/lib/records/ebay-linked-offers";
import {
  linkedOfferDescription,
  linkedOfferTitle,
} from "@/lib/records/linked-offer-copy";
import { cardConditionOptions, isCardCondition, type CardCondition } from "@/lib/records/types";
import { trpc } from "@/trpc/client";

type ListingPhoto = {
  archiveKey: string | null;
  ebayUrl: string | null;
  listingPhotoKey: string | null;
  previewUrl: string;
};

type SharedDefaults = {
  dispatchTimeMax: string;
  location: string;
  postalCode: string;
  shippingCost: string;
  shippingService: EbayDeliveryServiceCode;
};

type OfferKind = "individual" | "x2" | "x3";

type OfferDraft = {
  description: string;
  kind: OfferKind;
  photos: ListingPhoto[];
  price: string;
  title: string;
};

type OperationResult = {
  error?: string;
  kind: string;
  review?: {
    errors?: Array<{ code?: string | null; message?: string | null; severity?: string | null }>;
    fees?: Array<{ amount?: number; currency?: string; name?: string | null }>;
    readyToPublish?: boolean;
  } | null;
  state: string;
};

type SavedDraft = {
  listKeptCopies?: boolean;
  mode?: "individual" | "linked";
  offers?: OfferDraft[];
  quantity?: number;
  shared?: SharedDefaults;
  step?: number;
};

const defaultService = ebayDeliveryServices[0];
const deliveryMarkupPence = 40;

function suggestedDeliveryCharge(service: (typeof ebayDeliveryServices)[number]) {
  return ((service.suggestedCostPence + deliveryMarkupPence) / 100).toFixed(2);
}

const initialShared: SharedDefaults = {
  dispatchTimeMax: "3",
  location: "Surrey",
  postalCode: "GU21 6DE",
  shippingCost: suggestedDeliveryCharge(defaultService),
  shippingService: defaultService.code,
};

function pence(value: string) {
  const normalized = value.trim().replace(/[£,\s]/g, "");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  return Math.round(Number(normalized) * 100);
}

function conditionDescriptor(condition: string) {
  return cardConditionOptions.find((option) => option.value === condition)?.ebayDescriptorValueId ?? "400010";
}

function editionFeature(edition: string) {
  if (/limited/i.test(edition)) return "Limited Edition";
  if (/unlimited/i.test(edition)) return "Unlimited Edition";
  return "1st Edition";
}

function specifics(target: { edition: string; rarity: string }, printing: { setCode: string; setName: string }): EbayListingItemSpecifics {
  return {
    cardNumber: printing.setCode || "Not specified",
    cardSize: "Japanese",
    features: editionFeature(target.edition),
    game: "Yu-Gi-Oh! TCG",
    manufacturer: "Konami",
    rarity: target.rarity || "Not specified",
    setName: printing.setName || printing.setCode || "Not specified",
  };
}

function offerLabel(kind: OfferKind) {
  return kind === "individual" ? "Individual listing" : `${kind} set listing`;
}

function formatReviewMoney(amount: number, currency = "GBP") {
  try {
    return new Intl.NumberFormat("en-GB", { currency, style: "currency" }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function simplifyEbayNote(message: string | null | undefined) {
  if (!message) return "eBay returned an additional note.";
  if (message.includes("Funds from your sales may be unavailable")) return "eBay may temporarily hold the money from a sale.";
  if (message.includes("additional postage cost")) return "Additional postage uses the same price as standard delivery.";
  if (message.includes("Final Value Fee waived")) return "eBay says the final value fee is waived.";
  return message;
}

function ReviewResultCard({
  offer,
  quantity,
  result,
}: {
  offer: OfferDraft | null;
  quantity: number;
  result: OperationResult;
}) {
  const kind = result.kind as OfferKind;
  const setSize = kind === "individual" ? 1 : kind === "x2" ? 2 : 3;
  const ebayQuantity = Math.floor(quantity / setSize);
  const errors = result.review?.errors ?? [];
  const blockingMessages = errors.filter((error) => error.severity?.toLocaleLowerCase("en-GB") === "error");
  const notes = errors.filter((error) => error.severity?.toLocaleLowerCase("en-GB") !== "error");
  const positiveFees = (result.review?.fees ?? []).filter((fee) => Number(fee.amount ?? 0) > 0);
  const feeTotals = Array.from(positiveFees.reduce((totals, fee) => {
    const currency = fee.currency || "GBP";
    totals.set(currency, (totals.get(currency) ?? 0) + Number(fee.amount ?? 0));
    return totals;
  }, new Map<string, number>()));
  const ready = result.state === "published" || (result.state === "reviewed" && result.review?.readyToPublish === true && !positiveFees.length && !result.error);
  const statusLabel = result.state === "published" ? "Published" : ready ? "Ready to publish" : "Needs changes";

  return <li className={`rounded-lg border p-4 ${ready ? "border-emerald-200 bg-emerald-50/40" : "border-rose-300 bg-rose-50/50"}`}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 className="font-black text-zinc-950">{offerLabel(kind)}</h3>
        {offer?.title ? <p className="mt-0.5 line-clamp-2 text-sm font-medium leading-5 text-zinc-600">{offer.title}</p> : null}
      </div>
      <span className={`inline-flex min-h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-bold ${ready ? "bg-emerald-100 text-emerald-900" : "bg-rose-100 text-rose-900"}`}>
        {ready ? <CheckCircle2 aria-hidden="true" className="size-3.5" /> : <AlertTriangle aria-hidden="true" className="size-3.5" />}
        {statusLabel}
      </span>
    </div>
    <dl className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-zinc-200 bg-zinc-200 text-sm sm:grid-cols-4">
      <div className="bg-white p-3"><dt className="font-medium text-zinc-500">Buyer receives</dt><dd className="mt-0.5 font-black text-zinc-950">{setSize} {setSize === 1 ? "card" : "matching cards"}</dd></div>
      <div className="bg-white p-3"><dt className="font-medium text-zinc-500">eBay quantity</dt><dd className="mt-0.5 font-black tabular-nums text-zinc-950">{ebayQuantity}</dd></div>
      <div className="bg-white p-3"><dt className="font-medium text-zinc-500">Price</dt><dd className="mt-0.5 font-black tabular-nums text-zinc-950">{offer ? `£${offer.price}` : "—"}</dd></div>
      <div className="bg-white p-3"><dt className="font-medium text-zinc-500">Upfront eBay fee</dt><dd className={`mt-0.5 font-black tabular-nums ${positiveFees.length ? "text-rose-800" : "text-emerald-800"}`}>{feeTotals.length ? feeTotals.map(([currency, amount]) => formatReviewMoney(amount, currency)).join(" + ") : "£0.00"}</dd></div>
    </dl>
    {positiveFees.length ? <div className="mt-3 rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-950"><p className="font-black">Publication is blocked because eBay reported an upfront fee.</p><ul className="mt-1 grid gap-1 font-medium">{positiveFees.map((fee, index) => <li key={`${fee.name ?? "fee"}-${index}`}>{fee.name ?? "Listing fee"}: {formatReviewMoney(Number(fee.amount ?? 0), fee.currency || "GBP")}</li>)}</ul></div> : null}
    {blockingMessages.map((error, index) => <p className="mt-3 rounded-md border border-rose-300 bg-rose-50 p-3 text-sm font-bold text-rose-950" key={`${error.code ?? "error"}-${index}`}>{error.message ?? `eBay error ${error.code ?? "unknown"}`}</p>)}
    {result.error ? <p className="mt-3 rounded-md border border-rose-300 bg-rose-50 p-3 text-sm font-bold text-rose-950">{result.error}</p> : null}
    {notes.length ? <details className="mt-3 text-sm"><summary className="min-h-11 cursor-pointer content-center font-bold text-zinc-700">{notes.length} {notes.length === 1 ? "note" : "notes"} from eBay</summary><ul className="grid gap-1 rounded-md bg-white p-3 text-zinc-700">{notes.map((note, index) => <li key={`${note.code ?? "note"}-${index}`}>{simplifyEbayNote(note.message)}</li>)}</ul></details> : null}
  </li>;
}

function defaultOffer(
  kind: OfferKind,
  target: { name: string; edition: string; rarity: string; estimatedPricePence?: number | null; marketPricePence: number | null },
  printing: { setCode: string; setName: string },
  condition: string,
  priorSetOffers: Array<{ kind: "x2" | "x3"; pricePence: number }> = [],
): OfferDraft {
  const identity = {
    condition,
    edition: target.edition,
    name: target.name,
    rarity: target.rarity,
    setCode: printing.setCode,
    setName: printing.setName,
  };
  const price = linkedOfferPricePrefill(
    kind,
    target.estimatedPricePence ?? target.marketPricePence ?? 0,
    priorSetOffers,
  );
  return {
    description: linkedOfferDescription(kind, identity),
    kind,
    photos: [],
    price: (price / 100).toFixed(2),
    title: linkedOfferTitle(kind, identity),
  };
}

function savedDraft(value: unknown): SavedDraft | null {
  return value && typeof value === "object" ? value as SavedDraft : null;
}

function reusablePhotos(images: ListingPhotoSetImage[]): ListingPhoto[] {
  return images.map((image) => ({
    archiveKey: null,
    ebayUrl: null,
    listingPhotoKey: image.key,
    previewUrl: image.previewUrl,
  }));
}

function OfferPage({
  canManage,
  cardName,
  condition,
  edition,
  offer,
  onPhotosChange,
  onUpdate,
  printingId,
  quantityLabel,
  sourceCopyIds,
}: {
  canManage: boolean;
  cardName: string;
  condition: CardCondition;
  edition: string;
  offer: OfferDraft;
  onPhotosChange: (images: ListingPhotoSetImage[]) => void;
  onUpdate: (update: Partial<OfferDraft>) => void;
  printingId: string;
  quantityLabel: string;
  sourceCopyIds: string[];
}) {
  return <div className="grid gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(20rem,.95fr)]">
    <section className="rounded-xl border border-zinc-300 bg-white p-4 shadow-sm sm:p-5">
      <p className="text-xs font-bold uppercase tracking-[.12em] text-[#8a1f2d]">{offerLabel(offer.kind)}</p>
      <h2 className="mt-1 text-xl font-black">Make this listing clear to buyers</h2>
      <p className="mt-1 text-sm font-medium leading-6 text-zinc-600">{quantityLabel}</p>
      <div className="mt-5 grid gap-4">
        <label className="text-sm font-bold">Title <span className="font-medium text-zinc-500">({offer.title.length}/80)</span><input className={fieldClass} maxLength={80} onChange={(event) => onUpdate({ title: event.target.value })} value={offer.title} /></label>
        <label className="text-sm font-bold">Price (£)<input className={fieldClass} inputMode="decimal" onChange={(event) => onUpdate({ price: event.target.value })} value={offer.price} /></label>
        <label className="text-sm font-bold">Description<textarea className={`${textAreaClass} min-h-72 leading-6`} maxLength={4000} onChange={(event) => onUpdate({ description: event.target.value })} value={offer.description} /></label>
      </div>
    </section>
    <div className="min-w-0"><ListingPhotoSetManager canManage={canManage} cardName={cardName} condition={condition} edition={edition} kind={offer.kind} onImagesChange={onPhotosChange} printingId={printingId} sourceCopyIds={sourceCopyIds} surface="card" /></div>
  </div>;
}

function DiscardDraftDialog({
  draftCount,
  error,
  onClose,
  onConfirm,
  pending,
  triggerRef,
}: {
  draftCount: number;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
  pending: boolean;
  triggerRef: RefObject<HTMLButtonElement | null>;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const close = () => { if (!pending) onClose(); };
  const dialogRef = useViewportOverlay<HTMLDivElement>({
    initialFocusRef: cancelRef,
    isOpen: true,
    onClose: close,
    triggerRef,
  });

  if (typeof document === "undefined") return null;

  return createPortal(
    <div aria-busy={pending} aria-describedby="discard-listing-draft-description" aria-labelledby="discard-listing-draft-title" aria-modal="true" className="fixed inset-0 z-[80] grid place-items-end bg-zinc-950/55 p-3 backdrop-blur-sm sm:place-items-center sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }} role="alertdialog">
      <div className="max-h-[calc(100dvh-1.5rem)] w-full max-w-md overflow-y-auto rounded-xl border border-rose-200 bg-white shadow-2xl sm:max-h-[calc(100dvh-3rem)]" ref={dialogRef} tabIndex={-1}>
        <div className="p-5 sm:p-6">
          <span className="grid size-11 place-items-center rounded-full bg-rose-50 text-rose-700"><Trash2 aria-hidden="true" className="size-5" /></span>
          <h2 className="mt-4 text-xl font-black text-zinc-950" id="discard-listing-draft-title">Delete unfinished {draftCount === 1 ? "draft" : "drafts"}?</h2>
          <p className="mt-2 text-sm font-medium leading-6 text-zinc-600" id="discard-listing-draft-description">This permanently removes the saved {draftCount === 1 ? "listing draft" : `${draftCount} listing drafts`}. It won&apos;t remove ended listings, inventory history, or saved photos.</p>
          {error ? <p className="mt-3 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-900" role="alert">{error}</p> : null}
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-zinc-200 bg-zinc-50 p-4 sm:flex-row sm:justify-end sm:px-6">
          <button className="min-h-11 rounded-md border border-zinc-300 bg-white px-4 text-sm font-bold text-zinc-700 disabled:cursor-wait disabled:opacity-60" disabled={pending} onClick={close} ref={cancelRef} type="button">Cancel</button>
          <button className="min-h-11 rounded-md bg-rose-700 px-4 text-sm font-bold text-white transition hover:bg-rose-800 focus-visible:ring-2 focus-visible:ring-rose-700 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60" disabled={pending} onClick={onConfirm} type="button">{pending ? "Deleting…" : "Delete draft"}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function LinkedOfferListing({
  initialCondition,
  initialPrintingId,
  initialResumeFamilyId,
  initialTargetId,
}: {
  initialCondition?: string;
  initialPrintingId?: string;
  initialResumeFamilyId?: string;
  initialTargetId?: string;
}) {
  const router = useRouter();
  const source = useRecordsDataSource();
  const [mode, setMode] = useState<"individual" | "linked" | null>(null);
  const [targetId, setTargetId] = useState(initialTargetId ?? "");
  const [variantKey, setVariantKey] = useState(initialPrintingId && initialCondition ? `${initialPrintingId}\0${initialCondition}` : "");
  const [quantity, setQuantity] = useState<number | null>(null);
  const [listKept, setListKept] = useState(false);
  const [step, setStep] = useState(1);
  const [shared, setShared] = useState(initialShared);
  const [offers, setOffers] = useState<OfferDraft[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [successToast, setSuccessToast] = useState<string | null>(null);
  const [resumeFamilyId, setResumeFamilyId] = useState(initialResumeFamilyId ?? null);
  const [dismissedRecoveryFamilyId, setDismissedRecoveryFamilyId] = useState<string | null>(null);
  const [familyId, setFamilyId] = useState<string | null>(null);
  const [operationResults, setOperationResults] = useState<OperationResult[] | null>(null);
  const [pending, setPending] = useState(false);
  const [cardImageOpen, setCardImageOpen] = useState(false);
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false);
  const [discardError, setDiscardError] = useState<string | null>(null);
  const cardImageTriggerRef = useRef<HTMLButtonElement>(null);
  const discardTriggerRef = useRef<HTMLButtonElement>(null);
  const restoredFamilyRef = useRef<string | null>(null);
  const savePlan = trpc.ebay.saveLinkedOfferPool.useMutation();
  const reviewPlan = trpc.ebay.reviewLinkedOfferPlan.useMutation();
  const publishPlan = trpc.ebay.publishLinkedOfferPlan.useMutation();
  const discardPlan = trpc.ebay.discardLinkedOfferDraft.useMutation();

  useEffect(() => {
    if (!successToast) return;
    const timeout = window.setTimeout(() => setSuccessToast(null), 4500);
    return () => window.clearTimeout(timeout);
  }, [successToast]);

  const targetOptions = useMemo(() => {
    const printingTargetIds = new Map(source.snapshot.printings.map((printing) => [printing.id, printing.targetId]));
    const ownedCounts = new Map<string, number>();
    for (const copy of source.snapshot.copies) {
      if (copy.status !== "available" || !isCardCondition(copy.condition)) continue;
      const ownedTargetId = printingTargetIds.get(copy.printingId);
      if (ownedTargetId) ownedCounts.set(ownedTargetId, (ownedCounts.get(ownedTargetId) ?? 0) + 1);
    }
    return source.snapshot.targets.flatMap((target) => {
      const ownedCount = ownedCounts.get(target.id) ?? 0;
      if (!ownedCount) return [];
      return [{
        detail: `${target.rarity} · ${target.edition} · ${ownedCount} ${ownedCount === 1 ? "Copy" : "Copies"} owned`,
        displayText: `${target.name} · ${target.rarity} · ${target.edition}`,
        id: target.id,
        label: target.name,
        searchText: `${target.name} ${target.rarity} ${target.edition}`.toLocaleLowerCase("en-GB"),
      }];
    });
  }, [source.snapshot.copies, source.snapshot.printings, source.snapshot.targets]);

  const groups = useMemo(() => {
    const result = new Map<string, {
      condition: CardCondition;
      copies: typeof source.snapshot.copies;
      printing: typeof source.snapshot.printings[number];
      target: typeof source.snapshot.targets[number];
    }>();
    if (!targetId) return [];
    for (const copy of source.snapshot.copies) {
      if (copy.status !== "available" || !isCardCondition(copy.condition)) continue;
      const printing = source.snapshot.printings.find((candidate) => candidate.id === copy.printingId);
      const target = printing ? source.snapshot.targets.find((candidate) => candidate.id === printing.targetId) : null;
      if (!printing || !target || target.id !== targetId) continue;
      const key = linkedOfferCompatibilityKey({ printingId: printing.id, edition: target.edition, condition: copy.condition });
      const group = result.get(key) ?? { condition: copy.condition, copies: [], printing, target };
      group.copies.push(copy);
      result.set(key, group);
    }
    return Array.from(result, ([key, group]) => ({ key, ...group }));
  }, [source, targetId]);

  const variantOptions = useMemo(() => groups.map((candidate) => ({
    detail: `${candidate.printing.setName || candidate.printing.setCode} · ${candidate.condition} · ${candidate.copies.length} owned`,
    displayText: `${candidate.printing.setCode || candidate.printing.setName} · ${candidate.condition} · ${candidate.copies.length} owned`,
    id: candidate.key,
    label: candidate.printing.setCode || candidate.printing.setName,
    searchText: `${candidate.printing.setCode} ${candidate.printing.setName} ${candidate.condition}`.toLocaleLowerCase("en-GB"),
  })), [groups]);

  const selectedVariantKey = groups.some((candidate) => candidate.key === variantKey)
    ? variantKey
    : groups[0]?.key ?? "";
  const group = groups.find((candidate) => candidate.key === selectedVariantKey) ?? null;
  const variantQuery = trpc.ebay.linkedOfferVariant.useQuery({
    printingId: group?.printing.id ?? "missing",
    condition: group?.condition ?? "Near Mint",
  }, { enabled: source.mode === "live" && Boolean(group) });
  const live = variantQuery.data;
  const fallbackTargetCopies = group ? source.snapshot.copies.flatMap((copy) => {
    const printing = source.snapshot.printings.find((candidate) => candidate.id === copy.printingId);
    if (printing?.targetId !== group.target.id || copy.status !== "available") return [];
    return [{
      acquiredAt: copy.createdAt,
      condition: copy.condition,
      copyId: copy.id,
      edition: group.target.edition,
      printingId: copy.printingId,
    }];
  }) : [];
  const fallbackCandidates = group ? protectLinkedOfferWishlistCopies(fallbackTargetCopies, group.target.desiredQuantity)
    .filter((copy) => copy.printingId === group.printing.id && copy.condition === group.condition) : [];
  const availability = live?.availability ?? (group ? linkedOfferVariantAvailability(fallbackCandidates) : null);
  const candidates = live?.copies.map((copy) => ({
    acquiredAt: copy.acquiredAt,
    condition: copy.condition,
    copyId: copy.id,
    edition: group?.target.edition ?? "",
    printingId: copy.printingId,
    wishlistProtected: copy.wishlistProtected,
  })) ?? fallbackCandidates;
  const defaultQuantity = availability ? Math.min(candidates.length, availability.toList) : 0;
  const selectedQuantity = Math.min(quantity ?? defaultQuantity, listKept ? candidates.length : defaultQuantity);
  const selectedCopies = selectLinkedOfferCopies(candidates, selectedQuantity);
  const selectedCopyIds = selectedCopies.map((copy) => copy.copyId);
  const activeOffers = (live?.activeOffers ?? []) as Array<LinkedOffer & { blockedReason?: string | null; listingId: string }>;
  const changes = mode ? planLinkedOfferChanges(activeOffers, selectedQuantity, mode) : [];
  const operations = mode ? linkedOfferOperations(activeOffers, selectedQuantity, mode) : [];
  const previousOffers = live?.offers ?? [];
  const previousActiveCount = previousOffers.filter((offer) => offer.state === "published" && offer.currentListingState !== "ended").length;
  const previousEndedCount = previousOffers.filter((offer) => offer.state === "published" && offer.currentListingState === "ended").length;
  const previousUnfinishedCount = previousOffers.filter((offer) => offer.state !== "published").length;
  const previousFailedCount = previousOffers.filter((offer) => offer.state === "failed" || offer.state === "uncertain").length;
  const showPreviousAttempt = Boolean(
    live?.family
    && previousUnfinishedCount
    && dismissedRecoveryFamilyId !== live.family.id
    && resumeFamilyId !== live.family.id,
  );
  const blockedOperation = operations.find((operation) => (
    (operation.action === "update" || operation.action === "end")
      && activeOffers.find((offer) => offer.listingId === operation.listingId)?.blockedReason
  ));
  const planProblem = live?.planProblem
    ?? activeOffers.find((offer) => offer.listingId === blockedOperation?.listingId)?.blockedReason
    ?? null;
  const priorSetOffers = (live?.offers ?? []).flatMap((offer) => {
    if (offer.kind !== "x2" && offer.kind !== "x3") return [];
    const details = offer.details as { pricePence?: unknown };
    return typeof details.pricePence === "number" ? [{ kind: offer.kind, pricePence: details.pricePence }] : [];
  });
  const desiredSetKind = mode === "linked" ? linkedOfferQuantities(selectedQuantity).set?.kind ?? null : null;
  const flow = [
    { id: "stock", label: "Choose stock" },
    { id: "individual", label: "Individual listing" },
    ...(desiredSetKind ? [{ id: "set", label: `${desiredSetKind} listing` }] : []),
    { id: "delivery", label: "Delivery" },
    { id: "review", label: "Review" },
    { id: "publish", label: "Publish" },
  ] as const;
  const currentPage = flow[Math.min(step - 1, flow.length - 1)]?.id ?? "stock";
  const usesKept = availability ? Math.max(0, selectedQuantity - Math.min(candidates.length, availability.toList)) : 0;

  function resolvedOffer(kind: OfferKind) {
    return offers.find((offer) => offer.kind === kind)
      ?? (group ? defaultOffer(kind, group.target, group.printing, group.condition, priorSetOffers) : null);
  }

  function resumeHref(nextFamilyId?: string) {
    const params = new URLSearchParams();
    if (targetId) params.set("target", targetId);
    if (group) {
      params.set("printing", group.printing.id);
      params.set("condition", group.condition);
    }
    if (nextFamilyId) params.set("resume", nextFamilyId);
    const query = params.toString();
    return `/records/listings/new${query ? `?${query}` : ""}`;
  }

  useEffect(() => {
    const family = live?.family;
    if (!family || resumeFamilyId !== family.id || restoredFamilyRef.current === family.id) return;
    restoredFamilyRef.current = family.id;
    const draft = savedDraft(family.draft);
    const restoredResults = live?.offers.map((offer) => ({
      error: offer.lastError ?? undefined,
      kind: offer.kind,
      review: offer.review as OperationResult["review"],
      state: offer.state,
    })) ?? [];
    const restore = window.setTimeout(() => {
      setFamilyId(family.id);
      setOperationResults(restoredResults.length ? restoredResults : null);
      if (!draft) return;
      if (draft.mode) setMode(draft.mode);
      if (typeof draft.quantity === "number") setQuantity(draft.quantity);
      if (typeof draft.listKeptCopies === "boolean") setListKept(draft.listKeptCopies);
      if (draft.shared) setShared(draft.shared);
      if (draft.offers?.length) {
        setOffers(draft.offers.map((offer) => ({
          ...offer,
          photos: Array.isArray(offer.photos) ? offer.photos : [],
        })));
      }
      if (typeof draft.step === "number") setStep(Math.max(1, draft.step));
    }, 0);
    return () => window.clearTimeout(restore);
  }, [live?.family, live?.offers, resumeFamilyId]);

  function resumePreviousAttempt() {
    const family = live?.family;
    if (!family) return;
    restoredFamilyRef.current = null;
    setResumeFamilyId(family.id);
    setDismissedRecoveryFamilyId(family.id);
    router.replace(resumeHref(family.id), { scroll: false });
  }

  function continueFresh() {
    setDiscardError(null);
    setDiscardDialogOpen(true);
  }

  async function confirmContinueFresh() {
    const previousFamilyId = live?.family?.id;
    if (!previousFamilyId || discardPlan.isPending) return;
    setDiscardError(null);
    try {
      await discardPlan.mutateAsync({ familyId: previousFamilyId });
      setDiscardDialogOpen(false);
      setDismissedRecoveryFamilyId(previousFamilyId);
      resetPlan();
      await variantQuery.refetch();
      setSuccessToast(previousUnfinishedCount === 1 ? "Unfinished listing draft deleted." : "Unfinished listing drafts deleted.");
    } catch (error) {
      setDiscardError(error instanceof Error ? error.message : "The unfinished listing draft could not be deleted.");
    }
  }

  function resetPlan() {
    setOffers([]);
    setFamilyId(null);
    setOperationResults(null);
    setMessage(null);
    setSuccessToast(null);
    if (resumeFamilyId) {
      setResumeFamilyId(null);
      restoredFamilyRef.current = null;
      router.replace(resumeHref(), { scroll: false });
    }
  }

  function updateOffer(kind: OfferKind, update: Partial<OfferDraft>) {
    setOffers((current) => {
      const base = current.find((offer) => offer.kind === kind) ?? resolvedOffer(kind);
      if (!base) return current;
      const next = { ...base, ...update };
      return current.some((offer) => offer.kind === kind)
        ? current.map((offer) => offer.kind === kind ? next : offer)
        : [...current, next];
    });
    setFamilyId(null);
    setOperationResults(null);
    setMessage(null);
    setSuccessToast(null);
  }

  async function prepareOfferPhotos(offer: OfferDraft) {
    const prepared: ListingPhoto[] = [];
    for (const photo of offer.photos) {
      let staged = photo;
      if (!staged.archiveKey) {
        if (!staged.listingPhotoKey) throw new Error(`${offerLabel(offer.kind)} has an invalid saved photo.`);
        const body = new FormData();
        body.append("copyId", selectedCopyIds[0]!);
        body.append("listingPhotoKey", staged.listingPhotoKey);
        body.append("stageOnly", "true");
        const response = await fetch("/api/ebay/image", { body, method: "POST" });
        const value = await response.json() as { archiveKey?: string; message?: string; previewUrl?: string };
        if (!response.ok || !value.archiveKey) throw new Error(value.message || "A reusable listing photo could not be prepared.");
        staged = { ...staged, archiveKey: value.archiveKey, previewUrl: value.previewUrl ?? staged.previewUrl };
      }
      if (!staged.ebayUrl) {
        const body = new FormData();
        body.append("copyId", selectedCopyIds[0]!);
        body.append("archiveKey", staged.archiveKey!);
        const response = await fetch("/api/ebay/image", { body, method: "POST" });
        const value = await response.json() as { ebayUrl?: string; message?: string };
        if (!response.ok || !value.ebayUrl) throw new Error(value.message || "A prepared photo could not be sent to eBay for Review.");
        staged = { ...staged, ebayUrl: value.ebayUrl };
      }
      prepared.push(staged);
    }
    return prepared;
  }

  function validateOffer(offer: OfferDraft) {
    if (!offer.title.trim() || offer.title.length > 80) return `${offerLabel(offer.kind)} needs a title of 80 characters or fewer.`;
    if (offer.description.trim().length < 20) return `${offerLabel(offer.kind)} needs a clearer description.`;
    if (!pence(offer.price)) return `${offerLabel(offer.kind)} needs a price of at least £0.01.`;
    if (!offer.photos.length) return `Add at least one ${offerLabel(offer.kind).toLowerCase()} photo.`;
    return null;
  }

  function detailsFor(offer: OfferDraft, photos: ListingPhoto[]) {
    if (!group) throw new Error("Choose a matching variant.");
    const pricePence = pence(offer.price);
    const shippingCostPence = pence(shared.shippingCost);
    const offerProblem = validateOffer(offer);
    if (offerProblem) throw new Error(offerProblem);
    if (!pricePence) throw new Error(`${offerLabel(offer.kind)} needs a valid price.`);
    if (shippingCostPence === null) throw new Error("Enter a valid delivery cost.");
    if (photos.some((photo) => !photo.archiveKey || !photo.ebayUrl)) throw new Error("Every listing photo must be prepared before eBay Review.");
    return {
      cardConditionDescriptorValueId: conditionDescriptor(group.condition),
      categoryId: ebayCardCategory.id,
      copyIds: selectedCopyIds,
      description: offer.description,
      dispatchTimeMax: Number(shared.dispatchTimeMax),
      imageDraftCopyId: selectedCopyIds[0]!,
      images: photos.map((photo) => ({ archiveKey: photo.archiveKey!, ebayUrl: photo.ebayUrl! })),
      itemSpecifics: specifics(group.target, group.printing),
      language: "English" as const,
      location: shared.location,
      postalCode: shared.postalCode,
      pricePence,
      shippingCostPence,
      shippingService: shared.shippingService,
      title: offer.title,
    };
  }

  async function saveAndReview() {
    if (!group || !mode || !selectedCopyIds.length) return;
    const individual = resolvedOffer("individual");
    const setOffer = desiredSetKind ? resolvedOffer(desiredSetKind) : null;
    if (!individual) return;
    setPending(true);
    setMessage(null);
    setSuccessToast(null);
    try {
      const individualProblem = validateOffer(individual);
      if (individualProblem) throw new Error(individualProblem);
      if (setOffer) {
        const setProblem = validateOffer(setOffer);
        if (setProblem) throw new Error(setProblem);
      }
      if (!Number.isInteger(Number(shared.dispatchTimeMax)) || Number(shared.dispatchTimeMax) < 1) throw new Error("Enter at least 1 dispatch day.");
      if (!shared.location.trim() || !shared.postalCode.trim() || pence(shared.shippingCost) === null) throw new Error("Complete the shared delivery details.");

      const preparedByKind = new Map<OfferKind, { draft: OfferDraft; photos: ListingPhoto[] }>();
      const preparedIndividual = await prepareOfferPhotos(individual);
      preparedByKind.set("individual", { draft: { ...individual, photos: preparedIndividual }, photos: preparedIndividual });
      if (setOffer) {
        const preparedSet = await prepareOfferPhotos(setOffer);
        preparedByKind.set(setOffer.kind, { draft: { ...setOffer, photos: preparedSet }, photos: preparedSet });
      }
      const fallback = preparedByKind.get("individual")!;
      const offerInputs = operations.map((operation) => {
        const prepared = preparedByKind.get(operation.kind) ?? fallback;
        return { ...operation, details: detailsFor(prepared.draft, prepared.photos) };
      });
      const savedOffers = Array.from(preparedByKind.values(), ({ draft }) => draft);
      setOffers(savedOffers);
      const draft = { listKeptCopies: listKept, mode, offers: savedOffers, quantity: selectedQuantity, shared, step: flow.length };
      const saved = await savePlan.mutateAsync({
        condition: group.condition,
        copyIds: selectedCopyIds,
        draft,
        listKeptCopies: listKept,
        mode,
        offers: offerInputs,
        printingId: group.printing.id,
      });
      setFamilyId(saved.familyId);
      setResumeFamilyId(saved.familyId);
      router.replace(resumeHref(saved.familyId), { scroll: false });
      const reviewed = await reviewPlan.mutateAsync({ familyId: saved.familyId });
      const reviewedResults = reviewed as OperationResult[];
      setOperationResults(reviewedResults);
      setStep(flow.length);
      const notReady = reviewedResults.filter((result) => result.state === "failed" || result.review?.readyToPublish !== true);
      if (notReady.length) {
        setMessage(`${notReady.length} offer ${notReady.length === 1 ? "needs" : "need"} changes before publication.`);
      } else {
        setSuccessToast("Every offer passed its independent eBay Review.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The plan could not be reviewed.");
    } finally {
      setPending(false);
    }
  }

  async function publish() {
    if (!familyId) return;
    setPending(true);
    setMessage(null);
    try {
      const results = await publishPlan.mutateAsync({ familyId });
      setOperationResults(results);
      const failed = results.filter((result) => result.error || result.state !== "published");
      setMessage(failed.length
        ? "Published offers were preserved. Retry only the unresolved saved offer."
        : "The linked listing plan was published successfully.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Publication stopped safely. Successful offers were preserved.");
    } finally {
      setPending(false);
    }
  }

  function next() {
    setMessage(null);
    if (currentPage === "stock") {
      if (!mode || !group || !selectedQuantity || planProblem) {
        setMessage(planProblem ?? "Choose a selling option, compatible variant, and quantity.");
        return;
      }
    } else if (currentPage === "individual") {
      const offer = resolvedOffer("individual");
      const problem = offer ? validateOffer(offer) : "Individual listing details are missing.";
      if (problem) { setMessage(problem); return; }
    } else if (currentPage === "set" && desiredSetKind) {
      const offer = resolvedOffer(desiredSetKind);
      const problem = offer ? validateOffer(offer) : `${desiredSetKind} listing details are missing.`;
      if (problem) { setMessage(problem); return; }
    } else if (currentPage === "delivery") {
      if (!Number.isInteger(Number(shared.dispatchTimeMax)) || Number(shared.dispatchTimeMax) < 1 || !shared.location.trim() || !shared.postalCode.trim() || pence(shared.shippingCost) === null) {
        setMessage("Complete the shared delivery details before Review.");
        return;
      }
    } else if (currentPage === "review") {
      void saveAndReview();
      return;
    }
    setStep((current) => Math.min(flow.length, current + 1));
  }

  if (source.status !== "ready") return <div className="grid min-h-72 place-items-center rounded-lg border border-zinc-300 bg-white font-bold" role="status">Loading listing workspace…</div>;

  const individual = resolvedOffer("individual");
  const setOffer = desiredSetKind ? resolvedOffer(desiredSetKind) : null;
  const nextLabel = currentPage === "stock"
    ? "Set up individual listing"
    : currentPage === "individual" && desiredSetKind
      ? `Set up ${desiredSetKind} listing`
      : currentPage === "individual" || currentPage === "set"
        ? "Set delivery defaults"
        : currentPage === "delivery"
          ? "Review exact plan"
          : currentPage === "review"
            ? "Run eBay Review"
            : "Publish plan";

  return <section aria-labelledby="linked-listing-title" className="mx-auto grid w-full max-w-5xl gap-4 pb-28 sm:gap-5 sm:pb-6">
    <header className="max-w-3xl"><p className="text-xs font-bold uppercase tracking-[.14em] text-[#8a1f2d]">eBay</p><h1 className="mt-1 text-2xl font-black text-zinc-950" id="linked-listing-title">Create listing</h1><p className="mt-1 text-sm font-medium leading-6 text-zinc-600">Set up each offer on its own page, then check the exact stock and eBay changes before publishing.</p></header>
    <WizardProgress labels={flow.map((item) => item.label)} step={step} />
    {message ? <p className={`rounded-lg border p-3 text-sm font-semibold ${message.includes("success") || message.includes("passed") ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-amber-300 bg-amber-50 text-amber-950"}`} role="status">{message}</p> : null}
    <StepPanel step={step}>
      {currentPage === "stock" ? <div className="grid gap-4">
        <fieldset><legend className="text-base font-black">How do you want to sell?</legend><div className="mt-2 grid gap-3 sm:grid-cols-2">{([
          { description: "One listing where buyers purchase one matching Copy at a time.", icon: Tag, label: "Sell cards individually", value: "individual" },
          { description: "Create an individual listing plus the safe x2 or x3 set listing.", icon: Layers3, label: "Create linked listings", value: "linked" },
        ] as const).map(({ description, icon: Icon, label, value }) => {
          const selected = mode === value;
          return <button aria-pressed={selected} className={`min-h-28 cursor-pointer rounded-lg border p-4 text-left shadow-sm transition focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-offset-2 ${selected ? "border-[#8a1f2d] bg-rose-50 shadow-md" : "border-zinc-300 bg-white hover:border-[#8a1f2d] hover:bg-rose-50/40"}`} key={value} onClick={() => { setMode(value); setStep(1); resetPlan(); }} type="button"><span className="flex items-center gap-4"><span className={`grid size-11 shrink-0 place-items-center rounded-lg ${selected ? "bg-[#8a1f2d] text-white" : "bg-zinc-100 text-zinc-700"}`}><Icon aria-hidden="true" className="size-5" /></span><span className="min-w-0 flex-1"><strong className="block text-base">{label}</strong><span className="mt-1 block text-sm font-medium leading-5 text-zinc-600">{description}</span></span>{selected ? <CheckCircle2 aria-hidden="true" className="size-5 shrink-0 text-[#8a1f2d]" /> : null}</span></button>;
        })}</div></fieldset>
        {mode ? <section aria-labelledby="stock-selection-title" className="rounded-xl border border-zinc-300 bg-white shadow-sm">
          <header className="flex items-start gap-3 rounded-t-xl border-b border-zinc-200 bg-zinc-50 px-4 py-3 sm:px-5"><span className="grid size-10 shrink-0 place-items-center rounded-lg bg-white text-[#8a1f2d] shadow-sm ring-1 ring-zinc-200"><Boxes aria-hidden="true" className="size-5" /></span><div><h2 className="font-black" id="stock-selection-title">Choose matching stock</h2><p className="mt-0.5 text-sm font-medium leading-5 text-zinc-600">Select one exact Printing and condition, then choose how many Copies to list.</p></div></header>
          <div className="grid lg:grid-cols-[minmax(0,1.2fr)_minmax(19rem,0.8fr)]">
            <div className="grid content-start gap-4 p-4 sm:p-5">
              <div className="grid gap-4 2xl:grid-cols-2"><SearchablePicklist emptyMessage="No owned cards match that search. Try the card name, rarity, or edition." key={targetId || "no-target"} label="Card target" onSelect={(nextTargetId) => { setTargetId(nextTargetId); setVariantKey(""); setQuantity(null); resetPlan(); }} options={targetOptions} placeholder="Search owned cards" resultsLabel="Owned card targets" selectedId={targetId} visibleRows={3} /><SearchablePicklist emptyMessage="No Printing and condition options match that search." key={`variant-${targetId}`} label="Printing and condition" labelHint="Copies are grouped by Printing and condition so every card in the listing matches." onSelect={(nextVariantKey) => { setVariantKey(nextVariantKey); setQuantity(null); resetPlan(); }} options={variantOptions} placeholder="Search Printing or condition" resultsLabel="Printing and condition options" selectedId={selectedVariantKey} visibleRows={3} /></div>
              {group ? <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs font-bold uppercase tracking-[.12em] text-[#8a1f2d]">Selected variant</p><h3 className="mt-1 text-lg font-black">{group.target.name}</h3></div>{group.printing.imageUrl || group.target.imageUrl ? <button aria-label={`View card image for ${group.target.name}`} className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-md px-2.5 text-xs font-bold text-zinc-600 transition hover:bg-white hover:text-zinc-950 focus-visible:ring-2 focus-visible:ring-[#8a1f2d]/30" onClick={() => setCardImageOpen(true)} ref={cardImageTriggerRef} type="button"><ImageIcon aria-hidden="true" className="size-4" />View card</button> : null}</div><p className="mt-1 text-sm font-medium leading-5 text-zinc-600">{group.printing.setCode} · {group.printing.setName} · {group.target.rarity} · {group.target.edition} · {group.condition}</p>{cardImageOpen && (group.printing.imageUrl || group.target.imageUrl) ? <CardImagePreviewDialog imageUrl={group.printing.imageUrl || group.target.imageUrl || ""} name={group.target.name} onClose={() => setCardImageOpen(false)} rarity={group.target.rarity} triggerRef={cardImageTriggerRef} /> : null}</div> : <div className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-4 py-8 text-center text-sm font-semibold text-zinc-600">Choose a card target and compatible variant.</div>}
            </div>
            <aside aria-label="Listing quantity" className="relative overflow-hidden rounded-b-xl border-t border-zinc-200 bg-zinc-50/70 p-4 sm:p-5 lg:rounded-bl-none lg:border-l lg:border-t-0">
              {group && (group.printing.imageUrl || group.target.imageUrl) ? <Image alt="" aria-hidden="true" className="pointer-events-none select-none object-cover object-center opacity-[0.06] saturate-50" draggable={false} fill sizes="(min-width: 1024px) 22rem, 100vw" src={`/api/image-proxy?url=${encodeURIComponent(group.printing.imageUrl || group.target.imageUrl || "")}`} unoptimized /> : null}
              <div className="relative z-10 grid content-start gap-4">{group && availability ? <><div><dl className="grid grid-cols-3 overflow-hidden rounded-lg border border-zinc-200 bg-white/95 text-center shadow-sm"><div className="p-3"><dt className="text-xs font-bold uppercase tracking-wide text-zinc-500">Owned</dt><dd className="mt-1 text-xl font-black tabular-nums text-zinc-950">{availability.owned}</dd></div><div className="border-x border-zinc-200 p-3"><dt className="text-xs font-bold uppercase tracking-wide text-zinc-500">Wanted</dt><dd className="mt-1 text-xl font-black tabular-nums text-zinc-950">{availability.kept}</dd></div><div className="p-3"><dt className="text-xs font-bold uppercase tracking-wide text-zinc-500">To list</dt><dd className="mt-1 text-xl font-black tabular-nums text-[#8a1f2d]">{availability.toList}</dd></div></dl><p className="mt-2 text-xs font-semibold leading-5 text-zinc-600">Your Wishlist protects the best-condition Copies first.</p></div>
                <label className="grid gap-1 text-sm font-bold">Quantity<input aria-describedby="listing-quantity-help" className={fieldClass} inputMode="numeric" max={listKept ? candidates.length : defaultQuantity} min="1" onChange={(event) => { setQuantity(Number(event.target.value)); resetPlan(); }} type="number" value={selectedQuantity || ""} /><span className="text-xs font-medium leading-5 text-zinc-600" id="listing-quantity-help">Oldest eligible Copies are selected automatically.</span></label>
                <label className="flex min-h-14 cursor-pointer items-center gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-sm transition hover:border-zinc-400"><input checked={listKept} className="size-5 shrink-0" onChange={(event) => { setListKept(event.target.checked); setQuantity(null); resetPlan(); }} type="checkbox" /><span><strong className="block font-bold text-zinc-950">Include wanted Copies</strong><span className="mt-0.5 block text-xs font-medium leading-4 text-zinc-600">Allow Quantity to include Copies counted toward your Wishlist.</span></span></label>
                {usesKept ? <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-950">This card is on your Wishlist. Including this many Copies may sell one you want to keep. We’ll check again before publication.</p> : null}</> : <div className="grid min-h-40 place-items-center rounded-lg border border-dashed border-zinc-300 bg-white px-4 text-center text-sm font-semibold text-zinc-600">Stock totals and Quantity will appear here.</div>}</div>
            </aside>
          </div>
        </section> : null}
        {mode && group && showPreviousAttempt ? <section aria-labelledby="previous-listing-attempt-title" className="rounded-xl border border-amber-300 bg-amber-50 p-4 shadow-sm sm:p-5"><div className="flex items-start gap-3"><RotateCcw aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-amber-800" /><div className="min-w-0 flex-1"><p className="text-xs font-bold uppercase tracking-[.12em] text-amber-800">Previous attempt</p><h2 className="mt-1 text-lg font-black text-amber-950" id="previous-listing-attempt-title">A previous listing attempt needs attention</h2><p className="mt-1 text-sm font-medium leading-5 text-amber-950">{previousActiveCount ? `${previousActiveCount} ${previousActiveCount === 1 ? "listing is" : "listings are"} currently active. ` : ""}{previousEndedCount ? `${previousEndedCount} ${previousEndedCount === 1 ? "listing has" : "listings have"} ended. ` : ""}{previousUnfinishedCount} unfinished {previousUnfinishedCount === 1 ? "draft remains" : "drafts remain"}. You can resume it or delete it and start fresh.</p><div className="mt-4 flex flex-wrap gap-2"><button className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-[#8a1f2d] px-4 text-sm font-bold text-white transition hover:bg-[#711826] focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-offset-2" onClick={resumePreviousAttempt} type="button"><RotateCcw aria-hidden="true" className="size-4" />{previousFailedCount ? "Resume failed listing" : "Resume previous plan"}</button><button className="inline-flex min-h-11 items-center justify-center rounded-md border border-amber-400 bg-white px-4 text-sm font-bold text-amber-950 transition hover:bg-amber-100 focus-visible:ring-2 focus-visible:ring-amber-700 focus-visible:ring-offset-2" onClick={continueFresh} ref={discardTriggerRef} type="button">Continue fresh</button></div></div></div></section> : null}
        {group && selectedQuantity ? <section aria-label="Listing change preview" className="overflow-hidden rounded-xl border border-zinc-300 bg-white shadow-sm"><div className="grid lg:grid-cols-2"><div className="p-4 sm:p-5"><p className="text-xs font-bold uppercase tracking-[.12em] text-zinc-500">Current state</p><h2 className="mt-1 text-lg font-black">Active now</h2>{activeOffers.length ? <ul className="mt-3 grid gap-2">{activeOffers.map((offer) => <li className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm" key={offer.listingId}><strong>{offerLabel(offer.kind)} · quantity {offer.quantity}</strong><span className="mt-0.5 block font-medium text-zinc-600">eBay status: {offer.state === "unknown" ? "needs confirmation" : offer.state}</span>{offer.blockedReason ? <span className="mt-1 block font-bold text-rose-800">{offer.blockedReason}</span> : null}</li>)}</ul> : <p className="mt-3 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-3 py-5 text-center text-sm font-medium text-zinc-600">No active offers for this exact variant.</p>}{planProblem ? <p className="mt-3 rounded-md border border-rose-300 bg-rose-50 p-3 text-sm font-bold text-rose-900">{planProblem} Resolve the related offers before publishing.</p> : null}</div><div className="border-t border-zinc-200 bg-zinc-50/70 p-4 sm:p-5 lg:border-l lg:border-t-0"><p className="text-xs font-bold uppercase tracking-[.12em] text-[#8a1f2d]">Planned state</p><h2 className="mt-1 text-lg font-black">After this change</h2><ul className="mt-3 grid gap-2">{changes.map((change, index) => <li className="rounded-md border border-zinc-200 bg-white p-3 text-sm shadow-sm" key={`${change.action}-${index}`}><strong>{change.action}</strong><span className="mt-0.5 block font-medium text-zinc-600">{change.reason}</span></li>)}</ul></div></div></section> : null}
      </div> : null}

      {currentPage === "individual" && individual && group ? <OfferPage canManage={source.mode === "live"} cardName={group.target.name} condition={group.condition} edition={group.target.edition} offer={individual} onPhotosChange={(images) => updateOffer(individual.kind, { photos: reusablePhotos(images) })} onUpdate={(update) => updateOffer(individual.kind, update)} printingId={group.printing.id} quantityLabel={`You’re creating one eBay listing with quantity ${selectedQuantity}. Each purchase is for one matching Copy.`} sourceCopyIds={selectedCopyIds} /> : null}
      {currentPage === "set" && setOffer && group ? <OfferPage canManage={source.mode === "live"} cardName={group.target.name} condition={group.condition} edition={group.target.edition} offer={setOffer} onPhotosChange={(images) => updateOffer(setOffer.kind, { photos: reusablePhotos(images) })} onUpdate={(update) => updateOffer(setOffer.kind, update)} printingId={group.printing.id} quantityLabel={`This is one ${setOffer.kind} listing. Each purchase includes ${setOffer.kind === "x2" ? 2 : 3} matching Copies.`} sourceCopyIds={selectedCopyIds} /> : null}

      {currentPage === "delivery" ? <section className="rounded-xl border border-zinc-300 bg-white shadow-sm">
        <header className="flex items-start gap-3 border-b border-zinc-200 bg-zinc-50 px-4 py-4 sm:px-5"><span className="grid size-10 shrink-0 place-items-center rounded-lg bg-white text-[#8a1f2d] shadow-sm ring-1 ring-zinc-200"><Truck aria-hidden="true" className="size-5" /></span><div><h2 className="text-lg font-black">Shared delivery defaults</h2><p className="mt-1 text-sm font-medium text-zinc-600">These delivery details are used by every listing in this plan.</p></div></header>
        <div className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-3"><label className="text-sm font-bold">Dispatch days<input className={fieldClass} inputMode="numeric" min="1" onChange={(event) => { setShared((current) => ({ ...current, dispatchTimeMax: event.target.value })); setFamilyId(null); }} type="number" value={shared.dispatchTimeMax} /></label><label className="text-sm font-bold">Delivery service<select className={fieldClass} onChange={(event) => { const shippingService = event.target.value as EbayDeliveryServiceCode; const service = ebayDeliveryServices.find((candidate) => candidate.code === shippingService); setShared((current) => ({ ...current, shippingCost: service ? suggestedDeliveryCharge(service) : current.shippingCost, shippingService })); setFamilyId(null); }} value={shared.shippingService}>{ebayDeliveryServices.map((service) => <option key={service.code} value={service.code}>{service.label}</option>)}</select></label><label className="text-sm font-bold">Delivery cost (£)<input aria-describedby="delivery-cost-help" className={fieldClass} inputMode="decimal" onChange={(event) => { setShared((current) => ({ ...current, shippingCost: event.target.value })); setFamilyId(null); }} value={shared.shippingCost} /><span className="text-xs font-medium leading-5 text-zinc-600" id="delivery-cost-help">Defaults to the selected service&apos;s suggested cost plus 40p. You can still edit it.</span></label><label className="text-sm font-bold">Item location<input className={fieldClass} onChange={(event) => { setShared((current) => ({ ...current, location: event.target.value })); setFamilyId(null); }} value={shared.location} /></label><label className="text-sm font-bold">Postcode<input className={fieldClass} onChange={(event) => { setShared((current) => ({ ...current, postalCode: event.target.value })); setFamilyId(null); }} value={shared.postalCode} /></label></div>
      </section> : null}

      {currentPage === "review" ? <div className="grid gap-4">
        <section className="rounded-xl border border-zinc-300 bg-white p-4 shadow-sm sm:p-5"><div className="flex items-start gap-3"><PackageCheck aria-hidden="true" className="mt-0.5 size-5 text-[#8a1f2d]" /><div><h2 className="text-lg font-black">Final check</h2><p className="mt-1 text-sm font-medium text-zinc-600">Check each listing, its reusable photos, and the eBay changes before Review.</p></div></div><div className="mt-4 grid gap-3 sm:grid-cols-2">{[individual, setOffer].filter((offer): offer is OfferDraft => Boolean(offer)).map((offer) => <article className="rounded-lg border border-zinc-200 bg-zinc-50 p-4" key={offer.kind}><p className="text-xs font-bold uppercase tracking-wide text-[#8a1f2d]">{offerLabel(offer.kind)}</p><h3 className="mt-1 font-black">{offer.title}</h3><dl className="mt-3 grid grid-cols-2 gap-2 text-sm"><div><dt className="font-medium text-zinc-500">Price</dt><dd className="font-black">£{offer.price}</dd></div><div><dt className="font-medium text-zinc-500">Photos</dt><dd className="font-black">{offer.photos.length}</dd></div></dl>{offer.photos.some((photo) => photo.listingPhotoKey) ? <p className="mt-3 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-bold text-sky-900">Reusing photos from previous matching stock.</p> : null}</article>)}</div></section>
        <section className="rounded-xl border border-zinc-300 bg-white p-4 shadow-sm sm:p-5"><h2 className="text-lg font-black">What will change</h2><ul className="mt-3 grid gap-2">{changes.map((change) => <li className="rounded-md bg-zinc-50 p-3 text-sm" key={`${change.kind}-${change.action}`}><strong>{change.action}</strong><span className="block text-zinc-600">{change.reason}</span></li>)}</ul></section>
        <details className="rounded-xl border border-zinc-300 bg-white p-4" open><summary className="flex min-h-11 cursor-pointer items-center justify-between font-black">Exact selected Copies <ChevronDown aria-hidden="true" className="size-4" /></summary><ol className="mt-3 grid gap-2 text-sm">{selectedCopies.map((copy, index) => <li className="rounded-md bg-zinc-50 px-3 py-2" key={copy.copyId}>{index + 1}. Copy #{copy.copyId.slice(-6)} · acquired {new Date(copy.acquiredAt.split("/")[0] ?? copy.acquiredAt).toLocaleDateString("en-GB")}</li>)}</ol></details>
        {usesKept ? <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm font-bold text-amber-950">This card is on your Wishlist. Publishing this plan may sell {usesKept === 1 ? "a Copy you want to keep" : `${usesKept} Copies you want to keep`}.</p> : null}
        <p className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm font-semibold text-amber-950"><AlertTriangle aria-hidden="true" className="size-5 shrink-0" />Temporary warning: linked listings can oversell until reservation and sibling protection arrive in #21 and #22.</p>
        <p className="text-sm font-medium text-zinc-600">eBay Review checks every operation without publishing anything.</p>
      </div> : null}

      {currentPage === "publish" ? <div className="grid gap-4"><section className="rounded-xl border border-zinc-300 bg-white p-4 shadow-sm sm:p-5"><div className="flex items-start gap-3"><CheckCircle2 aria-hidden="true" className="mt-0.5 size-5 text-emerald-700" /><div><h2 className="text-lg font-black">eBay Review results</h2><p className="mt-1 text-sm font-medium leading-5 text-zinc-600">Each listing was checked separately. Publish is only available when every listing is ready and eBay reports no upfront fee.</p></div></div>{operationResults?.length ? <ul className="mt-4 grid gap-3">{operationResults.map((result) => <ReviewResultCard key={`${result.kind}-${result.state}`} offer={resolvedOffer(result.kind as OfferKind)} quantity={selectedQuantity} result={result} />)}</ul> : <p className="mt-4 text-sm font-semibold text-zinc-600">Run eBay Review to prepare publication.</p>}</section>{operationResults?.some((result) => result.state === "failed" || (result.state === "reviewed" && result.review?.readyToPublish !== true)) ? <button className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-4 text-sm font-bold" onClick={() => { setStep(Math.max(1, flow.findIndex((item) => item.id === "individual") + 1)); setOperationResults(null); }} type="button"><RotateCcw className="size-4" />Edit listings</button> : null}</div> : null}
    </StepPanel>
    <WizardActions confirmDisabled={!familyId || !operationResults?.length || operationResults.some((result) => result.state === "failed" || result.state === "prepared" || (result.state === "reviewed" && result.review?.readyToPublish !== true))} finalLabel="Publish plan" nextDisabled={currentPage === "stock" && (!mode || !group || !selectedQuantity || Boolean(planProblem))} nextLabel={nextLabel} onBack={() => setStep((current) => Math.max(1, current - 1))} onConfirm={() => void publish()} onNext={next} pending={pending} pendingLabel={currentPage === "review" ? "Reviewing each listing…" : currentPage === "publish" ? "Publishing saved plan…" : "Working…"} step={step} totalSteps={flow.length} />
    {pending ? <span className="sr-only" role="status"><Loader2 className="size-4" />Working on the saved listing plan.</span> : null}
    {successToast ? <div aria-live="polite" className="fixed bottom-4 right-4 z-[100] flex min-h-12 max-w-[calc(100vw-2rem)] items-center gap-3 rounded-lg border border-emerald-500 bg-emerald-700 px-4 py-3 text-sm font-bold text-white shadow-xl sm:max-w-sm" role="status"><CheckCircle2 aria-hidden="true" className="size-5 shrink-0" /><span className="flex-1">{successToast}</span><button aria-label="Dismiss success message" className="grid size-8 shrink-0 place-items-center rounded-md text-emerald-50 transition hover:bg-emerald-800 focus-visible:ring-2 focus-visible:ring-white" onClick={() => setSuccessToast(null)} type="button"><X aria-hidden="true" className="size-4" /></button></div> : null}
    {discardDialogOpen ? <DiscardDraftDialog draftCount={previousUnfinishedCount} error={discardError} onClose={() => { setDiscardDialogOpen(false); setDiscardError(null); }} onConfirm={() => void confirmContinueFresh()} pending={discardPlan.isPending} triggerRef={discardTriggerRef} /> : null}
  </section>;
}

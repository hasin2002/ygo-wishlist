"use client";

import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Images,
  Info,
  Layers3,
  LoaderCircle,
  Pencil,
  Plus,
  Search,
  X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CardPhotoManager } from "@/components/records/card-photo-manager";
import {
  copyExposureSelectorLabel,
  ebayExposurePresentation,
  ebayExposureSummary,
  physicalCopyStateLabel,
} from "@/components/records/ebay-copy-exposure-presentation";
import {
  DestructiveToast,
  fieldClass,
  FormSection,
  penceToPounds,
  PreviewNotice,
  StepPanel,
  textAreaClass,
  WizardActions,
  WizardProgress,
} from "@/components/records/entry-form-ui";
import { DraftHydrationBoundary, FormDraftStatus } from "@/components/records/form-draft-ui";
import { useRecordsDataSource } from "@/components/records/records-preview-provider";
import { useSession } from "@/lib/auth-client";
import { ebayLotCategory } from "@/lib/ebay-listing-options";
import { useFormDraftLifecycle } from "@/lib/records/use-form-draft-lifecycle";
import { hasFields, isNullableString, isOneOf, isRecord, isString } from "@/lib/records/form-draft-validators";
import {
  buildEbayLotDescription,
  buildEbayLotTitle,
  estimateEbayLotValue,
  planEbayLotSavedPhotoImports,
} from "@/lib/records/ebay-lot";
import { ebaySoldListingsUrl } from "@/lib/records/ebay-sold-listings";
import {
  copyDisplayLabel,
  copyShortReference,
} from "@/lib/records/copy-display";
import { filterCopySelectionCandidates, mixedLotCopyBounds, pageCopySelection, reconcileCopySelection } from "@/lib/records/copy-selection";
import { trpc } from "@/trpc/client";
import { useCollectionChange, collectionRefreshFailureMessage } from "@/lib/use-collection-change";
import { taskReturnHref } from "@/lib/navigation-intent";

type Photo = {
  archiveKey: string;
  ebayUrl: string;
  previewUrl: string;
  sourceInventoryCopyId?: string;
  sourceInventoryKey?: string;
};

type InventoryPhoto = {
  key: string;
  position: number;
  previewUrl: string;
};

type SavedPhotoCandidate = InventoryPhoto & {
  cardName: string;
  copyId: string;
  id: string;
  printingLabel: string;
};

type Draft = {
  copyIds: string[];
  description: string;
  photoAnchorCopyId: string | null;
  photos: Photo[];
  price: string;
  priceOrigin: "estimate" | "manual";
  shipping: string;
  title: string;
};

type EbayVerification = {
  errors: Array<{
    code: string | null;
    message: string | null;
    severity: string | null;
  }>;
  fees: Array<{
    amount: number;
    currency: string;
    name: string | null;
  }>;
  readyToPublish: boolean;
};

const pageSize = 20;

function pence(value: string) {
  return Math.round(Number(value.replace(/[£,\s]/g, "")) * 100) || 0;
}

function defaultDraft(): Draft {
  return {
    copyIds: [],
    description: "",
    photoAnchorCopyId: null,
    photos: [],
    price: "",
    priceOrigin: "estimate",
    shipping: "1.55",
    title: "",
  };
}

function isLotDraft(value: unknown): value is Draft {
  if (!isRecord(value) || !hasFields(value, [
    "copyIds", "description", "photoAnchorCopyId", "photos", "price", "priceOrigin", "shipping", "title",
  ])) return false;
  return Array.isArray(value.copyIds)
    && value.copyIds.every(isString)
    && isString(value.description)
    && isNullableString(value.photoAnchorCopyId)
    && Array.isArray(value.photos)
    && value.photos.every((photo) => isRecord(photo)
      && isString(photo.archiveKey)
      && isString(photo.ebayUrl)
      && isString(photo.previewUrl)
      && (photo.sourceInventoryCopyId === undefined || isString(photo.sourceInventoryCopyId))
      && (photo.sourceInventoryKey === undefined || isString(photo.sourceInventoryKey)))
    && isString(value.price)
    && isOneOf(value.priceOrigin, ["estimate", "manual"] as const)
    && isString(value.shipping)
    && isString(value.title);
}

function copyReference(copyId: string) {
  return copyId.slice(-6);
}

function feeName(value: string | null) {
  return value
    ?.replace(/Fee$/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim() || "eBay fee";
}

function feeAmount(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-GB", {
      currency,
      style: "currency",
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

type SoldListingResearchGroup = {
  count: number;
  estimatePence: number | null;
  imageUrl: string | null;
  id: string;
  printing: { setCode: string; setName: string };
  target: { edition: string; name: string; rarity: string };
};

function LotDialog({
  children,
  description,
  dismissible = true,
  footer,
  id,
  onClose,
  title,
}: {
  children: React.ReactNode;
  description: string;
  dismissible?: boolean;
  footer?: React.ReactNode;
  id: string;
  onClose: () => void;
  title: string;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const dismissibleRef = useRef(dismissible);
  const onCloseRef = useRef(onClose);
  const titleId = `${id}-title`;
  const descriptionId = `${titleId}-description`;

  useEffect(() => {
    dismissibleRef.current = dismissible;
    onCloseRef.current = onClose;
  }, [dismissible, onClose]);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => {
      closeButtonRef.current?.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (!dismissibleRef.current) return;
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((element) => !element.hasAttribute("hidden"));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      window.requestAnimationFrame(() => {
        const trigger = document.querySelector<HTMLElement>(
          `[aria-controls="${id}"]`,
        );
        (trigger ?? previouslyFocused)?.focus();
      });
    };
  }, [id]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      aria-describedby={descriptionId}
      aria-labelledby={titleId}
      aria-modal="true"
      className="fixed inset-0 z-[60] grid place-items-center bg-black/30 px-4 py-6"
      onMouseDown={(event) => {
        if (dismissible && event.target === event.currentTarget) onClose();
      }}
      role="dialog"
    >
      <section
        className="flex max-h-[88dvh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-zinc-300 bg-white shadow-xl"
        id={id}
        ref={dialogRef}
      >
        <header className="flex items-start justify-between gap-4 border-b border-zinc-200 p-4">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#8a1f2d]">
              eBay lot
            </p>
            <h2 className="mt-1 text-xl font-bold text-zinc-950" id={titleId}>
              {title}
            </h2>
            <p className="mt-1 max-w-xl text-sm font-medium leading-5 text-zinc-500" id={descriptionId}>
              {description}
            </p>
          </div>
          <button aria-label={`Close ${title}`} className="grid min-h-11 min-w-11 shrink-0 place-items-center rounded-md border border-zinc-300 text-zinc-600 transition hover:border-zinc-950 hover:text-zinc-950 focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-40" disabled={!dismissible} onClick={onClose} ref={closeButtonRef} type="button">
            <X aria-hidden="true" className="size-4" />
          </button>
        </header>
        <div className="min-h-0 overflow-y-auto overscroll-contain p-4">
          {children}
        </div>
        {footer ? (
          <footer className="border-t border-zinc-200 bg-white p-4">
            {footer}
          </footer>
        ) : null}
      </section>
    </div>,
    document.body,
  );
}

function SoldListingResearch({ groups }: { groups: SoldListingResearchGroup[] }) {
  const [open, setOpen] = useState(false);
  if (!groups.length) return null;

  return (
    <>
      <section
        aria-labelledby="sold-listing-research-title"
        className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4"
      >
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-white text-[#981d2d] ring-1 ring-zinc-200">
            <ExternalLink aria-hidden="true" className="size-4" />
          </span>
          <div className="min-w-0">
            <h3 className="font-black text-zinc-950" id="sold-listing-research-title">
              Check sold prices
            </h3>
            <p className="mt-0.5 text-sm font-medium leading-5 text-zinc-600">
              Compare {groups.length} unique {groups.length === 1 ? "printing" : "printings"} before setting the lot price.
            </p>
          </div>
        </div>
        <button
          aria-controls="sold-listing-research-dialog"
          aria-expanded={open}
          aria-haspopup="dialog"
          className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-md border border-zinc-300 bg-white px-3 text-sm font-bold text-zinc-800 transition hover:border-[#8a1f2d] hover:text-[#8a1f2d] focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-offset-2"
          onClick={() => setOpen(true)}
          type="button"
        >
          View research
        </button>
      </section>
      {open ? (
        <LotDialog
          description={`Compare recent completed eBay sales for ${groups.length} unique ${groups.length === 1 ? "printing" : "printings"} before setting the whole-lot price.`}
          footer={(
            <div className="flex justify-end">
              <button
                className="min-h-11 rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white transition hover:bg-zinc-800 focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-offset-2"
                onClick={() => setOpen(false)}
                type="button"
              >
                Done
              </button>
            </div>
          )}
          id="sold-listing-research-dialog"
          onClose={() => setOpen(false)}
          title="Sold-listing research"
        >
          <ul className="grid gap-2">
            {groups.map((group) => {
              const soldUrl = ebaySoldListingsUrl({
                edition: group.target.edition,
                name: group.target.name,
                rarity: group.target.rarity,
                setCode: group.printing.setCode,
              });
              return (
                <li className="flex min-w-0 flex-col gap-3 rounded-md border border-zinc-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between" key={group.id}>
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="grid h-16 w-12 shrink-0 place-items-center overflow-hidden rounded-md border border-zinc-200 bg-zinc-100">
                      {group.imageUrl ? <Image alt="" className="h-full w-full object-contain p-1" height={64} src={`/api/image-proxy?url=${encodeURIComponent(group.imageUrl)}`} unoptimized width={48} /> : <span className="text-[10px] font-black text-zinc-400">CARD</span>}
                    </div>
                    <div className="min-w-0">
                      <strong className="block break-words text-sm text-zinc-950">{group.target.name}{group.count > 1 ? ` ×${group.count}` : ""}</strong>
                      <span className="mt-1 block text-xs font-medium text-zinc-500">
                        {group.printing.setCode || group.printing.setName || "Unknown set"} · {group.target.rarity} · {group.target.edition}
                        {group.estimatePence === null ? " · No stored estimate" : ` · £${penceToPounds(group.estimatePence)} each`}
                      </span>
                    </div>
                  </div>
                  <a className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-bold text-zinc-800 transition hover:border-[#8a1f2d] hover:text-[#8a1f2d] focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-offset-2" href={soldUrl} rel="noreferrer" target="_blank">
                    <ExternalLink aria-hidden="true" className="size-4" />
                    View sold listings
                    <span className="sr-only"> for {group.target.name} (opens in a new tab)</span>
                  </a>
                </li>
              );
            })}
          </ul>
        </LotDialog>
      ) : null}
    </>
  );
}

function EbayLotForm({ returnHref }: { returnHref: string }) {
  const collectionChanged = useCollectionChange();
  const source = useRecordsDataSource();
  const lifecycle = useFormDraftLifecycle({
    workflow: "ebay-mixed-lot",
    ownerScope: source.draftOwnerScope,
    origin: "/records/listings/new-lot",
    initialData: defaultDraft(),
    isValidData: isLotDraft,
  });
  const draft = lifecycle.data;
  const setDraft = lifecycle.setData;
  const [step, setStep] = useState(1);
  const [query, setQuery] = useState("");
  const [rarity, setRarity] = useState("all");
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [validation, setValidation] = useState<EbayVerification | null>(null);
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [arrangeAnnouncement, setArrangeAnnouncement] = useState("");
  const [manifestOpen, setManifestOpen] = useState(false);
  const [clearSelectionOpen, setClearSelectionOpen] = useState(false);
  const [clearingSelection, setClearingSelection] = useState(false);
  const [savedPhotoPickerOpen, setSavedPhotoPickerOpen] = useState(false);
  const [savedPhotoCandidates, setSavedPhotoCandidates] = useState<SavedPhotoCandidate[]>([]);
  const [savedPhotoSelection, setSavedPhotoSelection] = useState<string[]>([]);
  const [savedPhotosError, setSavedPhotosError] = useState<string | null>(null);
  const [savedPhotosLoading, setSavedPhotosLoading] = useState(false);
  const [savedPhotoImportProgress, setSavedPhotoImportProgress] = useState<{
    completed: number;
    total: number;
  } | null>(null);
  const autoImportedSelectionsRef = useRef(new Set<string>());
  const publishActionRef = useRef(false);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [importingPhoto, setImportingPhoto] = useState(false);
  const [preparingPhotos, setPreparingPhotos] = useState(false);
  const [removingPhotoId, setRemovingPhotoId] = useState<string | null>(null);
  const [reorderingPhotos, setReorderingPhotos] = useState(false);
  const validate = trpc.ebay.validateLot.useMutation();
  const publish = trpc.ebay.publishLot.useMutation();

  const candidates = useMemo(
    () =>
      source.snapshot.copies.flatMap((copy) => {
        const printing = source.snapshot.printings.find(
          (value) => value.id === copy.printingId,
        );
        const target = printing
          ? source.snapshot.targets.find(
              (value) => value.id === printing.targetId,
            )
          : undefined;
        const exposure = source.snapshot.copyEbayExposures.find(
          (value) => value.copyId === copy.id,
        );
        return printing && target
          ? [{
              copy,
              exposure,
              imageUrl: printing.imageUrl || target.imageUrl,
              printing,
              target,
            }]
          : [];
      }),
    [source.snapshot],
  );

  const selection = useMemo(() => reconcileCopySelection(
    draft.copyIds,
    candidates.map((item) => ({
      id: item.copy.id,
      item,
      reason: item.copy.status !== "available"
        ? `Copy #${copyShortReference(item.copy.id)} is ${item.copy.status === "sold" ? "already sold" : "not available"}. Remove or replace it.`
        : item.exposure?.action.disposition === "blocked"
          ? `Copy #${copyShortReference(item.copy.id)} is blocked: ${item.exposure.action.reason}`
          : null,
    })),
    mixedLotCopyBounds,
  ), [candidates, draft.copyIds]);
  const selected = selection.selected;
  const selectedById = new Map(
    selected.map((item) => [item.copy.id, item]),
  );
  const manifest = selected.map(({ copy, printing, target }) => ({
    condition: copy.condition,
    copyId: copy.id,
    edition: target.edition,
    name: target.name,
    printing: printing.setCode || printing.setName,
    rarity: target.rarity,
  }));
  const priceEstimate = useMemo(() => {
    const groups = new Map<string, {
      count: number;
      estimatePence: number | null;
      imageUrl: string | null;
      printing: { setCode: string; setName: string };
      target: { edition: string; name: string; rarity: string };
    }>();
    for (const item of selected) {
      const estimatePence = item.target.estimatedPricePence
        ?? item.target.marketPricePence;
      const existing = groups.get(item.printing.id);
      if (existing) {
        existing.count += 1;
      } else {
        groups.set(item.printing.id, {
          count: 1,
          estimatePence,
          imageUrl: item.imageUrl,
          printing: item.printing,
          target: item.target,
        });
      }
    }

    return {
      groups: Array.from(groups, ([id, group]) => ({ id, ...group })),
      ...estimateEbayLotValue(selected.map((item) => item.target.estimatedPricePence ?? item.target.marketPricePence)),
    };
  }, [selected]);
  const estimatedPriceText = selected.length && priceEstimate.unpricedCopyCount === 0
    ? penceToPounds(priceEstimate.totalPence)
    : "";
  const effectivePrice = draft.priceOrigin === "estimate"
    ? estimatedPriceText
    : draft.price;
  const eligibleCandidates = candidates.filter(
    ({ copy, exposure }) =>
      copy.status === "available" &&
      exposure?.action.disposition !== "blocked",
  );
  const rarityOptions = Array.from(
    new Set(
      eligibleCandidates
        .map((item) => item.target.rarity)
        .filter(Boolean),
    ),
  ).sort((left, right) => left.localeCompare(right));
  const filtered = filterCopySelectionCandidates(eligibleCandidates, {
    query, rarity, selectedIds: selection.selectedIds, selectedOnly,
  });
  const { currentPage, items: visible, pageCount, resultEnd, resultStart } = pageCopySelection(filtered, page, pageSize);
  const visibleFees =
    validation?.fees.filter(
      (fee) => Number.isFinite(fee.amount) && fee.amount !== 0,
    ) ?? [];
  const photoAnchor = draft.photoAnchorCopyId
    ? selectedById.get(draft.photoAnchorCopyId)
    : selected[0];
  const photoBusy =
    uploadingPhotos ||
    importingPhoto ||
    preparingPhotos ||
    savedPhotosLoading ||
    clearingSelection ||
    removingPhotoId !== null ||
    reorderingPhotos;
  const availablePhotoSlots = Math.max(0, 12 - draft.photos.length);

  function updateDraft(next: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...next }));
    setValidation(null);
    setPublishedUrl(null);
  }

  function regenerate() {
    updateDraft({
      title: buildEbayLotTitle(manifest),
      description: buildEbayLotDescription(manifest),
    });
  }

  function toggleCopy(copyId: string, checked: boolean) {
    if (checked && selection.selectedIds.length >= mixedLotCopyBounds.max) {
      setError("A mixed card lot can contain no more than 100 physical Copies. Remove or reorder selected Copies before adding another.");
      return;
    }
    if (
      !checked &&
      draft.photoAnchorCopyId === copyId &&
      draft.photos.length
    ) {
      setError(
        "Remove the lot photos before removing their anchor Copy from this manifest.",
      );
      return;
    }
    updateDraft({
      copyIds: checked
        ? Array.from(new Set([...draft.copyIds, copyId]))
        : draft.copyIds.filter((id) => id !== copyId),
      photoAnchorCopyId:
        !checked && draft.photoAnchorCopyId === copyId
          ? null
          : draft.photoAnchorCopyId,
    });
    setError(null);
  }

  function moveCopy(copyId: string, direction: -1 | 1) {
    const currentIndex = draft.copyIds.indexOf(copyId);
    const nextIndex = currentIndex + direction;
    if (
      currentIndex < 0 ||
      nextIndex < 0 ||
      nextIndex >= draft.copyIds.length
    ) {
      return;
    }
    const copyIds = [...draft.copyIds];
    [copyIds[currentIndex], copyIds[nextIndex]] = [
      copyIds[nextIndex],
      copyIds[currentIndex],
    ];
    updateDraft({ copyIds });
    const moved = selectedById.get(copyId);
    setArrangeAnnouncement(
      `${moved?.target.name || "Copy"} moved to position ${nextIndex + 1} of ${copyIds.length}.`,
    );
  }

  function clearSelection() {
    updateDraft({
      copyIds: [],
      description: "",
      photoAnchorCopyId: null,
      photos: [],
      price: "",
      priceOrigin: "estimate",
      title: "",
    });
    setManifestOpen(false);
    setClearSelectionOpen(false);
    setSelectedOnly(false);
    setPage(1);
    setError(null);
  }

  async function confirmClearSelection() {
    if (!draft.photos.length) {
      clearSelection();
      return;
    }
    setClearingSelection(true);
    try {
      const failed: Photo[] = [];
      for (const photo of draft.photos) {
        const response = await fetch("/api/ebay/image", {
          body: JSON.stringify({
            archiveKey: photo.archiveKey,
            copyId: draft.photoAnchorCopyId,
          }),
          headers: { "Content-Type": "application/json" },
          method: "DELETE",
        });
        if (!response.ok) failed.push(photo);
      }
      if (failed.length) {
        updateDraft({ photos: failed });
        setClearSelectionOpen(false);
        setError(
          `${draft.photos.length - failed.length} lot ${draft.photos.length - failed.length === 1 ? "photo was" : "photos were"} removed, but ${failed.length} could not be removed. Your Copy selection was kept so you can try again safely.`,
        );
        return;
      }
      clearSelection();
    } finally {
      setClearingSelection(false);
    }
  }

  async function createPhoto(body: FormData) {
    const response = await fetch("/api/ebay/image", {
      body,
      method: "POST",
    });
    const value = await response.json();
    if (!response.ok) {
      throw new Error(value.message || "Photo upload failed.");
    }
    const photo = value as Partial<Photo>;
    if (!photo.archiveKey || !photo.previewUrl) {
      throw new Error("The prepared photo response was incomplete.");
    }
    return {
      archiveKey: photo.archiveKey,
      ebayUrl: photo.ebayUrl ?? "",
      previewUrl: photo.previewUrl,
    };
  }

  async function uploadPhotos(files: File[]) {
    setUploadingPhotos(true);
    try {
      const anchor = draft.photoAnchorCopyId ?? selection.selectedIds[0];
      if (!anchor) throw new Error("Choose Copies before adding photos.");
      const added = await Promise.all(
        files
          .slice(0, 12 - draft.photos.length)
          .map(async (file) => {
            const body = new FormData();
            body.append("copyId", anchor);
            body.append("image", file);
            return createPhoto(body);
          }),
      );
      updateDraft({
        photoAnchorCopyId: anchor,
        photos: [...draft.photos, ...added],
      });
      setError(null);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Photo upload failed.",
      );
    } finally {
      setUploadingPhotos(false);
    }
  }

  async function loadSavedPhotoCandidates() {
    const copyIds = selected.map((item) => item.copy.id);
    if (!copyIds.length) {
      throw new Error("Choose Copies before importing saved photos.");
    }
    const response = await fetch(
      `/api/inventory/card-images?copyIds=${encodeURIComponent(copyIds.join(","))}`,
    );
    const value = await response.json() as {
      configured?: boolean;
      imagesByCopy?: Record<string, InventoryPhoto[]>;
      message?: string;
    };
    if (!response.ok) {
      throw new Error(value.message || "Saved card photos could not be loaded.");
    }
    if (value.configured === false) {
      throw new Error("Saved card photo storage is not configured.");
    }
    const imagesByCopy = value.imagesByCopy ?? {};
    const planned = planEbayLotSavedPhotoImports({
      copyIds,
      existingPhotos: draft.photos,
      imagesByCopy,
      maxPhotos: Number.MAX_SAFE_INTEGER,
    });
    const selectedMetadata = new Map(
      selected.map((item) => [item.copy.id, item]),
    );
    const candidates = planned.flatMap((photo) => {
      const item = selectedMetadata.get(photo.copyId);
      return item
        ? [{
            ...photo,
            cardName: item.target.name,
            id: `${photo.copyId}:${photo.key}`,
            previewUrl: `/api/inventory/card-images?copyId=${encodeURIComponent(photo.copyId)}&key=${encodeURIComponent(photo.key)}`,
            printingLabel:
              item.printing.setCode || item.printing.setName || "Unknown set",
          }]
        : [];
    });
    return { candidates, copyIds, imagesByCopy };
  }

  async function openSavedPhotoPicker() {
    setSavedPhotoPickerOpen(true);
    setSavedPhotosLoading(true);
    setSavedPhotosError(null);
    setSavedPhotoCandidates([]);
    setSavedPhotoSelection([]);
    try {
      const { candidates } = await loadSavedPhotoCandidates();
      setSavedPhotoCandidates(candidates);
      const primaryByCopy = new Map<string, string>();
      for (const candidate of candidates) {
        if (!primaryByCopy.has(candidate.copyId)) {
          primaryByCopy.set(candidate.copyId, candidate.id);
        }
      }
      setSavedPhotoSelection(
        Array.from(primaryByCopy.values()).slice(0, availablePhotoSlots),
      );
    } catch (reason) {
      setSavedPhotosError(
        reason instanceof Error
          ? reason.message
          : "Saved card photos could not be loaded.",
      );
    } finally {
      setSavedPhotosLoading(false);
    }
  }

  function toggleSavedPhoto(candidateId: string) {
    setSavedPhotoSelection((current) => {
      if (current.includes(candidateId)) {
        return current.filter((id) => id !== candidateId);
      }
      if (current.length >= availablePhotoSlots) return current;
      return [...current, candidateId];
    });
  }

  async function importSavedPhotoCandidates(
    selectedCandidates: SavedPhotoCandidate[],
    closeWhenComplete: boolean,
  ) {
    if (!selectedCandidates.length) return;
    setImportingPhoto(true);
    setSavedPhotosError(null);
    setSavedPhotoImportProgress({
      completed: 0,
      total: selectedCandidates.length,
    });
    try {
      const anchor = draft.photoAnchorCopyId ?? selection.selectedIds[0];
      if (!anchor) {
        throw new Error("Choose Copies before importing saved photos.");
      }
      const added: Photo[] = [];
      const failedIds: string[] = [];
      const failedMessages: string[] = [];
      for (const [index, candidate] of selectedCandidates.entries()) {
        try {
          const body = new FormData();
          body.append("copyId", anchor);
          body.append("inventoryCopyId", candidate.copyId);
          body.append("inventoryKey", candidate.key);
          body.append("stageOnly", "true");
          added.push({
            ...await createPhoto(body),
            sourceInventoryCopyId: candidate.copyId,
            sourceInventoryKey: candidate.key,
          });
        } catch (reason) {
          failedIds.push(candidate.id);
          failedMessages.push(
            reason instanceof Error
              ? reason.message
              : "A saved card photo could not be added.",
          );
        } finally {
          setSavedPhotoImportProgress({
            completed: index + 1,
            total: selectedCandidates.length,
          });
        }
      }
      if (!added.length) {
        throw new Error(
          failedMessages[0]
            || "The selected saved photos could not be added. Try again shortly.",
        );
      }
      updateDraft({ photoAnchorCopyId: anchor, photos: [...draft.photos, ...added] });
      setSavedPhotoCandidates((current) =>
        current.filter(
          (candidate) =>
            !selectedCandidates.some(
              (selectedCandidate) =>
                selectedCandidate.id === candidate.id &&
                !failedIds.includes(candidate.id),
            ),
        ),
      );
      setSavedPhotoSelection(failedIds);
      if (failedIds.length) {
        setSavedPhotosError(
          `${added.length} ${added.length === 1 ? "photo was" : "photos were"} added. ${failedIds.length} could not be added and remain selected so you can retry. ${failedMessages[0] || ""}`.trim(),
        );
      } else if (closeWhenComplete) {
        setSavedPhotoPickerOpen(false);
      }
      setError(null);
    } catch (reason) {
      setSavedPhotosError(
        reason instanceof Error ? reason.message : "Saved-photo import failed.",
      );
    } finally {
      setImportingPhoto(false);
      setSavedPhotoImportProgress(null);
    }
  }

  async function importSavedCopyPhotos() {
    await importSavedPhotoCandidates(
      savedPhotoCandidates.filter((candidate) =>
        savedPhotoSelection.includes(candidate.id),
      ),
      true,
    );
  }

  async function autoImportSavedCopyPhotos() {
    const selectionKey = selected.map((item) => item.copy.id).join(",");
    if (
      !selectionKey ||
      availablePhotoSlots === 0 ||
      autoImportedSelectionsRef.current.has(selectionKey)
    ) {
      return;
    }
    autoImportedSelectionsRef.current.add(selectionKey);
    setSavedPhotosLoading(true);
    setSavedPhotosError(null);
    try {
      const { candidates, copyIds, imagesByCopy } =
        await loadSavedPhotoCandidates();
      const plannedIds = new Set(
        planEbayLotSavedPhotoImports({
          copyIds,
          existingPhotos: draft.photos,
          imagesByCopy,
        }).map((photo) => `${photo.copyId}:${photo.key}`),
      );
      const automaticCandidates = candidates.filter((candidate) =>
        plannedIds.has(candidate.id),
      );
      setSavedPhotoCandidates(candidates);
      if (automaticCandidates.length) {
        setSavedPhotoSelection(
          automaticCandidates.map((candidate) => candidate.id),
        );
        await importSavedPhotoCandidates(automaticCandidates, false);
      }
    } catch (reason) {
      setSavedPhotosError(
        reason instanceof Error
          ? reason.message
          : "Saved card photos could not be pulled through.",
      );
    } finally {
      setSavedPhotosLoading(false);
    }
  }

  async function removePhoto(archiveKey: string) {
    setRemovingPhotoId(archiveKey);
    try {
      const response = await fetch("/api/ebay/image", {
        body: JSON.stringify({
          archiveKey,
          copyId: draft.photoAnchorCopyId,
        }),
        headers: { "Content-Type": "application/json" },
        method: "DELETE",
      });
      if (!response.ok) return false;
      const photos = draft.photos.filter(
        (photo) => photo.archiveKey !== archiveKey,
      );
      updateDraft({
        photoAnchorCopyId: photos.length
          ? draft.photoAnchorCopyId
          : null,
        photos,
      });
      return true;
    } finally {
      setRemovingPhotoId(null);
    }
  }

  async function reorderPhotos(ids: string[]) {
    setReorderingPhotos(true);
    try {
      const byId = new Map(
        draft.photos.map((photo) => [photo.archiveKey, photo]),
      );
      const photos = ids
        .map((id) => byId.get(id))
        .filter((photo): photo is Photo => Boolean(photo));
      if (photos.length !== draft.photos.length) return false;
      updateDraft({ photos });
      return true;
    } finally {
      setReorderingPhotos(false);
    }
  }

  async function preparePhotosForEbay() {
    const pendingPhotos = draft.photos.filter((photo) => !photo.ebayUrl);
    if (!pendingPhotos.length) return draft.photos;
    const anchor = draft.photoAnchorCopyId ?? selection.selectedIds[0];
    if (!anchor) throw new Error("Choose Copies before preparing photos.");

    setPreparingPhotos(true);
    setSavedPhotosError(null);
    try {
      const preparedByKey = new Map<string, Photo>();
      for (const photo of pendingPhotos) {
        const body = new FormData();
        body.append("archiveKey", photo.archiveKey);
        body.append("copyId", anchor);
        const prepared = await createPhoto(body);
        if (!prepared.ebayUrl) {
          throw new Error("eBay did not return a URL for the prepared photo.");
        }
        preparedByKey.set(photo.archiveKey, {
          ...photo,
          ebayUrl: prepared.ebayUrl,
          previewUrl: prepared.previewUrl,
        });
      }
      const photos = draft.photos.map(
        (photo) => preparedByKey.get(photo.archiveKey) ?? photo,
      );
      updateDraft({ photos });
      return photos;
    } finally {
      setPreparingPhotos(false);
    }
  }

  function input(photos = draft.photos) {
    return {
      copyIds: selection.selectedIds,
      categoryId: ebayLotCategory.id,
      cardConditionDescriptorValueId: "400010" as const,
      description: draft.description,
      dispatchTimeMax: 3,
      imageDraftCopyId: draft.photoAnchorCopyId ?? selection.selectedIds[0]!,
      images: photos.map(({ archiveKey, ebayUrl }) => ({
        archiveKey,
        ebayUrl,
      })),
      itemSpecifics: {
        cardNumber: "Mixed",
        cardSize: "Japanese",
        features: "Mixed card lot",
        game: "Yu-Gi-Oh! TCG",
        manufacturer: "Konami",
        rarity: "Mixed",
        setName: "Mixed",
      },
      language: "English" as const,
      location: "Surrey",
      postalCode: "GU21 6DE",
      pricePence: pence(effectivePrice),
      shippingCostPence: pence(draft.shipping),
      shippingService:
        "UK_RoyalMailSecondClassStandard" as const,
      title: draft.title,
    };
  }

  function stepProblem() {
    if (step === 1 && selection.issues.length) {
      return selection.issues[0]!.message;
    }
    if (step === 1 && !selection.valid) {
      return "Choose at least two eligible physical Copies.";
    }
    if (
      step === 2 &&
      (!draft.title.trim() ||
        !draft.description.trim() ||
        !draft.photos.length ||
        pence(effectivePrice) < 1)
    ) {
      return "Add a title, description, whole-lot price, and at least one photo.";
    }
    return null;
  }

  async function next() {
    const problem = stepProblem();
    if (problem) {
      setError(problem);
      return;
    }
    if (step === 1) {
      setError(null);
      setStep(2);
      void autoImportSavedCopyPhotos();
      return;
    }
    if (step === 2) {
      try {
        const photos = await preparePhotosForEbay();
        setValidation(await validate.mutateAsync(input(photos)));
      } catch (reason) {
        setValidation(null);
        const message = reason instanceof Error
          ? reason.message
          : "eBay validation failed.";
        setError(message);
        if (message.startsWith("Reconnect eBay")) {
          setSavedPhotosError(message);
        }
        return;
      }
    }
    setError(null);
    setStep((current) => Math.min(3, current + 1));
  }

  async function confirm() {
    if (!validation?.readyToPublish || publishActionRef.current) return;
    publishActionRef.current = true;
    setPublishing(true);
    setError(null);
    try {
      const result = await publish.mutateAsync(input());
      setPublishedUrl(result.listingUrl);
      try {
        await collectionChanged("listing");
      } catch (refreshError) {
        setError(collectionRefreshFailureMessage(refreshError));
      }
      try {
        lifecycle.discard();
      } catch {
        setError((current) =>
          current
            ? `${current} The listing was published, but its local draft could not be cleared. Do not publish it again.`
            : "The listing was published, but its local draft could not be cleared. Do not publish it again.",
        );
      }
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Lot publication failed.",
      );
    } finally {
      publishActionRef.current = false;
      setPublishing(false);
    }
  }

  const copyDetails = (
    item: (typeof selected)[number],
  ) =>
    `Ref #${copyReference(item.copy.id)} · ${
      item.printing.setCode || "Unknown set"
    } · ${item.target.rarity} · ${item.target.edition} · ${
      item.copy.condition
    }`;

  return (
    <DraftHydrationBoundary ready={lifecycle.hydrated}>
    <form
      autoComplete="off"
      className="grid min-w-0 gap-4"
      onSubmit={(event) => event.preventDefault()}
    >
      <DestructiveToast
        message={error}
        onDismiss={() => setError(null)}
      />
      <FormDraftStatus
        dirty={lifecycle.dirty}
        onDiscard={() => {
          if (!window.confirm("Discard this mixed-lot draft and clear its selected Copies and listing details?")) return;
          lifecycle.discard();
          setStep(1);
          setValidation(null);
        }}
        recoveryMessage={lifecycle.recoveryMessage}
        restored={lifecycle.restored}
      />

      <WizardProgress
        labels={["Choose Copies", "Details & Photos", "Review"]}
        step={step}
      />

      {step === 1 ? (
        <StepPanel step={step}>
          <FormSection
            description="Select every physical Copy the buyer will receive, then arrange the exact order used in the listing."
            number={1}
            title="Choose Copies"
          >
            <div className="grid min-w-0 gap-5">
              <div className="min-w-0">
                <div
                  aria-live="polite"
                  className="mb-4 flex flex-col gap-1 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <strong>{selected.length} {selected.length === 1 ? "copy" : "copies"} selected</strong>
                    <span className="mt-0.5 block text-sm font-medium text-zinc-500">
                      {selection.valid ? "Selection complete" : selection.issues.length ? "Remove or replace the unavailable selected Copy" : "Choose at least two copies to continue"}
                    </span>
                  </div>
                  <span className={`inline-flex min-h-9 w-fit items-center gap-2 rounded-full px-3 text-sm font-bold ${selection.valid ? "bg-emerald-50 text-emerald-800" : "bg-amber-100 text-amber-900"}`}>
                    {selection.valid ? <CheckCircle2 className="size-4" /> : <Info className="size-4" />}
                    {selection.valid ? "Ready to continue" : selection.issues.length ? "Needs attention" : `${Math.max(0, 2 - selected.length)} more required`}
                  </span>
                </div>

                {selection.issues.length ? (
                  <div aria-live="assertive" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-950">
                    <strong className="block">Selected Copies need attention</strong>
                    <ul className="mt-2 grid gap-2">
                      {selection.issues.map((issue, index) => <li className="flex flex-wrap items-center justify-between gap-2" key={`${issue.code}:${issue.copyId ?? index}`}>
                        <span>{issue.message}</span>
                        {issue.copyId ? <button className="min-h-11 rounded-md border border-rose-300 bg-white px-3 font-bold" onClick={() => toggleCopy(issue.copyId!, false)} type="button">Remove</button> : null}
                      </li>)}
                    </ul>
                  </div>
                ) : null}

                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(180px,0.35fr)_auto] lg:items-end">
                  <label>
                    <span className="text-sm font-bold text-zinc-700">Search cards</span>
                    <div className="relative mt-1">
                      <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
                      <input
                        className={`${fieldClass} mt-0 min-w-0 pl-9`}
                        onChange={(event) => {
                          setQuery(event.target.value);
                          setPage(1);
                        }}
                        placeholder="Name, set, code, edition, rarity, condition"
                        type="search"
                        value={query}
                      />
                    </div>
                  </label>
                  <label>
                    <span className="text-sm font-bold text-zinc-700">Rarity</span>
                    <select
                      className={fieldClass}
                      onChange={(event) => {
                        setRarity(event.target.value);
                        setPage(1);
                      }}
                      value={rarity}
                    >
                      <option value="all">All rarities</option>
                      {rarityOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                  </label>
                  <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-zinc-300 bg-zinc-50 px-3 text-sm font-bold text-zinc-700">
                    <input
                      checked={selectedOnly}
                      className="size-4 accent-[#8a1f2d]"
                      onChange={(event) => {
                        setSelectedOnly(event.target.checked);
                        setPage(1);
                      }}
                      type="checkbox"
                    />
                    Selected only
                  </label>
                </div>

                <div className="mt-4 flex items-center justify-between gap-3 text-sm font-medium text-zinc-500">
                  <span>Available inventory</span>
                  <span>Showing {resultStart}–{resultEnd} of {filtered.length}</span>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
                  {visible.map(
                    ({ copy, exposure, imageUrl, printing, target }, index) => {
                      const chosen = selection.selectedIds.includes(copy.id);
                      const exposurePresentation = exposure
                        ? ebayExposurePresentation(
                            exposure.aggregateState,
                            exposure.liveOfferCount,
                          )
                        : null;
                      const copiesForTarget = source.snapshot.copies.filter((candidate) => {
                        const candidatePrinting = source.snapshot.printings.find(
                          (value) => value.id === candidate.printingId,
                        );
                        return candidatePrinting?.targetId === target.id;
                      });
                      const copyLabel = `${target.name}, ${printing.setCode || "unknown set"}, Copy ${copyReference(copy.id)}`;
                      return (
                        <label
                          className={`group relative cursor-pointer overflow-hidden rounded-lg border bg-white transition focus-within:ring-2 focus-within:ring-[#8a1f2d] focus-within:ring-offset-2 ${
                            chosen
                              ? "border-[#8a1f2d] ring-1 ring-[#8a1f2d]"
                              : "border-zinc-200 hover:border-zinc-400 hover:shadow-sm"
                          }`}
                          key={copy.id}
                        >
                          <div className="relative aspect-[3/4] bg-zinc-100">
                            {imageUrl ? (
                              <Image
                                alt=""
                                className="object-contain p-2"
                                fill
                                loading={index < 4 ? "eager" : "lazy"}
                                sizes="(max-width: 768px) 50vw, (max-width: 1280px) 33vw, 25vw"
                                src={`/api/image-proxy?url=${encodeURIComponent(imageUrl)}`}
                                unoptimized
                              />
                            ) : (
                              <span className="grid h-full place-items-center text-xs font-black text-zinc-400">CARD</span>
                            )}
                            <input
                              aria-label={`Select ${copyExposureSelectorLabel(copyLabel, exposure)}. eBay status ${exposurePresentation?.label ?? "Unavailable"}.`}
                              checked={chosen}
                              className="sr-only"
                              onChange={(event) =>
                                toggleCopy(copy.id, event.target.checked)
                              }
                              type="checkbox"
                            />
                            <span aria-hidden="true" className={`absolute right-2 top-2 z-10 grid size-9 place-items-center rounded-full border shadow-sm ${chosen ? "border-[#8a1f2d] bg-[#8a1f2d] text-white" : "border-zinc-300 bg-white text-zinc-600"}`}>
                              {chosen ? <Check className="size-4" /> : <Plus className="size-4" />}
                            </span>
                            {chosen ? (
                              <span className="absolute left-2 top-2 z-10 rounded-full bg-[#8a1f2d] px-2 py-1 text-[11px] font-black text-white shadow-sm">
                                Selected
                              </span>
                            ) : null}
                          </div>
                          <span className="block p-3">
                            <span className="line-clamp-2 block min-h-10 text-sm font-black leading-5 text-zinc-950">{target.name}</span>
                            <span className="mt-1 block text-xs font-bold text-[#8a1f2d]">{target.rarity || "Unknown rarity"}</span>
                            <span className="mt-1 block text-xs font-medium text-zinc-500">{printing.setCode || "Unknown set"} · {target.edition || "Unknown edition"}</span>
                            <span className="mt-1 block text-xs font-medium text-zinc-500">{copyDisplayLabel(copiesForTarget, copy.id)} · #{copyShortReference(copy.id)} · {copy.condition}</span>
                            <span className="mt-2 block text-xs font-bold text-zinc-700">Physical · {exposure ? physicalCopyStateLabel(exposure) : "Status unavailable"}</span>
                            <span className="mt-1 block break-words text-xs font-bold text-zinc-700">eBay exposure · {exposurePresentation?.label ?? "Unavailable"}{exposure ? ` · ${ebayExposureSummary(exposure)}` : ""}</span>
                          </span>
                        </label>
                      );
                    },
                  )}
                </div>

                {!visible.length ? (
                  <div className="mt-4 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-4 py-8 text-center">
                    <p className="font-bold text-zinc-800">
                      No Copies match this search
                    </p>
                    <button
                      className="mt-2 min-h-11 rounded-md px-3 text-sm font-bold text-[#8a1f2d] hover:bg-rose-50"
                      onClick={() => {
                        setQuery("");
                        setRarity("all");
                        setSelectedOnly(false);
                        setPage(1);
                      }}
                      type="button"
                    >
                      Clear search
                    </button>
                  </div>
                ) : null}

                {pageCount > 1 ? (
                  <nav
                    aria-label="Copy result pages"
                    className="mt-4 flex min-w-0 items-center justify-between gap-2"
                  >
                    <button
                      className="inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-sm font-bold disabled:opacity-40 sm:px-3"
                      disabled={currentPage <= 1}
                      onClick={() =>
                        setPage((current) => current - 1)
                      }
                      type="button"
                    >
                      <ChevronLeft
                        aria-hidden="true"
                        className="size-4"
                      />
                      Previous
                    </button>
                    <span className="shrink-0 text-xs font-bold text-zinc-600 sm:text-sm">
                      Page {currentPage} of {pageCount}
                    </span>
                    <button
                      className="inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-sm font-bold disabled:opacity-40 sm:px-3"
                      disabled={currentPage >= pageCount}
                      onClick={() =>
                        setPage((current) => current + 1)
                      }
                      type="button"
                    >
                      Next
                      <ChevronRight
                        aria-hidden="true"
                        className="size-4"
                      />
                    </button>
                  </nav>
                ) : null}
              </div>

              <aside
                aria-labelledby="selected-manifest-title"
                className="min-w-0 rounded-lg border border-zinc-200 bg-zinc-50 p-3"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <div>
                    <h3
                      className="font-black text-zinc-950"
                      id="selected-manifest-title"
                    >
                      Selected manifest
                    </h3>
                    <p className="mt-1 text-sm font-medium leading-5 text-zinc-600">
                      Review the order before continuing. It is used in the listing and fulfilment record.
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-zinc-950 px-2.5 py-1 text-xs font-black text-white">
                    {selected.length}
                  </span>
                </div>

                <p
                  aria-atomic="true"
                  aria-live="polite"
                  className="sr-only"
                >
                  {arrangeAnnouncement}
                </p>

                {selected.length ? (
                  <>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        aria-controls="selected-manifest-dialog"
                        aria-expanded={manifestOpen}
                        aria-haspopup="dialog"
                        className="inline-flex min-h-11 items-center rounded-md border border-zinc-300 bg-white px-3 text-sm font-bold text-zinc-800 transition hover:border-[#8a1f2d] hover:text-[#8a1f2d] focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-offset-2"
                        onClick={() => setManifestOpen(true)}
                        type="button"
                      >
                        Review & arrange {selected.length} {selected.length === 1 ? "Copy" : "Copies"}
                      </button>
                      <button
                        aria-controls={draft.photos.length ? "clear-lot-selection-dialog" : undefined}
                        aria-haspopup={draft.photos.length ? "dialog" : undefined}
                        className="inline-flex min-h-11 items-center rounded-md px-3 text-sm font-bold text-rose-800 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-45"
                        onClick={() => {
                          if (draft.photos.length) {
                            setClearSelectionOpen(true);
                          } else {
                            clearSelection();
                          }
                        }}
                        type="button"
                      >
                        Clear all
                      </button>
                    </div>
                    {manifestOpen ? (
                      <LotDialog
                        description="Arrange the exact physical Copies shown in the listing and fulfilment record."
                        footer={(
                          <div className="flex justify-end">
                            <button
                              className="min-h-11 rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white transition hover:bg-zinc-800 focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-offset-2"
                              onClick={() => setManifestOpen(false)}
                              type="button"
                            >
                              Done
                            </button>
                          </div>
                        )}
                        id="selected-manifest-dialog"
                        onClose={() => setManifestOpen(false)}
                        title="Selected manifest"
                      >
                        <ol className="grid gap-2">
                          {selected.map((item, index) => (
                            <li
                              className="flex min-w-0 items-center gap-2 rounded-md border border-zinc-200 bg-white p-2"
                              key={item.copy.id}
                            >
                              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-zinc-100 text-xs font-black">
                                {index + 1}
                              </span>
                              <span className="relative h-14 w-10 shrink-0 overflow-hidden rounded border border-zinc-200 bg-zinc-100">
                                {item.imageUrl ? (
                                  <Image
                                    alt=""
                                    className="object-contain p-0.5"
                                    fill
                                    sizes="40px"
                                    src={`/api/image-proxy?url=${encodeURIComponent(item.imageUrl)}`}
                                    unoptimized
                                  />
                                ) : (
                                  <span className="grid h-full place-items-center text-[8px] font-black text-zinc-400">
                                    CARD
                                  </span>
                                )}
                              </span>
                              <span className="min-w-0 flex-1">
                                <strong className="block break-words text-sm">
                                  {item.target.name}
                                </strong>
                                <span className="block break-words text-xs font-medium text-zinc-500">
                                  Ref #{copyReference(item.copy.id)} ·{" "}
                                  {item.printing.setCode || "Unknown set"}
                                </span>
                              </span>
                              <span className="flex shrink-0 gap-1">
                                <button
                                  aria-label={`Move ${item.target.name}, Copy ${copyReference(item.copy.id)}, earlier`}
                                  className="grid size-11 place-items-center rounded-md border border-zinc-200 text-zinc-700 transition hover:border-zinc-500 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-35"
                                  disabled={index === 0}
                                  onClick={() => moveCopy(item.copy.id, -1)}
                                  title="Move earlier"
                                  type="button"
                                >
                                  <ArrowUp aria-hidden="true" className="size-4" />
                                </button>
                                <button
                                  aria-label={`Move ${item.target.name}, Copy ${copyReference(item.copy.id)}, later`}
                                  className="grid size-11 place-items-center rounded-md border border-zinc-200 text-zinc-700 transition hover:border-zinc-500 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-35"
                                  disabled={index === selected.length - 1}
                                  onClick={() => moveCopy(item.copy.id, 1)}
                                  title="Move later"
                                  type="button"
                                >
                                  <ArrowDown aria-hidden="true" className="size-4" />
                                </button>
                              </span>
                            </li>
                          ))}
                        </ol>
                      </LotDialog>
                    ) : null}
                  </>
                ) : (
                  <p className="mt-3 rounded-md border border-dashed border-zinc-300 bg-white px-3 py-6 text-center text-sm font-medium text-zinc-500">
                    Choose at least two Copies to build this lot.
                  </p>
                )}
              </aside>
            </div>
          </FormSection>
        </StepPanel>
      ) : null}

      {step === 2 ? (
        <StepPanel step={step}>
          <FormSection
            description="Set the shared wording, whole-lot price, delivery, and photos for this quantity-1 offer."
            number={2}
            title="Details & Photos"
          >
            <div className="grid min-w-0 gap-5">
              <aside className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm font-medium leading-5 text-amber-950">
                <AlertTriangle
                  aria-hidden="true"
                  className="mt-0.5 size-5 shrink-0"
                />
                <p>
                  <strong className="font-black">Whole-lot values.</strong>{" "}
                  Price and postage cover all {selected.length} Copies,
                  not each Copy separately.
                </p>
              </aside>

              <section
                aria-labelledby="listing-copy-title"
                className="grid min-w-0 gap-4"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h3 className="font-black" id="listing-copy-title">
                      Listing wording
                    </h3>
                    <p className="mt-1 text-sm font-medium text-zinc-600">
                      Generate a safe starting point from the ordered
                      manifest, then edit it as needed.
                    </p>
                  </div>
                  <button
                    className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-bold transition hover:border-[#8a1f2d] hover:text-[#8a1f2d]"
                    onClick={regenerate}
                    type="button"
                  >
                    <Pencil
                      aria-hidden="true"
                      className="size-4"
                    />
                    Generate from manifest
                  </button>
                </div>

                <div className="grid min-w-0 gap-4 sm:grid-cols-2">
                  <label className="min-w-0 sm:col-span-2">
                    <span className="text-sm font-bold text-zinc-700">
                      Title
                    </span>
                    <input
                      className={`${fieldClass} min-w-0`}
                      maxLength={80}
                      onChange={(event) =>
                        updateDraft({ title: event.target.value })
                      }
                      value={draft.title}
                    />
                    <span className="mt-1 block text-right text-xs font-medium text-zinc-500">
                      {draft.title.length}/80
                    </span>
                  </label>
                  <label className="min-w-0">
                    <span className="text-sm font-bold text-zinc-700">
                      Whole-lot price
                    </span>
                    <span className="relative mt-1 block">
                      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center font-bold text-zinc-500">
                        £
                      </span>
                      <input
                        className={`${fieldClass} mt-0 min-w-0 pl-7`}
                        inputMode="decimal"
                        min="0"
                        onChange={(event) =>
                          updateDraft({ price: event.target.value, priceOrigin: "manual" })
                        }
                        placeholder="0.00"
                        step="0.01"
                        type="number"
                        value={effectivePrice}
                      />
                    </span>
                    {estimatedPriceText ? (
                      <span className="mt-1 block text-xs font-medium leading-5 text-zinc-500">
                        {draft.priceOrigin === "estimate"
                          ? `Auto-filled from the stored estimate for all ${selected.length} Copies.`
                          : `Stored estimate for all ${selected.length} Copies: £${estimatedPriceText}.`}
                      </span>
                    ) : (
                      <span className="mt-1 block text-xs font-medium leading-5 text-amber-800">
                        {priceEstimate.unpricedCopyCount
                          ? `${priceEstimate.unpricedCopyCount} ${priceEstimate.unpricedCopyCount === 1 ? "Copy has" : "Copies have"} no stored estimate, so no partial price was applied.`
                          : "Choose Copies to calculate an estimate."}
                      </span>
                    )}
                  </label>
                  <label className="min-w-0">
                    <span className="text-sm font-bold text-zinc-700">
                      Postage
                    </span>
                    <span className="relative mt-1 block">
                      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center font-bold text-zinc-500">
                        £
                      </span>
                      <input
                        className={`${fieldClass} mt-0 min-w-0 pl-7`}
                        inputMode="decimal"
                        min="0"
                        onChange={(event) =>
                          updateDraft({ shipping: event.target.value })
                        }
                        step="0.01"
                        type="number"
                        value={draft.shipping}
                      />
                    </span>
                  </label>
                  <label className="min-w-0 sm:col-span-2">
                    <span className="text-sm font-bold text-zinc-700">
                      Description
                    </span>
                    <textarea
                      className={`${textAreaClass} min-h-40 min-w-0`}
                      onChange={(event) =>
                        updateDraft({
                          description: event.target.value,
                        })
                      }
                      value={draft.description}
                    />
                  </label>
                </div>
                {estimatedPriceText && draft.priceOrigin === "manual" ? (
                  <button
                    className="inline-flex min-h-11 w-fit items-center rounded-md px-3 text-sm font-bold text-[#8a1f2d] transition hover:bg-rose-50 focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-inset"
                    onClick={() => updateDraft({ price: "", priceOrigin: "estimate" })}
                    type="button"
                  >
                    Use estimated whole-lot price (£{estimatedPriceText})
                  </button>
                ) : null}
              </section>

              <SoldListingResearch groups={priceEstimate.groups} />

              {!savedPhotoPickerOpen &&
              (savedPhotosLoading || importingPhoto) ? (
                <p
                  className="flex items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2.5 text-sm font-bold text-sky-950"
                  role="status"
                >
                  <LoaderCircle
                    aria-hidden="true"
                    className="size-4 animate-spin motion-reduce:animate-none"
                  />
                  {savedPhotoImportProgress
                    ? `Pulling through saved Copy photos ${savedPhotoImportProgress.completed} of ${savedPhotoImportProgress.total}…`
                    : "Checking the selected Copies for saved photos…"}
                </p>
              ) : null}

              <CardPhotoManager
                canManage
                cardName={photoAnchor?.target.name || "card lot"}
                changing={photoBusy}
                configured
                description={
                  photoAnchor
                    ? `Shared lot photos are anchored to ${photoAnchor.target.name}, Copy #${copyReference(photoAnchor.copy.id)}. Reordering the manifest will not change that anchor.`
                    : "Add shared photos after choosing the exact Copies."
                }
                emptyText="Add at least one clear photo showing the mixed card lot."
                id="ebay-lot-photos"
                images={draft.photos.map((photo) => ({
                  id: photo.archiveKey,
                  previewUrl: photo.previewUrl,
                }))}
                loading={false}
                maxImages={12}
                message={
                  !savedPhotoPickerOpen && !savedPhotosLoading
                    ? savedPhotosError
                    : null
                }
                onRemove={removePhoto}
                onReorder={reorderPhotos}
                onUpload={uploadPhotos}
                previewSubtitle="Prepared for this mixed card lot"
                removalDescription="This removes the photo from this draft only."
                removalTitle="Remove this lot photo?"
                removingId={removingPhotoId}
                reordering={reorderingPhotos}
                secondaryAction={{
                  controls: "saved-copy-photo-picker-dialog",
                  disabled: !selection.selectedIds[0] || photoBusy || draft.photos.length >= 12,
                  expanded: savedPhotoPickerOpen,
                  hasPopup: "dialog",
                  icon: Images,
                  label: "Choose saved Copy photos",
                  onClick: () => void openSavedPhotoPicker(),
                }}
                storageWarning="Configure archive storage before adding photos."
                title="Lot photos"
                uploading={uploadingPhotos}
              />

              {savedPhotosError?.startsWith("Reconnect eBay") ? (
                <Link
                  className="inline-flex min-h-11 w-fit items-center justify-center rounded-md bg-zinc-950 px-4 text-sm font-bold text-white transition hover:bg-zinc-800 focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-offset-2"
                  href="/ebay"
                >
                  Reconnect eBay
                </Link>
              ) : null}

              {savedPhotoPickerOpen ? (
                <LotDialog
                  description="Choose photos already saved against the selected physical Copies. Your original card photos stay untouched."
                  dismissible={!importingPhoto}
                  footer={(
                    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <button
                        className="min-h-11 rounded-md border border-zinc-300 bg-white px-4 text-sm font-bold text-zinc-700 transition hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-[#8a1f2d] disabled:cursor-wait disabled:opacity-50"
                        disabled={importingPhoto}
                        onClick={() => setSavedPhotoPickerOpen(false)}
                        type="button"
                      >
                        Cancel
                      </button>
                      <button
                        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-[#981d2d] px-4 text-sm font-bold text-white shadow-sm transition-colors hover:bg-[#7f1826] focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={
                          savedPhotosLoading ||
                          importingPhoto ||
                          !savedPhotoSelection.length
                        }
                        onClick={() => void importSavedCopyPhotos()}
                        type="button"
                      >
                        {importingPhoto ? (
                          <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
                        ) : (
                          <Images aria-hidden="true" className="size-4" />
                        )}
                        {savedPhotoImportProgress
                          ? `Adding ${savedPhotoImportProgress.completed} of ${savedPhotoImportProgress.total}…`
                          : `Add ${savedPhotoSelection.length || ""} ${savedPhotoSelection.length === 1 ? "photo" : "photos"}`.replace("  ", " ")}
                      </button>
                    </div>
                  )}
                  id="saved-copy-photo-picker-dialog"
                  onClose={() => setSavedPhotoPickerOpen(false)}
                  title="Choose saved Copy photos"
                >
                  {savedPhotosLoading ? (
                    <div className="grid min-h-48 place-items-center text-center" role="status">
                      <span>
                        <LoaderCircle aria-hidden="true" className="mx-auto size-6 animate-spin text-[#8a1f2d] motion-reduce:animate-none" />
                        <span className="mt-3 block text-sm font-bold text-zinc-700">
                          Loading saved photos…
                        </span>
                      </span>
                    </div>
                  ) : (
                    <div className="grid gap-4">
                      <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="text-sm font-black text-zinc-950">
                            {savedPhotoSelection.length} selected · {availablePhotoSlots} {availablePhotoSlots === 1 ? "slot" : "slots"} available
                          </p>
                          <p className="mt-1 text-xs font-medium leading-5 text-zinc-600">
                            The primary saved photo for each Copy is preselected where space allows. You can change the selection below.
                          </p>
                        </div>
                        {savedPhotoCandidates.length ? (
                          <div className="flex shrink-0 flex-wrap gap-2">
                            <button
                              className="min-h-11 rounded-md px-3 text-sm font-bold text-[#8a1f2d] transition hover:bg-rose-50 focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-inset"
                              onClick={() =>
                                setSavedPhotoSelection(
                                  savedPhotoCandidates
                                    .slice(0, availablePhotoSlots)
                                    .map((candidate) => candidate.id),
                                )
                              }
                              type="button"
                            >
                              Fill available slots
                            </button>
                            <button
                              className="min-h-11 rounded-md px-3 text-sm font-bold text-zinc-700 transition hover:bg-zinc-200 focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-inset"
                              onClick={() => setSavedPhotoSelection([])}
                              type="button"
                            >
                              Clear
                            </button>
                          </div>
                        ) : null}
                      </div>

                      {savedPhotosError ? (
                        <p className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm font-semibold leading-5 text-rose-950" role="alert">
                          {savedPhotosError}
                        </p>
                      ) : null}

                      {savedPhotoCandidates.length ? (
                        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                          {savedPhotoCandidates.map((candidate) => {
                            const checked = savedPhotoSelection.includes(candidate.id);
                            const selectionFull =
                              !checked &&
                              savedPhotoSelection.length >= availablePhotoSlots;
                            return (
                              <li key={candidate.id}>
                                <label className={`group grid h-full cursor-pointer overflow-hidden rounded-lg border bg-white transition focus-within:ring-2 focus-within:ring-[#8a1f2d] focus-within:ring-offset-2 ${checked ? "border-[#8a1f2d] ring-1 ring-[#8a1f2d]" : "border-zinc-200 hover:border-zinc-400"} ${selectionFull ? "cursor-not-allowed opacity-55" : ""}`}>
                                  <span className="relative block aspect-square overflow-hidden bg-zinc-100">
                                    <Image
                                      alt=""
                                      className="h-full w-full object-cover"
                                      height={320}
                                      src={candidate.previewUrl}
                                      unoptimized
                                      width={320}
                                    />
                                    <input
                                      aria-label={`${checked ? "Remove" : "Add"} saved photo ${candidate.position + 1} for ${candidate.cardName}`}
                                      checked={checked}
                                      className="sr-only"
                                      disabled={selectionFull || importingPhoto}
                                      onChange={() => toggleSavedPhoto(candidate.id)}
                                      type="checkbox"
                                    />
                                    <span aria-hidden="true" className={`absolute right-2 top-2 grid size-9 place-items-center rounded-full border shadow-sm ${checked ? "border-[#8a1f2d] bg-[#8a1f2d] text-white" : "border-zinc-300 bg-white text-zinc-600"}`}>
                                      {checked ? <Check className="size-4" /> : <Plus className="size-4" />}
                                    </span>
                                  </span>
                                  <span className="block min-w-0 p-2.5">
                                    <strong className="line-clamp-2 block text-sm leading-5 text-zinc-950">
                                      {candidate.cardName}
                                    </strong>
                                    <span className="mt-1 block break-words text-xs font-medium text-zinc-500">
                                      {candidate.printingLabel} · Copy #{copyReference(candidate.copyId)} · Photo {candidate.position + 1}
                                    </span>
                                  </span>
                                </label>
                              </li>
                            );
                          })}
                        </ul>
                      ) : !savedPhotosError ? (
                        <div className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-4 py-8 text-center">
                          <Images aria-hidden="true" className="mx-auto size-6 text-zinc-400" />
                          <p className="mt-3 font-bold text-zinc-800">
                            No unused saved photos
                          </p>
                          <p className="mt-1 text-sm font-medium leading-5 text-zinc-600">
                            None of the selected Copies have another saved photo available to add.
                          </p>
                        </div>
                      ) : null}
                    </div>
                  )}
                </LotDialog>
              ) : null}
            </div>
          </FormSection>
        </StepPanel>
      ) : null}

      {step === 3 ? (
        <StepPanel step={step}>
          <div className="grid min-w-0 gap-4">
            <PreviewNotice label="Review before publishing.">
              Nothing has been published. eBay will receive one
              fixed-price lot with quantity 1.
            </PreviewNotice>

            <FormSection
              description="Confirm the offer, every physical Copy, and eBay's latest validation response."
              number={3}
              title="Review"
            >
              <div className="grid min-w-0 gap-5">
                <div className="min-w-0">
                  <section
                    aria-labelledby="offer-summary-title"
                    className="rounded-lg border border-zinc-200 bg-zinc-50 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#8a1f2d]">
                          Quantity 1 · {ebayLotCategory.label}
                        </p>
                        <h3
                          className="mt-2 break-words text-lg font-black"
                          id="offer-summary-title"
                        >
                          {draft.title || "Untitled lot"}
                        </h3>
                      </div>
                      <button
                        className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-bold"
                        onClick={() => setStep(2)}
                        type="button"
                      >
                        <Pencil className="size-4" />
                        Edit
                      </button>
                    </div>
                    <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                      <div>
                        <dt className="font-bold text-zinc-500">
                          Whole-lot price
                        </dt>
                        <dd className="mt-1 font-black">
                          £{effectivePrice || "0.00"}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-bold text-zinc-500">
                          Postage
                        </dt>
                        <dd className="mt-1 font-black">
                          £{draft.shipping || "0.00"}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-bold text-zinc-500">
                          Exact Copies
                        </dt>
                        <dd className="mt-1 font-black">
                          {selected.length}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-bold text-zinc-500">
                          Photos
                        </dt>
                        <dd className="mt-1 font-black">
                          {draft.photos.length}
                        </dd>
                      </div>
                    </dl>
                  </section>

                  <section
                    aria-labelledby="review-manifest-title"
                    className="mt-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="font-black" id="review-manifest-title">
                          Exact fulfilment order
                        </h3>
                        <p className="mt-1 text-sm font-medium text-zinc-600">
                          The buyer receives every Copy shown below.
                        </p>
                      </div>
                      <button
                        className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-bold"
                        onClick={() => setStep(1)}
                        type="button"
                      >
                        <Pencil className="size-4" />
                        Edit
                      </button>
                    </div>
                    <ol className="mt-3 grid min-w-0 gap-2">
                      {selected.map((item, index) => (
                        <li
                          className="flex min-w-0 gap-3 rounded-lg border border-zinc-200 p-3"
                          key={item.copy.id}
                        >
                          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-zinc-100 text-xs font-black">
                            {index + 1}
                          </span>
                          <p className="min-w-0 break-words text-sm font-medium text-zinc-600">
                            <strong className="block text-zinc-950">
                              {item.target.name}
                            </strong>
                            {copyDetails(item)}
                          </p>
                        </li>
                      ))}
                    </ol>
                  </section>
                  <div className="mt-4">
                    <SoldListingResearch groups={priceEstimate.groups} />
                  </div>
                </div>

                <aside
                  aria-labelledby="ebay-check-title"
                  className="min-w-0 rounded-lg border border-zinc-200 bg-zinc-50 p-4"
                >
                  <div className="flex items-start gap-3">
                    <span
                      className={`grid size-10 shrink-0 place-items-center rounded-full ${
                        validation?.readyToPublish
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-rose-50 text-rose-700"
                      }`}
                    >
                      {validation?.readyToPublish ? (
                        <CheckCircle2
                          aria-hidden="true"
                          className="size-5"
                        />
                      ) : (
                        <AlertTriangle
                          aria-hidden="true"
                          className="size-5"
                        />
                      )}
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-bold uppercase tracking-[0.12em] text-zinc-500">
                        eBay validation
                      </p>
                      <h3
                        className={`mt-1 font-black ${
                          validation?.readyToPublish
                            ? "text-emerald-800"
                            : "text-rose-800"
                        }`}
                        id="ebay-check-title"
                      >
                        {validation?.readyToPublish
                          ? "Ready to publish"
                          : "Changes required"}
                      </h3>
                    </div>
                  </div>

                  {validation?.errors.length ? (
                    <ul className="mt-4 grid gap-2">
                      {validation.errors.map((validationError, index) => (
                        <li
                          className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm font-medium leading-5 text-rose-950"
                          key={`${validationError.code}-${index}`}
                        >
                          <strong className="block font-black">
                            {validationError.severity || "eBay message"}
                            {validationError.code
                              ? ` · ${validationError.code}`
                              : ""}
                          </strong>
                          <span className="mt-1 block break-words">
                            {validationError.message ||
                              "eBay returned a validation message."}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-4 text-sm font-medium leading-5 text-zinc-600">
                      {validation?.readyToPublish
                        ? "eBay accepted the listing details and returned no validation messages."
                        : "Go back, review the listing details, and validate again."}
                    </p>
                  )}

                  <div className="mt-4 border-t border-zinc-200 pt-4">
                    <h4 className="text-sm font-black">Fees returned</h4>
                    {visibleFees.length ? (
                      <dl className="mt-2 divide-y divide-zinc-100 overflow-hidden rounded-md border border-zinc-200 text-sm">
                        {visibleFees.map((fee, index) => (
                          <div
                            className="flex min-w-0 justify-between gap-3 p-2.5"
                            key={`${fee.name}-${index}`}
                          >
                            <dt className="min-w-0 break-words text-zinc-600">
                              {feeName(fee.name)}
                            </dt>
                            <dd className="shrink-0 font-black">
                              {feeAmount(fee.amount, fee.currency)}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    ) : (
                      <p className="mt-1 text-sm font-medium text-zinc-600">
                        No non-zero listing fees were returned.
                      </p>
                    )}
                  </div>

                  {publishedUrl ? (
                    <div
                      className="mt-4 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-emerald-950"
                      role="status"
                    >
                      <CheckCircle2
                        aria-hidden="true"
                        className="size-5 text-emerald-700"
                      />
                      <p className="mt-2 font-black">
                        Mixed card lot published
                      </p>
                      <a
                        className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-md bg-emerald-700 px-3 text-sm font-bold text-white"
                        href={publishedUrl}
                        rel="noreferrer"
                        target="_blank"
                      >
                        View on eBay
                      </a>
                    </div>
                  ) : null}
                </aside>
              </div>
            </FormSection>
          </div>
        </StepPanel>
      ) : null}

      {clearSelectionOpen ? (
        <LotDialog
          description={`This clears all ${selected.length} selected Copies and removes ${draft.photos.length} ${draft.photos.length === 1 ? "lot photo" : "lot photos"} from this draft. Saved photos on the individual Copies are not deleted.`}
          dismissible={!clearingSelection}
          footer={(
            <div className="grid grid-cols-2 gap-2">
              <button
                className="min-h-11 rounded-md border border-zinc-300 bg-white px-4 text-sm font-bold text-zinc-700 transition hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-[#8a1f2d] disabled:cursor-wait disabled:opacity-50"
                disabled={clearingSelection}
                onClick={() => setClearSelectionOpen(false)}
                type="button"
              >
                Keep selection
              </button>
              <button
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-rose-700 px-4 text-sm font-bold text-white transition hover:bg-rose-800 focus-visible:ring-2 focus-visible:ring-rose-700 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60"
                disabled={clearingSelection}
                onClick={() => void confirmClearSelection()}
                type="button"
              >
                {clearingSelection ? (
                  <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
                ) : null}
                {clearingSelection ? "Clearing…" : "Clear all"}
              </button>
            </div>
          )}
          id="clear-lot-selection-dialog"
          onClose={() => setClearSelectionOpen(false)}
          title="Clear this lot selection?"
        >
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-medium leading-5 text-rose-950">
            The generated title, description, and whole-lot price will also be reset because they describe this selection.
          </div>
        </LotDialog>
      ) : null}

      {!publishedUrl ? (
        <WizardActions
          confirmDisabled={!validation?.readyToPublish}
          finalLabel="Publish quantity 1 lot"
          nextDisabled={
            (step === 1 && !selection.valid) ||
            (step === 2 && photoBusy)
          }
          onBack={() => {
            setError(null);
            setStep((current) => Math.max(1, current - 1));
          }}
          onConfirm={() => void confirm()}
          onNext={() => void next()}
          pending={
            preparingPhotos ||
            validate.isPending ||
            publish.isPending ||
            publishing
          }
          pendingLabel={
            preparingPhotos
              ? "Preparing photos…"
              : validate.isPending
                ? "Validating…"
                : "Publishing…"
          }
          sticky={false}
          step={step}
          totalSteps={3}
        />
      ) : (
        <Link
          className="inline-flex min-h-11 items-center justify-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-bold text-zinc-700 hover:border-zinc-950 sm:w-fit"
          href={returnHref}
          replace
        >
          Back to Listings
        </Link>
      )}

      <p className="sr-only" role="status">
        {validate.isPending
          ? "Validating the mixed card lot with eBay."
          : publish.isPending
            ? "Publishing the mixed card lot."
            : ""}
      </p>
    </form>
    </DraftHydrationBoundary>
  );
}

export function EbayLotListing() {
  const source = useRecordsDataSource();
  const searchParams = useSearchParams();
  const returnHref = taskReturnHref(searchParams.get("origin"), "/records/listings");
  const { data: session } = useSession();
  const ebayStatus = trpc.ebay.status.useQuery(undefined, {
    enabled: source.mode === "live" && Boolean(session),
    staleTime: 30_000,
  });
  const capability = ebayStatus.data?.capability;
  return (
    <div className="flex w-full flex-col gap-5">
      <nav aria-label="Mixed lot breadcrumb" className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <Link
          className="inline-flex min-h-11 w-fit items-center gap-2 rounded-md text-sm font-bold text-zinc-600 hover:text-zinc-950"
          href={returnHref}
          replace
        >
          <ArrowLeft className="size-4" />
          Back to Listings
        </Link>
        <p className="text-xs font-semibold text-zinc-500">Unfinished work is kept in this browser tab.</p>
      </nav>
      <header className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-rose-50 text-[#8a1f2d]">
          <Layers3 className="size-5" />
        </span>
        <div>
          <h1 className="text-2xl font-black">Create mixed card lot</h1>
          <p className="mt-1 max-w-2xl text-sm font-medium leading-6 text-zinc-600">
            Choose the exact physical Copies sold together, then create one
            fixed-price eBay offer with quantity 1.
          </p>
        </div>
      </header>
      {source.mode !== "live" ? <section className="rounded-xl border border-zinc-300 bg-white p-6 text-center"><h2 className="text-xl font-black">Mixed lots are unavailable in preview mode</h2><p className="mt-2 text-sm font-medium text-zinc-600">Switch to live Records to prepare an eBay listing.</p></section>
        : ebayStatus.isError ? <section className="rounded-xl border border-rose-300 bg-rose-50 p-6 text-center text-rose-950" role="alert"><h2 className="text-xl font-black">eBay readiness could not be checked</h2><p className="mt-2 text-sm font-medium">The mixed-lot editor is paused until the permission check succeeds.</p><button className="mt-4 min-h-11 rounded-md border border-rose-400 bg-white px-4 text-sm font-bold" onClick={() => void ebayStatus.refetch()} type="button">Retry eBay check</button></section>
        : !capability?.ebay.allowed ? <section className="rounded-xl border border-amber-300 bg-amber-50 p-6 text-center text-amber-950" role="status"><h2 className="text-xl font-black">{ebayStatus.isPending ? "Checking eBay readiness" : "Mixed lot unavailable"}</h2><p className="mt-2 text-sm font-medium">{ebayStatus.isPending ? "Checking whether this account can create an eBay listing…" : capability ? `${capability.ebay.message} ${capability.ebay.remedy}` : "Sign in with seller permission to create an eBay listing."}</p>{capability && ["not_connected", "reconnect_required", "missing_scopes"].includes(capability.ebay.code) ? <Link className="mt-4 inline-flex min-h-11 items-center justify-center rounded-md bg-[#8a1f2d] px-4 text-sm font-bold text-white" href="/ebay">Open eBay settings</Link> : null}</section>
          : <EbayLotForm returnHref={returnHref} />}
    </div>
  );
}

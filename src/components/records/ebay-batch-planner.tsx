"use client";

import {
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  Images,
  ListChecks,
  Loader2,
  PackageCheck,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { type ReactNode, useMemo, useState } from "react";
import type { inferRouterInputs } from "@trpc/server";
import { useSession } from "@/lib/auth-client";
import {
  ebayCardCategory,
  ebayDeliveryServices,
  ebayLotCategory,
  type EbayDeliveryServiceCode,
  type EbayListingItemSpecifics,
} from "@/lib/ebay-listing-options";
import {
  ebayCrossListingPlanProblem,
  ebayBatchOfferFingerprint,
  ebayBatchOfferIsReady,
  ebayBatchStatusLabel,
  effectiveEbayBatchDefaults,
  planEbayCrossListingOfferSeeds,
  type EbayBatchDraft,
  type EbayBatchOffer,
  type EbayBatchOfferOverride,
  type EbayBatchPhoto,
  type EbayBatchSharedDefaults,
} from "@/lib/records/ebay-batch";
import { buildEbayLotDescription, buildEbayLotTitle, planEbayLotSavedPhotoImports } from "@/lib/records/ebay-lot";
import {
  buildHomogeneousQuantityDescription,
  buildHomogeneousQuantityTitle,
  planHomogeneousQuantitySavedPhotos,
} from "@/lib/records/ebay-quantity-listing";
import { useFormDraftLifecycle } from "@/lib/records/use-form-draft-lifecycle";
import { copySelectionAvailabilityReason } from "@/lib/records/copy-selection";
import { copyShortReference } from "@/lib/records/copy-display";
import { cardConditionOptions, type CardPrinting, type WishlistTarget } from "@/lib/records/types";
import { rarityAbbreviation } from "@/lib/rarity-abbreviations";
import { useRecordsDataSource } from "@/components/records/records-preview-provider";
import { CopySelectionPicker, type CopySelectionPickerItem } from "@/components/records/copy-selection-picker";
import { CardPhotoManager } from "@/components/records/card-photo-manager";
import {
  fieldClass,
  FormSection,
  StepPanel,
  textAreaClass,
  WizardActions,
  WizardProgress,
} from "@/components/records/entry-form-ui";
import { trpc } from "@/trpc/client";
import { useCollectionChange } from "@/lib/use-collection-change";
import type { AppRouter } from "@/server/root";

type EbayRouterInputs = inferRouterInputs<AppRouter>["ebay"];

type PlannerCopy = CopySelectionPickerItem & {
  blockedReason: string | null;
};

type InventoryPhoto = {
  key: string;
  position: number;
  previewUrl: string;
};

const statusTone = {
  draft: "border-zinc-300 bg-zinc-50 text-zinc-700",
  needs_changes: "border-amber-300 bg-amber-50 text-amber-900",
  ready: "border-sky-300 bg-sky-50 text-sky-900",
  publishing: "border-violet-300 bg-violet-50 text-violet-900",
  published: "border-emerald-300 bg-emerald-50 text-emerald-900",
  failed: "border-rose-300 bg-rose-50 text-rose-900",
} as const;

function randomIdentity(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function randomPublicationId() {
  return crypto.randomUUID().replaceAll("-", "").toUpperCase();
}

function pounds(value: number | null | undefined) {
  return value === null || value === undefined ? "" : (value / 100).toFixed(2);
}

function pence(value: string) {
  const normalized = value.trim().replace(/[£,\s]/g, "");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  return Math.round(Number(normalized) * 100);
}

function conditionId(condition: string) {
  return cardConditionOptions.find((option) => option.value === condition)?.ebayDescriptorValueId ?? "400010";
}

function editionFeature(edition: string) {
  if (/limited/i.test(edition)) return "Limited Edition";
  if (/unlimited/i.test(edition)) return "Unlimited Edition";
  return "1st Edition";
}

function defaultSpecifics(target: WishlistTarget, printing: CardPrinting): EbayListingItemSpecifics {
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

function defaultSharedDefaults(): EbayBatchSharedDefaults {
  return {
    dispatchTimeMax: "3",
    language: "English",
    location: "Surrey",
    postalCode: "GU21 6DE",
    reusableDescription: "Please review all photos carefully before buying. Please contact me if you have any questions.",
    shippingCost: "1.55",
    shippingService: ebayDeliveryServices[0].code,
  };
}

function defaultDraft(): EbayBatchDraft {
  return {
    id: randomIdentity("ebay-batch"),
    manualSaleAcknowledged: false,
    offers: [],
    selectedCopyIds: [],
    sharedDefaults: defaultSharedDefaults(),
    step: 1,
  };
}

function normalizedBatchDraft(draft: EbayBatchDraft): EbayBatchDraft {
  const postalCode = draft.sharedDefaults.postalCode.trim() || "GU21 6DE";
  if (
    draft.sharedDefaults.language === "English"
    && draft.sharedDefaults.location === "Surrey"
    && draft.sharedDefaults.postalCode === postalCode
  ) return draft;
  return {
    ...draft,
    sharedDefaults: {
      ...draft.sharedDefaults,
      language: "English",
      location: "Surrey",
      postalCode,
    },
  };
}

function isBatchDraft(value: unknown): value is EbayBatchDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<EbayBatchDraft>;
  return typeof draft.id === "string"
    && typeof draft.manualSaleAcknowledged === "boolean"
    && [1, 2, 3].includes(draft.step ?? 0)
    && Array.isArray(draft.selectedCopyIds)
    && draft.selectedCopyIds.every((id) => typeof id === "string")
    && Boolean(draft.sharedDefaults && typeof draft.sharedDefaults === "object")
    && Array.isArray(draft.offers)
    && draft.offers.every((offer) => Boolean(
      offer
      && typeof offer.id === "string"
      && typeof offer.publicationId === "string"
      && Array.isArray(offer.copyIds)
      && ["individual", "quantity", "bundle"].includes(offer.kind)
      && ["draft", "needs_changes", "ready", "publishing", "published", "failed"].includes(offer.status),
    ));
}

function offerKindLabel(kind: EbayBatchOffer["kind"]) {
  return kind === "quantity" ? "Quantity offer" : kind === "bundle" ? "Mixed-card lot" : "Individual offer";
}

function plannedCopy(
  copyId: string,
  candidates: PlannerCopy[],
) {
  return candidates.find((candidate) => candidate.copy.id === copyId) ?? null;
}

function makeOffer(copyIds: string[], kind: EbayBatchOffer["kind"], candidates: PlannerCopy[]): EbayBatchOffer {
  const members = copyIds.flatMap((copyId) => {
    const candidate = plannedCopy(copyId, candidates);
    return candidate ? [candidate] : [];
  });
  const first = members[0];
  if (!first) throw new Error("A planned offer needs at least one physical Copy.");
  const lotManifest = members.map(({ copy, printing, target }) => ({
    condition: copy.condition,
    copyId: copy.id,
    edition: target.edition,
    name: target.name,
    printing: printing.setCode || printing.setName,
    rarity: target.rarity,
  }));
  const quantityCopy = {
    condition: first.copy.condition,
    edition: first.target.edition,
    name: first.target.name,
    quantity: copyIds.length,
    rarity: first.target.rarity,
    setCode: first.printing.setCode,
    setName: first.printing.setName,
  };
  const estimatedPence = kind === "bundle"
    ? members.reduce((sum, member) => sum + (member.target.estimatedPricePence ?? member.target.marketPricePence ?? 0), 0)
    : first.target.estimatedPricePence ?? first.target.marketPricePence;
  return {
    copyIds,
    description: kind === "bundle"
      ? buildEbayLotDescription(lotManifest)
      : buildHomogeneousQuantityDescription(quantityCopy),
    id: randomIdentity("ebay-offer"),
    itemSpecifics: kind === "bundle" ? {
      cardNumber: "Mixed",
      cardSize: "Japanese",
      features: "Mixed card lot",
      game: "Yu-Gi-Oh! TCG",
      manufacturer: "Konami",
      rarity: "Mixed",
      setName: "Mixed",
    } : defaultSpecifics(first.target, first.printing),
    kind,
    overrideDefaults: null,
    photos: [],
    price: pounds(estimatedPence),
    publicationId: randomPublicationId(),
    publishedItemId: null,
    publishedUrl: null,
    status: "draft",
    statusMessage: null,
    title: kind === "bundle" ? buildEbayLotTitle(lotManifest) : buildHomogeneousQuantityTitle(quantityCopy),
    validatedFingerprint: null,
    verification: null,
  };
}

function withReusableDescription(offer: EbayBatchOffer, shared: EbayBatchSharedDefaults) {
  return [offer.description.trim(), shared.reusableDescription.trim()].filter(Boolean).join("\n\n");
}

function localOfferProblem(offer: EbayBatchOffer, shared: EbayBatchSharedDefaults) {
  const defaults = effectiveEbayBatchDefaults(shared, offer.overrideDefaults);
  if (offer.kind === "individual" && offer.copyIds.length !== 1) return "An individual offer must contain exactly one Copy.";
  if ((offer.kind === "quantity" || offer.kind === "bundle") && offer.copyIds.length < 2) return "This offer needs at least two Copies.";
  if (!offer.title.trim() || offer.title.trim().length > 80) return "Enter a title using no more than 80 characters.";
  if (withReusableDescription(offer, shared).length < 20) return "Enter a description of at least 20 characters.";
  if (!pence(offer.price) || pence(offer.price)! < 1) return "Enter a price of at least £0.01.";
  if (!offer.photos.length || offer.photos.length > 12) return "Add between 1 and 12 photos.";
  if (offer.photos.some((photo) => !photo.ebayUrl)) return "Send every prepared photo to eBay before Review.";
  if (!/^\d+$/.test(defaults.dispatchTimeMax) || Number(defaults.dispatchTimeMax) < 1 || Number(defaults.dispatchTimeMax) > 30) return "Dispatch time must be between 1 and 30 days.";
  if (defaults.postalCode.trim().length < 2) return "Enter the item postcode in Shared defaults or this offer's override.";
  if (pence(defaults.shippingCost) === null) return "Enter a valid shipping cost.";
  if (Object.values(offer.itemSpecifics).some((value) => !value.trim())) return "Complete every item specific.";
  return null;
}

function sharedDefaultsProblem(defaults: EbayBatchSharedDefaults) {
  if (!/^\d+$/.test(defaults.dispatchTimeMax) || Number(defaults.dispatchTimeMax) < 1 || Number(defaults.dispatchTimeMax) > 30) return "Enter a dispatch time between 1 and 30 days.";
  if (defaults.postalCode.trim().length < 2) return "Enter the postcode used for your offers.";
  if (pence(defaults.shippingCost) === null) return "Enter a valid shipping cost.";
  return null;
}

export function EbayBatchPlanner() {
  const source = useRecordsDataSource();
  const { data: session, isPending: sessionPending } = useSession();
  const initialDraft = useMemo(() => defaultDraft(), []);
  const lifecycle = useFormDraftLifecycle({
    workflow: "ebay-batch",
    ownerScope: source.draftOwnerScope,
    origin: "/records/listings/new-batch",
    initialData: initialDraft,
    isValidData: isBatchDraft,
  });
  const draft = normalizedBatchDraft(lifecycle.data);
  const setDraft = lifecycle.setData;
  const collectionChanged = useCollectionChange();
  const ebayStatus = trpc.ebay.status.useQuery(undefined, {
    enabled: source.mode === "live" && Boolean(session),
    staleTime: 30_000,
  });
  const validateOfferWithEbay = trpc.ebay.validateBatchOffer.useMutation();
  const publishOffer = trpc.ebay.publishBatchOffer.useMutation();
  const [editingOfferId, setEditingOfferId] = useState<string | null>(null);
  const [busyOfferId, setBusyOfferId] = useState<string | null>(null);
  const [queueMessage, setQueueMessage] = useState<string | null>(null);
  const [photoMessage, setPhotoMessage] = useState<string | null>(null);

  const candidates = useMemo<PlannerCopy[]>(() => {
    const printingById = new Map(source.snapshot.printings.map((printing) => [printing.id, printing]));
    const targetById = new Map(source.snapshot.targets.map((target) => [target.id, target]));
    const exposureByCopyId = new Map(source.snapshot.copyEbayExposures.map((exposure) => [exposure.copyId, exposure]));
    return source.snapshot.copies.flatMap((copy) => {
      const printing = printingById.get(copy.printingId);
      const target = printing ? targetById.get(printing.targetId) : null;
      if (!printing || !target) return [];
      const exposure = exposureByCopyId.get(copy.id);
      return [{
        blockedReason: copySelectionAvailabilityReason({ copyId: copy.id, exposure, status: copy.status }),
        copy,
        exposure,
        imageUrl: printing.imageUrl || target.imageUrl,
        printing,
        target,
      }];
    });
  }, [source.snapshot]);
  const selectableCandidates = candidates.filter((candidate) => !candidate.blockedReason);
  const selectedCardName = draft.selectedCopyIds.length
    ? plannedCopy(draft.selectedCopyIds[0]!, candidates)?.target.name ?? null
    : null;
  const selectableCardCopies = selectedCardName
    ? selectableCandidates.filter((candidate) => candidate.target.name.trim().toLocaleLowerCase() === selectedCardName.trim().toLocaleLowerCase())
    : selectableCandidates;
  const selectedPlanningCopies = draft.selectedCopyIds.flatMap((copyId) => {
    const candidate = plannedCopy(copyId, candidates);
    return candidate ? [{
      condition: candidate.copy.condition,
      copyId,
      edition: candidate.target.edition,
      printingId: candidate.printing.id,
    }] : [];
  });
  const selectedStandaloneCount = Math.max(
    0,
    planEbayCrossListingOfferSeeds(selectedPlanningCopies).length - 1,
  );
  const allPublished = draft.offers.length > 0 && draft.offers.every((offer) => offer.status === "published");
  const queuePending = draft.offers.some((offer) => offer.status === "publishing");

  function updateDraft(update: Partial<EbayBatchDraft>) {
    setDraft((current) => ({ ...current, ...update }));
  }

  function updateSharedDefaults(update: Partial<EbayBatchSharedDefaults>) {
    setDraft((current) => ({
      ...current,
      sharedDefaults: { ...current.sharedDefaults, ...update },
      offers: current.offers.map((offer) => offer.status === "published" ? offer : {
        ...offer,
        status: "draft",
        statusMessage: null,
        validatedFingerprint: null,
        verification: null,
      }),
    }));
  }

  function updateOffer(offerId: string, update: Partial<EbayBatchOffer>, preserveReview = false) {
    setDraft((current) => ({
      ...current,
      offers: current.offers.map((offer) => offer.id !== offerId || offer.status === "published" ? offer : {
        ...offer,
        ...update,
        ...(!preserveReview ? {
          status: "draft" as const,
          statusMessage: null,
          validatedFingerprint: null,
          verification: null,
        } : {}),
      }),
    }));
  }

  function rebuildPlan() {
    const offers = planEbayCrossListingOfferSeeds(selectedPlanningCopies)
      .map((seed) => makeOffer(seed.copyIds, seed.kind, candidates));
    updateDraft({ manualSaleAcknowledged: false, offers, step: 2 });
    setEditingOfferId(offers[0]?.id ?? null);
  }

  function publicationIdentity(offer: EbayBatchOffer) {
    return {
      batchId: draft.id,
      offerId: offer.id,
      plan: draft.offers.map((plannedOffer) => ({
        copyIds: plannedOffer.copyIds,
        kind: plannedOffer.kind,
        offerId: plannedOffer.id,
      })),
      publicationId: offer.publicationId,
    };
  }

  function offerDetails(offer: EbayBatchOffer) {
    const defaults = effectiveEbayBatchDefaults(draft.sharedDefaults, offer.overrideDefaults);
    const common = {
      cardConditionDescriptorValueId: offer.kind === "bundle" ? "400010" as const : conditionId(plannedCopy(offer.copyIds[0]!, candidates)?.copy.condition ?? ""),
      description: withReusableDescription(offer, draft.sharedDefaults),
      dispatchTimeMax: Number(defaults.dispatchTimeMax),
      images: offer.photos.map(({ archiveKey, ebayUrl }) => ({ archiveKey, ebayUrl: ebayUrl! })),
      itemSpecifics: offer.itemSpecifics,
      language: defaults.language,
      location: defaults.location.trim(),
      postalCode: defaults.postalCode.trim(),
      pricePence: pence(offer.price)!,
      shippingCostPence: pence(defaults.shippingCost)!,
      shippingService: defaults.shippingService,
      title: offer.title.trim(),
    };
    if (offer.kind === "individual") return { ...common, categoryId: ebayCardCategory.id, copyId: offer.copyIds[0]! };
    if (offer.kind === "quantity") return { ...common, categoryId: ebayCardCategory.id, copyIds: offer.copyIds, imageDraftCopyId: offer.copyIds[0]! };
    return { ...common, categoryId: ebayLotCategory.id, copyIds: offer.copyIds, imageDraftCopyId: offer.copyIds[0]! };
  }

  async function preparePhotos(offer: EbayBatchOffer) {
    const pending = offer.photos.filter((photo) => !photo.ebayUrl);
    if (!pending.length) return offer;
    setBusyOfferId(offer.id);
    const prepared = [...offer.photos];
    for (const photo of pending) {
      const body = new FormData();
      body.append("archiveKey", photo.archiveKey);
      body.append("copyId", offer.copyIds[0]!);
      const response = await fetch("/api/ebay/image", { body, method: "POST" });
      const result = await response.json() as { archiveKey?: string; ebayUrl?: string; message?: string; previewUrl?: string };
      if (!response.ok || !result.ebayUrl) throw new Error(result.message || "A prepared photo could not be sent to eBay.");
      const index = prepared.findIndex((candidate) => candidate.archiveKey === photo.archiveKey);
      if (index >= 0) prepared[index] = { ...prepared[index]!, ebayUrl: result.ebayUrl };
    }
    const next = { ...offer, photos: prepared };
    updateOffer(offer.id, { photos: prepared });
    return next;
  }

  async function validateOffer(offer: EbayBatchOffer) {
    setPhotoMessage(null);
    setQueueMessage(null);
    try {
      const prepared = await preparePhotos(offer);
      const problem = localOfferProblem(prepared, draft.sharedDefaults);
      if (problem) throw new Error(problem);
      const details = offerDetails(prepared);
      const identity = publicationIdentity(prepared);
      const verification = prepared.kind === "individual"
        ? await validateOfferWithEbay.mutateAsync({ kind: "individual", details: details as EbayRouterInputs["validate"], identity })
        : prepared.kind === "quantity"
          ? await validateOfferWithEbay.mutateAsync({ kind: "quantity", details: details as EbayRouterInputs["validateQuantity"], identity })
          : await validateOfferWithEbay.mutateAsync({ kind: "bundle", details: details as EbayRouterInputs["validateLot"], identity });
      const reviewed: EbayBatchOffer = { ...prepared, verification };
      updateOffer(prepared.id, {
        status: verification.readyToPublish ? "ready" : "needs_changes",
        statusMessage: verification.readyToPublish ? "eBay approved this offer for publication." : "Review the eBay messages below.",
        validatedFingerprint: ebayBatchOfferFingerprint(reviewed, draft.sharedDefaults),
        verification,
      }, true);
    } catch (error) {
      updateOffer(offer.id, {
        status: "needs_changes",
        statusMessage: error instanceof Error ? error.message : "This offer could not be reviewed.",
        validatedFingerprint: null,
        verification: null,
      }, true);
    } finally {
      setBusyOfferId(null);
    }
  }

  async function validateAll() {
    for (const offer of draft.offers) {
      if (offer.status === "published" || ebayBatchOfferIsReady(offer, draft.sharedDefaults)) continue;
      await validateOffer(offer);
    }
  }

  async function publishQueue() {
    setQueueMessage(null);
    const planProblem = ebayCrossListingPlanProblem(draft.offers);
    if (planProblem) {
      setQueueMessage(planProblem);
      return;
    }
    if (!draft.manualSaleAcknowledged) {
      setQueueMessage("Confirm that you will manually end sibling listings after a sale before publishing this cross-list set.");
      return;
    }
    const publicationOrder = [...draft.offers].sort((left, right) => Number(left.kind === "bundle") - Number(right.kind === "bundle"));
    for (const offer of publicationOrder) {
      if (offer.status === "published") continue;
      const reviewCurrent = offer.verification?.readyToPublish
        && offer.validatedFingerprint === ebayBatchOfferFingerprint(offer, draft.sharedDefaults);
      if (!reviewCurrent) {
        setQueueMessage(`“${offer.title || "Untitled offer"}” needs Review before the queue can continue.`);
        return;
      }
      updateOffer(offer.id, { status: "publishing", statusMessage: "Publishing this offer…" }, true);
      setBusyOfferId(offer.id);
      try {
        const details = offerDetails(offer);
        const identity = publicationIdentity(offer);
        const result = offer.kind === "individual"
          ? await publishOffer.mutateAsync({ kind: "individual", details: details as EbayRouterInputs["validate"], identity })
          : offer.kind === "quantity"
            ? await publishOffer.mutateAsync({ kind: "quantity", details: details as EbayRouterInputs["validateQuantity"], identity })
            : await publishOffer.mutateAsync({ kind: "bundle", details: details as EbayRouterInputs["validateLot"], identity });
        updateOffer(offer.id, {
          publishedItemId: result.itemId,
          publishedUrl: result.listingUrl,
          status: "published",
          statusMessage: result.recovered ? "Recovered the existing eBay offer safely." : "Published successfully.",
        }, true);
        await collectionChanged("listing");
      } catch (error) {
        updateOffer(offer.id, {
          status: "failed",
          statusMessage: error instanceof Error ? error.message : "This offer could not be published.",
        }, true);
        setQueueMessage("The queue stopped at the failed offer. Successful offers remain recorded; Retry continues from here.");
        setBusyOfferId(null);
        return;
      }
    }
    setBusyOfferId(null);
    setQueueMessage("Every listing in this cross-list set has been published and recorded.");
  }

  async function uploadPhotos(offer: EbayBatchOffer, files: File[]) {
    setBusyOfferId(offer.id);
    setPhotoMessage(null);
    try {
      const added: EbayBatchPhoto[] = [];
      for (const file of files.slice(0, Math.max(0, 12 - offer.photos.length))) {
        const body = new FormData();
        body.append("copyId", offer.copyIds[0]!);
        body.append("image", file);
        const response = await fetch("/api/ebay/image", { body, method: "POST" });
        const result = await response.json() as { archiveKey?: string; ebayUrl?: string; message?: string; previewUrl?: string };
        if (!response.ok || !result.archiveKey || !result.ebayUrl || !result.previewUrl) throw new Error(result.message || "A photo could not be uploaded.");
        added.push({ archiveKey: result.archiveKey, ebayUrl: result.ebayUrl, previewUrl: result.previewUrl });
      }
      updateOffer(offer.id, { photos: [...offer.photos, ...added] });
    } catch (error) {
      setPhotoMessage(error instanceof Error ? error.message : "Photos could not be uploaded.");
    } finally {
      setBusyOfferId(null);
    }
  }

  async function importSavedPhotos(offer: EbayBatchOffer) {
    setBusyOfferId(offer.id);
    setPhotoMessage(null);
    try {
      const copyIds = offer.copyIds.join(",");
      const response = await fetch(`/api/inventory/card-images?copyIds=${encodeURIComponent(copyIds)}`);
      const result = await response.json() as { imagesByCopy?: Record<string, InventoryPhoto[]>; message?: string };
      if (!response.ok) throw new Error(result.message || "Saved Copy photos could not be loaded.");
      const planned = offer.kind === "bundle"
        ? planEbayLotSavedPhotoImports({ copyIds: offer.copyIds, existingPhotos: offer.photos, imagesByCopy: result.imagesByCopy ?? {} })
        : planHomogeneousQuantitySavedPhotos({ copyIds: offer.copyIds, existingPhotos: offer.photos, imagesByCopy: result.imagesByCopy ?? {} });
      const added: EbayBatchPhoto[] = [];
      for (const photo of planned) {
        const body = new FormData();
        body.append("copyId", offer.copyIds[0]!);
        body.append("inventoryCopyId", "copyId" in photo ? photo.copyId : "");
        body.append("inventoryKey", photo.key);
        body.append("stageOnly", "true");
        const staged = await fetch("/api/ebay/image", { body, method: "POST" });
        const stagedResult = await staged.json() as { archiveKey?: string; message?: string; previewUrl?: string };
        if (!staged.ok || !stagedResult.archiveKey || !stagedResult.previewUrl) throw new Error(stagedResult.message || "A saved photo could not be prepared.");
        const sourceCopyId = "copyId" in photo ? photo.copyId : offer.copyIds[0]!;
        added.push({
          archiveKey: stagedResult.archiveKey,
          ebayUrl: null,
          previewUrl: stagedResult.previewUrl,
          sourceInventoryCopyId: sourceCopyId,
          sourceInventoryKey: photo.key,
        });
      }
      updateOffer(offer.id, { photos: [...offer.photos, ...added].slice(0, 12) });
      setPhotoMessage(added.length ? `${added.length} saved ${added.length === 1 ? "photo" : "photos"} prepared from every selected Copy.` : "No additional saved Copy photos were available.");
    } catch (error) {
      setPhotoMessage(error instanceof Error ? error.message : "Saved Copy photos could not be prepared.");
    } finally {
      setBusyOfferId(null);
    }
  }

  async function removePhoto(offer: EbayBatchOffer, archiveKey: string) {
    setBusyOfferId(offer.id);
    try {
      const response = await fetch("/api/ebay/image", {
        body: JSON.stringify({ archiveKey, copyId: offer.copyIds[0] }),
        headers: { "content-type": "application/json" },
        method: "DELETE",
      });
      if (!response.ok) return false;
      updateOffer(offer.id, { photos: offer.photos.filter((photo) => photo.archiveKey !== archiveKey) });
      return true;
    } finally {
      setBusyOfferId(null);
    }
  }

  if (source.status === "loading" || sessionPending || !lifecycle.hydrated) {
    return <div className="grid min-h-72 place-items-center rounded-xl border border-zinc-300 bg-white font-bold" role="status">Restoring this tab&apos;s cross-list draft…</div>;
  }
  if (source.status === "error") {
    return <section className="rounded-xl border border-rose-300 bg-rose-50 p-6 text-rose-950" role="alert"><h2 className="text-xl font-black">Inventory could not be loaded</h2><p className="mt-2 text-sm font-medium">{source.errorMessage || "Nothing has been changed. Retry Records before planning offers."}</p><button className="mt-4 min-h-11 rounded-md border border-rose-400 bg-white px-4 font-bold" onClick={() => void source.refresh()} type="button">Retry inventory</button></section>;
  }
  if (source.mode !== "live") {
    return <section className="rounded-xl border border-zinc-300 bg-white p-6 text-center"><ListChecks className="mx-auto size-8 text-zinc-400" /><h2 className="mt-3 text-xl font-black">Cross-list creation is available in live Records</h2><p className="mx-auto mt-2 max-w-xl text-sm font-medium text-zinc-600">Preview mode cannot prepare or publish eBay offers.</p></section>;
  }
  if (ebayStatus.isError) {
    return <section className="rounded-xl border border-rose-300 bg-rose-50 p-6 text-center text-rose-950" role="alert"><h2 className="text-xl font-black">eBay readiness could not be checked</h2><p className="mt-2 text-sm font-medium">Check your connection before starting a cross-list set.</p><button className="mt-4 min-h-11 rounded-md border border-rose-400 bg-white px-4 font-bold" onClick={() => void ebayStatus.refetch()} type="button">Retry eBay check</button></section>;
  }
  if (!ebayStatus.data?.capability.ebay.allowed) {
    return <section className="rounded-xl border border-amber-300 bg-amber-50 p-6 text-center text-amber-950"><h2 className="text-xl font-black">Cross-list creation unavailable</h2><p className="mx-auto mt-2 max-w-xl text-sm font-medium">{ebayStatus.data ? `${ebayStatus.data.capability.ebay.message} ${ebayStatus.data.capability.ebay.remedy}` : "Checking seller permission…"}</p><Link className="mt-4 inline-flex min-h-11 items-center rounded-md bg-zinc-950 px-4 font-bold text-white" href="/ebay">Open eBay settings</Link></section>;
  }

  const sharedProblem = sharedDefaultsProblem(draft.sharedDefaults);
  const planProblem = ebayCrossListingPlanProblem(draft.offers);
  const canLeaveSelection = draft.selectedCopyIds.length >= 2 && selectedStandaloneCount >= 2;
  const canReviewPlan = draft.offers.length > 0 && !planProblem && !sharedProblem;
  const reviewCurrent = draft.offers.every((offer) => offer.status === "published" || offer.verification?.readyToPublish && offer.validatedFingerprint === ebayBatchOfferFingerprint(offer, draft.sharedDefaults));

  return <section aria-labelledby="batch-title" className="grid gap-4">
    <header>
      <div><p className="text-xs font-bold uppercase tracking-[0.14em] text-[#8a1f2d]">Cross-list one card</p><h1 className="mt-1 text-2xl font-black" id="batch-title">Create the full lot and its standalone offers</h1><p className="mt-2 max-w-3xl text-sm font-medium leading-6 text-zinc-600">Choose several exact Copies of one card. You will get one mixed-rarity lot plus policy-safe individual or quantity listings.</p></div>
    </header>
    <WizardProgress labels={["Select Copies", "Plan offers", "Review & publish"]} step={draft.step} />

    <StepPanel step={draft.step}>
      {draft.step === 1 ? <FormSection description="Choose at least two available physical Copies of the same card name. After the first choice, the picker narrows to that card." number={1} title="Choose one card's Copies">
        <CopySelectionPicker
          candidates={selectableCardCopies}
          emptyDescription="Record or restore an available physical Copy before creating a cross-list set."
          emptyTitle="No eligible Copies are available"
          getCopyCaption={(item) => `Copy ${copyShortReference(item.copy.id)}`}
          onToggle={(copyId, checked) => updateDraft({ manualSaleAcknowledged: false, selectedCopyIds: checked ? [...draft.selectedCopyIds, copyId] : draft.selectedCopyIds.filter((id) => id !== copyId) })}
          selectedIds={draft.selectedCopyIds}
        />
        <p aria-live="polite" className="mt-4 rounded-md bg-zinc-50 px-3 py-2 text-sm font-bold text-zinc-700">{draft.selectedCopyIds.length} exact {draft.selectedCopyIds.length === 1 ? "Copy" : "Copies"} selected{selectedCardName ? ` for ${selectedCardName}` : ""}. {draft.selectedCopyIds.length < 2 ? "Choose at least two to create a full lot." : selectedStandaloneCount < 2 ? "Choose another distinct rarity, Printing, edition, or condition." : `Ready to create one full lot plus ${selectedStandaloneCount} standalone listings.`}</p>
      </FormSection> : null}

      {draft.step === 2 ? <div className="grid gap-4">
        <FormSection description="English, Surrey, and GU21 6DE are applied automatically. These values flow into every offer, with overrides available when needed." number={1} title="Shared defaults">
          <SharedDefaultsFields defaults={draft.sharedDefaults} onChange={updateSharedDefaults} />
          {sharedProblem ? <p className="mt-3 text-sm font-bold text-rose-700" role="alert">{sharedProblem}</p> : null}
        </FormSection>
        <FormSection description="The full lot contains every selected Copy. Identical standalone Copies are consolidated into one quantity listing to follow eBay's duplicate-listing policy." number={2} title={`${draft.offers.length} listings will be created`}>
          <div className="rounded-lg border border-sky-300 bg-sky-50 p-3 text-sky-950"><p className="text-sm font-black">One linked cross-list set</p><p className="mt-1 text-xs font-medium leading-5">Every Copy appears in the full lot and in exactly one standalone offer. This shared membership is intentional.</p></div>
          {planProblem ? <p className="mt-3 text-sm font-bold text-rose-700" role="alert">{planProblem}</p> : null}
          <div className="mt-4 grid gap-3">{draft.offers.map((offer, index) => {
            const expanded = editingOfferId === offer.id;
            return <OfferCard
              candidates={candidates}
              expanded={expanded}
              key={offer.id}
              number={index + 1}
              offer={offer}
              onEdit={() => setEditingOfferId((current) => current === offer.id ? null : offer.id)}
            >
              {expanded ? <OfferEditor
                busy={busyOfferId === offer.id}
                candidates={candidates}
                imageArchiveConfigured={ebayStatus.data?.imageArchiveConfigured === true}
                offer={offer}
                onImportSaved={() => void importSavedPhotos(offer)}
                onRemovePhoto={(archiveKey) => removePhoto(offer, archiveKey)}
                onReorderPhotos={async (ids) => { updateOffer(offer.id, { photos: ids.flatMap((id) => offer.photos.find((photo) => photo.archiveKey === id) ?? []) }); return true; }}
                onUpdate={(update) => updateOffer(offer.id, update)}
                onUpload={(files) => uploadPhotos(offer, files)}
                photoMessage={photoMessage}
                shared={draft.sharedDefaults}
              /> : null}
            </OfferCard>;
          })}</div>
        </FormSection>
      </div> : null}

      {draft.step === 3 ? <div className="grid gap-4">
        <section className="rounded-lg border border-zinc-300 bg-white p-4 shadow-sm sm:p-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><h2 className="text-lg font-black">Independent offer reviews</h2><p className="mt-1 text-sm font-medium text-zinc-600">Review calls eBay but does not publish. An edit makes only that offer need Review again.</p></div><button className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-4 text-sm font-bold disabled:opacity-50" disabled={Boolean(busyOfferId)} onClick={() => void validateAll()} type="button">{busyOfferId ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> : <Sparkles className="size-4" />}Review remaining</button></div>
          <div className="mt-4 grid gap-3">{draft.offers.map((offer, index) => <ReviewOfferCard busy={busyOfferId === offer.id} candidates={candidates} key={offer.id} number={index + 1} offer={offer} onReview={() => void validateOffer(offer)} shared={draft.sharedDefaults} />)}</div>
        </section>
        <section aria-live="polite" className="rounded-lg border border-zinc-300 bg-white p-4 shadow-sm sm:p-5"><div className="flex items-start gap-3"><PackageCheck className="mt-0.5 size-6 shrink-0 text-[#8a1f2d]" /><div><h2 className="text-lg font-black">Sequential publication queue</h2><p className="mt-1 text-sm font-medium text-zinc-600">Standalone offers publish first and the full lot publishes last. Successful offers stay recorded if a later offer fails.</p></div></div><label className="mt-4 flex cursor-pointer items-start gap-3 rounded-md border border-amber-400 bg-amber-50 p-3 text-sm font-bold text-amber-950"><input checked={draft.manualSaleAcknowledged} className="mt-1 size-4" onChange={(event) => updateDraft({ manualSaleAcknowledged: event.target.checked })} type="checkbox" /><span><span className="block font-black">Manual sale protection required for now</span><span className="mt-1 block font-medium leading-5">Automatic sibling takedown is not part of this change. If any listing sells, you must manually end every other active listing containing that exact Copy.</span></span></label>{queueMessage ? <p className={`mt-4 rounded-md px-3 py-2 text-sm font-bold ${allPublished ? "bg-emerald-50 text-emerald-900" : "bg-amber-50 text-amber-950"}`} role={allPublished ? "status" : "alert"}>{queueMessage}</p> : null}<button className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-[#8a1f2d] px-5 text-sm font-black text-white transition hover:bg-[#711826] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto" disabled={queuePending || allPublished || Boolean(planProblem) || !draft.manualSaleAcknowledged || !reviewCurrent} onClick={() => void publishQueue()} type="button">{queuePending ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> : <ListChecks className="size-4" />}{draft.offers.some((offer) => offer.status === "failed" || offer.status === "published") ? "Retry unpublished listings" : "Publish cross-list set"}</button>{!reviewCurrent && !allPublished ? <p className="mt-2 text-xs font-bold text-zinc-600">Review every unpublished offer before starting the queue.</p> : null}</section>
      </div> : null}
    </StepPanel>

    <WizardActions
      confirmDisabled
      finalLabel="Publish from the queue above"
      nextDisabled={draft.step === 1 ? !canLeaveSelection : !canReviewPlan}
      onBack={() => updateDraft({ step: Math.max(1, draft.step - 1) as 1 | 2 | 3 })}
      onNext={() => draft.step === 1 ? rebuildPlan() : updateDraft({ step: 3 })}
      pending={queuePending}
      step={draft.step}
      totalSteps={3}
    />
    {allPublished ? <button className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-4 text-sm font-bold" onClick={() => { if (window.confirm("Start another cross-list set? The completed plan will be cleared from this tab.")) lifecycle.discard(); }} type="button"><RotateCcw className="size-4" />Cross-list another card</button> : null}
  </section>;
}

function SharedDefaultsFields({ defaults, onChange }: { defaults: EbayBatchSharedDefaults; onChange: (update: Partial<EbayBatchSharedDefaults>) => void }) {
  return <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
    <label><span className="text-sm font-bold text-zinc-700">Dispatch time</span><select className={fieldClass} onChange={(event) => onChange({ dispatchTimeMax: event.target.value })} value={defaults.dispatchTimeMax}>{Array.from({ length: 30 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1} {index === 0 ? "working day" : "working days"}</option>)}</select></label>
    <label><span className="text-sm font-bold text-zinc-700">Shipping service</span><select className={fieldClass} onChange={(event) => onChange({ shippingService: event.target.value as EbayDeliveryServiceCode })} value={defaults.shippingService}>{ebayDeliveryServices.map((service) => <option key={service.code} value={service.code}>{service.label}</option>)}</select></label>
    <label><span className="text-sm font-bold text-zinc-700">Shipping cost</span><span className="relative block"><span className="pointer-events-none absolute bottom-0 left-3 top-1 flex items-center font-bold text-zinc-500">£</span><input className={`${fieldClass} pl-7`} inputMode="decimal" onChange={(event) => onChange({ shippingCost: event.target.value })} value={defaults.shippingCost} /></span></label>
    <label className="sm:col-span-2 lg:col-span-3"><span className="text-sm font-bold text-zinc-700">Reusable description text</span><textarea className={textAreaClass} onChange={(event) => onChange({ reusableDescription: event.target.value })} value={defaults.reusableDescription} /><span className="mt-1 block text-xs font-medium text-zinc-500">Appended to every offer-specific description.</span></label>
  </div>;
}

function OfferCard({ candidates, children, expanded, number, offer, onEdit }: { candidates: PlannerCopy[]; children: ReactNode; expanded: boolean; number: number; offer: EbayBatchOffer; onEdit: () => void }) {
  const editorId = `batch-offer-editor-${offer.id}`;
  return <article className={`rounded-lg border bg-white p-4 transition-colors ${expanded ? "border-zinc-950 shadow-sm" : "border-zinc-300"}`}><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="rounded-md bg-zinc-950 px-2 py-1 text-xs font-black text-white">Listing {number}</span><span className="text-xs font-bold text-zinc-600">{offerKindLabel(offer.kind)}</span><span className={`rounded-md border px-2 py-1 text-xs font-black ${statusTone[offer.status]}`}>{ebayBatchStatusLabel(offer.status)}</span></div><h3 className="mt-2 break-words font-black">{offer.title || "Untitled offer"}</h3><p className="mt-1 text-sm font-medium text-zinc-600">{offer.copyIds.length} exact {offer.copyIds.length === 1 ? "Copy" : "Copies"} · £{offer.price || "—"}</p><p className="mt-1 text-xs font-bold text-sky-800">{offer.kind === "bundle" ? "Full lot containing every selected Copy" : "Standalone offer · its Copies also appear in the full lot"}</p></div><button aria-controls={editorId} aria-expanded={expanded} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-zinc-300 px-3 text-sm font-bold transition-colors hover:bg-zinc-50" onClick={onEdit} type="button">{expanded ? "Close details" : "Edit details"}<ChevronDown aria-hidden="true" className={`size-4 transition-transform motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`} /></button></div><ul className="mt-3 flex flex-wrap gap-2">{offer.copyIds.map((copyId) => { const candidate = plannedCopy(copyId, candidates); const rarity = candidate?.target.rarity; return <li className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs font-bold text-zinc-700" key={copyId} title={rarity || "Unknown rarity"}>{rarityAbbreviation(rarity) || "—"} · {candidate?.printing.setCode || "Unknown set"} · #{copyShortReference(copyId)}</li>; })}</ul>{children}</article>;
}

function OfferEditor({ busy, candidates, imageArchiveConfigured, offer, onImportSaved, onRemovePhoto, onReorderPhotos, onUpdate, onUpload, photoMessage, shared }: { busy: boolean; candidates: PlannerCopy[]; imageArchiveConfigured: boolean; offer: EbayBatchOffer; onImportSaved: () => void; onRemovePhoto: (archiveKey: string) => Promise<boolean>; onReorderPhotos: (ids: string[]) => Promise<boolean>; onUpdate: (update: Partial<EbayBatchOffer>) => void; onUpload: (files: File[]) => Promise<void>; photoMessage: string | null; shared: EbayBatchSharedDefaults }) {
  const first = plannedCopy(offer.copyIds[0]!, candidates);
  const effective = effectiveEbayBatchDefaults(shared, offer.overrideDefaults);
  const toggleOverride = () => onUpdate({
    overrideDefaults: offer.overrideDefaults ? null : {
      dispatchTimeMax: shared.dispatchTimeMax,
      shippingCost: shared.shippingCost,
      shippingService: shared.shippingService,
    },
  });
  const updateOverride = (update: Partial<EbayBatchOfferOverride>) => onUpdate({
    overrideDefaults: { ...(offer.overrideDefaults ?? effective), ...update } as EbayBatchOfferOverride,
  });

  return <section aria-label={`Edit ${offer.title}`} className="mt-4 border-t border-zinc-200 pt-4" id={`batch-offer-editor-${offer.id}`}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-xs font-bold uppercase tracking-[0.12em] text-[#8a1f2d]">Editing {offerKindLabel(offer.kind)}</p><h3 className="mt-1 text-lg font-black">Offer-specific details</h3></div>
      <span className="rounded-md border border-zinc-300 bg-zinc-50 px-2 py-1 text-xs font-bold">Shared defaults remain active</span>
    </div>
    <div className="mt-4 grid gap-4 sm:grid-cols-2">
      <label className="sm:col-span-2"><span className="text-sm font-bold text-zinc-700">Title</span><input className={fieldClass} maxLength={80} onChange={(event) => onUpdate({ title: event.target.value })} value={offer.title} /><span className="mt-1 block text-xs font-medium text-zinc-500">{offer.title.length}/80</span></label>
      <label><span className="text-sm font-bold text-zinc-700">Price</span><span className="relative block"><span className="pointer-events-none absolute bottom-0 left-3 top-1 flex items-center font-bold text-zinc-500">£</span><input className={`${fieldClass} pl-7`} inputMode="decimal" onChange={(event) => onUpdate({ price: event.target.value })} value={offer.price} /></span></label>
      <div><span className="text-sm font-bold text-zinc-700">Condition data</span><p className="mt-1 min-h-11 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm font-semibold">{offer.kind === "bundle" ? "Mixed-card lot category condition" : first?.copy.condition || "Not available"}</p></div>
      <label className="sm:col-span-2"><span className="text-sm font-bold text-zinc-700">Offer description</span><textarea className={textAreaClass} onChange={(event) => onUpdate({ description: event.target.value })} value={offer.description} /><span className="mt-1 block text-xs font-medium text-zinc-500">The reusable shared text is appended during Review.</span></label>
    </div>
    <details className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
      <summary className="min-h-11 cursor-pointer py-2 text-sm font-black">Advanced item-specific overrides</summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">{Object.entries(offer.itemSpecifics).map(([key, value]) => <label key={key}><span className="text-xs font-bold capitalize text-zinc-600">{key.replace(/([A-Z])/g, " $1")}</span><input className={fieldClass} onChange={(event) => onUpdate({ itemSpecifics: { ...offer.itemSpecifics, [key]: event.target.value } })} value={value} /></label>)}</div>
    </details>
    <label className="mt-4 flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-bold"><input checked={Boolean(offer.overrideDefaults)} onChange={toggleOverride} type="checkbox" />Override shared delivery defaults for this offer</label>
    {offer.overrideDefaults ? <div className="mt-3 rounded-lg border border-sky-300 bg-sky-50 p-3">
      <p className="text-xs font-black uppercase tracking-[0.12em] text-sky-900">Offer override</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label><span className="text-xs font-bold">Dispatch days</span><input className={fieldClass} inputMode="numeric" onChange={(event) => updateOverride({ dispatchTimeMax: event.target.value })} value={offer.overrideDefaults.dispatchTimeMax} /></label>
        <label><span className="text-xs font-bold">Shipping service</span><select className={fieldClass} onChange={(event) => updateOverride({ shippingService: event.target.value as EbayDeliveryServiceCode })} value={offer.overrideDefaults.shippingService}>{ebayDeliveryServices.map((service) => <option key={service.code} value={service.code}>{service.label}</option>)}</select></label>
        <label><span className="text-xs font-bold">Shipping cost</span><input className={fieldClass} inputMode="decimal" onChange={(event) => updateOverride({ shippingCost: event.target.value })} value={offer.overrideDefaults.shippingCost} /></label>
      </div>
    </div> : null}
    <div className="mt-4"><CardPhotoManager canManage cardName={offer.title || "eBay offer"} changing={busy} configured={imageArchiveConfigured} description="Upload offer photos or aggregate saved inventory photos from every selected Copy." emptyText="Add at least one photo before Review." error={photoMessage ?? undefined} eyebrow="Offer photos" id={`batch-photos-${offer.id}`} images={offer.photos.map((photo) => ({ id: photo.archiveKey, previewUrl: photo.previewUrl }))} loading={false} maxImages={12} message={offer.photos.some((photo) => !photo.ebayUrl) ? "Prepared saved photos will be sent to eBay during Review." : null} onRemove={onRemovePhoto} onReorder={onReorderPhotos} onUpload={onUpload} previewSubtitle="Prepared for this offer" removalDescription="This removes the photo from this offer draft only." removalTitle="Remove offer photo?" reordering={false} secondaryAction={{ disabled: busy, icon: Images, label: "Use saved Copy photos", onClick: onImportSaved }} storageWarning="Inventory photos remain attached to their exact physical Copies." title="Photos" uploading={busy} /></div>
  </section>;
}

function ReviewOfferCard({ busy, candidates, number, offer, onReview, shared }: { busy: boolean; candidates: PlannerCopy[]; number: number; offer: EbayBatchOffer; onReview: () => void; shared: EbayBatchSharedDefaults }) {
  const current = offer.verification?.readyToPublish && offer.validatedFingerprint === ebayBatchOfferFingerprint(offer, shared);
  return <article className="rounded-lg border border-zinc-300 bg-white p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="rounded-md bg-zinc-950 px-2 py-1 text-xs font-black text-white">Offer {number}</span><span className={`rounded-md border px-2 py-1 text-xs font-black ${statusTone[offer.status]}`}>{ebayBatchStatusLabel(offer.status)}</span></div><h3 className="mt-2 break-words font-black">{offer.title}</h3><p className="mt-1 text-sm font-medium text-zinc-600">{offerKindLabel(offer.kind)} · {offer.copyIds.length} exact {offer.copyIds.length === 1 ? "Copy" : "Copies"} · £{offer.price}</p><p className="mt-1 text-xs font-bold text-zinc-500">{offer.copyIds.map((copyId) => plannedCopy(copyId, candidates)?.target.name ?? copyShortReference(copyId)).join(" · ")}</p></div>{offer.status === "published" && offer.publishedUrl ? <a className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-emerald-700 px-4 text-sm font-bold text-white" href={offer.publishedUrl} rel="noreferrer" target="_blank">Open on eBay <ExternalLink className="size-4" /></a> : <button className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-4 text-sm font-bold disabled:opacity-50" disabled={busy} onClick={onReview} type="button">{busy ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> : current ? <CheckCircle2 className="size-4 text-emerald-700" /> : <Sparkles className="size-4" />}{current ? "Review again" : "Review with eBay"}</button>}</div>{offer.statusMessage ? <p className={`mt-3 rounded-md px-3 py-2 text-sm font-bold ${offer.status === "failed" || offer.status === "needs_changes" ? "bg-rose-50 text-rose-900" : offer.status === "published" ? "bg-emerald-50 text-emerald-900" : "bg-zinc-50 text-zinc-700"}`} role={offer.status === "failed" || offer.status === "needs_changes" ? "alert" : "status"}>{offer.statusMessage}</p> : null}{offer.verification?.errors.length ? <ul className="mt-3 grid gap-2">{offer.verification.errors.map((error, index) => <li className="rounded-md bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-950" key={`${error.code}-${index}`}>{error.message || "eBay returned a review message."}</li>)}</ul> : null}</article>;
}

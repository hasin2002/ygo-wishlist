"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  ImagePlus,
  PencilLine,
  RotateCcw,
  Send,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useSession } from "@/lib/auth-client";
import {
  ebayCardCategory,
  ebayDeliveryServices,
  ebayListingLanguages,
  type EbayDeliveryServiceCode,
  type EbayListingItemSpecifics,
  type EbayListingLanguage,
} from "@/lib/ebay-listing-options";
import { resolveEbayListingContext } from "@/lib/records/ebay-listing-context";
import { ebaySoldListingsUrl } from "@/lib/records/ebay-sold-listings";
import { useFormDraftLifecycle } from "@/lib/records/use-form-draft-lifecycle";
import { hasFields, isOneOf, isRecord, isString, isStringRecord } from "@/lib/records/form-draft-validators";
import { individualListingDraftResumeHref } from "@/lib/records/individual-listing-draft";
import { ebaySettingsHref } from "@/lib/ebay-connection-state";
import {
  inventoryCardDetailHref,
  inventoryCopySellHref,
  parseInventoryListState,
} from "@/lib/records/inventory-route-state";
import {
  cardConditionOptions,
  isCardCondition,
  type CardCopy,
  type CardPrinting,
  type CopyEbayExposureState,
  type WishlistTarget,
} from "@/lib/records/types";
import { copyShortReference } from "@/lib/records/copy-display";
import { useRecordsDataSource } from "@/components/records/records-preview-provider";
import { DraftConflictDialog } from "@/components/records/form-draft-ui";
import { CardPhotoManager } from "@/components/records/card-photo-manager";
import { ebayOffersDialogEventName } from "@/components/records/ebay-copy-exposure";
import {
  EbayListingStatusPanel,
} from "@/components/records/ebay-listing-status";
import { toEbayListingTimestamp } from "@/components/records/ebay-listing-timestamp";
import { trpc } from "@/trpc/client";
import {
  collectionRefreshFailureMessage,
  useCollectionChange,
} from "@/lib/use-collection-change";

type ListingPhoto = { archiveKey: string; ebayUrl: string; previewUrl: string };
type InventoryPhoto = { key: string; previewUrl: string };
type ConditionId = "400010" | "400015" | "400016" | "400017";
type ListingForm = {
  categoryId: typeof ebayCardCategory.id;
  cardConditionDescriptorValueId: ConditionId;
  description: string;
  dispatchTimeMax: string;
  images: ListingPhoto[];
  itemSpecifics: EbayListingItemSpecifics;
  language: EbayListingLanguage;
  location: string;
  postalCode: string;
  price: string;
  shippingCost: string;
  shippingService: EbayDeliveryServiceCode;
  title: string;
};
type FieldKey =
  | "title"
  | "price"
  | "dispatchTimeMax"
  | "shippingCost"
  | "description"
  | "location"
  | "postalCode"
  | "images"
  | "itemSpecifics";
type FieldErrors = Partial<Record<FieldKey, string>>;
type EbayVerification = {
  errors: Array<{ code: string | null; message: string | null; severity: string | null }>;
  fees: Array<{ amount: number; currency: string; name: string | null }>;
  readyToPublish: boolean;
};

const categoryId = ebayCardCategory.id;
const defaultDeliveryService = ebayDeliveryServices[0];
const fieldIds: Record<FieldKey, string> = {
  title: "ebay-title",
  price: "ebay-price",
  dispatchTimeMax: "ebay-dispatch",
  shippingCost: "ebay-shipping-cost",
  description: "ebay-description",
  location: "ebay-location",
  postalCode: "ebay-postcode",
  images: "ebay-images",
  itemSpecifics: "ebay-item-specifics",
};

function pence(value: string) {
  const parsed = Number(value.replace(/[£,\s]/g, ""));
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) : null;
}

function pounds(value: number | null) {
  return value === null ? "" : (value / 100).toFixed(2);
}

function conditionId(value: string): ConditionId {
  return cardConditionOptions.find((option) => option.value === value)?.ebayDescriptorValueId ?? "400010";
}

function editionAbbreviation(value: string) {
  if (/^1st edition$/i.test(value)) return "1st Ed";
  if (/^unlimited edition$/i.test(value)) return "Unlimited";
  if (/^limited edition$/i.test(value)) return "Limited";
  return value;
}

function conditionAbbreviation(value: string) {
  return ({
    "Near Mint": "NM",
    "Lightly Played": "LP",
    "Moderately Played": "MP",
    "Heavily Played": "HP",
  } as Record<string, string>)[value] ?? value;
}

function defaultTitle(target: WishlistTarget, printing: CardPrinting, copy: CardCopy) {
  const prefix = "Yu Gi Oh";
  const suffix = [
    target.rarity,
    printing.setCode || printing.setName,
    editionAbbreviation(target.edition),
    conditionAbbreviation(copy.condition),
  ].filter(Boolean).join(" ");
  const name = target.name.slice(0, Math.max(1, 80 - prefix.length - suffix.length - 2)).trim();
  return `${prefix} ${name} ${suffix}`.slice(0, 80);
}

function defaultDescription(target: WishlistTarget, printing: CardPrinting, copy: CardCopy) {
  return [
    `Yu-Gi-Oh! ${target.name}`,
    `Set: ${printing.setName || "Not specified"}${printing.setCode ? ` (${printing.setCode})` : ""}`,
    `Rarity: ${target.rarity}`,
    `Edition: ${target.edition}`,
    `Condition: ${copy.condition}`,
    "Please review all photos carefully before buying.",
    "You are buying the card described in the title and shown in the images.",
    "Please feel free to contact me with any questions or to request additional images.",
  ].join("\n");
}

function featureFromEdition(edition: string) {
  const value = edition.toLowerCase();
  if (value.includes("limited")) return "Limited Edition";
  if (value.includes("unlimited")) return "Unlimited Edition";
  return "1st Edition";
}

function initialForm(target: WishlistTarget, printing: CardPrinting, copy: CardCopy): ListingForm {
  return {
    categoryId,
    cardConditionDescriptorValueId: conditionId(copy.condition),
    description: defaultDescription(target, printing, copy),
    dispatchTimeMax: "3",
    images: [],
    itemSpecifics: {
      cardNumber: printing.setCode,
      cardSize: "Japanese",
      features: featureFromEdition(target.edition),
      game: "Yu-Gi-Oh! TCG",
      manufacturer: "Konami",
      rarity: target.rarity,
      setName: printing.setName,
    },
    language: "English",
    location: "Surrey",
    postalCode: "GU21 6DE",
    price: "",
    shippingCost: pounds(defaultDeliveryService.suggestedCostPence),
    shippingService: defaultDeliveryService.code,
    title: defaultTitle(target, printing, copy),
  };
}

function isListingPhoto(value: unknown): value is ListingPhoto {
  return isRecord(value)
    && isString(value.archiveKey)
    && isString(value.ebayUrl)
    && isString(value.previewUrl);
}

function isListingForm(value: unknown): value is ListingForm {
  if (!isRecord(value) || !hasFields(value, [
    "categoryId", "cardConditionDescriptorValueId", "description", "dispatchTimeMax", "images", "itemSpecifics",
    "language", "location", "postalCode", "price", "shippingCost", "shippingService", "title",
  ])) return false;
  const specifics = value.itemSpecifics;
  return value.categoryId === categoryId
    && isOneOf(value.cardConditionDescriptorValueId, ["400010", "400015", "400016", "400017"] as const)
    && isString(value.description)
    && isString(value.dispatchTimeMax)
    && Array.isArray(value.images)
    && value.images.every(isListingPhoto)
    && isStringRecord(specifics)
    && ["cardNumber", "cardSize", "features", "game", "manufacturer", "rarity", "setName"].every((field) => field in specifics)
    && isOneOf(value.language, ebayListingLanguages)
    && isString(value.location)
    && isString(value.postalCode)
    && isString(value.price)
    && isString(value.shippingCost)
    && isOneOf(value.shippingService, ebayDeliveryServices.map((service) => service.code))
    && isString(value.title);
}

function validateForm(form: ListingForm): FieldErrors {
  const errors: FieldErrors = {};
  const price = pence(form.price);
  const postage = pence(form.shippingCost);
  const dispatch = Number(form.dispatchTimeMax);
  const specifics = Object.values(form.itemSpecifics);
  if (!form.title.trim() || form.title.trim().length > 80) errors.title = "Enter a title of no more than 80 characters.";
  if (price === null || price < 1 || price > 10_000_000) errors.price = "Enter a price between £0.01 and £100,000.";
  if (!Number.isInteger(dispatch) || dispatch < 1 || dispatch > 30) errors.dispatchTimeMax = "Enter a whole number from 1 to 30.";
  if (postage === null || postage > 100_000) errors.shippingCost = "Enter a postage cost up to £1,000.";
  if (form.description.trim().length < 20 || form.description.trim().length > 4_000) errors.description = "Enter a description between 20 and 4,000 characters.";
  if (form.location.trim().length === 1 || form.location.trim().length > 80) errors.location = "Enter a full town or city, or leave it blank.";
  if (form.postalCode.trim().length < 2 || form.postalCode.trim().length > 16) errors.postalCode = "Enter the item location postcode.";
  if (!form.images.length || form.images.length > 12) errors.images = "Add between 1 and 12 listing photos.";
  if (specifics.some((value) => !value.trim() || value.trim().length > 65)) errors.itemSpecifics = "Complete every item specific using no more than 65 characters.";
  return errors;
}

function listingInput(copy: CardCopy, form: ListingForm) {
  return {
    copyId: copy.id,
    categoryId: form.categoryId,
    cardConditionDescriptorValueId: form.cardConditionDescriptorValueId,
    description: form.description.trim(),
    dispatchTimeMax: Number(form.dispatchTimeMax),
    images: form.images.map(({ archiveKey, ebayUrl }) => ({ archiveKey, ebayUrl })),
    itemSpecifics: Object.fromEntries(
      Object.entries(form.itemSpecifics).map(([key, value]) => [key, value.trim()]),
    ) as unknown as EbayListingItemSpecifics,
    language: form.language,
    location: form.location.trim(),
    postalCode: form.postalCode.trim(),
    pricePence: pence(form.price)!,
    shippingCostPence: pence(form.shippingCost)!,
    shippingService: form.shippingService,
    title: form.title.trim(),
  };
}

function feeName(value: string | null) {
  return value?.replace(/Fee$/, "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").trim() || "eBay fee";
}

function feeAmount(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-GB", { currency, style: "currency" }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function StatusCard({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  return (
    <section className="rounded-xl border border-zinc-300 bg-white p-6 text-center shadow-sm">
      <AlertTriangle className="mx-auto size-7 text-[#8a1f2d]" />
      <h2 className="mt-3 text-xl font-black">{title}</h2>
      <div className="mx-auto mt-2 max-w-xl text-sm font-medium leading-6 text-zinc-600">{children}</div>
    </section>
  );
}

export function EbayListingAction(props: {
  copy: CardCopy;
  enabled?: boolean;
  exposure: CopyEbayExposureState;
  printing: CardPrinting;
  target: WishlistTarget;
}) {
  const { copy, enabled = true, exposure, target } = props;
  const { data: session } = useSession();
  const searchParams = useSearchParams();
  const ebayStatus = trpc.ebay.status.useQuery(undefined, {
    enabled: enabled && Boolean(session),
    staleTime: 30_000,
  });
  if (!enabled) {
    return (
      <button className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-zinc-300 bg-zinc-100 px-3 text-sm font-bold text-zinc-500 disabled:cursor-not-allowed sm:w-auto" disabled title="Selling is available from a saved Copy in live records" type="button">
        <Send aria-hidden="true" className="size-4" />
        Sell on eBay
      </button>
    );
  }
  if (ebayStatus.isError) {
    return (
      <div className="grid min-w-0 w-full gap-2 sm:w-auto" role="alert">
        <p className="break-words text-xs font-semibold leading-5 text-rose-800">eBay readiness could not be checked.</p>
        <button className="inline-flex min-h-11 items-center justify-center rounded-md border border-rose-300 bg-white px-3 text-sm font-bold text-rose-900" onClick={() => void ebayStatus.refetch()} type="button">Retry eBay check</button>
      </div>
    );
  }
  const capability = ebayStatus.data?.capability;
  if (!capability?.ebay.allowed) {
    const reason = ebayStatus.isPending
      ? "Checking whether eBay selling is available…"
      : capability
        ? `${capability.ebay.message} ${capability.ebay.remedy}`
        : "Sign in with seller permission to manage eBay listings.";
    return (
      <div className="grid min-w-0 w-full gap-2 sm:w-auto">
        <button aria-describedby={`ebay-action-reason-${copy.id}`} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-zinc-300 bg-zinc-100 px-3 text-sm font-bold text-zinc-500 disabled:cursor-not-allowed sm:w-auto" disabled type="button">
          <Send aria-hidden="true" className="size-4" />
          Sell on eBay unavailable
        </button>
        <p className="break-words text-xs font-semibold leading-5 text-zinc-600" id={`ebay-action-reason-${copy.id}`} role="status">{reason}</p>
      </div>
    );
  }
  const blocked = exposure.action.disposition === "blocked";
  const reviewing = exposure.action.disposition === "review";
  const needsTakedown = exposure.action.code === "needs_takedown";
  if (!blocked && !reviewing && !isCardCondition(copy.condition)) {
    return (
      <span className="inline-flex min-h-11 w-full items-center rounded-md border border-amber-300 bg-amber-50 px-3 text-sm font-bold text-amber-900 sm:w-auto">
        Set a supported condition before selling
      </span>
    );
  }
  const state = parseInventoryListState(new URLSearchParams(searchParams.toString()));
  const href = inventoryCopySellHref(target.id, copy.id, state);
  return (
    <div className="grid min-w-0 w-full gap-2 sm:w-auto">
      {blocked ? (
        <>
          <button aria-describedby={`ebay-action-reason-${copy.id}`} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-zinc-300 bg-zinc-100 px-3 text-sm font-bold text-zinc-500 disabled:cursor-not-allowed sm:w-auto" disabled type="button">
            <Send aria-hidden="true" className="size-4" />
            Sell on eBay unavailable
          </button>
          <p className="break-words text-xs font-semibold leading-5 text-zinc-600" id={`ebay-action-reason-${copy.id}`}>{exposure.action.reason}</p>
        </>
      ) : (
        <>
          {needsTakedown ? (
            <button
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-bold text-zinc-800 transition hover:border-[#8a1f2d] hover:text-[#8a1f2d] focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-offset-2 sm:w-auto"
              onClick={() => window.dispatchEvent(new Event(ebayOffersDialogEventName(copy.id)))}
              type="button"
            >
              <AlertTriangle aria-hidden="true" className="size-4" />
              Review live offers
            </button>
          ) : (
            <Link
              className={`inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md px-3 text-sm font-bold transition focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-offset-2 sm:w-auto ${
                reviewing
                  ? "border border-zinc-300 bg-white text-zinc-800 hover:border-[#8a1f2d] hover:text-[#8a1f2d]"
                  : "bg-[#8a1f2d] text-white hover:bg-[#711826]"
              }`}
              href={href}
            >
              <Send aria-hidden="true" className="size-4" />
              {reviewing ? "Review eBay status" : "Sell on eBay"}
            </Link>
          )}
          {reviewing ? <p className="break-words text-xs font-semibold leading-5 text-zinc-600">{exposure.action.reason}</p> : null}
        </>
      )}
    </div>
  );
}

export function EbayListingPage({ copyId, targetId }: { copyId: string; targetId: string }) {
  const source = useRecordsDataSource();
  const searchParams = useSearchParams();
  const { data: session, isPending: sessionPending } = useSession();
  const listState = parseInventoryListState(new URLSearchParams(searchParams.toString()));
  const backHref = inventoryCardDetailHref(targetId, listState, copyId);
  const context = useMemo(
    () => resolveEbayListingContext(source.snapshot, targetId, copyId),
    [copyId, source.snapshot, targetId],
  );
  const canCheckEbayCapability = source.mode === "live" && Boolean(session);
  const collectionChanged = useCollectionChange();
  const status = trpc.ebay.status.useQuery(undefined, { enabled: canCheckEbayCapability });
  const eligibility = trpc.ebay.eligibility.useQuery({ copyId }, { enabled: status.data?.capability.ebay.allowed === true });

  async function refreshEbayStatus() {
    await eligibility.refetch();
    await collectionChanged("listing");
  }

  if (source.status === "loading" || sessionPending) {
    return <div className="grid min-h-72 place-items-center rounded-xl border border-zinc-300 bg-white font-bold" role="status">Preparing listing workspace…</div>;
  }
  if (source.status === "error") {
    return <StatusCard title="Records could not be loaded"><p>{source.errorMessage || "Nothing has been changed. Refresh and try again."}</p><button className="mt-4 min-h-11 rounded-md bg-zinc-950 px-4 font-bold text-white" onClick={() => void source.refresh()} type="button">Refresh Records</button></StatusCard>;
  }
  if (!context.ok) {
    return <StatusCard title="This Copy cannot be listed"><p>{context.message}</p><Link className="mt-4 inline-flex min-h-11 items-center rounded-md bg-zinc-950 px-4 font-bold text-white" href={backHref}>Back to inventory</Link></StatusCard>;
  }
  if (source.mode !== "live") {
    return <StatusCard title="Listing is unavailable in preview mode"><p>Switch to live Records data to create an eBay listing.</p><Link className="mt-4 inline-flex min-h-11 items-center rounded-md bg-zinc-950 px-4 font-bold text-white" href={backHref}>Back to inventory</Link></StatusCard>;
  }
  if (!session) {
    return <StatusCard title="Sign in to continue"><p>Your signed-in owner session is required before an eBay listing draft can be opened.</p><Link className="mt-4 inline-flex min-h-11 items-center rounded-md bg-zinc-950 px-4 font-bold text-white" href="/login">Sign in</Link></StatusCard>;
  }
  if (status.isPending) {
    return <div className="grid min-h-72 place-items-center rounded-xl border border-zinc-300 bg-white font-bold" role="status">Checking eBay readiness…</div>;
  }
  if (status.isError || !status.data) {
    return <StatusCard title="eBay readiness could not be checked"><p>Check your connection and try again.</p><button className="mt-4 min-h-11 rounded-md bg-zinc-950 px-4 font-bold text-white" onClick={() => void status.refetch()} type="button">Retry eBay check</button></StatusCard>;
  }
  if (!status.data?.capability.ebay.allowed) {
    const capability = status.data?.capability;
    return <StatusCard title={status.isPending ? "Checking eBay readiness" : "eBay listing unavailable"}><p>{status.isPending ? "Checking whether this account can create an eBay listing…" : capability ? `${capability.ebay.message} ${capability.ebay.remedy}` : "Sign in with seller permission to create an eBay listing."}</p>{capability && ["not_connected", "reconnect_required", "missing_scopes"].includes(capability.ebay.code) ? <Link className="mt-4 inline-flex min-h-11 items-center rounded-md bg-[#8a1f2d] px-4 font-bold text-white" href={ebaySettingsHref(backHref)}>Open eBay settings</Link> : null}</StatusCard>;
  }
  if (!isCardCondition(context.copy.condition)) {
    return <StatusCard title="Choose a supported condition"><p>Update this Copy to Near Mint, Lightly Played, Moderately Played, or Heavily Played before listing it.</p><Link className="mt-4 inline-flex min-h-11 items-center rounded-md bg-zinc-950 px-4 font-bold text-white" href={backHref}>Back to inventory</Link></StatusCard>;
  }
  if (eligibility.isLoading) {
    return <div className="grid min-h-72 place-items-center rounded-xl border border-zinc-300 bg-white font-bold" role="status">Checking eBay readiness…</div>;
  }
  if (eligibility.isError) {
    return <StatusCard title="eBay eligibility could not be checked"><p>Check your connection and try again.</p><button className="mt-4 min-h-11 rounded-md bg-zinc-950 px-4 font-bold text-white" onClick={() => void refreshEbayStatus()} type="button">Retry eligibility check</button></StatusCard>;
  }
  const eligibilityResult = eligibility.data;
  if (!eligibilityResult?.eligible) {
    const listing = eligibilityResult?.listing;
    if (listing) {
      return (
        <EbayListingStatusPanel
          copyState={context.copy.status}
          ebayUrl={listing.listingUrl}
          endedAt={toEbayListingTimestamp(listing.listingEndedAt)}
          errorMessage={eligibilityResult.status === "sync_unavailable"
            ? listing.lastError || "eBay could not confirm the current listing status."
            : listing.lastError}
          headingLevel={2}
          lastSyncedAt={toEbayListingTimestamp(listing.lastSyncedAt)}
          listedAt={toEbayListingTimestamp(listing.listingStartedAt)}
          listingState={listing.listingState}
          listingUpdatedAt={toEbayListingTimestamp(listing.updatedAt)}
          onReconnect={eligibilityResult.reconnectRequired
            ? () => window.location.assign(ebaySettingsHref(backHref))
            : undefined}
          onRefresh={() => { void refreshEbayStatus(); }}
          onReview={() => window.location.assign(backHref)}
          paidAt={toEbayListingTimestamp(listing.paidAt)}
          requiresReconnect={eligibilityResult.reconnectRequired}
          saleRecordId={listing.saleRecordId}
          saleState={listing.saleState}
          syncing={eligibility.isFetching}
          title="This Copy’s eBay status"
        />
      );
    }
    const message = eligibilityResult?.status === "active_listing"
      ? "This Copy already has an active eBay listing."
      : eligibilityResult?.status === "unavailable"
        ? "This Copy is no longer available to sell."
        : "This Copy is not available in your inventory.";
    return <StatusCard title="This Copy cannot be listed"><p>{message}</p><Link className="mt-4 inline-flex min-h-11 items-center rounded-md bg-zinc-950 px-4 font-bold text-white" href={backHref}>Back to inventory</Link></StatusCard>;
  }
  if (!("connection" in status.data) || !status.data.configured || !status.data.connection) {
    return <StatusCard title="Connect eBay to continue"><p>Your listing draft will be created here after the eBay seller connection is ready.</p><div className="mt-4 flex flex-wrap justify-center gap-2"><Link className="inline-flex min-h-11 items-center rounded-md bg-[#8a1f2d] px-4 font-bold text-white" href={ebaySettingsHref(backHref)}>Open eBay settings</Link><Link className="inline-flex min-h-11 items-center rounded-md border border-zinc-300 px-4 font-bold" href={backHref}>Back to inventory</Link></div></StatusCard>;
  }
  return (
    <EbayListingWorkspace
      backHref={backHref}
      copy={context.copy}
      imageArchiveConfigured={status.data.imageArchiveConfigured}
      ownerScope={session.user.id}
      printing={context.printing}
      target={context.target}
    />
  );
}

function EbayListingWorkspace({
  backHref,
  copy,
  imageArchiveConfigured,
  ownerScope,
  printing,
  target,
}: {
  backHref: string;
  copy: CardCopy;
  imageArchiveConfigured: boolean;
  ownerScope: string;
  printing: CardPrinting;
  target: WishlistTarget;
}) {
  const source = useRecordsDataSource();
  const router = useRouter();
  const collectionChanged = useCollectionChange();
  const defaults = useMemo(() => initialForm(target, printing, copy), [copy, printing, target]);
  const lifecycle = useFormDraftLifecycle({
    workflow: "ebay-listing",
    ownerScope,
    origin: backHref,
    identity: copy.id,
    intent: { kind: "copy", id: copy.id, label: `${target.name} Copy #${copyShortReference(copy.id)}` },
    initialData: defaults,
    isValidData: isListingForm,
  });
  const form = lifecycle.data;
  const setForm = lifecycle.setData;
  const draftReady = lifecycle.hydrated;
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [photoMessage, setPhotoMessage] = useState<string | null>(null);
  const [validation, setValidation] = useState<EbayVerification | null>(null);
  const [uploading, setUploading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);
  const importedRef = useRef(false);
  const priceEditedRef = useRef(false);
  const pricingRefreshStartedRef = useRef(false);
  const publishActionRef = useRef(false);
  const previouslyStoredPrice = pounds(
    target.estimatedPricePence ?? target.marketPricePence,
  );
  const catalogueImage = target.imageUrl ?? printing.imageUrl;
  const soldUrl = useMemo(
    () => ebaySoldListingsUrl({
      edition: target.edition,
      name: target.name,
      rarity: target.rarity,
      setCode: printing.setCode,
    }),
    [printing.setCode, target.edition, target.name, target.rarity],
  );
  const refreshPricing = trpc.library.refreshPricing.useMutation({
    onSuccess: (pricing) => {
      if (priceEditedRef.current) return;
      setForm((current) => ({
        ...current,
        price: pounds(pricing.estimatedPricePence),
      }));
      clearFieldError("price");
    },
  });
  const validate = trpc.ebay.validate.useMutation();
  const publish = trpc.ebay.publish.useMutation();
  const visibleFees = validation?.fees.filter((fee) => Number.isFinite(fee.amount) && fee.amount !== 0) ?? [];

  useEffect(() => {
    if (!draftReady) return;
    priceEditedRef.current = form.price.trim() !== previouslyStoredPrice;
  }, [draftReady, form.price, previouslyStoredPrice]);

  useEffect(() => {
    if (!draftReady || pricingRefreshStartedRef.current) return;
    pricingRefreshStartedRef.current = true;
    refreshPricing.mutate({ id: target.id });
  }, [draftReady, refreshPricing, target.id]);

  useEffect(() => {
    if (!draftReady || !imageArchiveConfigured || importedRef.current || form.images.length) return;
    importedRef.current = true;
    let cancelled = false;
    async function importSavedPhotos() {
      setImporting(true);
      try {
        const response = await fetch(`/api/inventory/card-images?copyId=${encodeURIComponent(copy.id)}`);
        const payload = await response.json() as { images?: InventoryPhoto[]; message?: string };
        if (!response.ok) throw new Error(payload.message || "Saved card photos could not be loaded.");
        const imported: ListingPhoto[] = [];
        for (const image of (payload.images ?? []).slice(0, 12)) {
          if (cancelled) return;
          const body = new FormData();
          body.append("copyId", copy.id);
          body.append("inventoryKey", image.key);
          const result = await fetch("/api/ebay/image", { body, method: "POST" });
          const value = await result.json() as Partial<ListingPhoto> & { message?: string };
          if (!result.ok || !value.archiveKey || !value.ebayUrl || !value.previewUrl) throw new Error(value.message || "A saved card photo could not be imported.");
          imported.push(value as ListingPhoto);
        }
        if (!cancelled && imported.length) setForm((current) => ({ ...current, images: imported }));
      } catch (error) {
        if (!cancelled) setPhotoMessage(error instanceof Error ? error.message : "Saved card photos could not be loaded.");
      } finally {
        if (!cancelled) setImporting(false);
      }
    }
    void importSavedPhotos();
    return () => { cancelled = true; };
  }, [copy.id, draftReady, form.images.length, imageArchiveConfigured, setForm]);

  function clearFieldError(key: FieldKey) {
    setErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
    setValidation(null);
  }

  function update<K extends keyof ListingForm>(key: K, value: ListingForm[K], field?: FieldKey) {
    if (key === "price") priceEditedRef.current = true;
    setForm((current) => ({ ...current, [key]: value }));
    if (field) clearFieldError(field);
  }

  function updateSpecific<K extends keyof EbayListingItemSpecifics>(key: K, value: EbayListingItemSpecifics[K]) {
    setForm((current) => ({ ...current, itemSpecifics: { ...current.itemSpecifics, [key]: value } }));
    clearFieldError("itemSpecifics");
  }

  function selectDelivery(code: EbayDeliveryServiceCode) {
    const service = ebayDeliveryServices.find((option) => option.code === code);
    if (!service) return;
    setForm((current) => ({ ...current, shippingCost: pounds(service.suggestedCostPence), shippingService: code }));
    clearFieldError("shippingCost");
  }

  async function createListingPhoto(body: FormData) {
    const response = await fetch("/api/ebay/image", { body, method: "POST" });
    const payload = await response.json() as Partial<ListingPhoto> & { message?: string };
    if (!response.ok || !payload.archiveKey || !payload.ebayUrl || !payload.previewUrl) {
      throw new Error(payload.message || "Image upload failed.");
    }
    return payload as ListingPhoto;
  }

  async function uploadListingPhotos(files: File[]) {
    const selectedFiles = files.slice(0, Math.max(0, 12 - form.images.length));
    if (!selectedFiles.length) return;
    setUploading(true);
    setPhotoMessage(null);
    const added: ListingPhoto[] = [];
    const failures: string[] = [];
    for (const file of selectedFiles) {
      const body = new FormData();
      body.append("copyId", copy.id);
      body.append("image", file);
      try {
        added.push(await createListingPhoto(body));
      } catch (error) {
        failures.push(`${file.name}: ${error instanceof Error ? error.message : "could not be uploaded."}`);
      }
    }
    if (added.length) {
      setForm((current) => ({ ...current, images: [...current.images, ...added].slice(0, 12) }));
      clearFieldError("images");
    }
    if (failures.length) setPhotoMessage(failures.join(" "));
    setUploading(false);
  }

  async function addCatalogueImage() {
    if (!catalogueImage || form.images.length >= 12) return;
    setUploading(true);
    setPhotoMessage(null);
    const body = new FormData();
    body.append("copyId", copy.id);
    body.append("sourceUrl", catalogueImage);
    try {
      const image = await createListingPhoto(body);
      setForm((current) => ({ ...current, images: [...current.images, image].slice(0, 12) }));
      clearFieldError("images");
    } catch (error) {
      setPhotoMessage(error instanceof Error ? error.message : "The catalogue image could not be added.");
    } finally {
      setUploading(false);
    }
  }

  async function removeImage(archiveKey: string) {
    setDeletingKey(archiveKey);
    setPhotoMessage(null);
    try {
      const response = await fetch("/api/ebay/image", {
        body: JSON.stringify({ archiveKey, copyId: copy.id }),
        headers: { "Content-Type": "application/json" },
        method: "DELETE",
      });
      const payload = await response.json() as { message?: string; removed?: boolean };
      if (!response.ok || !payload.removed) throw new Error(payload.message || "The image could not be removed.");
      setForm((current) => ({ ...current, images: current.images.filter((item) => item.archiveKey !== archiveKey) }));
      clearFieldError("images");
      return true;
    } catch (error) {
      setPhotoMessage(error instanceof Error ? error.message : "The image could not be removed.");
      return false;
    } finally {
      setDeletingKey(null);
    }
  }

  async function reorderImages(archiveKeys: string[]) {
    const imageByKey = new Map(form.images.map((image) => [image.archiveKey, image]));
    const nextImages = archiveKeys
      .map((archiveKey) => imageByKey.get(archiveKey))
      .filter((image): image is ListingPhoto => image !== undefined);
    if (nextImages.length !== form.images.length) {
      setPhotoMessage("Photo order changed unexpectedly. Please try again.");
      return false;
    }
    setForm((current) => ({ ...current, images: nextImages }));
    clearFieldError("images");
    setPhotoMessage(null);
    return true;
  }

  async function reviewListing(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    const nextErrors = validateForm(form);
    setErrors(nextErrors);
    const first = Object.keys(nextErrors)[0] as FieldKey | undefined;
    if (first) {
      window.requestAnimationFrame(() => document.getElementById(fieldIds[first])?.focus());
      return;
    }
    try {
      setValidation(await validate.mutateAsync(listingInput(copy, form)));
    } catch (error) {
      setValidation(null);
      setMessage(error instanceof Error ? error.message : "eBay validation failed.");
    }
  }

  async function publishListing() {
    if (publishActionRef.current) return;
    publishActionRef.current = true;
    let result: Awaited<ReturnType<typeof publish.mutateAsync>>;
    try {
      result = await publish.mutateAsync(listingInput(copy, form));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The listing could not be published.");
      publishActionRef.current = false;
      return;
    }

    setPublishedUrl(result.listingUrl);
    try {
      await collectionChanged("listing");
    } catch (error) {
      setMessage(collectionRefreshFailureMessage(error));
    }
    try {
      lifecycle.discard();
    } catch {
      setMessage((current) =>
        current
          ? `${current} The listing was published, but its local draft could not be cleared. Do not publish it again.`
          : "The listing was published, but its local draft could not be cleared. Do not publish it again.",
      );
    }
    publishActionRef.current = false;
  }

  function resetDraft() {
    if (!window.confirm("Reset this draft to its original details? Added listing photos will be removed from the draft.")) return;
    lifecycle.reset();
    priceEditedRef.current = false;
    setForm({
      ...defaults,
      price: pounds(refreshPricing.data?.estimatedPricePence ?? null),
    });
    setErrors({});
    setValidation(null);
    setMessage("Draft reset.");
    setPhotoMessage(null);
    importedRef.current = true;
  }

  function resumeDifferentCopyDraft() {
    const previousCopyId = lifecycle.conflict?.intent.kind === "copy"
      ? lifecycle.conflict.intent.id
      : null;
    if (!previousCopyId) return;
    const href = individualListingDraftResumeHref({
      copies: source.snapshot.copies,
      listState: parseInventoryListState(new URL(backHref, window.location.origin).searchParams),
      previousCopyId,
      printings: source.snapshot.printings,
      targets: source.snapshot.targets,
    });
    if (!href) {
      router.back();
      return;
    }
    router.push(href);
  }

  if (!draftReady) {
    return <div aria-live="polite" className="grid min-h-72 place-items-center rounded-xl border border-zinc-300 bg-white font-bold">Restoring this tab&apos;s listing draft…</div>;
  }

  const inputClass = "min-h-11 w-full min-w-0 max-w-full rounded-md border border-zinc-300 bg-white px-3 font-medium outline-none focus:border-[#8a1f2d] focus:ring-2 focus:ring-[#8a1f2d]/20 aria-[invalid=true]:border-rose-500";
  const errorText = (key: FieldKey) => errors[key] ? <span className="text-xs font-bold text-rose-700">{errors[key]}</span> : null;

  return (
    <div className="grid min-w-0 max-w-full gap-5">
      {lifecycle.conflict ? (
        <DraftConflictDialog
          incoming={{ kind: "copy", id: copy.id, label: `${target.name} Copy #${copyShortReference(copy.id)}` }}
          onCancel={() => router.back()}
          onResume={lifecycle.conflictIsDifferentIdentity ? resumeDifferentCopyDraft : lifecycle.resumePrevious}
          onStartNew={lifecycle.startNew}
          previous={lifecycle.conflict.intent}
        />
      ) : null}
      <nav aria-label="Listing breadcrumb" className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <Link className="inline-flex min-h-11 items-center gap-2 rounded-md text-sm font-bold text-zinc-700 transition hover:text-[#8a1f2d] focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-offset-2" href={backHref}><ArrowLeft className="size-4" />Back to card inventory</Link>
        <p className="text-xs font-semibold text-zinc-500">Unfinished work is kept in this browser tab.</p>
      </nav>
      <header className="flex min-w-0 max-w-full flex-col gap-4 rounded-xl border border-zinc-300 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-black">Create listing</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-zinc-500">
          <span aria-live="polite">{!draftReady ? "Draft starting…" : lifecycle.recoveryMessage ?? (lifecycle.restored ? "Draft restored in this tab" : lifecycle.dirty ? "Draft saved in this tab" : "Draft ready in this tab")}</span>
          <button className="inline-flex min-h-11 items-center gap-2 rounded-md border border-zinc-300 px-3 text-sm text-zinc-700 hover:border-zinc-950" onClick={resetDraft} type="button"><RotateCcw className="size-4" />Reset draft</button>
        </div>
      </header>

      <section className="grid min-w-0 max-w-full gap-4 rounded-xl border border-zinc-300 bg-white p-4 shadow-sm sm:grid-cols-[6rem_minmax(0,1fr)] sm:items-center">
        <div className="mx-auto grid aspect-[59/86] w-24 shrink-0 place-items-center overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100 sm:mx-0">
          {catalogueImage ? <Image alt={`${target.name} card`} className="h-full w-full object-contain" height={160} src={catalogueImage} unoptimized width={120} /> : <WalletCards className="size-7 text-zinc-400" />}
        </div>
        <div className="min-w-0">
          <h2 className="break-words text-xl font-black">{target.name}</h2>
          <p className="mt-1 break-words text-sm font-semibold text-zinc-600">Copy #{copyShortReference(copy.id)} · {printing.setCode || "Unknown set code"} · {printing.setName || "Unknown set"}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {[target.rarity, target.edition, copy.condition].map((value) => <span className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs font-bold text-zinc-700" key={value}>{value}</span>)}
          </div>
        </div>
      </section>

      <form className="grid min-w-0 max-w-full items-start gap-5 lg:grid-cols-[minmax(0,1fr)_19rem]" noValidate onSubmit={reviewListing}>
        <div className="grid min-w-0 gap-5">
          <CardPhotoManager
            canManage
            cardName={target.name}
            changing={uploading || importing || Boolean(deletingKey)}
            configured={imageArchiveConfigured}
            description="Saved Copy photos appear automatically. Put the clearest front image first."
            emptyText="No listing photos yet."
            error={errors.images}
            eyebrow="Step 1"
            id={fieldIds.images}
            images={form.images.map((image) => ({ id: image.archiveKey, previewUrl: image.previewUrl }))}
            loading={importing}
            loadingText="Preparing saved Copy photos…"
            maxImages={12}
            message={photoMessage}
            onRemove={removeImage}
            onReorder={reorderImages}
            onUpload={uploadListingPhotos}
            previewSubtitle="Prepared for this eBay listing"
            removalDescription="It will be removed from this listing draft and its private archive. Your original inventory photo is not affected."
            removalTitle="Remove this photo from the listing?"
            removingId={deletingKey}
            reordering={false}
            secondaryAction={catalogueImage ? {
              disabled: !imageArchiveConfigured || uploading || importing,
              icon: ImagePlus,
              label: "Use catalogue image",
              onClick: () => void addCatalogueImage(),
            } : undefined}
            storageWarning="Configure the private image archive before adding photos."
            title="Listing photos"
            uploading={uploading}
          />

          <section className="min-w-0 max-w-full rounded-xl border border-zinc-300 bg-white p-4 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#8a1f2d]">Step 2</p>
            <h2 className="mt-1 text-lg font-black">Listing details</h2>
            <div className="mt-4 grid min-w-0 items-start gap-4 md:grid-cols-2">
              <label className="grid min-w-0 gap-1.5 text-sm font-bold md:col-span-2">Title
                <input aria-invalid={Boolean(errors.title)} className={inputClass} id={fieldIds.title} maxLength={80} onChange={(event) => update("title", event.target.value, "title")} value={form.title} />
                <span className="flex justify-between text-xs font-medium text-zinc-500"><span>{errorText("title")}</span><span>{form.title.length}/80</span></span>
              </label>
              <label className="grid min-w-0 gap-1.5 text-sm font-bold">Condition
                <select className={inputClass} onChange={(event) => update("cardConditionDescriptorValueId", event.target.value as ConditionId)} value={form.cardConditionDescriptorValueId}>
                  {cardConditionOptions.map((option) => <option key={option.value} value={option.ebayDescriptorValueId}>{option.label}</option>)}
                </select>
                <span className="text-xs font-medium text-zinc-500">Mapped from {copy.condition}.</span>
              </label>
              <label className="grid min-w-0 gap-1.5 text-sm font-bold">Language
                <select className={inputClass} onChange={(event) => update("language", event.target.value as EbayListingLanguage)} value={form.language}>{ebayListingLanguages.map((language) => <option key={language} value={language}>{language}</option>)}</select>
              </label>
              <label className="grid min-w-0 gap-1.5 text-sm font-bold">Price (£)
                <input
                  aria-describedby="ebay-price-status"
                  aria-invalid={Boolean(errors.price)}
                  className={inputClass}
                  id={fieldIds.price}
                  inputMode="decimal"
                  onChange={(event) => update("price", event.target.value, "price")}
                  value={form.price}
                />
                {errorText("price")}
                <span
                  aria-live="polite"
                  className={`text-xs font-medium ${
                    refreshPricing.isError ? "text-amber-800" : "text-zinc-500"
                  }`}
                  id="ebay-price-status"
                >
                  {refreshPricing.isPending
                    ? "Checking current eBay pricing…"
                    : refreshPricing.isError
                      ? "eBay pricing could not be refreshed. Check listings and enter a price."
                      : refreshPricing.data?.sampleSize
                        ? `Updated using ${refreshPricing.data.sampleSize} matching eBay listing${refreshPricing.data.sampleSize === 1 ? "" : "s"}.`
                        : refreshPricing.data
                          ? "No matching eBay listings were found. Check listings and enter a price."
                          : "Price will be checked when this page opens."}
                </span>
              </label>
              <label className="grid min-w-0 gap-1.5 text-sm font-bold">Dispatch within (days)
                <input aria-invalid={Boolean(errors.dispatchTimeMax)} className={inputClass} id={fieldIds.dispatchTimeMax} inputMode="numeric" onChange={(event) => update("dispatchTimeMax", event.target.value, "dispatchTimeMax")} value={form.dispatchTimeMax} />
                {errorText("dispatchTimeMax")}
              </label>
              <label className="grid min-w-0 gap-1.5 text-sm font-bold">Delivery service
                <select className={inputClass} onChange={(event) => selectDelivery(event.target.value as EbayDeliveryServiceCode)} value={form.shippingService}>{ebayDeliveryServices.map((service) => <option key={service.code} value={service.code}>{service.label}</option>)}</select>
              </label>
              <label className="grid min-w-0 gap-1.5 text-sm font-bold">Postage cost (£)
                <input aria-invalid={Boolean(errors.shippingCost)} className={inputClass} id={fieldIds.shippingCost} inputMode="decimal" onChange={(event) => update("shippingCost", event.target.value, "shippingCost")} value={form.shippingCost} />
                {errorText("shippingCost")}
              </label>
              <label className="grid min-w-0 gap-1.5 text-sm font-bold md:col-span-2">Description
                <textarea aria-invalid={Boolean(errors.description)} className={`${inputClass} min-h-40 py-3`} id={fieldIds.description} maxLength={4000} onChange={(event) => update("description", event.target.value, "description")} value={form.description} />
                {errorText("description")}
              </label>
            </div>
          </section>

          <section className="min-w-0 max-w-full rounded-xl border border-zinc-300 bg-white p-4 shadow-sm">
            <h2 className="text-lg font-black">Item specifics and location</h2>
            <div className="mt-4 grid min-w-0 items-start gap-4 md:grid-cols-2">
              <label className="grid min-w-0 gap-1.5 text-sm font-bold">Dispatch location
                <input aria-invalid={Boolean(errors.location)} className={inputClass} id={fieldIds.location} maxLength={80} onChange={(event) => update("location", event.target.value, "location")} value={form.location} />
                {errorText("location")}
              </label>
              <label className="grid min-w-0 gap-1.5 text-sm font-bold">Postcode
                <input aria-invalid={Boolean(errors.postalCode)} autoComplete="postal-code" className={inputClass} id={fieldIds.postalCode} maxLength={16} onChange={(event) => update("postalCode", event.target.value, "postalCode")} value={form.postalCode} />
                {errorText("postalCode")}
              </label>
              <details className="overflow-hidden rounded-md border border-zinc-200 bg-zinc-50 md:col-span-2" id={fieldIds.itemSpecifics}>
                <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-black hover:bg-zinc-100"><PencilLine className="size-4" />Review item specifics</summary>
                <div className="grid gap-4 border-t border-zinc-200 bg-white p-3 sm:grid-cols-2">
                  {([
                    ["cardSize", "Card size"], ["rarity", "Rarity"], ["manufacturer", "Manufacturer"],
                    ["setName", "Set"], ["game", "Game"], ["features", "Features"], ["cardNumber", "Card number"],
                  ] as Array<[keyof EbayListingItemSpecifics, string]>).map(([key, label]) => (
                    <label className="grid min-w-0 gap-1 text-sm font-bold" key={key}>{label}<input className={inputClass} maxLength={65} onChange={(event) => updateSpecific(key, event.target.value)} value={form.itemSpecifics[key]} /></label>
                  ))}
                  {errorText("itemSpecifics")}
                </div>
              </details>
            </div>
          </section>
          <p className="flex items-start gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm font-semibold text-zinc-700"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-[#8a1f2d]" />Returns are set to “No returns accepted” for this listing flow.</p>
        </div>

        <aside className="grid gap-4 lg:sticky lg:top-5">
          <section className="rounded-xl border border-zinc-300 bg-white p-4 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#8a1f2d]">Step 3</p>
            <h2 className="mt-1 text-lg font-black">{publishedUrl ? "Published" : "Review and publish"}</h2>
            {!publishedUrl ? <p className="mt-2 text-sm font-medium leading-5 text-zinc-600">Check the key details, then ask eBay to validate policies and fees.</p> : null}
            {Object.keys(errors).length ? (
              <div className="mt-4 rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-950" role="alert">
                <p className="font-black">Fix {Object.keys(errors).length} field{Object.keys(errors).length === 1 ? "" : "s"}</p>
                <ul className="mt-2 grid gap-1">{Object.entries(errors).map(([key, value]) => <li key={key}><a className="font-semibold underline" href={`#${fieldIds[key as FieldKey]}`}>{value}</a></li>)}</ul>
              </div>
            ) : null}
            {message ? <p className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm font-semibold text-amber-950" role="alert">{message}</p> : null}
            {publishedUrl ? (
              <div className="mt-4 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-emerald-950" role="status">
                <CheckCircle2 className="size-6 text-emerald-700" />
                <p className="mt-2 font-black">Listing is live</p>
                <a className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-md bg-emerald-700 px-3 text-sm font-bold text-white" href={publishedUrl} rel="noreferrer" target="_blank">View on eBay<ExternalLink className="size-4" /></a>
              </div>
            ) : (
              <>
                <button className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 text-sm font-bold text-white hover:bg-zinc-800 disabled:cursor-wait disabled:opacity-60" disabled={importing || validate.isPending || publish.isPending} type="submit"><ShieldCheck className="size-4" />{importing ? "Preparing photos…" : validate.isPending ? "Validating…" : "Validate with eBay"}</button>
                {validation ? (
                  <div className="mt-4 border-t border-zinc-200 pt-4 text-sm">
                    <p className={validation.readyToPublish ? "font-black text-emerald-800" : "font-black text-rose-800"}>{validation.readyToPublish ? "Ready to publish" : "Changes required"}</p>
                    {validation.errors.length ? <ul className="mt-2 grid gap-2">{validation.errors.map((error, index) => <li className="rounded-md bg-rose-50 p-2 text-rose-950" key={`${error.code}-${index}`}>{error.message || "eBay returned a validation message."}</li>)}</ul> : null}
                    {visibleFees.length ? <dl className="mt-3 divide-y divide-zinc-100 rounded-md border border-zinc-200">{visibleFees.map((fee, index) => <div className="flex justify-between gap-3 p-2" key={`${fee.name}-${index}`}><dt>{feeName(fee.name)}</dt><dd className="font-black">{feeAmount(fee.amount, fee.currency)}</dd></div>)}</dl> : null}
                    {validation.readyToPublish ? <button className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md bg-[#8a1f2d] px-4 font-bold text-white disabled:opacity-60" disabled={publish.isPending} onClick={() => void publishListing()} type="button"><Send className="size-4" />{publish.isPending ? "Publishing…" : "Publish listing"}</button> : null}
                  </div>
                ) : null}
              </>
            )}
          </section>
          <a className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-bold text-zinc-700 hover:border-zinc-950" href={soldUrl} rel="noreferrer" target="_blank">Compare sold listings<ExternalLink className="size-4" /></a>
        </aside>
      </form>

    </div>
  );
}

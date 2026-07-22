"use client";

import Image from "next/image";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  ImagePlus,
  Maximize2,
  PencilLine,
  Send,
  Settings2,
  ShieldCheck,
  UploadCloud,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "@/lib/auth-client";
import {
  ebayCardCategory,
  ebayDeliveryServices,
  ebayListingLanguages,
  type EbayDeliveryServiceCode,
  type EbayListingItemSpecifics,
  type EbayListingLanguage,
} from "@/lib/ebay-listing-options";
import type { CardCopy, CardPrinting, WishlistTarget } from "@/lib/records/types";
import { trpc } from "@/trpc/client";

type ListingPhoto = {
  archiveKey: string;
  ebayUrl: string;
  previewUrl: string;
};

type InventoryPhoto = {
  key: string;
  previewUrl: string;
};

type ListingForm = {
  categoryId: typeof ebayCardCategory.id;
  cardConditionDescriptorValueId: EbayCardConditionDescriptorValueId;
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

const ebayCardCategoryId = ebayCardCategory.id;
const defaultDeliveryService = ebayDeliveryServices[0];
type EbayCardConditionDescriptorValueId = "400010" | "400015" | "400016" | "400017";

function ebayCardConditionFromInventory(value: string): EbayCardConditionDescriptorValueId {
  const normalized = value.trim().toLowerCase();
  if (normalized.includes("light")) return "400015";
  if (normalized.includes("moderate")) return "400016";
  if (normalized.includes("heavy") || normalized.includes("damage") || normalized.includes("poor")) return "400017";
  return "400010";
}

function pence(value: string) {
  const parsed = Number(value.replace(/[£,\s]/g, ""));
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) : null;
}

function pounds(value: number | null) {
  return value === null ? "" : (value / 100).toFixed(2);
}

function feeName(value: string | null) {
  if (!value) return "eBay fee";
  const words = value
    .replace(/Fee$/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();
  return words || "eBay fee";
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

function editionAbbreviation(value: string) {
  if (/^1st edition$/i.test(value)) return "1st Ed";
  if (/^unlimited edition$/i.test(value)) return "Unlimited";
  if (/^limited edition$/i.test(value)) return "Limited";
  return value;
}

function qualityAbbreviation(value: string) {
  const known: Record<string, string> = {
    "damaged": "DMG",
    "heavily played": "HP",
    "lightly played": "LP",
    "moderately played": "MP",
    "near mint": "NM",
  };
  return known[value.trim().toLowerCase()] ?? value;
}

function defaultTitle(target: WishlistTarget, printing: CardPrinting, copy: CardCopy) {
  const prefix = "Yu Gi Oh";
  const suffix = [
    target.rarity,
    printing.setCode || printing.setName,
    editionAbbreviation(target.edition),
    qualityAbbreviation(copy.condition),
  ].filter(Boolean).join(" ");
  const availableNameLength = Math.max(1, 80 - prefix.length - suffix.length - 2);
  const name = target.name.slice(0, availableNameLength).trim();
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
  const normalized = edition.trim().toLowerCase();
  if (normalized.includes("limited")) return "Limited Edition";
  if (normalized.includes("unlimited")) return "Unlimited Edition";
  return "1st Edition";
}

function soldListingsUrl(target: WishlistTarget, printing: CardPrinting) {
  const query = [target.name, target.rarity, printing.setCode, target.edition].filter(Boolean).join(" ");
  const params = new URLSearchParams({
    _nkw: query,
    _sacat: ebayCardCategoryId,
    LH_Complete: "1",
    LH_Sold: "1",
  });
  return `https://www.ebay.co.uk/sch/i.html?${params}`;
}

function initialForm(target: WishlistTarget, printing: CardPrinting, copy: CardCopy): ListingForm {
  return {
    categoryId: ebayCardCategoryId,
    cardConditionDescriptorValueId: ebayCardConditionFromInventory(copy.condition),
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
    price: pounds(target.estimatedPricePence ?? target.marketPricePence),
    shippingCost: pounds(defaultDeliveryService.suggestedCostPence),
    shippingService: defaultDeliveryService.code,
    title: defaultTitle(target, printing, copy),
  };
}

function listingInput(copy: CardCopy, form: ListingForm) {
  const pricePence = pence(form.price);
  const shippingCostPence = pence(form.shippingCost);
  const dispatchTimeMax = Number(form.dispatchTimeMax);
  const location = form.location.trim();
  const postalCode = form.postalCode.trim();
  const title = form.title.trim();
  const description = form.description.trim();
  const itemSpecifics = {
    cardNumber: form.itemSpecifics.cardNumber.trim(),
    cardSize: form.itemSpecifics.cardSize.trim(),
    features: form.itemSpecifics.features.trim(),
    game: form.itemSpecifics.game.trim(),
    manufacturer: form.itemSpecifics.manufacturer.trim(),
    rarity: form.itemSpecifics.rarity.trim(),
    setName: form.itemSpecifics.setName.trim(),
  };
  const categoryId = form.categoryId;
  const shippingService = form.shippingService;
  if (categoryId !== ebayCardCategoryId) throw new Error("This listing flow supports eBay category 183454.");
  if (!title || title.length > 80) throw new Error("Enter a listing title of no more than 80 characters.");
  if (pricePence === null || pricePence < 1 || pricePence > 10_000_000) throw new Error("Enter a listing price between £0.01 and £100,000.");
  if (!Number.isInteger(dispatchTimeMax) || dispatchTimeMax < 1 || dispatchTimeMax > 30) throw new Error("Enter a dispatch time between 1 and 30 days.");
  if (location.length === 1 || location.length > 80) throw new Error("Enter a full town or city, or leave it blank.");
  if (postalCode.length < 2 || postalCode.length > 16) throw new Error("Enter the item location postcode.");
  if (!shippingService || shippingService.length > 100) throw new Error("Enter the eBay postage service code.");
  if (shippingCostPence === null || shippingCostPence > 100_000) throw new Error("Enter a valid postage cost up to £1,000.");
  if (description.length < 20 || description.length > 4_000) throw new Error("Enter a description between 20 and 4,000 characters.");
  if (Object.values(itemSpecifics).some((value) => !value || value.length > 65)) throw new Error("Complete every eBay item specific using no more than 65 characters per field.");
  if (!form.images.length) throw new Error("Add at least one listing image before validation.");
  if (form.images.length > 12) throw new Error("Use no more than 12 listing images.");
  return {
    copyId: copy.id,
    categoryId,
    cardConditionDescriptorValueId: form.cardConditionDescriptorValueId,
    description,
    dispatchTimeMax,
    images: form.images.map(({ archiveKey, ebayUrl }) => ({ archiveKey, ebayUrl })),
    itemSpecifics,
    language: form.language,
    location,
    postalCode,
    pricePence,
    shippingCostPence,
    shippingService,
    title,
  };
}

export function EbayListingAction({
  copy,
  enabled = true,
  printing,
  target,
}: {
  copy: CardCopy;
  enabled?: boolean;
  printing: CardPrinting;
  target: WishlistTarget;
}) {
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);
  if (!enabled || session?.user.role !== "admin") return null;

  return (
    <>
      <button
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-[#8a1f2d] px-3 text-sm font-bold text-white transition hover:bg-[#711826] focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-offset-2"
        onClick={() => setOpen(true)}
        type="button"
      >
        <Send className="size-4" /> Sell on eBay
      </button>
      {open ? <EbayListingDialog copy={copy} onClose={() => setOpen(false)} printing={printing} target={target} /> : null}
    </>
  );
}

function EbayListingDialog({
  copy,
  onClose,
  printing,
  target,
}: {
  copy: CardCopy;
  onClose: () => void;
  printing: CardPrinting;
  target: WishlistTarget;
}) {
  const [form, setForm] = useState(() => initialForm(target, printing, copy));
  const [reviewing, setReviewing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [validation, setValidation] = useState<{
    errors: Array<{ code: string | null; message: string | null; severity: string | null }>;
    fees: Array<{ amount: number; currency: string; name: string | null }>;
    readyToPublish: boolean;
  } | null>(null);
  const [deletingArchiveKey, setDeletingArchiveKey] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<ListingPhoto | null>(null);
  const [uploading, setUploading] = useState(false);
  const [importingInventoryImages, setImportingInventoryImages] = useState(false);
  const inventoryImagesLoaded = useRef(false);
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);
  const publishedNoticeRef = useRef<HTMLDivElement>(null);
  const status = trpc.ebay.status.useQuery();
  const validate = trpc.ebay.validate.useMutation();
  const publish = trpc.ebay.publish.useMutation();
  const soldUrl = useMemo(() => soldListingsUrl(target, printing), [printing, target]);
  const catalogueImage = printing.imageUrl ?? target.imageUrl;
  const canUseEbay = Boolean(status.data?.connection && status.data.configured);
  const canUploadImages = Boolean(canUseEbay && status.data?.imageArchiveConfigured);
  const visibleFees = validation?.fees.filter((fee) => Number.isFinite(fee.amount) && fee.amount !== 0) ?? [];

  useEffect(() => {
    if (publishedUrl) publishedNoticeRef.current?.scrollIntoView({ block: "nearest" });
  }, [publishedUrl]);

  useEffect(() => {
    if (!previewImage) return;
    const closePreview = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreviewImage(null);
    };
    window.addEventListener("keydown", closePreview);
    return () => window.removeEventListener("keydown", closePreview);
  }, [previewImage]);

  useEffect(() => {
    if (!canUploadImages || inventoryImagesLoaded.current) return;
    inventoryImagesLoaded.current = true;
    let cancelled = false;
    async function importSavedPhotos() {
      setImportingInventoryImages(true);
      try {
        const response = await fetch(`/api/inventory/card-images?copyId=${encodeURIComponent(copy.id)}`);
        const payload = await response.json() as { configured?: boolean; images?: InventoryPhoto[]; message?: string };
        if (!response.ok) throw new Error(payload.message || "Saved card photos could not be loaded.");
        const inventoryImages = payload.images ?? [];
        const imported: ListingPhoto[] = [];
        for (const image of inventoryImages.slice(0, 12)) {
          if (cancelled) return;
          const body = new FormData();
          body.append("copyId", copy.id);
          body.append("inventoryKey", image.key);
          const importResponse = await fetch("/api/ebay/image", { body, method: "POST" });
          const importedPayload = await importResponse.json() as Partial<ListingPhoto> & { message?: string };
          if (!importResponse.ok || !importedPayload.archiveKey || !importedPayload.ebayUrl || !importedPayload.previewUrl) {
            throw new Error(importedPayload.message || "A saved card photo could not be imported.");
          }
          imported.push(importedPayload as ListingPhoto);
        }
        if (!cancelled && imported.length) {
          setForm((current) => ({ ...current, images: [...current.images, ...imported].slice(0, 12) }));
        }
      } catch (error) {
        if (!cancelled) setMessage(error instanceof Error ? error.message : "Saved card photos could not be loaded.");
      } finally {
        if (!cancelled) setImportingInventoryImages(false);
      }
    }
    void importSavedPhotos();
    return () => { cancelled = true; };
  }, [canUploadImages, copy.id]);

  function update<K extends keyof ListingForm>(key: K, value: ListingForm[K]) {
    setValidation(null);
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateItemSpecific<K extends keyof EbayListingItemSpecifics>(
    key: K,
    value: EbayListingItemSpecifics[K],
  ) {
    setValidation(null);
    setForm((current) => ({
      ...current,
      itemSpecifics: { ...current.itemSpecifics, [key]: value },
    }));
  }

  function selectDeliveryService(code: EbayDeliveryServiceCode) {
    const service = ebayDeliveryServices.find((option) => option.code === code);
    if (!service) return;
    setValidation(null);
    setForm((current) => ({
      ...current,
      shippingCost: pounds(service.suggestedCostPence),
      shippingService: service.code,
    }));
  }

  async function uploadImage(file?: File) {
    if (!file) return;
    setUploading(true);
    setMessage(null);
    const body = new FormData();
    body.append("copyId", copy.id);
    body.append("image", file);
    try {
      const response = await fetch("/api/ebay/image", { body, method: "POST" });
      const payload = await response.json() as Partial<ListingPhoto> & { message?: string };
      if (!response.ok || !payload.archiveKey || !payload.ebayUrl || !payload.previewUrl) {
        throw new Error(payload.message || "Image upload failed.");
      }
      update("images", [...form.images, payload as ListingPhoto]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Image upload failed.");
    } finally {
      setUploading(false);
    }
  }

  async function importCatalogueImage() {
    if (!catalogueImage) return;
    setUploading(true);
    setMessage(null);
    const body = new FormData();
    body.append("copyId", copy.id);
    body.append("sourceUrl", catalogueImage);
    try {
      const response = await fetch("/api/ebay/image", { body, method: "POST" });
      const payload = await response.json() as Partial<ListingPhoto> & { message?: string };
      if (!response.ok || !payload.archiveKey || !payload.ebayUrl || !payload.previewUrl) {
        throw new Error(payload.message || "Catalogue image import failed.");
      }
      update("images", [...form.images, payload as ListingPhoto]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Catalogue image import failed.");
    } finally {
      setUploading(false);
    }
  }

  async function removeImage(image: ListingPhoto) {
    setDeletingArchiveKey(image.archiveKey);
    setMessage(null);
    try {
      const response = await fetch("/api/ebay/image", {
        body: JSON.stringify({ archiveKey: image.archiveKey, copyId: copy.id }),
        headers: { "Content-Type": "application/json" },
        method: "DELETE",
      });
      const payload = await response.json() as { message?: string; removed?: boolean };
      if (!response.ok || !payload.removed) throw new Error(payload.message || "The image could not be removed.");
      if (previewImage?.archiveKey === image.archiveKey) setPreviewImage(null);
      update("images", form.images.filter((item) => item.archiveKey !== image.archiveKey));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The image could not be removed.");
    } finally {
      setDeletingArchiveKey(null);
    }
  }

  async function validateListing() {
    setMessage(null);
    try {
      const result = await validate.mutateAsync(listingInput(copy, form));
      setValidation(result);
      setReviewing(true);
      if (!result.readyToPublish) setMessage("eBay needs changes before this listing can be published.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The listing could not be validated.");
    }
  }

  async function publishListing() {
    setMessage(null);
    try {
      const result = await publish.mutateAsync(listingInput(copy, form));
      setPublishedUrl(result.listingUrl);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The listing could not be published.");
    }
  }

  return (
    <div aria-labelledby="ebay-listing-title" aria-modal="true" className="fixed inset-0 z-[60] grid place-items-end bg-zinc-950/55 p-3 sm:place-items-center sm:p-6" role="dialog">
      <div className="max-h-[calc(100dvh-1.5rem)] w-full max-w-4xl overflow-y-auto rounded-xl border border-zinc-300 bg-[#f6f4ef] shadow-2xl sm:max-h-[calc(100dvh-3rem)]">
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-zinc-300 bg-white px-4 py-4 sm:px-6">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#8a1f2d]">eBay listing · physical Copy</p>
            <h2 className="mt-1 text-xl font-black" id="ebay-listing-title">Sell {target.name}</h2>
            <p className="mt-1 text-sm font-medium text-zinc-500">Copy #{copy.id.slice(-6).toUpperCase()} · {copy.condition}. This creates one listing for this Copy and does not mark it as sold in Records.</p>
          </div>
          <button aria-label="Close eBay listing" className="grid size-11 shrink-0 place-items-center rounded-md border border-zinc-300 bg-white text-zinc-600 hover:border-zinc-950 focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-offset-2" onClick={onClose} type="button"><X className="size-5" /></button>
        </header>

        <div className="grid gap-5 p-4 sm:p-6">
          {!status.data?.connection ? <section className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm font-semibold text-amber-950"><p className="flex items-center gap-2 font-black"><AlertTriangle className="size-4" />Connect eBay before creating a listing.</p><a className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-md bg-[#8a1f2d] px-3 text-sm font-bold text-white" href="/ebay"><ShieldCheck className="size-4" />Open eBay connection</a></section> : null}
          {status.data?.connection && !status.data.configured ? <p className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm font-semibold text-amber-950">eBay is connected, but the server’s listing configuration is incomplete.</p> : null}
          {status.data?.connection && status.data.configured && !status.data.imageArchiveConfigured ? <p className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm font-semibold text-amber-950">The private S3 listing-photo archive is not configured on this server.</p> : null}

          <section className="rounded-lg border border-zinc-300 bg-white p-4">
            <div className="flex flex-wrap items-end justify-between gap-3"><div><h3 className="font-black">1. Listing details</h3><p className="mt-1 text-sm font-medium text-zinc-500">Card details are filled from your collection data. Every postage option is delivery only.</p></div><a className="inline-flex min-h-11 items-center gap-2 rounded-md border border-zinc-300 px-3 text-sm font-bold text-[#8a1f2d] hover:border-[#8a1f2d]" href={soldUrl} rel="noreferrer" target="_blank">Sold listings <ExternalLink className="size-4" /></a></div>
            <div className="mt-4 grid items-start gap-4 md:grid-cols-2">
              <label className="grid content-start gap-1.5 text-sm font-bold md:col-span-2">
                Title
                <input className="h-11 rounded-md border border-zinc-300 px-3 font-medium outline-none focus:border-[#8a1f2d] focus:ring-2 focus:ring-[#8a1f2d]/20" maxLength={80} onChange={(event) => update("title", event.target.value)} value={form.title} />
                <span className="text-xs font-medium text-zinc-500">{form.title.length}/80 · Rarity is always written in full.</span>
              </label>
              <label className="grid content-start gap-1.5 text-sm font-bold">
                Card condition
                <select className="h-11 rounded-md border border-zinc-300 bg-white px-3 font-medium outline-none focus:border-[#8a1f2d]" onChange={(event) => update("cardConditionDescriptorValueId", event.target.value as EbayCardConditionDescriptorValueId)} value={form.cardConditionDescriptorValueId}>
                  <option value="400010">Near mint or better</option>
                  <option value="400015">Lightly played (Excellent)</option>
                  <option value="400016">Moderately played (Very good)</option>
                  <option value="400017">Heavily played (Poor)</option>
                </select>
                <span className="text-xs font-medium text-zinc-500">Prefilled from your inventory quality.</span>
              </label>
              <label className="grid content-start gap-1.5 text-sm font-bold">
                Language
                <select className="h-11 rounded-md border border-zinc-300 bg-white px-3 font-medium outline-none focus:border-[#8a1f2d]" onChange={(event) => update("language", event.target.value as EbayListingLanguage)} value={form.language}>
                  {ebayListingLanguages.map((language) => <option key={language} value={language}>{language}</option>)}
                </select>
              </label>
              <label className="grid content-start gap-1.5 text-sm font-bold">
                Price (£)
                <input className="h-11 rounded-md border border-zinc-300 px-3 font-medium outline-none focus:border-[#8a1f2d] focus:ring-2 focus:ring-[#8a1f2d]/20" inputMode="decimal" onChange={(event) => update("price", event.target.value)} value={form.price} />
              </label>
              <label className="grid content-start gap-1.5 text-sm font-bold">
                Dispatch within (days)
                <input className="h-11 rounded-md border border-zinc-300 px-3 font-medium outline-none focus:border-[#8a1f2d] focus:ring-2 focus:ring-[#8a1f2d]/20" inputMode="numeric" onChange={(event) => update("dispatchTimeMax", event.target.value)} value={form.dispatchTimeMax} />
              </label>
              <label className="grid content-start gap-1.5 text-sm font-bold">
                Delivery service
                <select className="h-11 rounded-md border border-zinc-300 bg-white px-3 font-medium outline-none focus:border-[#8a1f2d]" onChange={(event) => selectDeliveryService(event.target.value as EbayDeliveryServiceCode)} value={form.shippingService}>
                  {ebayDeliveryServices.map((service) => <option key={service.code} value={service.code}>{service.label}</option>)}
                </select>
                <span className="text-xs font-medium text-zinc-500">Delivery only. No collection option is sent to eBay.</span>
              </label>
              <label className="grid content-start gap-1.5 text-sm font-bold">
                Postage cost (£)
                <input className="h-11 rounded-md border border-zinc-300 px-3 font-medium outline-none focus:border-[#8a1f2d] focus:ring-2 focus:ring-[#8a1f2d]/20" inputMode="decimal" onChange={(event) => update("shippingCost", event.target.value)} value={form.shippingCost} />
                <span className="text-xs font-medium text-zinc-500">Updates to the current suggested online rate when the service changes; still editable.</span>
              </label>

              <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 md:col-span-2">
                <p className="text-sm font-black">Auto-filled eBay item specifics</p>
                <dl className="mt-3 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                  <div><dt className="text-xs font-bold uppercase tracking-wide text-zinc-500">Card size</dt><dd className="mt-0.5 font-semibold">{form.itemSpecifics.cardSize}</dd></div>
                  <div><dt className="text-xs font-bold uppercase tracking-wide text-zinc-500">Rarity</dt><dd className="mt-0.5 font-semibold">{form.itemSpecifics.rarity}</dd></div>
                  <div><dt className="text-xs font-bold uppercase tracking-wide text-zinc-500">Manufacturer</dt><dd className="mt-0.5 font-semibold">{form.itemSpecifics.manufacturer}</dd></div>
                  <div><dt className="text-xs font-bold uppercase tracking-wide text-zinc-500">Set</dt><dd className="mt-0.5 font-semibold">{form.itemSpecifics.setName || "Missing set name"}</dd></div>
                  <div><dt className="text-xs font-bold uppercase tracking-wide text-zinc-500">Game</dt><dd className="mt-0.5 font-semibold">{form.itemSpecifics.game}</dd></div>
                  <div><dt className="text-xs font-bold uppercase tracking-wide text-zinc-500">Features</dt><dd className="mt-0.5 font-semibold">{form.itemSpecifics.features}</dd></div>
                  <div><dt className="text-xs font-bold uppercase tracking-wide text-zinc-500">Card number</dt><dd className="mt-0.5 font-semibold">{form.itemSpecifics.cardNumber || "Missing set code"}</dd></div>
                </dl>
                <details className="group mt-3 overflow-hidden rounded-md border border-zinc-200 bg-white">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-black text-zinc-800 transition hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-inset">
                    <PencilLine className="size-4" />Edit item specifics
                  </summary>
                  <div className="grid items-start gap-4 border-t border-zinc-200 p-3 sm:grid-cols-2">
                    <p className="text-xs font-medium text-zinc-500 sm:col-span-2">These values come from your card data. Change them only when this physical card differs.</p>
                    <label className="grid content-start gap-1.5 text-sm font-bold">Card size<input className="h-11 rounded-md border border-zinc-300 px-3 font-medium outline-none focus:border-[#8a1f2d] focus:ring-2 focus:ring-[#8a1f2d]/20" maxLength={65} onChange={(event) => updateItemSpecific("cardSize", event.target.value)} required value={form.itemSpecifics.cardSize} /></label>
                    <label className="grid content-start gap-1.5 text-sm font-bold">Rarity<input className="h-11 rounded-md border border-zinc-300 px-3 font-medium outline-none focus:border-[#8a1f2d] focus:ring-2 focus:ring-[#8a1f2d]/20" maxLength={65} onChange={(event) => updateItemSpecific("rarity", event.target.value)} required value={form.itemSpecifics.rarity} /></label>
                    <label className="grid content-start gap-1.5 text-sm font-bold">Manufacturer<input className="h-11 rounded-md border border-zinc-300 px-3 font-medium outline-none focus:border-[#8a1f2d] focus:ring-2 focus:ring-[#8a1f2d]/20" maxLength={65} onChange={(event) => updateItemSpecific("manufacturer", event.target.value)} required value={form.itemSpecifics.manufacturer} /></label>
                    <label className="grid content-start gap-1.5 text-sm font-bold">Set<input className="h-11 rounded-md border border-zinc-300 px-3 font-medium outline-none focus:border-[#8a1f2d] focus:ring-2 focus:ring-[#8a1f2d]/20" maxLength={65} onChange={(event) => updateItemSpecific("setName", event.target.value)} required value={form.itemSpecifics.setName} /></label>
                    <label className="grid content-start gap-1.5 text-sm font-bold">Game<input className="h-11 rounded-md border border-zinc-300 px-3 font-medium outline-none focus:border-[#8a1f2d] focus:ring-2 focus:ring-[#8a1f2d]/20" maxLength={65} onChange={(event) => updateItemSpecific("game", event.target.value)} required value={form.itemSpecifics.game} /></label>
                    <label className="grid content-start gap-1.5 text-sm font-bold">Features<input className="h-11 rounded-md border border-zinc-300 px-3 font-medium outline-none focus:border-[#8a1f2d] focus:ring-2 focus:ring-[#8a1f2d]/20" maxLength={65} onChange={(event) => updateItemSpecific("features", event.target.value)} required value={form.itemSpecifics.features} /></label>
                    <label className="grid content-start gap-1.5 text-sm font-bold sm:col-span-2">Card number<input className="h-11 rounded-md border border-zinc-300 px-3 font-medium outline-none focus:border-[#8a1f2d] focus:ring-2 focus:ring-[#8a1f2d]/20" maxLength={65} onChange={(event) => updateItemSpecific("cardNumber", event.target.value)} required value={form.itemSpecifics.cardNumber} /></label>
                  </div>
                </details>
              </div>

              <label className="grid content-start gap-1.5 text-sm font-bold md:col-span-2">Description <textarea className="min-h-36 rounded-md border border-zinc-300 px-3 py-2 font-medium outline-none focus:border-[#8a1f2d] focus:ring-2 focus:ring-[#8a1f2d]/20" maxLength={4000} onChange={(event) => update("description", event.target.value)} value={form.description} /></label>

              <details className="group overflow-hidden rounded-md border border-zinc-200 bg-zinc-50 md:col-span-2">
                <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-black text-zinc-800 hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-inset"><Settings2 className="size-4" />Advanced settings</summary>
                <div className="grid gap-4 border-t border-zinc-200 bg-white p-3 md:grid-cols-2">
                  <label className="grid content-start gap-1.5 text-sm font-bold md:col-span-2">Category <select className="h-11 rounded-md border border-zinc-300 bg-white px-3 font-medium outline-none focus:border-[#8a1f2d]" onChange={(event) => update("categoryId", event.target.value as typeof ebayCardCategory.id)} value={form.categoryId}><option value={ebayCardCategory.id}>{ebayCardCategory.label}</option></select><span className="text-xs font-medium text-zinc-500">The correct eBay category ID is mapped behind the scenes.</span></label>
                  <label className="grid content-start gap-1.5 text-sm font-bold">Dispatch location <input className="h-11 rounded-md border border-zinc-300 px-3 font-medium outline-none focus:border-[#8a1f2d] focus:ring-2 focus:ring-[#8a1f2d]/20" maxLength={80} minLength={2} onChange={(event) => update("location", event.target.value)} value={form.location} /><span className="text-xs font-medium text-zinc-500">Item location for delivery estimates, not a collection address.</span></label>
                  <label className="grid content-start gap-1.5 text-sm font-bold">Postcode <input autoComplete="postal-code" className="h-11 rounded-md border border-zinc-300 px-3 font-medium uppercase outline-none focus:border-[#8a1f2d] focus:ring-2 focus:ring-[#8a1f2d]/20" maxLength={16} minLength={2} onChange={(event) => update("postalCode", event.target.value)} required value={form.postalCode} /></label>
                </div>
              </details>
            </div>
          </section>

          <section className="rounded-lg border border-zinc-300 bg-white p-4">
            <h3 className="font-black">2. Photos</h3>
            <p className="mt-1 text-sm font-medium text-zinc-500">Saved card photos are selected automatically. You can remove them or add different photos before sending this listing to eBay.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <label className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-bold text-zinc-700 transition hover:border-[#8a1f2d] has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50">
                <UploadCloud className="size-4" />{uploading ? "Uploading and archiving…" : "Upload photo"}
                <input accept="image/avif,image/bmp,image/gif,image/heic,image/jpeg,image/png,image/tiff,image/webp" className="sr-only" disabled={!canUploadImages || uploading || importingInventoryImages || form.images.length >= 12} onChange={(event) => { void uploadImage(event.target.files?.[0]); event.currentTarget.value = ""; }} type="file" />
              </label>
              {catalogueImage ? <button className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-bold text-zinc-700 transition hover:border-[#8a1f2d] disabled:cursor-not-allowed disabled:opacity-50" disabled={!canUploadImages || uploading || importingInventoryImages || form.images.length >= 12} onClick={() => void importCatalogueImage()} type="button"><ImagePlus className="size-4" />Use catalogue image</button> : null}
            </div>
            {importingInventoryImages ? <p className="mt-3 text-sm font-semibold text-zinc-600" role="status">Loading saved card photos…</p> : null}
            {!canUseEbay ? <p className="mt-3 text-sm font-semibold text-amber-800">Connect eBay above to add photos.</p> : null}
            {canUseEbay && !status.data?.imageArchiveConfigured ? <p className="mt-3 text-sm font-semibold text-amber-800">Configure the private S3 archive before adding photos.</p> : null}
            {form.images.length ? (
              <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {form.images.map((image, index) => (
                  <li className="relative overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100" key={image.archiveKey}>
                    <button aria-label={`Open listing photo ${index + 1}`} className="group grid w-full cursor-zoom-in gap-2 p-2 text-left transition hover:bg-zinc-200 focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-inset" onClick={() => setPreviewImage(image)} type="button">
                      <span className="relative block aspect-square overflow-hidden rounded-md bg-white">
                        <Image alt={`Listing photo ${index + 1} for ${target.name}`} className="h-full w-full object-contain" height={320} src={image.previewUrl} unoptimized width={320} />
                      </span>
                      <span className="flex items-center justify-between gap-2 px-1 text-xs font-bold text-zinc-700"><span>Photo {index + 1}</span><Maximize2 className="size-4 text-zinc-500" /></span>
                    </button>
                    <button aria-label={`Remove listing photo ${index + 1}`} className="absolute right-2 top-2 grid size-11 place-items-center rounded-md border border-zinc-300 bg-white/95 text-zinc-700 shadow-sm transition hover:border-rose-500 hover:text-rose-700 focus-visible:ring-2 focus-visible:ring-rose-600 disabled:cursor-wait disabled:opacity-60" disabled={deletingArchiveKey === image.archiveKey} onClick={() => void removeImage(image)} type="button"><X className="size-4" /></button>
                  </li>
                ))}
              </ul>
            ) : <p className="mt-4 rounded-md bg-zinc-50 px-3 py-2 text-sm font-semibold text-zinc-600">No images added yet.</p>}
          </section>

          <section className="rounded-lg border border-zinc-300 bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-black">3. {publishedUrl ? "Published" : "Review and validate"}</h3>
                <p className="mt-1 text-sm font-medium text-zinc-500">{publishedUrl ? "This listing is now live on eBay." : "eBay validates category requirements, policy requirements and fees before publishing."}</p>
              </div>
              {!publishedUrl ? <button className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 text-sm font-bold text-white hover:bg-zinc-800 disabled:cursor-wait disabled:opacity-60" disabled={!canUseEbay || importingInventoryImages || validate.isPending || publish.isPending} onClick={() => void validateListing()} type="button"><ShieldCheck className="size-4" />{importingInventoryImages ? "Loading photos…" : validate.isPending ? "Validating…" : "Validate with eBay"}</button> : null}
            </div>

            {publishedUrl ? (
              <div aria-live="polite" className="mt-4 rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-emerald-950" ref={publishedNoticeRef} role="status">
                <div className="flex items-start gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-emerald-700 text-white"><CheckCircle2 className="size-5" /></span>
                  <div>
                    <p className="font-black">Listing published successfully</p>
                    <p className="mt-1 text-sm font-medium">eBay accepted the listing and made it live.</p>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <a className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-emerald-700 px-4 text-sm font-bold text-white hover:bg-emerald-800 focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-2" href={publishedUrl} rel="noreferrer" target="_blank">View live listing <ExternalLink className="size-4" /></a>
                  <button className="inline-flex min-h-11 items-center justify-center rounded-md border border-emerald-300 bg-white px-4 text-sm font-bold text-emerald-900 hover:border-emerald-600" onClick={onClose} type="button">Done</button>
                </div>
              </div>
            ) : (
              <>
                {message ? <p className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-950" role="alert">{message}</p> : null}
                {reviewing && validation ? (
                  <div className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm">
                    <p className={validation.readyToPublish ? "font-black text-emerald-800" : "font-black text-rose-800"}>{validation.readyToPublish ? "Ready to publish — eBay accepted these details." : "Not ready to publish yet."}</p>
                    {validation.errors.length ? <ul className="mt-3 grid gap-2">{validation.errors.map((error, index) => <li className={error.severity === "Error" ? "rounded border border-rose-200 bg-rose-50 px-3 py-2 text-rose-950" : "rounded border border-amber-200 bg-amber-50 px-3 py-2 text-amber-950"} key={`${error.code}-${index}`}>{error.severity}: {error.message || "eBay returned a validation message."}</li>)}</ul> : null}
                    {visibleFees.length ? (
                      <div className="mt-3 overflow-hidden rounded-md border border-zinc-300 bg-white">
                        <p className="border-b border-zinc-200 px-3 py-2 font-black text-zinc-900">Estimated listing fees</p>
                        <dl className="divide-y divide-zinc-100">{visibleFees.map((fee, index) => <div className="flex items-center justify-between gap-4 px-3 py-2" key={`${fee.name}-${index}`}><dt className="font-medium text-zinc-600">{feeName(fee.name)}</dt><dd className="font-black tabular-nums text-zinc-950">{feeAmount(fee.amount, fee.currency)}</dd></div>)}</dl>
                      </div>
                    ) : null}
                    {validation.readyToPublish ? <button className="mt-4 inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-[#8a1f2d] px-4 text-sm font-bold text-white hover:bg-[#711826] disabled:cursor-wait disabled:opacity-60" disabled={publish.isPending} onClick={() => void publishListing()} type="button"><Send className="size-4" />{publish.isPending ? "Publishing…" : "Publish listing"}</button> : null}
                  </div>
                ) : null}
              </>
            )}
          </section>
          <p className="flex items-start gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-3 text-sm font-semibold text-zinc-700"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-[#8a1f2d]" />Returns are explicitly set to “No returns accepted” for this v1 listing flow.</p>
        </div>
      </div>
      {previewImage ? (
        <div aria-labelledby="ebay-photo-preview-title" aria-modal="true" className="fixed inset-0 z-[70] grid place-items-center bg-zinc-950/80 p-4 sm:p-8" role="dialog">
          <div className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-white/20 bg-zinc-950 shadow-2xl">
            <header className="flex items-center justify-between gap-4 border-b border-white/15 px-4 py-3 text-white">
              <div>
                <h3 className="font-black" id="ebay-photo-preview-title">Listing photo preview</h3>
                <p className="mt-0.5 text-xs font-medium text-zinc-300">Archived privately in S3</p>
              </div>
              <button aria-label="Close listing photo preview" autoFocus className="grid size-11 shrink-0 place-items-center rounded-md border border-white/25 bg-white/10 text-white transition hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white" onClick={() => setPreviewImage(null)} type="button"><X className="size-5" /></button>
            </header>
            <div className="grid min-h-0 flex-1 place-items-center overflow-auto p-3 sm:p-5">
              <Image alt={`Expanded listing photo for ${target.name}`} className="max-h-[calc(100dvh-10rem)] h-auto w-auto max-w-full rounded-md object-contain" height={1_200} src={previewImage.previewUrl} unoptimized width={1_200} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

"use client";

import { Images } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { CardPhotoManager } from "@/components/records/card-photo-manager";
import { planHomogeneousQuantitySavedPhotos } from "@/lib/records/ebay-quantity-listing";
import type { CardCondition } from "@/lib/records/types";

export type ListingPhotoKind = "individual" | "x2" | "x3";

export type ListingPhotoSetImage = {
  key: string;
  position: number;
  previewUrl: string;
  sourceCopyId: string | null;
  sourceInventoryKey: string | null;
};

const kindCopy: Record<ListingPhotoKind, { description: string; label: string }> = {
  individual: {
    description: "Reusable photos for the listing where buyers purchase one matching Copy.",
    label: "Individual",
  },
  x2: {
    description: "Reusable photos for the listing where buyers purchase two matching Copies together. The primary photo should show both cards.",
    label: "x2 set",
  },
  x3: {
    description: "Reusable photos for the listing where buyers purchase three matching Copies together. The primary photo should show all three cards.",
    label: "x3 set",
  },
};

const listingPhotoKinds = ["individual", "x2", "x3"] as const satisfies readonly ListingPhotoKind[];

function scopeBody({
  condition,
  edition,
  kind,
  printingId,
}: {
  condition: CardCondition;
  edition: string;
  kind: ListingPhotoKind;
  printingId: string;
}) {
  return { condition, edition, kind, printingId };
}

export function ListingPhotoSetManager({
  canManage,
  cardName,
  condition,
  edition,
  kind,
  onImagesChange,
  printingId,
  sourceCopyIds,
}: {
  canManage: boolean;
  cardName: string;
  condition: CardCondition;
  edition: string;
  kind: ListingPhotoKind;
  onImagesChange?: (images: ListingPhotoSetImage[]) => void;
  printingId: string;
  sourceCopyIds: string[];
}) {
  const [configured, setConfigured] = useState(true);
  const [images, setImages] = useState<ListingPhotoSetImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [reordering, setReordering] = useState(false);
  const [removingKey, setRemovingKey] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const onImagesChangeRef = useRef(onImagesChange);
  const scope = useMemo(() => scopeBody({ condition, edition, kind, printingId }), [condition, edition, kind, printingId]);

  useEffect(() => { onImagesChangeRef.current = onImagesChange; }, [onImagesChange]);

  const publishImages = useCallback((next: ListingPhotoSetImage[]) => {
    setImages(next);
    onImagesChangeRef.current?.(next);
  }, []);

  const loadImages = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams(scope);
      const response = await fetch(`/api/inventory/listing-photos?${params}`);
      const payload = await response.json() as { configured?: boolean; images?: ListingPhotoSetImage[]; message?: string };
      if (!response.ok) throw new Error(payload.message || "Listing photos could not be loaded.");
      setConfigured(payload.configured !== false);
      publishImages(payload.images ?? []);
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Listing photos could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [publishImages, scope]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => { void loadImages(); }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [loadImages]);

  async function addForm(form: FormData) {
    for (const [key, value] of Object.entries(scope)) form.append(key, value);
    const response = await fetch("/api/inventory/listing-photos", { body: form, method: "POST" });
    const payload = await response.json() as { image?: ListingPhotoSetImage; message?: string };
    if (!response.ok || !payload.image) throw new Error(payload.message || "The listing photo could not be saved.");
    return payload.image;
  }

  async function upload(files: File[]) {
    if (!files.length) return;
    setUploading(true);
    setMessage(null);
    const next = [...images];
    const failures: string[] = [];
    for (const file of files.slice(0, Math.max(0, 12 - next.length))) {
      const form = new FormData();
      form.append("image", file);
      try {
        next.push(await addForm(form));
      } catch (error) {
        failures.push(`${file.name}: ${error instanceof Error ? error.message : "could not be saved"}`);
      }
    }
    publishImages(next);
    setMessage(failures.length ? failures.join(" ") : `${next.length - images.length} ${next.length - images.length === 1 ? "photo" : "photos"} added.`);
    setUploading(false);
  }

  async function importSavedCopyPhotos() {
    if (!sourceCopyIds.length) return;
    setImporting(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/inventory/card-images?copyIds=${encodeURIComponent(sourceCopyIds.join(","))}`);
      const payload = await response.json() as { imagesByCopy?: Record<string, Array<{ key: string; position: number }>>; message?: string };
      if (!response.ok) throw new Error(payload.message || "Saved Copy photos could not be loaded.");
      const existingSourceKeys = new Set(images.map((image) => image.sourceInventoryKey).filter(Boolean));
      const planned = planHomogeneousQuantitySavedPhotos({
        copyIds: sourceCopyIds,
        existingPhotos: [],
        imagesByCopy: payload.imagesByCopy ?? {},
      }).filter((image) => !existingSourceKeys.has(image.key));
      const next = [...images];
      for (const source of planned.slice(0, Math.max(0, 12 - next.length))) {
        const form = new FormData();
        form.append("sourceCopyId", source.copyId);
        form.append("sourceInventoryKey", source.key);
        next.push(await addForm(form));
      }
      publishImages(next);
      const added = next.length - images.length;
      setMessage(added
        ? `${added} saved Copy ${added === 1 ? "photo" : "photos"} added to this reusable set.`
        : "No new saved Copy photos were available to add.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Saved Copy photos could not be added.");
    } finally {
      setImporting(false);
    }
  }

  async function remove(key: string) {
    setRemovingKey(key);
    setMessage(null);
    try {
      const response = await fetch("/api/inventory/listing-photos", {
        body: JSON.stringify({ ...scope, key }),
        headers: { "Content-Type": "application/json" },
        method: "DELETE",
      });
      const payload = await response.json() as { message?: string; removed?: boolean };
      if (!response.ok || !payload.removed) throw new Error(payload.message || "The listing photo could not be removed.");
      publishImages(images.filter((image) => image.key !== key).map((image, position) => ({ ...image, position })));
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The listing photo could not be removed.");
      return false;
    } finally {
      setRemovingKey(null);
    }
  }

  async function reorder(keys: string[]) {
    const previous = images;
    const byKey = new Map(images.map((image) => [image.key, image]));
    const optimistic = keys.flatMap((key, position) => {
      const image = byKey.get(key);
      return image ? [{ ...image, position }] : [];
    });
    publishImages(optimistic);
    setReordering(true);
    setMessage(null);
    try {
      const response = await fetch("/api/inventory/listing-photos", {
        body: JSON.stringify({ ...scope, keys }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      });
      const payload = await response.json() as { images?: ListingPhotoSetImage[]; message?: string };
      if (!response.ok || !payload.images) throw new Error(payload.message || "Photo order could not be saved.");
      publishImages(payload.images);
      return true;
    } catch (error) {
      publishImages(previous);
      setMessage(error instanceof Error ? error.message : "Photo order could not be saved.");
      return false;
    } finally {
      setReordering(false);
    }
  }

  return <CardPhotoManager
    canManage={canManage}
    cardName={`${cardName} ${kindCopy[kind].label}`}
    changing={uploading || reordering || importing || Boolean(removingKey)}
    configured={configured}
    description={`${kindCopy[kind].description} These stay available when listings end.`}
    emptyText={`No ${kindCopy[kind].label.toLowerCase()} listing photos saved yet.`}
    id={`listing-photo-set-${printingId}-${condition}-${kind}`}
    images={images.map((image) => ({ id: image.key, previewUrl: image.previewUrl }))}
    loading={loading}
    maxImages={12}
    message={message}
    onRemove={remove}
    onReorder={reorder}
    onUpload={upload}
    previewSubtitle={`${kindCopy[kind].label} · ${condition}`}
    removalDescription="It will be removed from this reusable photo set. Saved and live listing snapshots are not changed."
    removalTitle="Remove this reusable listing photo?"
    removingId={removingKey}
    reordering={reordering}
    secondaryAction={sourceCopyIds.length ? {
      disabled: importing || images.length >= 12,
      icon: Images,
      label: importing ? "Adding saved photos…" : "Use saved Copy photos",
      onClick: () => { void importSavedCopyPhotos(); },
    } : undefined}
    storageWarning="Private listing-photo storage is not configured on this server."
    surface="plain"
    title={`${kindCopy[kind].label} photos`}
    uploading={uploading}
  />;
}

export function InventoryListingPhotoSets(props: Omit<Parameters<typeof ListingPhotoSetManager>[0], "kind" | "onImagesChange">) {
  const [kind, setKind] = useState<ListingPhotoKind>("individual");
  const instanceId = useId().replaceAll(":", "");
  const tabRefs = useRef<Partial<Record<ListingPhotoKind, HTMLButtonElement | null>>>({});

  function selectFromKeyboard(event: React.KeyboardEvent<HTMLButtonElement>, currentKind: ListingPhotoKind) {
    const currentIndex = listingPhotoKinds.indexOf(currentKind);
    const nextIndex = event.key === "ArrowRight"
      ? (currentIndex + 1) % listingPhotoKinds.length
      : event.key === "ArrowLeft"
        ? (currentIndex - 1 + listingPhotoKinds.length) % listingPhotoKinds.length
        : event.key === "Home"
          ? 0
          : event.key === "End"
            ? listingPhotoKinds.length - 1
            : null;
    if (nextIndex === null) return;
    event.preventDefault();
    const nextKind = listingPhotoKinds[nextIndex];
    setKind(nextKind);
    tabRefs.current[nextKind]?.focus();
  }

  return (
    <section aria-labelledby="listing-photo-sets-title" className="overflow-hidden rounded-xl border border-zinc-300 bg-white shadow-sm">
      <header className="px-4 pt-4 sm:px-5 sm:pt-5">
        <h5 className="font-black" id="listing-photo-sets-title">Listing photos</h5>
        <p className="mt-1 text-sm font-medium leading-5 text-zinc-600">Keep separate reusable photo sets for each way you sell this exact Printing and condition.</p>
      </header>
      <div className="px-3 pb-3 pt-3 sm:px-5 sm:pb-4">
        <div aria-label="Listing photo set" className="grid grid-cols-3 gap-1 rounded-lg bg-zinc-100 p-1" role="tablist">
          {listingPhotoKinds.map((candidate) => (
            <button
              aria-controls={`listing-photo-panel-${instanceId}-${candidate}`}
              aria-selected={kind === candidate}
              className={`min-h-11 cursor-pointer rounded-md px-2 text-sm font-bold transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-[#8a1f2d] motion-reduce:transition-none ${kind === candidate ? "bg-white text-[#8a1f2d] shadow-sm" : "text-zinc-600 hover:text-zinc-950"}`}
              id={`listing-photo-tab-${instanceId}-${candidate}`}
              key={candidate}
              onClick={() => setKind(candidate)}
              onKeyDown={(event) => selectFromKeyboard(event, candidate)}
              ref={(element) => { tabRefs.current[candidate] = element; }}
              role="tab"
              tabIndex={kind === candidate ? 0 : -1}
              type="button"
            >
              {kindCopy[candidate].label}
            </button>
          ))}
        </div>
      </div>
      <div className="grid min-w-0 border-t border-zinc-200 p-4 sm:p-5">
        {listingPhotoKinds.map((candidate) => {
          const active = kind === candidate;
          return (
            <div
              aria-hidden={!active}
              aria-labelledby={`listing-photo-tab-${instanceId}-${candidate}`}
              className={`col-start-1 row-start-1 h-full min-w-0 transition-opacity duration-150 ease-out motion-reduce:transition-none ${active ? "visible relative z-10 opacity-100" : "pointer-events-none invisible opacity-0"}`}
              id={`listing-photo-panel-${instanceId}-${candidate}`}
              inert={!active}
              key={candidate}
              role="tabpanel"
              tabIndex={0}
            >
              <ListingPhotoSetManager {...props} kind={candidate} />
            </div>
          );
        })}
      </div>
    </section>
  );
}

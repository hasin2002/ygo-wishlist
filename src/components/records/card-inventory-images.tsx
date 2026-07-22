"use client";

import Image from "next/image";
import { ArrowLeft, ArrowRight, Maximize2, Star, UploadCloud, X } from "lucide-react";
import { useEffect, useState } from "react";

type InventoryImage = { key: string; previewUrl: string; position: number };

export function CardInventoryImages({
  canUpload,
  cardName,
  copyId,
  onImagesChange,
}: {
  canUpload: boolean;
  cardName: string;
  copyId: string;
  onImagesChange?: (images: InventoryImage[]) => void;
}) {
  const [configured, setConfigured] = useState(true);
  const [images, setImages] = useState<InventoryImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [reordering, setReordering] = useState(false);
  const [removingKey, setRemovingKey] = useState<string | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<InventoryImage | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<InventoryImage | null>(null);

  useEffect(() => {
    let active = true;
    void fetch(`/api/inventory/card-images?copyId=${encodeURIComponent(copyId)}`)
      .then(async (response) => {
        const payload = await response.json() as { configured?: boolean; images?: InventoryImage[]; message?: string };
        if (!response.ok) throw new Error(payload.message || "Card photos could not be loaded.");
        if (!active) return;
        setConfigured(payload.configured !== false);
        setImages(payload.images ?? []);
      })
      .catch((error) => { if (active) setMessage(error instanceof Error ? error.message : "Card photos could not be loaded."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [copyId]);

  useEffect(() => {
    if (!preview) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setPreview(null); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [preview]);

  async function upload(file?: File) {
    if (!file) return;
    setUploading(true);
    setMessage(null);
    const form = new FormData();
    form.append("copyId", copyId);
    form.append("image", file);
    try {
      const response = await fetch("/api/inventory/card-images", { body: form, method: "POST" });
      const payload = await response.json() as { image?: InventoryImage; message?: string };
      if (!response.ok || !payload.image) throw new Error(payload.message || "The card image could not be uploaded.");
      const next = [...images, payload.image];
      setImages(next);
      onImagesChange?.(next);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The card image could not be uploaded.");
    } finally {
      setUploading(false);
    }
  }

  async function remove(image: InventoryImage) {
    setRemovingKey(image.key);
    setMessage(null);
    try {
      const response = await fetch("/api/inventory/card-images", {
        body: JSON.stringify({ copyId, key: image.key }),
        headers: { "Content-Type": "application/json" },
        method: "DELETE",
      });
      const payload = await response.json() as { message?: string; removed?: boolean };
      if (!response.ok || !payload.removed) throw new Error(payload.message || "The card image could not be removed.");
      setPreview((current) => current?.key === image.key ? null : current);
      setPendingRemoval(null);
      const next = images.filter((item) => item.key !== image.key).map((item, position) => ({ ...item, position }));
      setImages(next);
      onImagesChange?.(next);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The card image could not be removed.");
    } finally {
      setRemovingKey(null);
    }
  }

  async function reorder(keys: string[]) {
    setReordering(true);
    setMessage(null);
    try {
      const response = await fetch("/api/inventory/card-images", { body: JSON.stringify({ copyId, keys }), headers: { "Content-Type": "application/json" }, method: "PATCH" });
      const payload = await response.json() as { images?: InventoryImage[]; message?: string };
      if (!response.ok || !payload.images) throw new Error(payload.message || "Photo order could not be saved.");
      setImages(payload.images);
      onImagesChange?.(payload.images);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Photo order could not be saved.");
    } finally {
      setReordering(false);
    }
  }

  const changing = uploading || reordering || Boolean(removingKey);

  return (
    <section aria-labelledby={`card-images-title-${copyId}`} className="border-t border-zinc-200 bg-zinc-50 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h5 className="font-black" id={`card-images-title-${copyId}`}>Card photos</h5>
          <p className="mt-0.5 text-xs font-medium text-zinc-500">Private photos saved against this physical Copy.</p>
        </div>
        {canUpload && configured ? (
          <label className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-bold text-zinc-700 transition hover:border-[#8a1f2d] has-[:disabled]:cursor-wait has-[:disabled]:opacity-60">
            <UploadCloud className="size-4" />{uploading ? "Uploading…" : "Upload photo"}
            <input accept="image/avif,image/bmp,image/gif,image/heic,image/jpeg,image/png,image/tiff,image/webp" className="sr-only" disabled={changing} onChange={(event) => { void upload(event.target.files?.[0]); event.currentTarget.value = ""; }} type="file" />
          </label>
        ) : null}
      </div>
      {!configured && canUpload ? <p className="mt-3 text-sm font-semibold text-amber-800">Private card-photo storage is not configured on this server.</p> : null}
      {message ? <p className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-900" role="alert">{message}</p> : null}
      {pendingRemoval ? <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 p-3" role="alert"><p className="text-sm font-bold text-rose-950">Remove this photo from the Copy?</p><p className="mt-1 text-xs font-medium text-rose-900">It will also be removed from the private S3 archive.</p><div className="mt-3 flex flex-wrap justify-end gap-2"><button className="min-h-11 rounded-md border border-rose-300 bg-white px-3 text-sm font-bold text-rose-950" disabled={Boolean(removingKey)} onClick={() => setPendingRemoval(null)} type="button">Cancel</button><button className="min-h-11 rounded-md bg-rose-700 px-3 text-sm font-bold text-white disabled:cursor-wait disabled:opacity-60" disabled={Boolean(removingKey)} onClick={() => void remove(pendingRemoval)} type="button">{removingKey ? "Removing…" : "Remove photo"}</button></div></div> : null}
      {loading ? <p className="mt-3 text-sm font-medium text-zinc-500">Loading photos…</p> : images.length ? (
        <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
          {images.map((image, index) => (
            <li className="relative overflow-hidden rounded-md border border-zinc-200 bg-white" key={image.key}>
              <button aria-label={`Open ${cardName} photo ${index + 1}`} className="group grid w-full cursor-zoom-in gap-1 p-1 text-left focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-inset" onClick={() => setPreview(image)} type="button">
                <span className="relative block aspect-square overflow-hidden rounded bg-zinc-100"><Image alt={`${cardName} photo ${index + 1}`} className="h-full w-full object-contain" height={180} src={image.previewUrl} unoptimized width={180} /></span>
                <span className="flex items-center justify-between px-1 py-0.5 text-[11px] font-bold text-zinc-600"><span>{index === 0 ? "Primary" : `Photo ${index + 1}`}</span><Maximize2 className="size-3.5 text-zinc-400" /></span>
              </button>
              {canUpload ? <div className="grid grid-cols-2 border-t border-zinc-200"><button aria-label={`Set ${cardName} photo ${index + 1} as primary`} className="grid min-h-11 place-items-center border-b border-r border-zinc-200 text-zinc-700 hover:text-[#8a1f2d] focus-visible:ring-2 focus-visible:ring-[#8a1f2d] disabled:opacity-40" disabled={changing || index === 0} onClick={() => void reorder([image.key, ...images.filter((item) => item.key !== image.key).map((item) => item.key)])} type="button"><Star className="size-4" /></button><button aria-label={`Move ${cardName} photo ${index + 1} earlier`} className="grid min-h-11 place-items-center border-b border-zinc-200 text-zinc-700 focus-visible:ring-2 focus-visible:ring-[#8a1f2d] disabled:opacity-40" disabled={changing || index === 0} onClick={() => void reorder(images.map((item) => item.key).map((key, position, all) => position === index - 1 ? all[index] : position === index ? all[index - 1] : key))} type="button"><ArrowLeft className="size-4" /></button><button aria-label={`Move ${cardName} photo ${index + 1} later`} className="grid min-h-11 place-items-center border-r border-zinc-200 text-zinc-700 focus-visible:ring-2 focus-visible:ring-[#8a1f2d] disabled:opacity-40" disabled={changing || index === images.length - 1} onClick={() => void reorder(images.map((item) => item.key).map((key, position, all) => position === index ? all[index + 1] : position === index + 1 ? all[index] : key))} type="button"><ArrowRight className="size-4" /></button><button aria-label={`Remove ${cardName} photo ${index + 1}`} className="grid min-h-11 place-items-center text-zinc-700 hover:text-rose-700 focus-visible:ring-2 focus-visible:ring-rose-600 disabled:cursor-wait disabled:opacity-60" disabled={changing} onClick={() => setPendingRemoval(image)} type="button"><X className="size-4" /></button></div> : null}
            </li>
          ))}
        </ul>
      ) : <p className="mt-3 text-sm font-medium text-zinc-500">No photos uploaded for this Copy yet.</p>}
      {preview ? (
        <div aria-labelledby="card-photo-preview-title" aria-modal="true" className="fixed inset-0 z-[70] grid place-items-center bg-zinc-950/80 p-4 sm:p-8" role="dialog">
          <div className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-white/20 bg-zinc-950 shadow-2xl">
            <header className="flex items-center justify-between gap-4 border-b border-white/15 px-4 py-3 text-white"><div><h3 className="font-black" id="card-photo-preview-title">Card photo preview</h3><p className="mt-0.5 text-xs font-medium text-zinc-300">Saved privately in S3</p></div><button aria-label="Close card photo preview" autoFocus className="grid size-11 shrink-0 place-items-center rounded-md border border-white/25 bg-white/10 text-white hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white" onClick={() => setPreview(null)} type="button"><X className="size-5" /></button></header>
            <div className="grid min-h-0 flex-1 place-items-center overflow-auto p-3 sm:p-5"><Image alt={`${cardName} expanded photo`} className="max-h-[calc(100dvh-10rem)] h-auto w-auto max-w-full rounded-md object-contain" height={1_200} src={preview.previewUrl} unoptimized width={1_200} /></div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

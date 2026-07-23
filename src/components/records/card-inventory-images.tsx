"use client";

import Image from "next/image";
import { ArrowDown, ArrowUp, Star, Trash2, UploadCloud, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type DragEvent } from "react";

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
  const [draggingFiles, setDraggingFiles] = useState(false);
  const [arrangeKeys, setArrangeKeys] = useState<string[] | null>(null);
  const dragDepth = useRef(0);
  const arrangeRowRefs = useRef(new Map<string, HTMLLIElement>());
  const previousArrangeRowTops = useRef(new Map<string, number>());

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

  useLayoutEffect(() => {
    if (!arrangeKeys || previousArrangeRowTops.current.size === 0) return;
    const previousTops = previousArrangeRowTops.current;
    previousArrangeRowTops.current = new Map();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const animatedRows: HTMLLIElement[] = [];
    const frames: number[] = [];
    const timers: number[] = [];
    for (const [key, row] of arrangeRowRefs.current) {
      const previousTop = previousTops.get(key);
      if (previousTop === undefined) continue;
      const offset = previousTop - row.getBoundingClientRect().top;
      if (Math.abs(offset) < 1) continue;
      animatedRows.push(row);
      row.style.transition = "none";
      row.style.transform = `translateY(${offset}px)`;
      frames.push(window.requestAnimationFrame(() => {
        row.style.transition = "transform 180ms cubic-bezier(0.2, 0, 0, 1)";
        row.style.transform = "translateY(0)";
        timers.push(window.setTimeout(() => { row.style.removeProperty("transform"); row.style.removeProperty("transition"); }, 180));
      }));
    }
    return () => {
      frames.forEach((frame) => window.cancelAnimationFrame(frame));
      timers.forEach((timer) => window.clearTimeout(timer));
      animatedRows.forEach((row) => { row.style.removeProperty("transform"); row.style.removeProperty("transition"); });
    };
  }, [arrangeKeys]);

  async function upload(files: File[]) {
    if (!files.length) return;
    setUploading(true);
    setMessage(null);
    const next = [...images];
    const failures: string[] = [];
    for (const file of files) {
      const form = new FormData();
      form.append("copyId", copyId);
      form.append("image", file);
      try {
        const response = await fetch("/api/inventory/card-images", { body: form, method: "POST" });
        const payload = await response.json() as { image?: InventoryImage; message?: string };
        if (!response.ok || !payload.image) throw new Error(payload.message || "The card image could not be uploaded.");
        next.push(payload.image);
      } catch (error) {
        failures.push(`${file.name}: ${error instanceof Error ? error.message : "could not be uploaded."}`);
      }
    }
    try {
      setImages(next);
      onImagesChange?.(next);
      if (failures.length) setMessage(failures.join(" "));
    } finally {
      setUploading(false);
    }
  }

  function acceptsFiles(event: DragEvent<HTMLElement>) {
    return Array.from(event.dataTransfer.types).includes("Files");
  }

  function handleDragEnter(event: DragEvent<HTMLLabelElement>) {
    if (!acceptsFiles(event)) return;
    event.preventDefault();
    if (changing || arranging) return;
    dragDepth.current += 1;
    setDraggingFiles(true);
  }

  function handleDragLeave(event: DragEvent<HTMLLabelElement>) {
    if (!acceptsFiles(event)) return;
    if (event.currentTarget.contains(event.relatedTarget as Node)) return;
    dragDepth.current = 0;
    setDraggingFiles(false);
  }

  function handleDragOver(event: DragEvent<HTMLLabelElement>) {
    if (!acceptsFiles(event)) return;
    event.preventDefault();
    if (changing || arranging) return;
    event.dataTransfer.dropEffect = "copy";
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    if (!acceptsFiles(event)) return;
    event.preventDefault();
    if (changing || arranging) return;
    dragDepth.current = 0;
    setDraggingFiles(false);
    void upload(Array.from(event.dataTransfer.files));
  }

  function movedKeys(key: string, targetKey: string, currentKeys = images.map((image) => image.key)) {
    const keys = [...currentKeys];
    const from = keys.indexOf(key);
    const to = keys.indexOf(targetKey);
    if (from < 0 || to < 0 || from === to) return keys;
    const [moved] = keys.splice(from, 1);
    keys.splice(to, 0, moved);
    return keys;
  }

  function moveArrangedPhoto(key: string, offset: -1 | 1) {
    previousArrangeRowTops.current = new Map(
      Array.from(arrangeRowRefs.current, ([rowKey, row]) => [rowKey, row.getBoundingClientRect().top]),
    );
    setArrangeKeys((current) => {
      if (!current) return current;
      const from = current.indexOf(key);
      const to = from + offset;
      if (from < 0 || to < 0 || to >= current.length) return current;
      const next = [...current];
      [next[from], next[to]] = [next[to], next[from]];
      return next;
    });
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
    const previousImages = images;
    const imageByKey = new Map(images.map((image) => [image.key, image]));
    const optimisticImages = keys
      .map((key, position) => {
        const image = imageByKey.get(key);
        return image ? { ...image, position } : null;
      })
      .filter((image): image is InventoryImage => image !== null);
    if (optimisticImages.length === images.length) setImages(optimisticImages);
    setReordering(true);
    setMessage(null);
    try {
      const response = await fetch("/api/inventory/card-images", { body: JSON.stringify({ copyId, keys }), headers: { "Content-Type": "application/json" }, method: "PATCH" });
      const payload = await response.json() as { images?: InventoryImage[]; message?: string };
      if (!response.ok || !payload.images) throw new Error(payload.message || "Photo order could not be saved.");
      setImages(payload.images);
      onImagesChange?.(payload.images);
      return true;
    } catch (error) {
      setImages(previousImages);
      setMessage(error instanceof Error ? error.message : "Photo order could not be saved.");
      return false;
    } finally {
      setReordering(false);
    }
  }

  async function saveArrangedOrder() {
    if (!arrangeKeys) return;
    if (await reorder(arrangeKeys)) setArrangeKeys(null);
  }

  const changing = uploading || reordering || Boolean(removingKey);
  const arranging = arrangeKeys !== null;
  const imageByKey = new Map(images.map((image) => [image.key, image]));
  const arrangedImages = (arrangeKeys ?? [])
    .map((key) => imageByKey.get(key))
    .filter((image): image is InventoryImage => image !== undefined);

  return (
    <section aria-labelledby={`card-images-title-${copyId}`} className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h5 className="font-black" id={`card-images-title-${copyId}`}>Card photos</h5>
          <p className="mt-0.5 text-xs font-medium text-zinc-500">Private photos saved against this physical Copy.</p>
        </div>
        {!loading && canUpload && images.length > 1 ? <button className="min-h-11 rounded-md border border-zinc-300 bg-white px-3 text-sm font-bold text-zinc-700 shadow-sm transition-colors hover:border-zinc-400 hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-[#8a1f2d] disabled:cursor-wait disabled:opacity-60" disabled={reordering} onClick={() => { setPendingRemoval(null); setArrangeKeys(arranging ? null : images.map((image) => image.key)); }} type="button">{arranging ? "Cancel" : "Arrange photos"}</button> : null}
      </div>
      {canUpload && configured && !arranging ? <label className={`mt-3 grid cursor-pointer place-items-center rounded-lg border-2 border-dashed px-4 text-center transition ${images.length ? "min-h-16 py-3" : "min-h-28 py-5"} ${draggingFiles ? "border-[#8a1f2d] bg-rose-50 text-[#8a1f2d]" : "border-zinc-300 bg-white text-zinc-600 hover:border-[#8a1f2d] hover:bg-rose-50/50"} ${changing ? "cursor-wait opacity-60" : ""}`} onDragEnter={handleDragEnter} onDragLeave={handleDragLeave} onDragOver={handleDragOver} onDrop={handleDrop}><input accept="image/avif,image/bmp,image/gif,image/heic,image/jpeg,image/png,image/tiff,image/webp" className="sr-only" disabled={changing} multiple onChange={(event) => { void upload(Array.from(event.target.files ?? [])); event.currentTarget.value = ""; }} type="file" /><span className={images.length ? "flex items-center justify-center gap-2" : ""}><UploadCloud aria-hidden="true" className={`${images.length ? "size-4" : "mx-auto size-5"}`} /><span><span className={`${images.length ? "" : "mt-2"} block text-sm font-bold`}>{uploading ? "Uploading photos…" : draggingFiles ? "Drop photos to upload" : images.length ? "Add more photos" : "Drag photos here, or click to choose files"}</span>{!images.length ? <span className="mt-1 block text-xs font-medium text-zinc-500">Add one or more private photos. JPG, PNG, WEBP and more · 12 MB each.</span> : null}</span></span></label> : null}
      {!configured && canUpload ? <p className="mt-3 text-sm font-semibold text-amber-800">Private card-photo storage is not configured on this server.</p> : null}
      {message ? <p className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-900" role="alert">{message}</p> : null}
      {pendingRemoval ? <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 p-3" role="alert"><p className="text-sm font-bold text-rose-950">Remove this photo from the Copy?</p><p className="mt-1 text-xs font-medium text-rose-900">It will also be removed from the private S3 archive.</p><div className="mt-3 flex flex-wrap justify-end gap-2"><button className="min-h-11 rounded-md border border-rose-300 bg-white px-3 text-sm font-bold text-rose-950" disabled={Boolean(removingKey)} onClick={() => setPendingRemoval(null)} type="button">Cancel</button><button className="min-h-11 rounded-md bg-rose-700 px-3 text-sm font-bold text-white disabled:cursor-wait disabled:opacity-60" disabled={Boolean(removingKey)} onClick={() => void remove(pendingRemoval)} type="button">{removingKey ? "Removing…" : "Remove photo"}</button></div></div> : null}
      {loading ? <p className="mt-3 text-sm font-medium text-zinc-500">Loading photos…</p> : arranging ? (
        <div className="mt-3">
          <p className="text-sm font-semibold text-zinc-700">Use the arrows to set the order. The first photo will be the primary photo.</p>
          <ol className="mt-3 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
            {arrangedImages.map((image, index) => <li className="grid grid-cols-2 items-stretch gap-2 border-b border-zinc-200 p-2 last:border-b-0 sm:flex sm:items-center sm:gap-3 sm:p-3" key={image.key} ref={(row) => { if (row) arrangeRowRefs.current.set(image.key, row); else arrangeRowRefs.current.delete(image.key); }}>
              <button aria-label={`Open ${cardName} photo ${index + 1}`} className="block aspect-square w-full cursor-zoom-in overflow-hidden rounded-md bg-zinc-100 touch-manipulation focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-offset-1 sm:size-16 sm:shrink-0" onClick={() => setPreview(image)} type="button"><Image alt="" className="h-full w-full object-cover" height={128} src={image.previewUrl} unoptimized width={128} /></button>
              <div className="hidden min-w-0 flex-1 sm:block"><p className="font-bold text-zinc-900">Photo {index + 1}</p><p className="mt-0.5 text-xs font-medium text-zinc-500">{index === 0 ? "Primary after save" : `Position ${index + 1}`}</p></div>
              <div className="grid min-h-full grid-cols-2 gap-2 sm:ml-auto sm:flex sm:min-h-0 sm:shrink-0"><button aria-label={`Move ${cardName} photo ${index + 1} earlier`} className="grid h-full min-h-11 w-full touch-manipulation place-items-center rounded-md border border-zinc-200 bg-zinc-50 text-zinc-600 transition duration-150 hover:border-zinc-300 hover:bg-zinc-100 hover:text-[#8a1f2d] active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-30 sm:size-11" disabled={reordering || index === 0} onClick={() => moveArrangedPhoto(image.key, -1)} type="button"><ArrowUp aria-hidden="true" className="size-5 sm:size-4" /></button><button aria-label={`Move ${cardName} photo ${index + 1} later`} className="grid h-full min-h-11 w-full touch-manipulation place-items-center rounded-md border border-zinc-200 bg-zinc-50 text-zinc-600 transition duration-150 hover:border-zinc-300 hover:bg-zinc-100 hover:text-[#8a1f2d] active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-30 sm:size-11" disabled={reordering || index === arrangedImages.length - 1} onClick={() => moveArrangedPhoto(image.key, 1)} type="button"><ArrowDown aria-hidden="true" className="size-5 sm:size-4" /></button></div>
            </li>)}
          </ol>
          <button className="mt-3 min-h-11 w-full rounded-md bg-[#981d2d] px-4 text-sm font-bold text-white shadow-sm transition-colors hover:bg-[#7f1826] focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60" disabled={reordering} onClick={() => void saveArrangedOrder()} type="button">{reordering ? "Saving order…" : "Save photo order"}</button>
        </div>
      ) : images.length ? (
        <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(9rem,12rem))]">
          {images.map((image, index) => <li className="relative overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm" key={image.key}>
            <button aria-label={`Open ${cardName} photo ${index + 1}${index === 0 ? ", primary photo" : ""}`} className="group grid w-full cursor-zoom-in text-left focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-inset" onClick={() => setPreview(image)} onKeyDown={(event) => { if (!event.altKey || changing || !canUpload) return; const offset = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0; if (!offset) return; const target = images[index + offset]; if (!target) return; event.preventDefault(); void reorder(movedKeys(image.key, target.key)); }} type="button"><span className="relative block aspect-square overflow-hidden bg-zinc-100"><Image alt={`${cardName} photo ${index + 1}`} className="h-full w-full object-cover" draggable={false} height={320} src={image.previewUrl} unoptimized width={320} /></span></button>
            {canUpload ? <><button aria-label={index === 0 ? `${cardName} photo ${index + 1} is the primary photo` : `Set ${cardName} photo ${index + 1} as primary`} aria-pressed={index === 0} className={`absolute left-0.5 top-0.5 z-10 grid size-11 place-items-center rounded-full transition focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-offset-1 disabled:cursor-default ${index === 0 ? "text-[#8a1f2d]" : "text-zinc-500"}`} disabled={changing || index === 0} onClick={() => void reorder([image.key, ...images.filter((item) => item.key !== image.key).map((item) => item.key)])} type="button"><span className="grid size-7 place-items-center rounded-full border border-zinc-200/80 bg-white/90 shadow-sm backdrop-blur-sm transition hover:border-[#8a1f2d]/40 hover:bg-white"><Star aria-hidden="true" className={`size-3.5 ${index === 0 ? "fill-current" : ""}`} /></span></button><button aria-label={`Remove ${cardName} photo ${index + 1}`} className="absolute right-0.5 top-0.5 z-10 grid size-11 place-items-center rounded-full text-zinc-500 transition hover:text-rose-700 focus-visible:ring-2 focus-visible:ring-rose-600 focus-visible:ring-offset-1 disabled:cursor-wait disabled:opacity-60" disabled={changing} onClick={() => setPendingRemoval(image)} type="button"><span className="grid size-7 place-items-center rounded-full border border-zinc-200/80 bg-white/90 shadow-sm backdrop-blur-sm transition hover:border-rose-200 hover:bg-rose-50"><Trash2 aria-hidden="true" className="size-3.5" /></span></button></> : null}
          </li>)}
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

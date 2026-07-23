"use client";

import Image from "next/image";
import { Star, Trash2, UploadCloud, X } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent, type PointerEvent } from "react";

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
  const [draggedKey, setDraggedKey] = useState<string | null>(null);
  const [dragTargetKey, setDragTargetKey] = useState<string | null>(null);
  const dragDepth = useRef(0);
  const pointerDrag = useRef<{ key: string; pointerId: number; startX: number; startY: number; moved: boolean } | null>(null);
  const pointerDropTarget = useRef<string | null>(null);
  const suppressPreview = useRef(false);

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
    if (changing) return;
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
    if (changing) return;
    event.dataTransfer.dropEffect = "copy";
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    if (!acceptsFiles(event)) return;
    event.preventDefault();
    if (changing) return;
    dragDepth.current = 0;
    setDraggingFiles(false);
    void upload(Array.from(event.dataTransfer.files));
  }

  function movedKeys(key: string, targetKey: string) {
    const keys = images.map((image) => image.key);
    const from = keys.indexOf(key);
    const to = keys.indexOf(targetKey);
    if (from < 0 || to < 0 || from === to) return keys;
    const [moved] = keys.splice(from, 1);
    keys.splice(to, 0, moved);
    return keys;
  }

  function resetPhotoDrag() {
    pointerDrag.current = null;
    pointerDropTarget.current = null;
    setDraggedKey(null);
    setDragTargetKey(null);
  }

  function handlePhotoPointerDown(event: PointerEvent<HTMLButtonElement>, image: InventoryImage) {
    if (!canUpload || changing || images.length < 2 || event.button !== 0) return;
    pointerDrag.current = { key: image.key, moved: false, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePhotoPointerMove(event: PointerEvent<HTMLButtonElement>) {
    const drag = pointerDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
    if (!drag.moved && distance < 8) return;
    event.preventDefault();
    drag.moved = true;
    setDraggedKey(drag.key);
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-photo-key]");
    pointerDropTarget.current = target?.dataset.photoKey ?? drag.key;
    setDragTargetKey(pointerDropTarget.current);
  }

  function handlePhotoPointerEnd(event: PointerEvent<HTMLButtonElement>) {
    const drag = pointerDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const targetKey = pointerDropTarget.current;
    if (drag.moved) {
      suppressPreview.current = true;
      if (targetKey && targetKey !== drag.key) void reorder(movedKeys(drag.key, targetKey));
      window.setTimeout(() => { suppressPreview.current = false; }, 0);
    }
    resetPhotoDrag();
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
    <section aria-labelledby={`card-images-title-${copyId}`} className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h5 className="font-black" id={`card-images-title-${copyId}`}>Card photos</h5>
          <p className="mt-0.5 text-xs font-medium text-zinc-500">Private photos saved against this physical Copy.</p>
        </div>
      </div>
      {canUpload && configured ? <label className={`mt-3 grid cursor-pointer place-items-center rounded-lg border-2 border-dashed px-4 text-center transition ${images.length ? "min-h-16 py-3" : "min-h-28 py-5"} ${draggingFiles ? "border-[#8a1f2d] bg-rose-50 text-[#8a1f2d]" : "border-zinc-300 bg-white text-zinc-600 hover:border-[#8a1f2d] hover:bg-rose-50/50"} ${changing ? "cursor-wait opacity-60" : ""}`} onDragEnter={handleDragEnter} onDragLeave={handleDragLeave} onDragOver={handleDragOver} onDrop={handleDrop}><input accept="image/avif,image/bmp,image/gif,image/heic,image/jpeg,image/png,image/tiff,image/webp" className="sr-only" disabled={changing} multiple onChange={(event) => { void upload(Array.from(event.target.files ?? [])); event.currentTarget.value = ""; }} type="file" /><span className={images.length ? "flex items-center justify-center gap-2" : ""}><UploadCloud aria-hidden="true" className={`${images.length ? "size-4" : "mx-auto size-5"}`} /><span><span className={`${images.length ? "" : "mt-2"} block text-sm font-bold`}>{uploading ? "Uploading photos…" : draggingFiles ? "Drop photos to upload" : images.length ? "Add more photos" : "Drag photos here, or click to choose files"}</span>{!images.length ? <span className="mt-1 block text-xs font-medium text-zinc-500">Add one or more private photos. JPG, PNG, WEBP and more · 12 MB each.</span> : null}</span></span></label> : null}
      {!configured && canUpload ? <p className="mt-3 text-sm font-semibold text-amber-800">Private card-photo storage is not configured on this server.</p> : null}
      {message ? <p className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-900" role="alert">{message}</p> : null}
      {pendingRemoval ? <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 p-3" role="alert"><p className="text-sm font-bold text-rose-950">Remove this photo from the Copy?</p><p className="mt-1 text-xs font-medium text-rose-900">It will also be removed from the private S3 archive.</p><div className="mt-3 flex flex-wrap justify-end gap-2"><button className="min-h-11 rounded-md border border-rose-300 bg-white px-3 text-sm font-bold text-rose-950" disabled={Boolean(removingKey)} onClick={() => setPendingRemoval(null)} type="button">Cancel</button><button className="min-h-11 rounded-md bg-rose-700 px-3 text-sm font-bold text-white disabled:cursor-wait disabled:opacity-60" disabled={Boolean(removingKey)} onClick={() => void remove(pendingRemoval)} type="button">{removingKey ? "Removing…" : "Remove photo"}</button></div></div> : null}
      {loading ? <p className="mt-3 text-sm font-medium text-zinc-500">Loading photos…</p> : images.length ? (
        <>{images.length > 1 ? <p className="mt-3 text-xs font-medium text-zinc-500">Drag photos to reorder. On a keyboard, focus a photo and use Alt + Left/Right.</p> : null}<ul className={`${images.length > 1 ? "mt-2" : "mt-3"} grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(9rem,12rem))]`}>
          {images.map((image, index) => (
            <li className={`relative overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm transition motion-reduce:transition-none ${draggedKey === image.key ? "scale-[0.98] opacity-60" : ""} ${dragTargetKey === image.key && draggedKey !== image.key ? "border-[#8a1f2d] ring-2 ring-[#8a1f2d]/20" : ""}`} data-photo-key={image.key} key={image.key}>
              <button aria-label={`Open ${cardName} photo ${index + 1}${index === 0 ? ", primary photo" : ""}`} className={`group grid w-full text-left focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-inset ${canUpload && images.length > 1 ? "cursor-grab touch-none active:cursor-grabbing" : "cursor-zoom-in"}`} onClick={() => { if (suppressPreview.current) return; setPreview(image); }} onKeyDown={(event) => { if (!event.altKey || changing || !canUpload) return; const offset = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0; if (!offset) return; const target = images[index + offset]; if (!target) return; event.preventDefault(); void reorder(movedKeys(image.key, target.key)); }} onPointerCancel={resetPhotoDrag} onPointerDown={(event) => handlePhotoPointerDown(event, image)} onPointerMove={handlePhotoPointerMove} onPointerUp={handlePhotoPointerEnd} type="button">
                <span className="relative block aspect-square overflow-hidden bg-zinc-100"><Image alt={`${cardName} photo ${index + 1}`} className="h-full w-full object-cover" draggable={false} height={320} src={image.previewUrl} unoptimized width={320} /></span>
              </button>
              {canUpload ? <><button aria-label={index === 0 ? `${cardName} photo ${index + 1} is the primary photo` : `Set ${cardName} photo ${index + 1} as primary`} aria-pressed={index === 0} className={`absolute left-0.5 top-0.5 z-10 grid size-11 place-items-center rounded-full transition focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-offset-1 disabled:cursor-default ${index === 0 ? "text-[#8a1f2d]" : "text-zinc-500"}`} data-photo-action disabled={changing || index === 0} onClick={() => void reorder([image.key, ...images.filter((item) => item.key !== image.key).map((item) => item.key)])} type="button"><span className="grid size-7 place-items-center rounded-full border border-zinc-200/80 bg-white/90 shadow-sm backdrop-blur-sm transition hover:border-[#8a1f2d]/40 hover:bg-white"><Star aria-hidden="true" className={`size-3.5 ${index === 0 ? "fill-current" : ""}`} /></span></button><button aria-label={`Remove ${cardName} photo ${index + 1}`} className="absolute right-0.5 top-0.5 z-10 grid size-11 place-items-center rounded-full text-zinc-500 transition hover:text-rose-700 focus-visible:ring-2 focus-visible:ring-rose-600 focus-visible:ring-offset-1 disabled:cursor-wait disabled:opacity-60" data-photo-action disabled={changing} onClick={() => setPendingRemoval(image)} type="button"><span className="grid size-7 place-items-center rounded-full border border-zinc-200/80 bg-white/90 shadow-sm backdrop-blur-sm transition hover:border-rose-200 hover:bg-rose-50"><Trash2 aria-hidden="true" className="size-3.5" /></span></button></> : null}
            </li>
          ))}
        </ul></>
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

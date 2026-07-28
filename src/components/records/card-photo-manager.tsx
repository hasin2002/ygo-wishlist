"use client";

import Image from "next/image";
import {
  ArrowDown,
  ArrowUp,
  Camera,
  ImagePlus,
  Star,
  Trash2,
  UploadCloud,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent,
} from "react";

export type CardPhotoManagerImage = {
  id: string;
  previewUrl: string;
};

type SecondaryAction = {
  controls?: string;
  disabled?: boolean;
  expanded?: boolean;
  hasPopup?: "dialog";
  icon?: LucideIcon;
  label: string;
  onClick: () => void;
};

export function CardPhotoManager({
  canManage,
  cardName,
  changing,
  configured,
  description,
  emptyText,
  error,
  eyebrow,
  id,
  images,
  loading,
  loadingText = "Loading photos…",
  maxImages,
  message,
  onRemove,
  onReorder,
  onUpload,
  previewSubtitle,
  previewNotice,
  removalDescription,
  removalTitle,
  removingId,
  reordering,
  secondaryAction,
  storageWarning,
  title,
  uploading,
}: {
  canManage: boolean;
  cardName: string;
  changing: boolean;
  configured: boolean;
  description: string;
  emptyText: string;
  error?: string;
  eyebrow?: string;
  id: string;
  images: CardPhotoManagerImage[];
  loading: boolean;
  loadingText?: string;
  maxImages?: number;
  message?: string | null;
  onRemove: (id: string) => Promise<boolean>;
  onReorder: (ids: string[]) => Promise<boolean>;
  onUpload: (files: File[]) => Promise<void>;
  previewSubtitle: string;
  previewNotice?: string;
  removalDescription: string;
  removalTitle: string;
  removingId?: string | null;
  reordering: boolean;
  secondaryAction?: SecondaryAction;
  storageWarning: string;
  title: string;
  uploading: boolean;
}) {
  const [arrangeIds, setArrangeIds] = useState<string[] | null>(null);
  const [arrangeAnnouncement, setArrangeAnnouncement] = useState("");
  const [draggingFiles, setDraggingFiles] = useState(false);
  const [pendingRemovalId, setPendingRemovalId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const arrangeRowRefs = useRef(new Map<string, HTMLLIElement>());
  const previousArrangeRowTops = useRef(new Map<string, number>());
  const dragDepth = useRef(0);
  const titleId = `${id}-title`;
  const arranging = arrangeIds !== null;
  const atLimit = maxImages !== undefined && images.length >= maxImages;
  const imageById = new Map(images.map((image) => [image.id, image]));
  const arrangedImages = (arrangeIds ?? [])
    .map((imageId) => imageById.get(imageId))
    .filter((image): image is CardPhotoManagerImage => image !== undefined);
  const preview = previewId ? imageById.get(previewId) : undefined;

  useEffect(() => {
    if (!preview) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreviewId(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [preview]);

  useLayoutEffect(() => {
    if (!arrangeIds || previousArrangeRowTops.current.size === 0) return;
    const previousTops = previousArrangeRowTops.current;
    previousArrangeRowTops.current = new Map();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const animatedRows: HTMLLIElement[] = [];
    const frames: number[] = [];
    const timers: number[] = [];
    for (const [imageId, row] of arrangeRowRefs.current) {
      const previousTop = previousTops.get(imageId);
      if (previousTop === undefined) continue;
      const offset = previousTop - row.getBoundingClientRect().top;
      if (Math.abs(offset) < 1) continue;
      animatedRows.push(row);
      row.style.transition = "none";
      row.style.transform = `translateY(${offset}px)`;
      frames.push(window.requestAnimationFrame(() => {
        row.style.transition = "transform 180ms cubic-bezier(0.2, 0, 0, 1)";
        row.style.transform = "translateY(0)";
        timers.push(window.setTimeout(() => {
          row.style.removeProperty("transform");
          row.style.removeProperty("transition");
        }, 180));
      }));
    }
    return () => {
      frames.forEach((frame) => window.cancelAnimationFrame(frame));
      timers.forEach((timer) => window.clearTimeout(timer));
      animatedRows.forEach((row) => {
        row.style.removeProperty("transform");
        row.style.removeProperty("transition");
      });
    };
  }, [arrangeIds]);

  function acceptedFiles(event: DragEvent<HTMLElement>) {
    return Array.from(event.dataTransfer.types).includes("Files");
  }

  function uploadFiles(files: File[]) {
    const remaining = maxImages === undefined ? files.length : Math.max(0, maxImages - images.length);
    if (!remaining) return;
    void onUpload(files.slice(0, remaining));
  }

  function handleDragEnter(event: DragEvent<HTMLLabelElement>) {
    if (!acceptedFiles(event)) return;
    event.preventDefault();
    if (changing || arranging || atLimit) return;
    dragDepth.current += 1;
    setDraggingFiles(true);
  }

  function handleDragLeave(event: DragEvent<HTMLLabelElement>) {
    if (!acceptedFiles(event)) return;
    if (event.currentTarget.contains(event.relatedTarget as Node)) return;
    dragDepth.current = 0;
    setDraggingFiles(false);
  }

  function handleDragOver(event: DragEvent<HTMLLabelElement>) {
    if (!acceptedFiles(event)) return;
    event.preventDefault();
    if (changing || arranging || atLimit) return;
    event.dataTransfer.dropEffect = "copy";
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    if (!acceptedFiles(event)) return;
    event.preventDefault();
    if (changing || arranging || atLimit) return;
    dragDepth.current = 0;
    setDraggingFiles(false);
    uploadFiles(Array.from(event.dataTransfer.files));
  }

  function rememberRowPositions() {
    previousArrangeRowTops.current = new Map(
      Array.from(arrangeRowRefs.current, ([imageId, row]) => [
        imageId,
        row.getBoundingClientRect().top,
      ]),
    );
  }

  function moveArrangedPhoto(imageId: string, offset: -1 | 1) {
    if (!arrangeIds) return;
    const from = arrangeIds.indexOf(imageId);
    const to = from + offset;
    if (from < 0 || to < 0 || to >= arrangeIds.length) return;
    rememberRowPositions();
    const next = [...arrangeIds];
    [next[from], next[to]] = [next[to], next[from]];
    setArrangeIds(next);
    setArrangeAnnouncement(`Photo moved to position ${to + 1}.`);
  }

  function makeArrangedPhotoPrimary(imageId: string) {
    if (!arrangeIds) return;
    rememberRowPositions();
    setArrangeIds([imageId, ...arrangeIds.filter((idValue) => idValue !== imageId)]);
    setArrangeAnnouncement("Photo moved to primary position.");
  }

  function movedIds(imageId: string, targetId: string) {
    const ids = images.map((image) => image.id);
    const from = ids.indexOf(imageId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0 || from === to) return ids;
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);
    return ids;
  }

  async function saveArrangedOrder() {
    if (!arrangeIds) return;
    if (await onReorder(arrangeIds)) {
      setArrangeIds(null);
      setArrangeAnnouncement("");
    }
  }

  async function confirmRemoval() {
    if (!pendingRemovalId) return;
    if (await onRemove(pendingRemovalId)) {
      setPreviewId((current) => current === pendingRemovalId ? null : current);
      setPendingRemovalId(null);
    }
  }

  const SecondaryIcon = secondaryAction?.icon ?? ImagePlus;
  const uploadDisabled = changing || atLimit;

  return (
    <section aria-busy={changing} aria-labelledby={titleId} className="min-w-0 max-w-full rounded-xl border border-zinc-300 bg-white p-4 shadow-sm" id={id} tabIndex={-1}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {eyebrow ? <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#8a1f2d]">{eyebrow}</p> : null}
          <h2 className={`${eyebrow ? "mt-1 text-lg" : ""} font-black`} id={titleId}>{title}</h2>
          <p className="mt-1 text-sm font-medium text-zinc-600">{description}</p>
        </div>
        <div className="flex items-center gap-2">
          {maxImages !== undefined ? <span aria-live="polite" className="rounded-md bg-zinc-100 px-2 py-1 text-xs font-bold text-zinc-600">{images.length}/{maxImages}</span> : null}
          {!loading && canManage && images.length > 1 ? (
            <button
              className="min-h-11 rounded-md border border-zinc-300 bg-white px-3 text-sm font-bold text-zinc-700 shadow-sm transition-colors hover:border-zinc-400 hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-[#8a1f2d] disabled:cursor-wait disabled:opacity-60"
              disabled={reordering}
              onClick={() => {
                setPendingRemovalId(null);
                setArrangeIds(arranging ? null : images.map((image) => image.id));
                setArrangeAnnouncement("");
              }}
              type="button"
            >
              {arranging ? "Cancel arranging" : "Arrange photos"}
            </button>
          ) : null}
        </div>
      </div>

      {!arranging && ((canManage && configured && !atLimit) || secondaryAction) ? (
        <div className={`mt-4 flex min-w-0 max-w-full flex-wrap gap-2 ${secondaryAction ? "" : "sm:hidden"}`}>
          {canManage && configured && !atLimit ? (
            <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-bold text-zinc-700 transition-colors hover:border-zinc-400 hover:bg-zinc-50 has-[:disabled]:cursor-wait has-[:disabled]:opacity-50 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[#8a1f2d] has-[:focus-visible]:ring-offset-2 sm:hidden">
              <Camera aria-hidden="true" className="size-4" />
              {uploading ? "Uploading…" : "Take photo on phone"}
              <input
                accept="image/*"
                capture="environment"
                className="sr-only"
                disabled={uploadDisabled}
                onChange={(event) => {
                  uploadFiles(Array.from(event.target.files ?? []));
                  event.currentTarget.value = "";
                }}
                type="file"
              />
            </label>
          ) : null}
          {secondaryAction ? (
            <button
              aria-controls={secondaryAction.controls}
              aria-expanded={secondaryAction.expanded}
              aria-haspopup={secondaryAction.hasPopup}
              className="inline-flex min-h-11 min-w-0 max-w-full items-center gap-2 whitespace-normal rounded-md border border-zinc-300 bg-white px-3 text-left text-sm font-bold text-zinc-700 transition-colors hover:border-zinc-400 hover:bg-zinc-50 focus-visible:ring-2 focus-visible:ring-[#8a1f2d] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={secondaryAction.disabled || changing || atLimit}
              onClick={secondaryAction.onClick}
              type="button"
            >
              <SecondaryIcon aria-hidden="true" className="size-4" />
              {secondaryAction.label}
            </button>
          ) : null}
        </div>
      ) : null}

      {canManage && configured && !arranging && !atLimit ? (
        <label
          className={`mt-3 grid cursor-pointer place-items-center rounded-lg border-2 border-dashed px-4 text-center transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[#8a1f2d] has-[:focus-visible]:ring-offset-2 ${!secondaryAction ? "sm:mt-4" : ""} ${images.length ? "min-h-16 py-3" : "min-h-28 py-5"} ${draggingFiles ? "border-[#8a1f2d] bg-rose-50 text-[#8a1f2d]" : "border-zinc-300 bg-zinc-50 text-zinc-600 hover:border-[#8a1f2d] hover:bg-rose-50/50"} ${changing ? "cursor-wait opacity-60" : ""}`}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          <input
            accept="image/avif,image/bmp,image/gif,image/heic,image/jpeg,image/png,image/tiff,image/webp"
            className="sr-only"
            disabled={uploadDisabled}
            multiple
            onChange={(event) => {
              uploadFiles(Array.from(event.target.files ?? []));
              event.currentTarget.value = "";
            }}
            type="file"
          />
          <span className={images.length ? "flex items-center justify-center gap-2" : ""}>
            <UploadCloud aria-hidden="true" className={images.length ? "size-4" : "mx-auto size-5"} />
            <span>
              <span className={`${images.length ? "" : "mt-2"} block text-sm font-bold`}>
                {uploading ? "Uploading photos…" : draggingFiles ? "Drop photos to upload" : images.length ? "Add more photos" : "Upload photos"}
              </span>
              {!images.length ? <span className="mt-1 block text-xs font-medium text-zinc-500">Choose one or more images, or drag them here · 12 MB each.</span> : null}
            </span>
          </span>
        </label>
      ) : null}

      {previewNotice ? (
        <div className="mt-3 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-3">
          <p className="text-sm font-medium leading-5 text-zinc-600">{previewNotice}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="inline-flex min-h-11 items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-bold text-zinc-500 disabled:cursor-not-allowed disabled:opacity-70" disabled type="button"><UploadCloud aria-hidden="true" className="size-4" />Upload photos</button>
            <button className="inline-flex min-h-11 items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-bold text-zinc-500 disabled:cursor-not-allowed disabled:opacity-70 sm:hidden" disabled type="button"><Camera aria-hidden="true" className="size-4" />Take photo on phone</button>
          </div>
        </div>
      ) : null}

      {!configured && canManage ? <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">{storageWarning}</p> : null}
      {message ? <p className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-900" role="alert">{message}</p> : null}
      {error ? <p className="mt-3 text-xs font-bold text-rose-700">{error}</p> : null}

      {pendingRemovalId ? (
        <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 p-3" role="alert">
          <p className="text-sm font-bold text-rose-950">{removalTitle}</p>
          <p className="mt-1 text-xs font-medium text-rose-900">{removalDescription}</p>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <button className="min-h-11 rounded-md border border-rose-300 bg-white px-3 text-sm font-bold text-rose-950" disabled={Boolean(removingId)} onClick={() => setPendingRemovalId(null)} type="button">Cancel</button>
            <button className="min-h-11 rounded-md bg-rose-700 px-3 text-sm font-bold text-white disabled:cursor-wait disabled:opacity-60" disabled={Boolean(removingId)} onClick={() => void confirmRemoval()} type="button">{removingId ? "Removing…" : "Remove photo"}</button>
          </div>
        </div>
      ) : null}

      {loading ? <p className="mt-4 text-sm font-medium text-zinc-500" role="status">{loadingText}</p> : arranging ? (
        <div className="mt-4">
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
            <p className="text-sm font-black text-zinc-900">Set the order buyers will see</p>
            <p className="mt-1 text-xs font-medium leading-5 text-zinc-600">The first photo is primary. Use the clearly labeled controls below, then save your changes.</p>
          </div>
          <p aria-live="polite" className="sr-only">{arrangeAnnouncement}</p>
          <ol className="mt-3 grid gap-2">
            {arrangedImages.map((image, index) => (
              <li
                className={`grid grid-cols-[3rem_minmax(0,1fr)] gap-3 rounded-lg border bg-white p-2.5 shadow-sm sm:grid-cols-[3rem_4.5rem_minmax(0,1fr)_auto] sm:items-center ${index === 0 ? "border-[#8a1f2d]/40 ring-1 ring-[#8a1f2d]/10" : "border-zinc-200"}`}
                key={image.id}
                ref={(row) => {
                  if (row) arrangeRowRefs.current.set(image.id, row);
                  else arrangeRowRefs.current.delete(image.id);
                }}
              >
                <span className={`grid size-11 place-items-center rounded-md text-sm font-black ${index === 0 ? "bg-[#8a1f2d] text-white" : "bg-zinc-100 text-zinc-700"}`}>{index + 1}</span>
                <button aria-label={`Open ${cardName} photo ${index + 1}`} className="hidden size-[4.5rem] cursor-zoom-in overflow-hidden rounded-md bg-zinc-100 focus-visible:ring-2 focus-visible:ring-[#8a1f2d] sm:block" onClick={() => setPreviewId(image.id)} type="button">
                  <Image alt="" className="h-full w-full object-cover" height={144} src={image.previewUrl} unoptimized width={144} />
                </button>
                <div className="min-w-0 self-center">
                  <p className="font-bold text-zinc-900">{index === 0 ? "Primary photo" : `Photo ${index + 1}`}</p>
                  <p className="mt-0.5 text-xs font-medium text-zinc-500">{index === 0 ? "Shown first in the gallery" : `Gallery position ${index + 1}`}</p>
                </div>
                <div className="col-span-2 grid grid-cols-3 gap-2 sm:col-span-1 sm:flex sm:justify-end">
                  <button aria-label={`Make ${cardName} photo ${index + 1} primary`} className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md border border-zinc-200 bg-zinc-50 px-2 text-xs font-bold text-zinc-700 hover:border-[#8a1f2d]/40 hover:text-[#8a1f2d] focus-visible:ring-2 focus-visible:ring-[#8a1f2d] disabled:cursor-default disabled:opacity-40" disabled={index === 0} onClick={() => makeArrangedPhotoPrimary(image.id)} type="button"><Star aria-hidden="true" className="size-4" /><span className="hidden lg:inline">Primary</span></button>
                  <button aria-label={`Move ${cardName} photo ${index + 1} earlier`} className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md border border-zinc-200 bg-zinc-50 px-2 text-xs font-bold text-zinc-700 hover:border-[#8a1f2d]/40 hover:text-[#8a1f2d] focus-visible:ring-2 focus-visible:ring-[#8a1f2d] disabled:cursor-not-allowed disabled:opacity-30" disabled={index === 0} onClick={() => moveArrangedPhoto(image.id, -1)} type="button"><ArrowUp aria-hidden="true" className="size-4" /><span className="hidden lg:inline">Earlier</span></button>
                  <button aria-label={`Move ${cardName} photo ${index + 1} later`} className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md border border-zinc-200 bg-zinc-50 px-2 text-xs font-bold text-zinc-700 hover:border-[#8a1f2d]/40 hover:text-[#8a1f2d] focus-visible:ring-2 focus-visible:ring-[#8a1f2d] disabled:cursor-not-allowed disabled:opacity-30" disabled={index === arrangedImages.length - 1} onClick={() => moveArrangedPhoto(image.id, 1)} type="button"><ArrowDown aria-hidden="true" className="size-4" /><span className="hidden lg:inline">Later</span></button>
                </div>
              </li>
            ))}
          </ol>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button className="min-h-11 rounded-md border border-zinc-300 bg-white px-4 text-sm font-bold text-zinc-700 hover:bg-zinc-50 focus-visible:ring-2 focus-visible:ring-[#8a1f2d]" disabled={reordering} onClick={() => setArrangeIds(null)} type="button">Cancel</button>
            <button className="min-h-11 rounded-md bg-[#981d2d] px-4 text-sm font-bold text-white shadow-sm transition-colors hover:bg-[#7f1826] focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60" disabled={reordering} onClick={() => void saveArrangedOrder()} type="button">{reordering ? "Saving order…" : "Save order"}</button>
          </div>
        </div>
      ) : images.length ? (
        <ul className="mt-4 grid min-w-0 max-w-full grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(9rem,12rem))]">
          {images.map((image, index) => (
            <li className="relative min-w-0 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm" key={image.id}>
              <button
                aria-label={`Open ${cardName} photo ${index + 1}${index === 0 ? ", primary photo" : ""}`}
                aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
                className="group grid w-full cursor-zoom-in text-left focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-inset"
                onClick={() => setPreviewId(image.id)}
                onKeyDown={(event) => {
                  if (!event.altKey || changing || !canManage) return;
                  const offset = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
                  if (!offset) return;
                  const target = images[index + offset];
                  if (!target) return;
                  event.preventDefault();
                  void onReorder(movedIds(image.id, target.id));
                }}
                type="button"
              >
                <span className="relative block aspect-square overflow-hidden bg-zinc-100">
                  <Image alt={`${cardName} photo ${index + 1}`} className="h-full w-full object-cover" draggable={false} height={320} src={image.previewUrl} unoptimized width={320} />
                </span>
              </button>
              {canManage ? (
                <>
                  <button aria-label={index === 0 ? `${cardName} photo ${index + 1} is the primary photo` : `Set ${cardName} photo ${index + 1} as primary`} aria-pressed={index === 0} className={`absolute left-0.5 top-0.5 z-10 grid size-11 place-items-center rounded-full transition focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-offset-1 disabled:cursor-default ${index === 0 ? "text-[#8a1f2d]" : "text-zinc-500"}`} disabled={changing || index === 0} onClick={() => void onReorder([image.id, ...images.filter((item) => item.id !== image.id).map((item) => item.id)])} type="button"><span className="grid size-7 place-items-center rounded-full border border-zinc-200/80 bg-white/90 shadow-sm backdrop-blur-sm transition hover:border-[#8a1f2d]/40 hover:bg-white"><Star aria-hidden="true" className={`size-3.5 ${index === 0 ? "fill-current" : ""}`} /></span></button>
                  <button aria-label={`Remove ${cardName} photo ${index + 1}`} className="absolute right-0.5 top-0.5 z-10 grid size-11 place-items-center rounded-full text-zinc-500 transition hover:text-rose-700 focus-visible:ring-2 focus-visible:ring-rose-600 focus-visible:ring-offset-1 disabled:cursor-wait disabled:opacity-60" disabled={changing} onClick={() => setPendingRemovalId(image.id)} type="button"><span className="grid size-7 place-items-center rounded-full border border-zinc-200/80 bg-white/90 shadow-sm backdrop-blur-sm transition hover:border-rose-200 hover:bg-rose-50"><Trash2 aria-hidden="true" className="size-3.5" /></span></button>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      ) : <p className="mt-4 rounded-md border border-dashed border-zinc-300 bg-zinc-50 px-4 py-8 text-center text-sm font-bold text-zinc-600">{emptyText}</p>}

      {preview ? (
        <div aria-labelledby={`${id}-preview-title`} aria-modal="true" className="fixed inset-0 z-[70] grid place-items-center bg-zinc-950/80 p-4 sm:p-8" role="dialog">
          <div className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-white/20 bg-zinc-950 shadow-2xl">
            <header className="flex items-center justify-between gap-4 border-b border-white/15 px-4 py-3 text-white">
              <div>
                <h3 className="font-black" id={`${id}-preview-title`}>Card photo preview</h3>
                <p className="mt-0.5 text-xs font-medium text-zinc-300">{previewSubtitle}</p>
              </div>
              <button aria-label="Close card photo preview" autoFocus className="grid size-11 shrink-0 place-items-center rounded-md border border-white/25 bg-white/10 text-white hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white" onClick={() => setPreviewId(null)} type="button"><X className="size-5" /></button>
            </header>
            <div className="grid min-h-0 flex-1 place-items-center overflow-auto p-3 sm:p-5">
              <Image alt={`${cardName} expanded photo`} className="max-h-[calc(100dvh-10rem)] h-auto w-auto max-w-full rounded-md object-contain" height={1_200} src={preview.previewUrl} unoptimized width={1_200} />
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

"use client";

import Image from "next/image";
import { Check, ChevronLeft, ChevronRight, Plus, Search } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  copyExposureSelectorLabel,
  ebayExposurePresentation,
  ebayExposureSummary,
  physicalCopyStateLabel,
} from "@/components/records/ebay-copy-exposure-presentation";
import { fieldClass } from "@/components/records/entry-form-ui";
import { copyShortReference } from "@/lib/records/copy-display";
import {
  filterCopySelectionCandidates,
  pageCopySelection,
} from "@/lib/records/copy-selection";
import type {
  CardCopy,
  CardPrinting,
  CopyEbayExposureState,
  WishlistTarget,
} from "@/lib/records/types";

export const copySelectionPickerPageSize = 4;

export type CopySelectionPickerItem = {
  copy: CardCopy;
  exposure: CopyEbayExposureState | undefined;
  imageUrl: string | null;
  printing: CardPrinting;
  target: WishlistTarget;
};

type CopySelectionPickerProps<T extends CopySelectionPickerItem> = {
  candidates: T[];
  disabled?: boolean;
  emptyDescription?: string;
  emptyTitle?: string;
  getCopyCaption: (item: T) => string;
  getPrimaryImageUrl?: (item: T) => string | null | undefined;
  onToggle: (copyId: string, checked: boolean) => Promise<void> | void;
  onVisibleCopyIdsChange?: (copyIds: string[]) => void;
  renderCardFooter?: (item: T) => ReactNode;
  selectedIds: string[];
  selectionMode?: "multiple" | "single";
  selectionName?: string;
  photoBadgeLabel?: (item: T) => string | null | undefined;
};

export function CopySelectionPicker<T extends CopySelectionPickerItem>({
  candidates,
  disabled = false,
  emptyDescription = "Clear the filters or search for a different card.",
  emptyTitle = "No Copies match this search",
  getCopyCaption,
  getPrimaryImageUrl,
  onToggle,
  onVisibleCopyIdsChange,
  photoBadgeLabel,
  renderCardFooter,
  selectedIds,
  selectionMode = "multiple",
  selectionName,
}: CopySelectionPickerProps<T>) {
  const [query, setQuery] = useState("");
  const [condition, setCondition] = useState("all");
  const [rarity, setRarity] = useState("all");
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [previousSelectedCount, setPreviousSelectedCount] = useState(selectedIds.length);
  if (previousSelectedCount !== selectedIds.length) {
    setPreviousSelectedCount(selectedIds.length);
    if (!selectedIds.length && selectedOnly) {
      setSelectedOnly(false);
      setPage(1);
    }
  }
  const rarityOptions = useMemo(
    () => Array.from(new Set(candidates.map((item) => item.target.rarity).filter(Boolean))).sort((left, right) => left.localeCompare(right)),
    [candidates],
  );
  const conditionOptions = useMemo(
    () => Array.from(new Set(candidates.map((item) => item.copy.condition))).sort((left, right) => left.localeCompare(right)),
    [candidates],
  );
  const filtered = useMemo(() => filterCopySelectionCandidates(candidates, {
    condition,
    query,
    rarity,
    selectedIds,
    selectedOnly,
    searchTerms: (item) => item.exposure
      ? [
          ebayExposurePresentation(item.exposure.aggregateState, item.exposure.liveOfferCount).label,
          ebayExposureSummary(item.exposure),
        ]
      : ["exposure unavailable"],
  }), [candidates, condition, query, rarity, selectedIds, selectedOnly]);
  const { currentPage, items: visible, pageCount, resultEnd, resultStart } = pageCopySelection(
    filtered,
    page,
    copySelectionPickerPageSize,
  );
  const visibleCopyIdsKey = visible.map((item) => item.copy.id).join(",");

  useEffect(() => {
    onVisibleCopyIdsChange?.(visibleCopyIdsKey ? visibleCopyIdsKey.split(",") : []);
  }, [onVisibleCopyIdsChange, visibleCopyIdsKey]);

  function clearFilters() {
    setQuery("");
    setCondition("all");
    setRarity("all");
    setSelectedOnly(false);
    setPage(1);
  }

  return (
    <div className="min-w-0">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(160px,0.3fr)_minmax(180px,0.35fr)_auto] lg:items-end">
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
          <span className="text-sm font-bold text-zinc-700">Condition</span>
          <select
            className={fieldClass}
            onChange={(event) => {
              setCondition(event.target.value);
              setPage(1);
            }}
            value={condition}
          >
            <option value="all">All conditions</option>
            {conditionOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
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

      <div aria-atomic="true" aria-live="polite" className="mt-4 flex items-center justify-between gap-3 text-sm font-medium text-zinc-500">
        <span>Available inventory</span>
        <span>Showing {resultStart}–{resultEnd} of {filtered.length}</span>
      </div>

      {visible.length ? (
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {visible.map((item, index) => {
            const selected = selectedIds.includes(item.copy.id);
            const exposurePresentation = item.exposure
              ? ebayExposurePresentation(item.exposure.aggregateState, item.exposure.liveOfferCount)
              : null;
            const preferredImageUrl = getPrimaryImageUrl?.(item);
            const imageUrl = preferredImageUrl
              || (item.imageUrl ? `/api/image-proxy?url=${encodeURIComponent(item.imageUrl)}` : null);
            const copyLabel = `${item.target.name}, ${item.printing.setCode || "unknown set"}, Copy ${copyShortReference(item.copy.id)}`;
            const badgeLabel = photoBadgeLabel?.(item);
            return (
              <label
                className={`group relative overflow-hidden rounded-lg border bg-white transition focus-within:ring-2 focus-within:ring-[#8a1f2d] focus-within:ring-offset-2 ${
                  disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"
                } ${selected ? "border-[#8a1f2d] ring-1 ring-[#8a1f2d]" : "border-zinc-200 hover:border-zinc-400 hover:shadow-sm"}`}
                key={item.copy.id}
              >
                <div className="relative aspect-[3/4] bg-zinc-100">
                  {imageUrl ? (
                    <Image
                      alt=""
                      className="object-contain p-2"
                      fill
                      loading={index < 4 ? "eager" : "lazy"}
                      sizes="(max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw"
                      src={imageUrl}
                      unoptimized
                    />
                  ) : (
                    <span className="grid h-full place-items-center text-xs font-black text-zinc-400">CARD</span>
                  )}
                  <input
                    aria-label={`Select ${copyExposureSelectorLabel(copyLabel, item.exposure)}. eBay status ${exposurePresentation?.label ?? "Unavailable"}.`}
                    checked={selected}
                    className="sr-only"
                    disabled={disabled}
                    name={selectionName}
                    onChange={(event) => void onToggle(item.copy.id, event.target.checked)}
                    type={selectionMode === "single" ? "radio" : "checkbox"}
                  />
                  <span aria-hidden="true" className={`absolute right-2 top-2 z-10 grid size-9 place-items-center rounded-full border shadow-sm ${selected ? "border-[#8a1f2d] bg-[#8a1f2d] text-white" : "border-zinc-300 bg-white text-zinc-600 group-hover:border-zinc-500"}`}>
                    {selected ? <Check className="size-4" /> : <Plus className="size-4" />}
                  </span>
                  {selected ? (
                    <span className="absolute left-2 top-2 z-10 rounded-full bg-[#8a1f2d] px-2 py-1 text-[11px] font-black text-white shadow-sm">
                      Selected
                    </span>
                  ) : null}
                  {badgeLabel ? <span className="absolute bottom-2 left-2 z-10 rounded-full bg-zinc-950/80 px-2 py-1 text-[10px] font-black text-white">{badgeLabel}</span> : null}
                </div>
                <span className="block p-3">
                  <span className="line-clamp-2 block min-h-10 text-sm font-black leading-5 text-zinc-950">{item.target.name}</span>
                  <span className="mt-1 block text-xs font-bold text-[#8a1f2d]">{item.target.rarity || "Unknown rarity"}</span>
                  <span className="mt-1 block text-xs font-medium text-zinc-500">{item.printing.setCode || "Unknown set"} · {item.target.edition || "Unknown edition"}</span>
                  <span className="mt-1 block text-xs font-medium text-zinc-500">{getCopyCaption(item)} · {item.copy.condition}</span>
                  <span className="mt-2 block text-xs font-bold text-zinc-700">Physical · {item.exposure ? physicalCopyStateLabel(item.exposure) : "Status unavailable"}</span>
                  <span className="mt-1 block break-words text-xs font-bold text-zinc-700">eBay exposure · {exposurePresentation?.label ?? "Unavailable"}{item.exposure ? ` · ${ebayExposureSummary(item.exposure)}` : ""}</span>
                  {renderCardFooter?.(item)}
                </span>
              </label>
            );
          })}
        </div>
      ) : (
        <div className="mt-4 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-4 py-8 text-center">
          <p className="font-bold text-zinc-800">{emptyTitle}</p>
          <p className="mt-1 text-sm font-medium text-zinc-500">{emptyDescription}</p>
          {candidates.length ? (
            <button className="mt-2 min-h-11 rounded-md px-3 text-sm font-bold text-[#8a1f2d] hover:bg-rose-50" onClick={clearFilters} type="button">
              Clear search
            </button>
          ) : null}
        </div>
      )}

      <nav aria-label="Copy result pages" className="mt-4 flex min-w-0 items-center justify-between gap-2">
        <button
          className="inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-sm font-bold disabled:opacity-40 sm:px-3"
          disabled={currentPage <= 1}
          onClick={() => setPage((current) => Math.max(1, current - 1))}
          type="button"
        >
          <ChevronLeft aria-hidden="true" className="size-4" />
          Previous
        </button>
        <span className="shrink-0 text-xs font-bold text-zinc-600 sm:text-sm">Page {currentPage} of {pageCount}</span>
        <button
          className="inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-sm font-bold disabled:opacity-40 sm:px-3"
          disabled={currentPage >= pageCount}
          onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
          type="button"
        >
          Next
          <ChevronRight aria-hidden="true" className="size-4" />
        </button>
      </nav>
    </div>
  );
}

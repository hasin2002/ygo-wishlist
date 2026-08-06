"use client";

import {
  AlertTriangle,
  ArrowLeft,
  ArrowDownLeft,
  ArrowUpRight,
  Boxes,
  CalendarDays,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  History,
  Images,
  PackageCheck,
  PackageOpen,
  Pencil,
  RefreshCcw,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Undo2,
  WalletCards,
  X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import {
  CardContentsEditor,
  type CardContentsDraft,
} from "@/components/records/card-contents-editor";
import { CardInventoryImages } from "@/components/records/card-inventory-images";
import { InventoryListingPhotoSets } from "@/components/records/listing-photo-set-manager";
import { CopySelectionPicker } from "@/components/records/copy-selection-picker";
import { EbayCopyExposure } from "@/components/records/ebay-copy-exposure";
import {
  copyRemovalDecision,
  physicalCopyStateLabel,
} from "@/components/records/ebay-copy-exposure-presentation";
import { inventoryEbayListingSummary } from "@/components/records/inventory-ebay-listing-summary-presentation";
import { parsePoundsToPence } from "@/components/records/entry-form-ui";
import { DataLoadError } from "@/components/data-load-error";
import { UnavailableAction } from "@/components/unavailable-action";
import { useViewportOverlay } from "@/components/use-viewport-overlay";
import { useRecordsDataSource } from "@/components/records/records-preview-provider";
import { SearchablePicklist, type SearchablePicklistOption } from "@/components/records/searchable-picklist";
import { getLibraryCardStatus, type LibraryCardStatusSummary } from "@/lib/records/library-status";
import { deriveSnapshotRecordsActions, type RecordsAction } from "@/lib/records/actions";
import { ownedCardTotalLabel, paidCostSummary } from "@/lib/records/paid-cost-summary";
import { parseSaleReviewIntent } from "@/lib/navigation-intent";
import {
  recordImagePreviewsFor,
  type RecordImagePreview,
} from "@/lib/records/record-images";
import { cardConditionOptions, isCardCondition } from "@/lib/records/types";
import type {
  CardAttentionUpdate,
  CardCopy,
  CardPrinting,
  DataSourceResult,
  EbayOfferExposure,
  RecordEntry,
  RecordEntryType,
  RecordLine,
  RecordsDataSource,
  RecordsSnapshot,
  ResolvedProductMetadata,
  ProductEdition,
  SupplyCategory,
  WishlistTarget,
} from "@/lib/records/types";

function dataSourceMessage(result: DataSourceResult, success: string) {
  return result.ok ? result.warning ?? success : result.message;
}
import { copyDisplayLabel, copyShortReference, orderCopies } from "@/lib/records/copy-display";
import {
  defaultInventoryListState,
  inventoryCardDetailHref,
  linkedListingHref,
  inventoryListHref,
  parseInventoryListState,
  type InventoryListState,
} from "@/lib/records/inventory-route-state";
import { trpc } from "@/trpc/client";

export type RecordsView = "overview" | "history" | "inventory";

const recordTypeLabels: Record<RecordEntryType, string> = {
  purchase: "Purchase",
  "pack-opening": "Pack opening",
  sale: "Sale",
  "imported-acquisition": "Imported acquisition",
};

const inventoryTabs = [
  { value: "cards", label: "Cards" },
  { value: "sealed", label: "Sealed" },
  { value: "bulk", label: "Bulk" },
  { value: "supplies", label: "Supplies" },
] as const;

type InventoryTab = (typeof inventoryTabs)[number]["value"];

const inventoryCardSections = [
  { icon: SlidersHorizontal, label: "Copy details", value: "details" },
  { icon: Camera, label: "Card Copy photos", value: "copy-photos" },
  { icon: Images, label: "Listing photos", value: "listing-photos" },
] as const;

type InventoryCardSection = (typeof inventoryCardSections)[number]["value"];

function formatCurrency(pence: number) {
  return new Intl.NumberFormat("en-GB", {
    currency: "GBP",
    style: "currency",
  }).format(pence / 100);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00`));
}

function recordAmount(record: RecordEntry) {
  if (record.amountKnown === false) return "Unknown";
  if (record.type === "sale") return `+${formatCurrency(record.amountPence)}`;
  if (record.amountPence > 0) return `−${formatCurrency(record.amountPence)}`;
  return "No cashflow";
}

function recordAmountLabel(record: RecordEntry) {
  if (record.type === "sale") return "Sale proceeds";
  if (record.type === "purchase") return "Purchase total";
  if (record.type === "pack-opening") return "Opening total";
  return "Acquisition total";
}

export function PreviewBanner() {
  const source = useRecordsDataSource();

  if (source.mode !== "preview") return null;

  return (
    <aside className="flex flex-col gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-amber-950 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <Sparkles className="mt-0.5 size-5 shrink-0" />
        <div>
          <p className="font-bold">UI preview — nothing here writes to your database</p>
          <p className="mt-0.5 text-sm font-medium leading-5 text-amber-800">
            Existing Library cards are read-only. Changes last in this browser tab until reset.
          </p>
          {source.errorMessage ? (
            <p className="mt-1 text-sm font-bold text-rose-700">{source.errorMessage}</p>
          ) : null}
        </div>
      </div>
      <button
        className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-md border border-amber-400 bg-white px-3 text-sm font-bold transition hover:border-amber-700"
        onClick={() => {
          if (window.confirm("Reset all preview entries and drafts in this tab?")) {
            source.resetPreview?.();
          }
        }}
        type="button"
      >
        <RefreshCcw className="size-4" />
        Reset preview
      </button>
    </aside>
  );
}

function MetricCard({
  detail,
  icon,
  label,
  tone = "default",
  value,
}: {
  detail: string;
  icon: ReactNode;
  label: string;
  tone?: "default" | "positive" | "negative";
  value: string;
}) {
  return (
    <article className="rounded-lg border border-zinc-300 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-zinc-500">{label}</p>
        <span className="text-zinc-400">{icon}</span>
      </div>
      <p
        className={`mt-3 text-3xl font-black tabular-nums ${
          tone === "positive"
            ? "text-emerald-700"
            : tone === "negative"
              ? "text-[#8a1f2d]"
              : "text-zinc-950"
        }`}
      >
        {value}
      </p>
      <p className="mt-1 text-sm font-medium text-zinc-500">{detail}</p>
    </article>
  );
}

function RecordTypeBadge({ type }: { type: RecordEntryType }) {
  const tone = type === "purchase"
    ? "border-blue-200 bg-blue-50 text-blue-800"
    : type === "sale"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : "border-zinc-200 bg-zinc-50 text-zinc-600";

  return (
    <span className={`inline-flex rounded-md border px-2 py-1 text-[11px] font-bold uppercase tracking-[0.1em] ${tone}`}>
      {recordTypeLabels[type]}
    </span>
  );
}

function RecordImageStack({ previews, type }: { previews: RecordImagePreview[]; type: RecordEntryType }) {
  const imageFor = (imageUrl: string) => `/api/image-proxy?url=${encodeURIComponent(imageUrl)}`;
  const isStack = previews.length > 1;
  const ariaLabel = `${previews[0]?.kind === "sealed" ? "Opened product" : isStack ? "Cards" : "Card"}: ${previews.map((preview) => preview.name).join(", ")}`;

  if (!previews.length) {
    return (
      <div aria-hidden="true" className="flex h-20 w-24 shrink-0 items-center">
        <span className="grid size-14 place-items-center rounded-md border border-dashed border-zinc-300 bg-zinc-50 text-zinc-400">
          {type === "pack-opening" ? <PackageOpen className="size-5" /> : <Boxes className="size-5" />}
        </span>
      </div>
    );
  }

  return (
    <div
      aria-label={ariaLabel}
      className="relative h-20 w-24 shrink-0"
      role="img"
    >
      {previews.map((preview, index) => {
        const position = isStack
          ? ["left-0 top-0 z-10", "left-4 top-1.5 z-20", "left-8 top-3 z-30"][index]
          : "inset-0";

        return (
          <div
            className={`absolute overflow-hidden rounded-md border border-zinc-300 bg-zinc-100 shadow-sm ${position} ${isStack ? "h-[68px] w-12" : preview.kind === "sealed" ? "size-20" : "h-20 w-14"}`}
            key={preview.id}
          >
            {preview.imageUrl ? (
              <Image
                alt=""
                className={`h-full w-full ${preview.kind === "sealed" ? "object-contain p-1" : "object-cover"}`}
                height={isStack ? 68 : 80}
                loading="lazy"
                src={imageFor(preview.imageUrl)}
                unoptimized
                width={preview.kind === "sealed" ? 80 : isStack ? 48 : 56}
              />
            ) : (
              <WalletCards aria-hidden="true" className="m-auto size-5 text-zinc-400" />
            )}
          </div>
        );
      })}
    </div>
  );
}

function RecordRow({
  actions,
  record,
  snapshot,
}: {
  actions?: ReactNode;
  record: RecordEntry;
  snapshot: RecordsSnapshot;
}) {
  const imagePreviews = recordImagePreviewsFor(record, snapshot);

  return (
    <article className={`p-4 ${record.status === "void" ? "bg-zinc-50 opacity-70" : "bg-white"}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <RecordImageStack previews={imagePreviews} type={record.type} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <RecordTypeBadge type={record.type} />
              {record.status === "void" ? (
                <span className="rounded-md bg-rose-50 px-2 py-1 text-[11px] font-bold uppercase tracking-[0.1em] text-rose-700">
                  Voided
                </span>
              ) : null}
              <span className="text-xs font-semibold text-zinc-500">{formatDate(record.date)}</span>
            </div>
            <h3 className="mt-2 text-base font-bold text-zinc-950">{record.title}</h3>
            <p className="mt-1 text-sm font-medium text-zinc-500">
              {record.source} · {record.lines.reduce((sum, line) => sum + line.quantity, 0)} item
              {record.lines.reduce((sum, line) => sum + line.quantity, 0) === 1 ? "" : "s"}
            </p>
            {record.notes ? <p className="mt-2 text-sm leading-5 text-zinc-600">{record.notes}</p> : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center justify-between gap-3 sm:flex-col sm:items-end">
          <div className="text-right">
            <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-zinc-500">{recordAmountLabel(record)}</p>
            <p
              className={`mt-0.5 font-black tabular-nums ${
                record.type === "sale"
                  ? "text-emerald-700"
                  : record.amountKnown === false
                    ? "text-amber-700"
                    : record.type === "purchase" && record.amountPence > 0
                      ? "text-blue-700"
                      : record.amountPence > 0
                      ? "text-zinc-950"
                      : "text-zinc-500"
              }`}
            >
              {recordAmount(record)}
            </p>
          </div>
          {actions}
        </div>
      </div>
    </article>
  );
}

function cardDraftsForRecord(record: RecordEntry, snapshot: RecordsSnapshot): CardContentsDraft[] {
  return record.lines.filter((line) => line.kind === "card").map((line) => {
    const copy = snapshot.copies.find((item) => line.entityIds.includes(item.id));
    const printing = copy ? snapshot.printings.find((item) => item.id === copy.printingId) : null;
    const target = printing ? snapshot.targets.find((item) => item.id === printing.targetId) : null;
    const productUrl = printing?.tcgplayerUrl || target?.tcgplayerUrl || "";
    const edition = target?.edition.toLowerCase().includes("unlimited")
      ? "Unlimited Edition"
      : target?.edition.toLowerCase().includes("limited")
        ? "Limited Edition"
        : "1st Edition";
    const resolved = /tcgplayer\.com\/product\/\d+/i.test(productUrl);
    return {
      id: line.id,
      selectedTargetId: target?.id ?? null,
      quantity: line.quantity,
      tcgplayerUrl: productUrl,
      name: target?.name || line.name,
      imageUrl: printing?.imageUrl || target?.imageUrl || null,
      edition,
      rarity: target?.rarity || "Unknown rarity",
      setName: printing?.setName || "Unknown set",
      setCode: printing?.setCode || "Unknown code",
      cardType: "",
      fetchStatus: resolved ? "resolved" : "attention",
      fetchAttempted: resolved,
      fetchMessage: resolved ? "Existing card metadata." : "Existing metadata is incomplete; it can be corrected here.",
      metadataNeedsAttention: !resolved,
      editedFields: [],
    };
  });
}

function RecordCardItemsEditor({
  initialCardLineId = null,
  record,
  source,
}: {
  initialCardLineId?: string | null;
  record: RecordEntry;
  source: RecordsDataSource;
}) {
  const [rows, setRows] = useState<CardContentsDraft[]>(() => cardDraftsForRecord(record, source.snapshot));
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const cardLines = record.lines.filter((line) => line.kind === "card");
  const hasBulkContainer = record.lines.some((line) => line.kind === "bulk");
  const isMultiCardRecord = record.type === "pack-opening" || hasBulkContainer;
  const openedProduct = record.type === "pack-opening"
    ? source.snapshot.sealedUnits.find((unit) => unit.openedRecordId === record.id) ?? null
    : null;

  if (!cardLines.length && !hasBulkContainer) return null;

  async function saveCards() {
    setSaving(true);
    const result = await source.replaceRecordCards(record.id, rows.map((row) => ({
      id: row.id,
      selectedTargetId: row.selectedTargetId,
      quantity: row.quantity,
      tcgplayerUrl: row.tcgplayerUrl,
      name: row.name,
      imageUrl: row.imageUrl,
      edition: row.edition as ProductEdition,
      rarity: row.rarity,
      setName: row.setName,
      setCode: row.setCode,
      metadataNeedsAttention: row.metadataNeedsAttention,
    })));
    setSaving(false);
    if (result.ok) {
      setMessage(result.warning ?? "Card items saved.");
      return;
    }
    setRows(cardDraftsForRecord(record, source.snapshot));
    setMessage(result.message);
  }

  return (
    <section className="grid gap-3">
      {openedProduct ? (
        <div className="flex flex-col gap-3 rounded-lg border border-zinc-300 bg-white p-3 sm:flex-row sm:items-center">
          <div className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-md border border-zinc-200 bg-zinc-100">
            {openedProduct.imageUrl ? (
              <Image
                alt={`${openedProduct.name} opened product`}
                className="h-full w-full object-contain p-1"
                height={80}
                loading="lazy"
                src={`/api/image-proxy?url=${encodeURIComponent(openedProduct.imageUrl)}`}
                unoptimized
                width={80}
              />
            ) : <PackageOpen aria-hidden="true" className="size-6 text-[#8a1f2d]" />}
          </div>
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#8a1f2d]">Opened product</p>
            <h3 className="mt-1 font-black">{openedProduct.name}</h3>
            <p className="mt-1 text-sm font-medium text-zinc-500">{openedProduct.edition ? `${openedProduct.edition} · ` : ""}{openedProduct.allocationPence === null || openedProduct.allocationPence === undefined ? "Cost unknown" : `Exact unit cost £${(openedProduct.allocationPence / 100).toFixed(2)}`} · This product is read-only here; edit the pulled cards below.</p>
          </div>
        </div>
      ) : null}
      <div><h3 className="font-bold">{record.type === "pack-opening" ? "Pulled cards" : "Card items"}</h3><p className="mt-1 text-sm font-medium text-zinc-500">Edit a card, change its quantity, remove it, or add another where this Record supports multiple cards.</p></div>
      {message ? <p className={`rounded-md border px-3 py-2 text-sm font-bold ${message === "Card items saved." ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-300 bg-rose-50 text-rose-900"}`} role={message === "Card items saved." ? "status" : "alert"}>{message}</p> : null}
      <CardContentsEditor allowAdd={isMultiCardRecord} allowExistingIncomplete allowRemoveLast={hasBulkContainer} initialActiveId={initialCardLineId} noun={record.type === "pack-opening" ? "pulled card" : "card"} onChange={setRows} rows={rows} />
      <button className="inline-flex min-h-11 items-center justify-center rounded-md bg-zinc-950 px-4 text-sm font-bold text-white transition hover:bg-zinc-800 disabled:cursor-wait disabled:opacity-60 sm:justify-self-start" disabled={saving} onClick={saveCards} type="button">{saving ? "Saving…" : "Save card changes"}</button>
    </section>
  );
}

function SaleCopyItemsEditor({ record, source }: { record: RecordEntry; source: RecordsDataSource }) {
  const [selectedIds, setSelectedIds] = useState(() => record.lines.flatMap((line) => line.entityIds));
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const exposures = new Map(source.snapshot.copyEbayExposures.map((exposure) => [exposure.copyId, exposure]));
  const candidates = source.snapshot.copies.flatMap((copy) => {
    if (copy.status !== "available" && copy.soldRecordId !== record.id) return [];
    const printing = source.snapshot.printings.find((item) => item.id === copy.printingId);
    const target = printing ? source.snapshot.targets.find((item) => item.id === printing.targetId) : null;
    if (!printing || !target) return [];
    return [{ copy, exposure: exposures.get(copy.id), imageUrl: printing.imageUrl || target.imageUrl, printing, target }];
  });

  function toggle(copyId: string, checked: boolean) {
    setSelectedIds((current) => checked
      ? Array.from(new Set([...current, copyId]))
      : current.filter((id) => id !== copyId));
  }

  async function saveCopies() {
    setSaving(true);
    const result = await source.replaceSaleCopies(record.id, selectedIds);
    setSaving(false);
    setMessage(dataSourceMessage(result, "Sold Copies saved."));
  }

  return (
    <section className="grid gap-3">
      <div><h3 className="font-bold">Cards sold</h3><p className="mt-1 text-sm font-medium text-zinc-500">Select the exact physical Copies included in this Sale. Removing one returns it to available inventory.</p></div>
      {message ? <p className={`rounded-md border px-3 py-2 text-sm font-bold ${message === "Sold Copies saved." ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-300 bg-rose-50 text-rose-900"}`} role="status">{message}</p> : null}
      <div aria-atomic="true" aria-live="polite" className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-3 text-sm font-bold text-zinc-700">
        {selectedIds.length} physical {selectedIds.length === 1 ? "Copy" : "Copies"} selected
      </div>
      <CopySelectionPicker
        candidates={candidates}
        emptyDescription={candidates.length ? "Clear the filters or search for a different card." : "There are no eligible Copies to add to this Sale."}
        emptyTitle={candidates.length ? "No Copies match this search" : "No available Copies"}
        getCopyCaption={(item) => {
          const copiesForTarget = source.snapshot.copies.filter((candidate) => {
            const printing = source.snapshot.printings.find((value) => value.id === candidate.printingId);
            return printing?.targetId === item.target.id;
          });
          return `${copyDisplayLabel(copiesForTarget, item.copy.id)} · #${copyShortReference(item.copy.id)}`;
        }}
        onToggle={toggle}
        selectedIds={selectedIds}
      />
      <button className="inline-flex min-h-11 items-center justify-center rounded-md bg-zinc-950 px-4 text-sm font-bold text-white transition hover:bg-zinc-800 disabled:cursor-wait disabled:opacity-60 sm:justify-self-start" disabled={saving} onClick={saveCopies} type="button">{saving ? "Saving…" : "Save sold Copies"}</button>
    </section>
  );
}

function NonCardLineEditor({ line, record, source }: { line: RecordLine; record: RecordEntry; source: RecordsDataSource }) {
  const sealedUnit = line.kind === "sealed" ? source.snapshot.sealedUnits.find((item) => line.entityIds.includes(item.id)) : null;
  const supplyItem = line.kind === "supply" ? source.snapshot.supplies.find((item) => line.entityIds.includes(item.id)) : null;
  const bulkLot = line.kind === "bulk" ? source.snapshot.bulkLots.find((item) => line.entityIds.includes(item.id)) : null;
  const [expanded, setExpanded] = useState(false);
  const [name, setName] = useState(line.name);
  const [quantity, setQuantity] = useState(line.quantity);
  const [detail, setDetail] = useState(line.detail ?? "");
  const [edition, setEdition] = useState<ProductEdition>(sealedUnit?.edition || "1st Edition");
  const [category, setCategory] = useState<SupplyCategory>(supplyItem?.category || "other");
  const [totalQuantity, setTotalQuantity] = useState(bulkLot?.totalQuantity ?? 1);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function saveLine() {
    setSaving(true);
    const result = await source.updateRecordLine(record.id, line.id, { name, quantity, detail, edition, category, totalQuantity });
    setSaving(false);
    setMessage(dataSourceMessage(result, "Item saved."));
    if (result.ok && !result.warning) setExpanded(false);
  }

    return <article className="rounded-lg border border-zinc-300 bg-white p-3">{expanded ? <div className="grid gap-3"><div className="flex items-center justify-between gap-3"><h4 className="font-bold capitalize">Edit {line.kind} item</h4><button className="min-h-11 rounded-md px-3 text-sm font-bold text-zinc-600 hover:bg-zinc-100" disabled={saving} onClick={() => setExpanded(false)} type="button">Cancel</button></div>{message && message !== "Item saved." ? <p className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-900">{message}</p> : null}<div className="grid gap-3 sm:grid-cols-2"><label className="sm:col-span-2"><span className="text-sm font-bold text-zinc-700">{line.kind === "sealed" ? "Product name" : "Item name"}</span><input className="mt-1 h-11 w-full rounded-md border border-zinc-300 px-3 text-sm font-semibold outline-none focus:border-[#8a1f2d] focus:ring-2 focus:ring-[#8a1f2d]/20" onChange={(event) => setName(event.target.value)} value={name} /></label>{line.kind === "bulk" ? <label><span className="text-sm font-bold text-zinc-700">Total cards in lot</span><input className="mt-1 h-11 w-full rounded-md border border-zinc-300 px-3 text-sm font-semibold outline-none focus:border-[#8a1f2d] focus:ring-2 focus:ring-[#8a1f2d]/20" min={bulkLot?.itemizedQuantity ?? 1} onChange={(event) => setTotalQuantity(Number(event.target.value))} type="number" value={totalQuantity} /><span className="mt-1 block text-xs font-medium text-zinc-500">Changing this recalculates the lot&apos;s per-card allocation and is blocked after a card is sold.</span></label> : <label><span className="text-sm font-bold text-zinc-700">Quantity</span><input className="mt-1 h-11 w-full rounded-md border border-zinc-300 px-3 text-sm font-semibold outline-none focus:border-[#8a1f2d] focus:ring-2 focus:ring-[#8a1f2d]/20" min="1" onChange={(event) => setQuantity(Number(event.target.value))} type="number" value={quantity} /></label>}{line.kind === "sealed" ? <label><span className="text-sm font-bold text-zinc-700">Product edition</span><select className="mt-1 h-11 w-full rounded-md border border-zinc-300 px-3 text-sm font-semibold outline-none focus:border-[#8a1f2d] focus:ring-2 focus:ring-[#8a1f2d]/20" onChange={(event) => setEdition(event.target.value as ProductEdition)} value={edition}><option value="1st Edition">1st Edition</option><option value="Unlimited Edition">Unlimited Edition</option></select></label> : null}{line.kind === "supply" ? <label><span className="text-sm font-bold text-zinc-700">Category</span><select className="mt-1 h-11 w-full rounded-md border border-zinc-300 px-3 text-sm font-semibold outline-none focus:border-[#8a1f2d] focus:ring-2 focus:ring-[#8a1f2d]/20" onChange={(event) => setCategory(event.target.value as SupplyCategory)} value={category}><option value="sleeves">Sleeves</option><option value="binder">Binder</option><option value="storage">Storage</option><option value="playmat">Playmat</option><option value="other">Other</option></select></label> : null}{line.kind === "bulk" ? <label><span className="text-sm font-bold text-zinc-700">Lot details</span><input className="mt-1 h-11 w-full rounded-md border border-zinc-300 px-3 text-sm font-semibold outline-none focus:border-[#8a1f2d] focus:ring-2 focus:ring-[#8a1f2d]/20" onChange={(event) => setDetail(event.target.value)} value={detail} /></label> : null}</div><button className="min-h-11 rounded-md bg-zinc-950 px-4 text-sm font-bold text-white disabled:cursor-wait disabled:opacity-60 sm:justify-self-start" disabled={saving} onClick={saveLine} type="button">{saving ? "Saving…" : "Save item"}</button></div> : <div className="flex items-center justify-between gap-3"><div><p className="font-bold">{name}</p><p className="mt-1 text-sm font-medium text-zinc-500">{line.kind === "bulk" ? `${bulkLot?.itemizedQuantity ?? 0} identified of ${totalQuantity} total cards` : `Quantity ${quantity}`}{line.kind === "sealed" ? ` · ${edition}` : line.kind === "supply" ? ` · ${category}` : line.kind === "bulk" ? "" : detail ? ` · ${detail}` : ""}</p>{message === "Item saved." ? <p className="mt-1 text-xs font-bold text-emerald-700">Saved</p> : null}</div><button className="inline-flex min-h-11 items-center gap-2 rounded-md border border-zinc-300 px-3 text-sm font-bold" onClick={() => setExpanded(true)} type="button"><Pencil className="size-4" /> Edit</button></div>}</article>;
}

function RecordStatusConfirmationDialog({
  onClose,
  onSuccess,
  record,
  source,
  triggerRef,
}: {
  onClose: () => void;
  onSuccess: (message: string) => void;
  record: RecordEntry;
  source: RecordsDataSource;
  triggerRef: RefObject<HTMLButtonElement | null>;
}) {
  const restoring = record.status === "void";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const close = () => {
    if (!busy) onClose();
  };
  const dialogRef = useViewportOverlay<HTMLDivElement>({
    initialFocusRef: cancelRef,
    isOpen: true,
    onClose: close,
    triggerRef,
  });

  async function confirmStatusChange() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await (restoring
      ? source.restoreRecord(record.id)
      : source.voidRecord(record.id));
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onSuccess(result.warning ?? `${restoring ? "Restored" : "Voided"} “${record.title}”.`);
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      aria-busy={busy}
      aria-describedby="record-status-confirmation-description"
      aria-labelledby="record-status-confirmation-title"
      aria-modal="true"
      className="fixed inset-0 z-[70] grid place-items-end bg-zinc-950/55 p-3 backdrop-blur-sm sm:place-items-center sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      role="alertdialog"
    >
      <div className="max-h-[calc(100dvh-1.5rem)] w-full max-w-lg overflow-y-auto rounded-xl border border-zinc-300 bg-white shadow-2xl sm:max-h-[calc(100dvh-3rem)]" ref={dialogRef} tabIndex={-1}>
        <div className="p-5 sm:p-6">
          <span className={`grid size-11 place-items-center rounded-full ${restoring ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
            {restoring ? <RotateCcw aria-hidden="true" className="size-5" /> : <Undo2 aria-hidden="true" className="size-5" />}
          </span>
          <h2 className="mt-4 text-xl font-black" id="record-status-confirmation-title">{restoring ? "Restore this Record’s effects?" : "Void this Record’s effects?"}</h2>
          <div className="mt-2 text-sm font-medium leading-6 text-zinc-600" id="record-status-confirmation-description">
            {restoring ? (
              <p>This Record stays in History. Restoring reapplies its inventory and cashflow effects; any dependency conflict is blocked without changing the Record.</p>
            ) : (
              <p>This Record stays visible in History and is not deleted. Its inventory and cashflow effects are removed until you restore it.</p>
            )}
          </div>
          <p className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm font-bold text-zinc-800">{record.title}</p>
          {error ? <p className="mt-3 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-900" role="alert">{error}</p> : null}
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-zinc-200 bg-zinc-50 p-4 sm:flex-row sm:justify-end sm:px-6">
          <button className="min-h-11 rounded-md border border-zinc-300 bg-white px-4 text-sm font-bold text-zinc-700 disabled:cursor-wait disabled:opacity-60" disabled={busy} onClick={close} ref={cancelRef} type="button">Cancel</button>
          <button className={`min-h-11 rounded-md px-4 text-sm font-bold text-white disabled:cursor-wait disabled:opacity-60 ${restoring ? "bg-emerald-700" : "bg-rose-700"}`} disabled={busy} onClick={() => void confirmStatusChange()} type="button">{busy ? (restoring ? "Restoring…" : "Voiding…") : (restoring ? "Restore effects" : "Void effects")}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function RecordEditorDialog({
  backLabel,
  costOnly = false,
  initialCardLineId = null,
  initialPanel = "details",
  onClose,
  onSaved,
  record,
  reviewSale = false,
  source,
}: {
  backLabel?: string;
  costOnly?: boolean;
  initialCardLineId?: string | null;
  initialPanel?: "details" | "items";
  onClose: () => void;
  onSaved: (message: string) => void;
  record: RecordEntry;
  reviewSale?: boolean;
  source: RecordsDataSource;
}) {
  const [title, setTitle] = useState(record.title);
  const [date, setDate] = useState(record.date);
  const [recordSource, setRecordSource] = useState(record.source);
  const [listingUrl, setListingUrl] = useState(record.listingUrl ?? "");
  const [amount, setAmount] = useState((record.amountPence / 100).toFixed(2));
  const [amountKnown, setAmountKnown] = useState(costOnly || record.amountKnown !== false);
  const [notes, setNotes] = useState(record.notes);
  const [sealedAllocationOverrideConfirmed, setSealedAllocationOverrideConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [statusConfirmationOpen, setStatusConfirmationOpen] = useState(false);
  const [activePanel, setActivePanel] = useState<"details" | "items">(initialPanel);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const statusButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useViewportOverlay<HTMLDivElement>({
    initialFocusRef: closeButtonRef,
    isOpen: true,
    onClose: () => {
      if (!saving && !statusConfirmationOpen) onClose();
    },
  });
  const editsCashflow = record.type === "purchase" || record.type === "sale" || record.type === "imported-acquisition";
  const editsListing = record.type === "purchase" || record.type === "imported-acquisition";
  const canMarkCostUnknown = !costOnly && (record.type === "purchase" || record.type === "imported-acquisition");
  const sealedUnitsForRecord = source.snapshot.sealedUnits.filter((unit) => unit.acquiredRecordId === record.id);
  const hasSealedAllocationOverrides = sealedUnitsForRecord.some((unit) => unit.allocationMode === "override");
  const hasOpenedSealedUnit = sealedUnitsForRecord.some((unit) => unit.openedRecordId);
  const parsedChangedAmount = parsePoundsToPence(amount);
  const changingSealedCost = hasSealedAllocationOverrides && (
    !amountKnown || parsedChangedAmount !== record.amountPence
  );
  const dialogDescription = reviewSale
    ? "Review this sale record and its exact physical Copies. You can correct its details or items before continuing."
    : costOnly
      ? "Add the acquisition cost to resolve this attention item."
      : "Edit this Record and its items without leaving the current view.";
  async function save() {
    const parsedAmount = editsCashflow && amountKnown ? parsePoundsToPence(amount) : 0;
    if (editsCashflow && amountKnown && parsedAmount === null) {
      setError(record.type === "sale"
        ? "Enter net proceeds such as 12 or 12.34."
        : "Enter an amount such as 12 or 12.34, or mark the acquisition cost as unknown.");
      return;
    }
    setSaving(true);
    const result = await source.updateRecordDetails(record.id, {
      title,
      date,
      source: recordSource,
      listingUrl: editsListing ? listingUrl : null,
      amountPence: editsCashflow ? parsedAmount ?? 0 : record.amountPence,
      amountKnown: editsCashflow ? amountKnown : record.amountKnown !== false,
      notes,
      sealedAllocationOverrideConfirmed,
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onSaved(result.warning ?? `Saved changes to “${title.trim()}”.`);
    onClose();
  }

  if (typeof document === "undefined") return null;

  return <>
  {createPortal(
    <div aria-describedby="record-editor-description" aria-labelledby="record-editor-title" aria-modal="true" className="fixed inset-0 z-50 grid place-items-end bg-zinc-950/45 p-3 sm:place-items-center sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving && !statusConfirmationOpen) onClose(); }} role="dialog">
      <div className="max-h-[calc(100dvh-1.5rem)] w-full max-w-2xl overflow-y-auto rounded-xl border border-zinc-300 bg-[#f6f4ef] shadow-2xl sm:max-h-[calc(100dvh-3rem)]" ref={dialogRef} tabIndex={-1}>
        <div className="flex items-start justify-between gap-4 border-b border-zinc-300 bg-white px-4 py-4 sm:px-6">
          <div><span className="text-xs font-bold uppercase tracking-[0.12em] text-[#8a1f2d]">{reviewSale ? "Review sale" : costOnly ? "Resolve attention" : recordTypeLabels[record.type]}</span><h2 className="mt-1 text-xl font-black" id="record-editor-title">{reviewSale ? "Review sale" : costOnly ? "Add acquisition cost" : "Edit record"}</h2><p className="mt-1 text-sm font-medium text-zinc-500" id="record-editor-description">{dialogDescription}</p></div>
          <button aria-label={reviewSale ? "Close Review sale" : backLabel || "Close record editor"} className="grid size-11 place-items-center rounded-md border border-zinc-300 bg-white text-zinc-600 transition hover:border-zinc-950 hover:text-zinc-950 focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-offset-2" onClick={onClose} ref={closeButtonRef} type="button">{backLabel ? <ArrowLeft className="size-5" /> : <X className="size-5" />}</button>
        </div>
        {!costOnly ? <div className="border-b border-zinc-300 bg-white px-4 sm:px-6"><div className="grid grid-cols-2 rounded-t-lg border-x border-t border-zinc-300 bg-zinc-100 p-1"><button aria-pressed={activePanel === "details"} className={`min-h-11 rounded-md px-3 text-sm font-bold transition ${activePanel === "details" ? "bg-white text-zinc-950 shadow-sm" : "text-zinc-600 hover:text-zinc-950"}`} onClick={() => setActivePanel("details")} type="button">Record details</button><button aria-pressed={activePanel === "items"} className={`min-h-11 rounded-md px-3 text-sm font-bold transition ${activePanel === "items" ? "bg-white text-zinc-950 shadow-sm" : "text-zinc-600 hover:text-zinc-950"}`} onClick={() => setActivePanel("items")} type="button">Items ({record.lines.filter((line) => line.kind !== "bulk").reduce((sum, line) => sum + line.quantity, 0)})</button></div></div> : null}
        {activePanel === "details" ? <div className="grid gap-5 p-4 sm:p-6">
          <div><h3 className="font-bold">{costOnly ? record.title : "Record details"}</h3><p className="mt-1 text-sm font-medium text-zinc-500">{reviewSale ? dialogDescription : costOnly ? "Enter the full amount paid. Saving removes this item from Needs attention and includes it in your totals." : `Edit the shared information that identifies this ${recordTypeLabels[record.type].toLowerCase()}.`}</p></div>
          {error ? <div className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-3 text-sm font-bold text-rose-900" role="alert">{error}</div> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            {costOnly ? <label className="sm:col-span-2"><span className="text-sm font-bold text-zinc-700">All-in amount paid <span className="text-rose-700">*</span></span><div className="relative mt-1"><span className="pointer-events-none absolute inset-y-0 left-0 flex w-10 items-center justify-center text-lg font-bold text-zinc-500">£</span><input className="h-11 w-full rounded-md border border-zinc-300 bg-white pl-10 pr-3 text-sm font-semibold outline-none focus:border-[#8a1f2d] focus:ring-2 focus:ring-[#8a1f2d]/20" inputMode="decimal" min="0" onChange={(event) => setAmount(event.target.value)} required step="0.01" type="number" value={amount} /></div></label> : <>
            <label className="sm:col-span-2"><span className="text-sm font-bold text-zinc-700">Record name <span className="text-rose-700">*</span></span><input className="mt-1 h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold outline-none focus:border-[#8a1f2d] focus:ring-2 focus:ring-[#8a1f2d]/20" maxLength={80} onChange={(event) => setTitle(event.target.value)} value={title} /></label>
            <label><span className="text-sm font-bold text-zinc-700">Date <span className="text-rose-700">*</span></span><input className="mt-1 h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold outline-none focus:border-[#8a1f2d] focus:ring-2 focus:ring-[#8a1f2d]/20" onChange={(event) => setDate(event.target.value)} type="date" value={date} /></label>
            <label><span className="text-sm font-bold text-zinc-700">{record.type === "sale" ? "Buyer or marketplace" : "Seller or source"} <span className="text-rose-700">*</span></span><input className="mt-1 h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold outline-none focus:border-[#8a1f2d] focus:ring-2 focus:ring-[#8a1f2d]/20" onChange={(event) => setRecordSource(event.target.value)} value={recordSource} /></label>
            {editsCashflow ? <label><span className="text-sm font-bold text-zinc-700">{record.type === "sale" ? "Net proceeds" : "All-in amount paid"}</span><div className="relative mt-1"><span className="pointer-events-none absolute inset-y-0 left-0 flex w-10 items-center justify-center text-lg font-bold text-zinc-500">£</span><input className="h-11 w-full rounded-md border border-zinc-300 bg-white pl-10 pr-3 text-sm font-semibold outline-none focus:border-[#8a1f2d] focus:ring-2 focus:ring-[#8a1f2d]/20 disabled:bg-zinc-100" disabled={!amountKnown} inputMode="decimal" min="0" onChange={(event) => { setAmount(event.target.value); setSealedAllocationOverrideConfirmed(false); }} step="0.01" type="number" value={amount} /></div>{canMarkCostUnknown ? <span className="mt-2 flex items-center gap-2 text-sm font-semibold text-zinc-700"><input checked={!amountKnown} onChange={(event) => { setAmountKnown(!event.target.checked); setSealedAllocationOverrideConfirmed(false); }} type="checkbox" /> Cost unknown</span> : null}{changingSealedCost ? <span className="mt-3 block rounded-md border border-amber-300 bg-amber-50 p-3 text-sm font-medium text-amber-950">{hasOpenedSealedUnit ? <><strong className="block font-bold">Reviewed unit costs cannot be changed after opening</strong><span className="mt-1 block">Post-opening changes are blocked to preserve each opened unit’s historical cost.</span></> : <><strong className="block font-bold">Review the new exact-unit costs</strong><span className="mt-1 block">All units are still sealed, so you can confirm this cost change before opening any of them.</span><label className="mt-2 flex items-start gap-2 font-semibold"><input checked={sealedAllocationOverrideConfirmed} onChange={(event) => setSealedAllocationOverrideConfirmed(event.target.checked)} type="checkbox" />I reviewed the new exact-unit costs.</label></>}</span> : null}</label> : null}
            {editsListing ? <label className="sm:col-span-2"><span className="text-sm font-bold text-zinc-700">Original listing <span className="font-medium text-zinc-400">(optional)</span></span><input className="mt-1 h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold outline-none focus:border-[#8a1f2d] focus:ring-2 focus:ring-[#8a1f2d]/20" inputMode="url" onChange={(event) => setListingUrl(event.target.value)} placeholder="https://…" type="url" value={listingUrl} /></label> : null}
            <label className="sm:col-span-2"><span className="text-sm font-bold text-zinc-700">Notes <span className="font-medium text-zinc-400">(optional)</span></span><textarea className="mt-1 min-h-24 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium outline-none focus:border-[#8a1f2d] focus:ring-2 focus:ring-[#8a1f2d]/20" onChange={(event) => setNotes(event.target.value)} value={notes} /></label>
            </>}
          </div>
        </div> : <div className="grid gap-6 p-4 sm:p-6">
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm font-medium leading-5 text-amber-950"><strong className="block font-bold">Dependency-safe item editing</strong><p className="mt-1">Items and quantities can be corrected here. If a Copy was later sold, removed, or a sealed unit was opened, changes that would contradict that history are blocked with a specific explanation.</p></div>
          {record.status === "void" ? <div className="rounded-lg border border-zinc-300 bg-white px-4 py-8 text-center"><p className="font-bold">Restore this Record to edit its items</p><p className="mt-1 text-sm font-medium text-zinc-500">Voided inventory stays frozen so it cannot leak back into the active collection.</p></div> : <>{record.type === "sale" ? <SaleCopyItemsEditor record={record} source={source} /> : <RecordCardItemsEditor initialCardLineId={initialCardLineId} record={record} source={source} />}{record.lines.filter((line) => line.kind !== "card").map((line) => <NonCardLineEditor key={line.id} line={line} record={record} source={source} />)}</>}
        </div>}
        <div className="flex flex-col-reverse gap-3 border-t border-zinc-300 bg-white p-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          {!costOnly ? <div><button className={`inline-flex min-h-11 items-center justify-center rounded-md border px-3 text-sm font-bold transition focus-visible:ring-2 focus-visible:ring-rose-700 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60 ${record.status === "void" ? "border-emerald-300 bg-emerald-50 text-emerald-800 hover:border-emerald-700" : "border-rose-300 bg-rose-50 text-rose-800 hover:border-rose-700"}`} disabled={saving} onClick={() => setStatusConfirmationOpen(true)} ref={statusButtonRef} type="button">{record.status === "void" ? "Restore record" : "Void record effects"}</button>{record.status === "void" ? <p className="mt-1 max-w-xs text-xs font-medium leading-4 text-zinc-500">Restoring reapplies this Record’s inventory and cashflow effects.</p> : <p className="mt-1 max-w-xs text-xs font-medium leading-4 text-zinc-500">Voiding keeps this Record in History but removes its inventory and cashflow effects until restored.</p>}</div> : <span />}
          <div className="flex flex-col-reverse gap-2 sm:flex-row"><button className="inline-flex min-h-11 items-center justify-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-bold text-zinc-700 transition hover:border-zinc-950" disabled={saving} onClick={onClose} type="button">{activePanel === "details" ? "Cancel" : "Close"}</button>{activePanel === "details" ? <button className="inline-flex min-h-11 items-center justify-center rounded-md bg-zinc-950 px-4 text-sm font-bold text-white transition hover:bg-zinc-800 focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60" disabled={saving} onClick={save} type="button">{saving ? "Saving…" : costOnly ? "Save acquisition cost" : "Save details"}</button> : null}</div>
        </div>
      </div>
    </div>,
    document.body,
  )}
  {statusConfirmationOpen ? <RecordStatusConfirmationDialog onClose={() => setStatusConfirmationOpen(false)} onSuccess={(message) => { setStatusConfirmationOpen(false); onSaved(message); onClose(); }} record={record} source={source} triggerRef={statusButtonRef} /> : null}
  </>;
}

type OverviewPeriod = "all" | "month" | "30-days" | "year" | "custom";

function localDateValue(date: Date) {
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return offsetDate.toISOString().slice(0, 10);
}

function overviewDateRange(period: OverviewPeriod, from: string, to: string) {
  const today = new Date();
  const todayValue = localDateValue(today);
  if (period === "all") return { from: "", to: "" };
  if (period === "custom") return { from, to };
  if (period === "month") return { from: `${todayValue.slice(0, 7)}-01`, to: todayValue };
  if (period === "year") return { from: `${todayValue.slice(0, 4)}-01-01`, to: todayValue };
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(today.getDate() - 29);
  return { from: localDateValue(thirtyDaysAgo), to: todayValue };
}

export function CardAttentionDialog({
  item,
  onClose,
  onSaved,
  source,
}: {
  item: NonNullable<RecordsSnapshot["attention"]>[number];
  onClose: () => void;
  onSaved: (message: string) => void;
  source: RecordsDataSource;
}) {
  const target = item.targetId ? source.snapshot.targets.find((value) => value.id === item.targetId) : null;
  const printing = target
    ? source.snapshot.printings.find((value) => value.id === item.printingId)
      ?? source.snapshot.printings.find((value) => value.targetId === target.id)
    : null;
  const [name, setName] = useState(target?.name ?? item.label);
  const [rarity, setRarity] = useState(target?.rarity ?? "");
  const [edition, setEdition] = useState<ProductEdition>(target?.edition === "Unlimited Edition" || target?.edition === "Limited Edition" ? target.edition : "1st Edition");
  const [tcgplayerUrl, setTcgplayerUrl] = useState(target?.tcgplayerUrl ?? printing?.tcgplayerUrl ?? "");
  const [printingSetName, setPrintingSetName] = useState(printing?.setName === "Unknown set" ? "" : printing?.setName ?? "");
  const [setCode, setSetCode] = useState(printing?.setCode === "Unknown code" ? "" : printing?.setCode ?? "");
  const [imageUrl, setImageUrl] = useState(target?.imageUrl ?? printing?.imageUrl ?? null);
  const [fetching, setFetching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useViewportOverlay<HTMLDivElement>({
    isOpen: true,
    onClose,
  });
  const showTcgplayerUrl = !tcgplayerUrl;
  const showName = !target?.name;
  const showRarity = !target?.rarity;
  const showEdition = item.field === "edition";
  const showSetName = !printingSetName;

  async function fetchDetails() {
    setFetching(true);
    setError(null);
    const result = await source.resolveTcgplayerProduct(tcgplayerUrl);
    setFetching(false);
    if (!result.ok) { setError(result.message); return; }
    setName(result.metadata.title || name);
    setRarity(result.metadata.rarity || rarity);
    if (result.metadata.edition) setEdition(result.metadata.edition);
    setPrintingSetName(result.metadata.setName || printingSetName);
    setSetCode(result.metadata.setCode || setCode);
    setImageUrl(result.metadata.imageUrl || imageUrl);
  }

  async function save() {
    if (!target || !printing) return;
    const update: CardAttentionUpdate = { targetId: target.id, printingId: printing.id, name, rarity, edition, tcgplayerUrl, setName: printingSetName, setCode, imageUrl };
    if (!name.trim() || !rarity.trim() || !tcgplayerUrl.trim() || !printingSetName.trim()) {
      setError("Complete the card name, rarity, TCGplayer link, and set name before saving.");
      return;
    }
    setSaving(true);
    setError(null);
    const result = await source.resolveCardAttention(update);
    setSaving(false);
    if (!result.ok) { setError(result.message); return; }
    onSaved(result.warning ?? `Resolved attention for “${name.trim()}”.`);
    onClose();
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <div aria-describedby="card-attention-description" aria-labelledby="card-attention-title" aria-modal="true" className="fixed inset-0 z-50 grid place-items-end bg-zinc-950/50 p-3 sm:place-items-center sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }} role="dialog">
      <div className="max-h-[calc(100dvh-1.5rem)] w-full max-w-xl overflow-y-auto rounded-xl border border-zinc-300 bg-[#f6f4ef] shadow-2xl sm:max-h-[calc(100dvh-3rem)]" ref={dialogRef} tabIndex={-1}>
        <header className="flex items-start justify-between gap-4 border-b border-zinc-300 bg-white px-4 py-4 sm:px-6">
          <div><span className="text-xs font-bold uppercase tracking-[0.12em] text-[#8a1f2d]">Resolve attention</span><h2 className="mt-1 text-xl font-black" id="card-attention-title">Confirm card details</h2><p className="mt-1 text-sm font-medium text-zinc-500" id="card-attention-description">Save the missing metadata once, and this item will leave the attention list.</p></div>
          <button aria-label="Close card resolution" className="grid size-11 shrink-0 place-items-center rounded-md border border-zinc-300 bg-white text-zinc-600 focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-offset-2" onClick={onClose} type="button"><X className="size-5" /></button>
        </header>
        <div className="grid gap-4 p-4 sm:p-6">
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm font-medium leading-5 text-amber-950"><strong className="font-bold">Why this needs attention</strong><p className="mt-1">{item.detail}</p></div>
          {error ? <p className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-3 text-sm font-bold text-rose-900" role="alert">{error}</p> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            {showTcgplayerUrl ? <label className="sm:col-span-2"><span className="text-sm font-bold text-zinc-700">TCGplayer product link <span className="text-rose-700">*</span></span><div className="mt-1 flex flex-col gap-2 sm:flex-row"><input className="h-11 min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold outline-none focus:border-[#8a1f2d] focus:ring-2 focus:ring-[#8a1f2d]/20" onChange={(event) => setTcgplayerUrl(event.target.value)} placeholder="https://www.tcgplayer.com/product/…" type="url" value={tcgplayerUrl} /><button className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-bold text-zinc-700 hover:border-[#8a1f2d] hover:text-[#8a1f2d] disabled:cursor-wait disabled:opacity-60" disabled={fetching || !tcgplayerUrl.trim()} onClick={() => void fetchDetails()} type="button"><Sparkles className="size-4" />{fetching ? "Fetching…" : "Fetch details"}</button></div><span className="mt-1 block text-xs font-medium text-zinc-500">Fetching can fill any other missing card details for you.</span></label> : null}
            {showName ? <label><span className="text-sm font-bold text-zinc-700">Card name <span className="text-rose-700">*</span></span><input className="mt-1 h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold outline-none focus:border-[#8a1f2d]" onChange={(event) => setName(event.target.value)} value={name} /></label> : null}
            {showRarity ? <label><span className="text-sm font-bold text-zinc-700">Rarity <span className="text-rose-700">*</span></span><input className="mt-1 h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold outline-none focus:border-[#8a1f2d]" onChange={(event) => setRarity(event.target.value)} value={rarity} /></label> : null}
            {showEdition ? <label><span className="text-sm font-bold text-zinc-700">Edition <span className="text-rose-700">*</span></span><select className="mt-1 h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold outline-none focus:border-[#8a1f2d]" onChange={(event) => setEdition(event.target.value as ProductEdition)} value={edition}><option value="1st Edition">1st Edition</option><option value="Unlimited Edition">Unlimited Edition</option><option value="Limited Edition">Limited Edition</option></select></label> : null}
            {showSetName ? <label className="sm:col-span-2"><span className="text-sm font-bold text-zinc-700">Set name <span className="text-rose-700">*</span></span><input className="mt-1 h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold outline-none focus:border-[#8a1f2d]" onChange={(event) => setPrintingSetName(event.target.value)} value={printingSetName} /></label> : null}
          </div>
        </div>
        <footer className="flex flex-col-reverse gap-2 border-t border-zinc-300 bg-white p-4 sm:flex-row sm:justify-end sm:px-6"><button className="min-h-11 rounded-md border border-zinc-300 bg-white px-4 text-sm font-bold text-zinc-700" disabled={saving} onClick={onClose} type="button">Cancel</button><button className="min-h-11 rounded-md bg-zinc-950 px-4 text-sm font-bold text-white disabled:cursor-wait disabled:opacity-60" disabled={saving || fetching} onClick={() => void save()} type="button">{saving ? "Saving…" : "Save resolved details"}</button></footer>
      </div>
    </div>,
    document.body,
  );
}

export function EbayCopyLinkAttentionDialog({
  item,
  onClose,
  onResolved,
  source,
}: {
  item: NonNullable<RecordsSnapshot["attention"]>[number];
  onClose: () => void;
  onResolved: (message: string) => void;
  source: RecordsDataSource;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useViewportOverlay<HTMLDivElement>({
    isOpen: true,
    onClose,
  });
  const copy = item.copyId ? source.snapshot.copies.find((value) => value.id === item.copyId) : null;
  const target = item.targetId ? source.snapshot.targets.find((value) => value.id === item.targetId) : null;
  const printing = copy ? source.snapshot.printings.find((value) => value.id === copy.printingId) : null;
  const inventoryHref = copy && target
    ? inventoryCardDetailHref(target.id, defaultInventoryListState, copy.id)
    : null;

  async function confirm() {
    if (!item.listingId) return;
    setSaving(true);
    setError(null);
    const result = await source.resolveEbayCopyLinkAttention(item.listingId);
    setSaving(false);
    if (!result.ok) { setError(result.message); return; }
    onResolved(result.warning ?? `Confirmed the physical Copy link for “${item.label}”.`);
    onClose();
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <div aria-describedby="ebay-copy-link-description" aria-labelledby="ebay-copy-link-title" aria-modal="true" className="fixed inset-0 z-50 grid place-items-end bg-zinc-950/50 p-3 sm:place-items-center sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }} role="dialog">
      <div className="max-h-[calc(100dvh-1.5rem)] w-full max-w-lg overflow-y-auto rounded-xl border border-zinc-300 bg-[#f6f4ef] shadow-2xl sm:max-h-[calc(100dvh-3rem)]" ref={dialogRef} tabIndex={-1}>
        <header className="flex items-start justify-between gap-4 border-b border-zinc-300 bg-white px-4 py-4 sm:px-6">
          <div><span className="text-xs font-bold uppercase tracking-[0.12em] text-[#8a1f2d]">Resolve eBay link</span><h2 className="mt-1 text-xl font-black" id="ebay-copy-link-title">Confirm physical Copy</h2><p className="mt-1 text-sm font-medium text-zinc-500" id="ebay-copy-link-description">This confirms the Copy already saved on the historical listing. It does not record a Sale.</p></div>
          <button aria-label="Close eBay Copy link resolution" className="grid size-11 shrink-0 place-items-center rounded-md border border-zinc-300 bg-white text-zinc-600 focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-offset-2" onClick={onClose} type="button"><X className="size-5" /></button>
        </header>
        <div className="grid gap-4 p-4 sm:p-6">
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm font-medium leading-5 text-amber-950"><strong className="font-bold">{item.label}</strong><p className="mt-1">{item.detail}</p></div>
          <section className="rounded-lg border border-zinc-300 bg-white px-3 py-3 text-sm text-zinc-700" aria-labelledby="saved-copy-title">
            <p className="text-xs font-bold uppercase tracking-[0.1em] text-zinc-500" id="saved-copy-title">Saved physical Copy</p>
            {copy ? <>
              <p className="mt-1 font-bold">{copyDisplayLabel(source.snapshot.copies.filter((value) => value.printingId === copy.printingId), copy.id)} · Ref #{copyShortReference(copy.id)}</p>
              <dl className="mt-3 grid gap-2 border-t border-zinc-200 pt-3 text-sm sm:grid-cols-2">
                <div><dt className="text-xs font-bold uppercase tracking-[0.08em] text-zinc-500">Condition</dt><dd className="mt-0.5 font-semibold text-zinc-700">{copy.condition}</dd></div>
                {printing ? <div><dt className="text-xs font-bold uppercase tracking-[0.08em] text-zinc-500">Printing</dt><dd className="mt-0.5 font-semibold text-zinc-700">{printing.setCode}{target ? ` · ${target.rarity}` : ""}</dd></div> : null}
                {printing?.setName ? <div className="sm:col-span-2"><dt className="text-xs font-bold uppercase tracking-[0.08em] text-zinc-500">Set</dt><dd className="mt-0.5 font-semibold text-zinc-700">{printing.setName}{target ? ` · ${target.edition}` : ""}</dd></div> : null}
              </dl>
              {inventoryHref ? <Link className="mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-sm font-bold text-[#8a1f2d] transition hover:bg-rose-50 focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-offset-2" href={inventoryHref}>
                Open this Copy in Inventory <ArrowUpRight aria-hidden="true" className="size-4" />
              </Link> : null}
            </> : <p className="mt-1 font-bold">The Copy saved on this historical listing is no longer available.</p>}
          </section>
          {error ? <p className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-3 text-sm font-bold text-rose-900" role="alert">{error}</p> : null}
        </div>
        <footer className="flex flex-col-reverse gap-2 border-t border-zinc-300 bg-white p-4 sm:flex-row sm:justify-end sm:px-6"><button className="min-h-11 rounded-md border border-zinc-300 bg-white px-4 text-sm font-bold text-zinc-700" disabled={saving} onClick={onClose} type="button">Cancel</button><button className="min-h-11 rounded-md bg-zinc-950 px-4 text-sm font-bold text-white disabled:cursor-wait disabled:opacity-60" disabled={saving} onClick={() => void confirm()} type="button">{saving ? "Confirming…" : "Confirm Copy link"}</button></footer>
      </div>
    </div>,
    document.body,
  );
}

function overviewActionDestination(action: RecordsAction) {
  if (action.references.listingId) return `/records/listings/${action.references.listingId}`;
  if (action.references.targetId) return `/records/inventory/cards/${action.references.targetId}`;
  if (action.references.recordId) return `/records/history?recordId=${encodeURIComponent(action.references.recordId)}`;
  return "/records/actions";
}

function overviewActionSubject(action: RecordsAction, snapshot: RecordsSnapshot) {
  const copy = snapshot.copies.find((candidate) => action.references.copyIds?.includes(candidate.id));
  const printing = snapshot.printings.find((candidate) => (
    candidate.id === action.references.printingId || candidate.id === copy?.printingId
  ));
  const target = snapshot.targets.find((candidate) => (
    candidate.id === action.references.targetId || candidate.id === printing?.targetId
  ));
  const record = snapshot.records.find((candidate) => candidate.id === action.references.recordId);
  const offer = snapshot.copyEbayExposures
    .flatMap((exposure) => exposure.offers)
    .find((candidate) => candidate.listingId === action.references.listingId);
  return target?.name ?? offer?.title ?? record?.title ?? null;
}

function Overview() {
  const source = useRecordsDataSource();
  const { snapshot } = source;
  const actionsQuery = trpc.records.actions.useQuery(undefined, {
    enabled: source.mode === "live" && source.status === "ready",
  });
  const [period, setPeriod] = useState<OverviewPeriod>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const range = overviewDateRange(period, customFrom, customTo);
  const activeRecords = snapshot.records.filter((record) => (
    record.status === "active"
    && (!range.from || record.date >= range.from)
    && (!range.to || record.date <= range.to)
  ));
  const cost = activeRecords
    .filter((record) => (record.type === "purchase" || record.type === "imported-acquisition") && record.amountKnown !== false)
    .reduce((sum, record) => sum + record.amountPence, 0);
  const unknownCostCount = activeRecords.filter((record) => (
    (record.type === "purchase" || record.type === "imported-acquisition") && record.amountKnown === false
  )).length;
  const proceeds = activeRecords
    .filter((record) => record.type === "sale")
    .reduce((sum, record) => sum + record.amountPence, 0);
  const availableCopies = snapshot.copies.filter((copy) => copy.status === "available").length;
  const actions = source.mode === "preview"
    ? deriveSnapshotRecordsActions(snapshot)
    : actionsQuery.data ?? [];
  const openActions = actions.filter((action) => action.status === "open").sort((left, right) => (
    (left.category === "required" ? 0 : 1) - (right.category === "required" ? 0 : 1)
    || ({ urgent: 0, warning: 1, info: 2 })[left.severity] - ({ urgent: 0, warning: 1, info: 2 })[right.severity]
    || (right.updatedAt?.getTime() ?? 0) - (left.updatedAt?.getTime() ?? 0)
  ));
  const visibleActions = openActions.slice(0, 5);
  const allOpenActionCount = openActions.length;
  const wishlistTargetCount = snapshot.targets.filter((target) => {
    const printingIds = snapshot.printings.filter((printing) => printing.targetId === target.id).map((printing) => printing.id);
    const ownedQuantity = snapshot.copies.filter((copy) => printingIds.includes(copy.printingId) && copy.status === "available").length;
    return getLibraryCardStatus(target.desiredQuantity, ownedQuantity).status === "wishlist";
  }).length;

  return (
    <div className="grid gap-5">
      <section className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex items-center gap-2"><CalendarDays className="size-4 text-[#8a1f2d]" /><h2 className="font-bold text-zinc-800">Summary</h2></div>
        <div className="flex flex-wrap items-center gap-2">
          <div aria-label="Summary period" className="flex max-w-full overflow-x-auto rounded-md border border-zinc-300 bg-white p-1" role="group">
            {([
              ["all", "All time"],
              ["month", "This month"],
              ["30-days", "30 days"],
              ["year", "This year"],
              ["custom", "Custom"],
            ] as Array<[OverviewPeriod, string]>).map(([value, label]) => <button aria-pressed={period === value} className={`min-h-9 shrink-0 rounded px-3 text-sm font-bold transition focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-offset-2 ${period === value ? "bg-[#8a1f2d] text-white" : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950"}`} key={value} onClick={() => setPeriod(value)} type="button">{label}</button>)}
          </div>
          {period === "custom" ? <div className="flex flex-wrap gap-2">
            <label className="sr-only" htmlFor="summary-from">From date</label><input className="h-11 min-w-36 rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold outline-none focus:border-[#8a1f2d] focus:ring-2 focus:ring-[#8a1f2d]/20" id="summary-from" onChange={(event) => setCustomFrom(event.target.value)} type="date" value={customFrom} />
            <label className="sr-only" htmlFor="summary-to">To date</label><input className="h-11 min-w-36 rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold outline-none focus:border-[#8a1f2d] focus:ring-2 focus:ring-[#8a1f2d]/20" id="summary-to" onChange={(event) => setCustomTo(event.target.value)} type="date" value={customTo} />
          </div> : null}
        </div>
      </section>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard detail={unknownCostCount ? `Known amounts only · ${unknownCostCount} cost${unknownCostCount === 1 ? "" : "s"} unknown` : "All-in acquisition amounts"} icon={<ArrowDownLeft className="size-5" />} label="Actual cost" tone="negative" value={formatCurrency(cost)} />
        <MetricCard detail="Net after fees and postage" icon={<ArrowUpRight className="size-5" />} label="Net proceeds" tone="positive" value={formatCurrency(proceeds)} />
        <MetricCard detail={unknownCostCount ? "Known costs only — incomplete while acquisition costs are unknown" : "Proceeds minus actual cost"} icon={<CircleDollarSign className="size-5" />} label="Cash position" tone={proceeds - cost >= 0 ? "positive" : "negative"} value={formatCurrency(proceeds - cost)} />
        <MetricCard detail={`${wishlistTargetCount} Wishlist target${wishlistTargetCount === 1 ? "" : "s"}`} icon={<WalletCards className="size-5" />} label="Physical copies" value={String(availableCopies)} />
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="flex h-full flex-col overflow-hidden rounded-lg border border-zinc-300 bg-white shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3">
            <div>
              <h2 className="font-bold">Recent history</h2>
              <p className="mt-0.5 text-sm font-medium text-zinc-500">What changed, in order</p>
            </div>
            <Link className="inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-sm font-bold text-[#8a1f2d] hover:bg-rose-50" href="/records/history">
              All history <ChevronRight className="size-4" />
            </Link>
          </div>
          <div className="divide-y divide-zinc-200">
            {snapshot.records.slice(0, 5).map((record) => <RecordRow key={record.id} record={record} snapshot={snapshot} />)}
          </div>
        </section>

        <section className="flex h-full flex-col overflow-hidden rounded-lg border border-zinc-300 bg-white shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-bold">Actions</h2>
                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-bold text-zinc-700">
                  {allOpenActionCount} open
                </span>
              </div>
              <p className="mt-0.5 text-sm font-medium text-zinc-500">Needs attention first</p>
            </div>
            <Link className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-md px-2 text-sm font-bold text-[#8a1f2d] hover:bg-rose-50" href="/records/actions">
              Open full Actions <ChevronRight className="size-4" />
            </Link>
          </div>
          {source.mode === "live" && actionsQuery.isPending ? (
            <div className="grid min-h-32 place-items-center p-4 text-sm font-bold text-zinc-600" role="status">Loading actions…</div>
          ) : source.mode === "live" && actionsQuery.isError ? (
            <div className="p-4">
              <p className="text-sm font-bold text-rose-800">Actions could not be loaded.</p>
            </div>
          ) : visibleActions.length ? (
            <div className="flex flex-1 flex-col divide-y divide-zinc-200">
              {visibleActions.map((action) => {
                const subject = overviewActionSubject(action, snapshot);
                const required = action.category === "required";
                return (
                  <Link className="group flex min-h-16 flex-1 items-start gap-3 bg-white px-4 py-3 transition hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#8a1f2d]/30" href={overviewActionDestination(action)} key={action.dedupeKey}>
                    <span className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-full ${required ? "bg-amber-50 text-amber-800" : "bg-indigo-50 text-indigo-700"}`}>
                      {required ? <AlertTriangle aria-hidden="true" className="size-4" /> : <Sparkles aria-hidden="true" className="size-4" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`text-xs font-bold ${required ? "text-amber-800" : "text-indigo-700"}`}>{required ? "Needs attention" : "Suggestion"} · {action.area === "ebay" ? "eBay" : `${action.area.charAt(0).toUpperCase()}${action.area.slice(1)}`}</span>
                      <span className="mt-0.5 block truncate font-bold leading-5 text-zinc-900">{action.title}</span>
                      {subject && subject !== action.title ? <span className="mt-0.5 block truncate text-sm font-semibold text-zinc-700">{subject}</span> : null}
                      <span className="mt-1 block truncate text-sm font-medium leading-5 text-zinc-500">{action.detail}</span>
                    </span>
                    <ChevronRight aria-hidden="true" className="mt-2 size-4 shrink-0 text-zinc-400 transition group-hover:translate-x-0.5 group-hover:text-zinc-700 motion-reduce:transform-none" />
                  </Link>
                );
              })}
            </div>
          ) : (
            <p className="p-4 text-sm font-medium text-zinc-600">No open actions right now.</p>
          )}
        </section>
      </div>
    </div>
  );
}

function HistoryView() {
  const source = useRecordsDataSource();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState("");
  const [type, setType] = useState<"all" | RecordEntryType>("all");
  const [includeVoid, setIncludeVoid] = useState(true);
  const [page, setPage] = useState(1);
  const [message, setMessage] = useState<string | null>(null);
  const [editingRecordId, setEditingRecordId] = useState<string | null>(null);
  const [statusRecordId, setStatusRecordId] = useState<string | null>(null);
  const statusButtonRef = useRef<HTMLButtonElement>(null);
  const handledReviewId = useRef<string | null>(null);
  const requestedReviewValue = searchParams.get("record");
  const requestedReviewIntent = parseSaleReviewIntent(requestedReviewValue);
  const requestedReviewId = requestedReviewIntent?.recordId ?? null;
  const records = source.snapshot.records.filter((record) => {
    if (type !== "all" && record.type !== type) return false;
    if (!includeVoid && record.status === "void") return false;
    const search = query.trim().toLowerCase();
    return !search || [record.title, record.source, record.notes, ...record.lines.map((line) => line.name)].join(" ").toLowerCase().includes(search);
  });
  const pageSize = 15;
  const pageCount = Math.max(1, Math.ceil(records.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visibleRecords = records.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const editingRecord = source.snapshot.records.find((record) => record.id === editingRecordId) ?? null;
  const statusRecord = source.snapshot.records.find((record) => record.id === statusRecordId) ?? null;

  useEffect(() => {
    if (!requestedReviewValue || handledReviewId.current === requestedReviewValue) return;
    const timeoutId = window.setTimeout(() => {
      if (handledReviewId.current === requestedReviewValue) return;
      handledReviewId.current = requestedReviewValue;
      if (!requestedReviewId) {
        setMessage("That Sale is no longer available in this collection.");
        return;
      }
      const requestedRecord = source.snapshot.records.find((record) => record.id === requestedReviewId);
      if (!requestedRecord || requestedRecord.type !== "sale") {
        setMessage("That Sale is no longer available in this collection.");
        return;
      }

      // A linked sale is authoritative over the transient History controls. It
      // may be outside the current page or excluded by an in-progress filter.
      const recordIndex = source.snapshot.records.findIndex((record) => record.id === requestedRecord.id);
      setQuery("");
      setType("all");
      setIncludeVoid(true);
      setPage(Math.floor(Math.max(recordIndex, 0) / 15) + 1);
      setEditingRecordId(requestedRecord.id);
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [requestedReviewId, requestedReviewValue, source.snapshot.records]);

  return (
    <>
    <section className="overflow-hidden rounded-lg border border-zinc-300 bg-white shadow-sm">
      <div className="grid gap-3 border-b border-zinc-200 bg-white p-3 md:grid-cols-[minmax(0,1fr)_220px_auto] md:items-center">
        <label className="relative">
          <span className="sr-only">Search record history</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
          <input className="h-11 w-full rounded-md border border-zinc-300 bg-zinc-50 pl-9 pr-3 text-sm outline-none focus:border-[#8a1f2d] focus:bg-white" onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Search entries, items, or source" value={query} />
        </label>
        <label>
          <span className="sr-only">Record type</span>
          <select className="h-11 w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 text-sm font-semibold outline-none focus:border-[#8a1f2d]" onChange={(event) => { setType(event.target.value as "all" | RecordEntryType); setPage(1); }} value={type}>
            <option value="all">All record types</option>
            {Object.entries(recordTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="inline-flex min-h-11 items-center gap-2 rounded-md border border-zinc-300 px-3 text-sm font-bold text-zinc-700">
          <input checked={includeVoid} className="size-4 accent-[#8a1f2d]" onChange={(event) => { setIncludeVoid(event.target.checked); setPage(1); }} type="checkbox" />
          Show voided Records
        </label>
      </div>
      {message ? <p className="border-b border-zinc-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900" role="status">{message}</p> : null}
      <div className="divide-y divide-zinc-200">
        {visibleRecords.length ? visibleRecords.map((record) => (
          <RecordRow
            actions={
              <div className="flex items-center gap-2">
                <button aria-label={`Edit ${record.title}`} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-xs font-bold text-zinc-700 transition hover:border-[#8a1f2d] hover:text-[#8a1f2d] focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-offset-2" onClick={() => setEditingRecordId(record.id)} type="button"><Pencil className="size-3.5" /> Edit</button>
                <button
                  className="inline-flex min-h-11 items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-xs font-bold text-zinc-700 transition hover:border-[#8a1f2d] hover:text-[#8a1f2d] disabled:cursor-wait disabled:opacity-60"
                  onClick={(event) => {
                    statusButtonRef.current = event.currentTarget;
                    setStatusRecordId(record.id);
                  }}
                  type="button"
                >
                  {record.status === "void" ? <RotateCcw className="size-3.5" /> : <Undo2 className="size-3.5" />}
                  {record.status === "void" ? "Restore" : "Void effects"}
                </button>
              </div>
            }
            key={record.id}
            record={record}
            snapshot={source.snapshot}
          />
        )) : (
          <div className="grid min-h-56 place-items-center px-4 text-center">
            <div><History className="mx-auto size-7 text-zinc-400" /><p className="mt-3 font-bold">No matching history</p><p className="mt-1 text-sm text-zinc-500">Try a different search or filter.</p></div>
          </div>
        )}
      </div>
      {records.length > pageSize ? <nav aria-label="History pages" className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200 bg-zinc-50 p-3 text-sm font-bold text-zinc-600">
        <span>Showing {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, records.length)} of {records.length}</span>
        <div className="flex items-center gap-2"><button aria-label="Previous history page" className="grid size-11 place-items-center rounded-md border border-zinc-300 bg-white transition hover:border-[#8a1f2d] focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-offset-2 disabled:opacity-40" disabled={currentPage === 1} onClick={() => setPage((current) => Math.max(1, current - 1))} type="button"><ChevronLeft className="size-4" /></button><span>Page {currentPage} of {pageCount}</span><button aria-label="Next history page" className="grid size-11 place-items-center rounded-md border border-zinc-300 bg-white transition hover:border-[#8a1f2d] focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-offset-2 disabled:opacity-40" disabled={currentPage === pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))} type="button"><ChevronRight className="size-4" /></button></div>
      </nav> : null}
    </section>
    {editingRecord ? <RecordEditorDialog key={editingRecord.id} onClose={() => setEditingRecordId(null)} onSaved={setMessage} record={editingRecord} reviewSale={requestedReviewId === editingRecord.id} source={source} /> : null}
    {statusRecord ? <RecordStatusConfirmationDialog onClose={() => setStatusRecordId(null)} onSuccess={(statusMessage) => { setStatusRecordId(null); setMessage(statusMessage); }} record={statusRecord} source={source} triggerRef={statusButtonRef} /> : null}
    </>
  );
}

type InventoryCopySourceGroup = {
  copies: Array<{ copy: CardCopy; printing: CardPrinting }>;
  record: RecordEntry | null;
  relevantLineId: string | null;
};

function inventoryCopySourceGroups(
  snapshot: RecordsSnapshot,
  target: WishlistTarget,
): InventoryCopySourceGroup[] {
  const printings = new Map(
    snapshot.printings
      .filter((printing) => printing.targetId === target.id)
      .map((printing) => [printing.id, printing]),
  );
  const groups = new Map<string, InventoryCopySourceGroup>();

  for (const copy of snapshot.copies) {
    const printing = printings.get(copy.printingId);
    if (!printing) continue;
    const record = snapshot.records.find((item) => item.id === copy.acquiredRecordId) ?? null;
    const group = groups.get(copy.acquiredRecordId) ?? {
      copies: [],
      record,
      relevantLineId: null,
    };
    group.copies.push({ copy, printing });
    groups.set(copy.acquiredRecordId, group);
  }

  for (const group of groups.values()) {
    if (!group.record) continue;
    const copyIds = new Set(group.copies.map(({ copy }) => copy.id));
    group.relevantLineId = group.record.lines.find((line) => (
      line.kind === "card" && line.entityIds.some((id) => copyIds.has(id))
    ))?.id ?? null;
  }

  return Array.from(groups.values()).sort((left, right) => (
    (right.record?.date ?? "").localeCompare(left.record?.date ?? "")
  ));
}

function InventoryCardSummary({
  libraryStatus,
  knownPurchaseValueCount,
  purchaseValuePence,
  printing,
  onEditProductSource,
  soldQuantity,
  selectedCopy,
  target,
  unknownPurchaseValueCount,
}: {
  libraryStatus: LibraryCardStatusSummary;
  knownPurchaseValueCount: number;
  purchaseValuePence: number;
  printing: CardPrinting | null;
  onEditProductSource?: () => void;
  soldQuantity: number;
  selectedCopy: {
    costPence: number | null;
    onViewSource?: () => void;
    record: Pick<RecordEntry, "date" | "source" | "title"> | null;
  } | null;
  target: WishlistTarget;
  unknownPurchaseValueCount: number;
}) {
  const purchaseValue = knownPurchaseValueCount === 0
    ? "Unknown"
    : paidCostSummary({
      formattedKnownTotal: formatCurrency(purchaseValuePence),
      knownCopyCount: knownPurchaseValueCount,
      unknownCopyCount: unknownPurchaseValueCount,
    });
  const productUrl = printing?.tcgplayerUrl || target.tcgplayerUrl;
  const productUrlLabel = (() => {
    if (!productUrl) return "No TCGplayer product link saved";
    try {
      const parsed = new URL(productUrl);
      return `${parsed.hostname.replace(/^www\./, "")}${parsed.pathname.replace(/\/$/, "")}`;
    } catch {
      return productUrl;
    }
  })();
  return (
    <section aria-labelledby="inventory-card-title" className="overflow-hidden rounded-xl border border-zinc-300 bg-white shadow-sm">
      <div className="grid gap-4 p-4 sm:grid-cols-[5rem_minmax(0,1fr)_auto] sm:items-center sm:p-5">
        <div className="mx-auto grid aspect-[59/86] w-20 shrink-0 place-items-center overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100 shadow-sm sm:mx-0">
          {target.imageUrl ? <Image alt={`${target.name} card`} className="h-full w-full object-contain" height={172} loading="eager" sizes="80px" src={`/api/image-proxy?url=${encodeURIComponent(target.imageUrl)}`} unoptimized width={118} /> : <WalletCards aria-hidden="true" className="size-7 text-zinc-400" />}
        </div>
        <div className="min-w-0">
          <span className="text-xs font-bold uppercase tracking-[0.12em] text-[#8a1f2d]">Card inventory</span>
          <h2 className="mt-1 break-words text-xl font-black leading-tight sm:text-2xl" id="inventory-card-title">{target.name}</h2>
          <p className="sr-only" id="inventory-card-description">Manage each physical Copy and the Record it came from.</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className={`rounded-md px-2 py-1 text-xs font-bold ${libraryStatus.status === "wishlist" ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>{libraryStatus.status === "wishlist" ? "Wishlist" : "Owned"}</span>
            <span className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs font-bold text-zinc-600">{target.rarity}</span>
            <span className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs font-bold text-zinc-600">{target.edition}</span>
          </div>
        </div>
        <dl className="grid grid-cols-3 gap-2 text-center sm:min-w-60">
          <div className="rounded-lg bg-zinc-50 px-2 py-2"><dt className="text-[11px] font-bold uppercase tracking-wide text-zinc-500">Wanted</dt><dd className="mt-0.5 text-lg font-black tabular-nums">{libraryStatus.wantedQuantity}</dd></div>
          <div className="rounded-lg bg-zinc-50 px-2 py-2"><dt className="text-[11px] font-bold uppercase tracking-wide text-zinc-500">Owned</dt><dd className="mt-0.5 text-lg font-black tabular-nums">{libraryStatus.ownedQuantity}</dd></div>
          <div className="rounded-lg bg-zinc-50 px-2 py-2"><dt className="text-[11px] font-bold uppercase tracking-wide text-zinc-500">Sold</dt><dd className="mt-0.5 text-lg font-black tabular-nums">{soldQuantity}</dd></div>
        </dl>
      </div>
      <details className="group border-t border-zinc-200 bg-zinc-50">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-2 text-sm font-bold text-zinc-700 focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-inset [&::-webkit-details-marker]:hidden sm:px-5">
          <span>Card details</span>
          <span className="text-xs font-semibold text-zinc-500"><span className="group-open:hidden">Show details</span><span className="hidden group-open:inline">Hide details</span></span>
        </summary>
        <dl className="grid gap-3 border-t border-zinc-200 px-4 py-3 text-sm sm:grid-cols-[minmax(0,0.9fr)_minmax(0,0.7fr)_minmax(0,1.4fr)] sm:gap-0 sm:divide-x sm:divide-zinc-200 sm:px-5">
          {libraryStatus.ownedQuantity ? <div className="sm:flex sm:min-w-0 sm:flex-col sm:justify-center sm:px-4 sm:first:pl-0"><dt className="text-xs font-bold uppercase tracking-wide text-zinc-500">{ownedCardTotalLabel(libraryStatus.ownedQuantity)}</dt><dd className="mt-1 font-bold text-zinc-800 tabular-nums">{purchaseValue}</dd></div> : <div className="sm:flex sm:min-w-0 sm:flex-col sm:justify-center sm:px-4 sm:first:pl-0"><dt className="text-xs font-bold uppercase tracking-wide text-zinc-500">Owned cost</dt><dd className="mt-1 font-bold text-zinc-800">No owned Copies</dd></div>}
          <div className="sm:flex sm:min-w-0 sm:flex-col sm:justify-center sm:px-4"><dt className="text-xs font-bold uppercase tracking-wide text-zinc-500">This Copy’s cost:</dt><dd className="mt-1 font-bold text-zinc-800 tabular-nums">{selectedCopy ? selectedCopy.costPence === null ? "Cost unknown" : formatCurrency(selectedCopy.costPence) : "No Copy selected"}</dd><dd className="mt-0.5 text-xs font-medium text-zinc-500">The allocated share from its source Record.</dd></div>
          <div className="sm:min-w-0 sm:px-4 sm:last:pr-0"><dt className="text-xs font-bold uppercase tracking-wide text-zinc-500">Acquired from</dt><dd className="mt-1 font-bold text-zinc-800 sm:flex sm:min-w-0 sm:items-center sm:justify-between sm:gap-3"><span className="min-w-0">{selectedCopy?.record?.title ?? "Source unavailable"}{selectedCopy?.record ? <span className="mt-0.5 block text-xs font-medium text-zinc-500">{selectedCopy.record.source} · {formatDate(selectedCopy.record.date)}</span> : null}</span>{selectedCopy?.onViewSource ? <button className="mt-1 block min-h-11 shrink-0 text-sm font-bold text-[#8a1f2d] underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-[#8a1f2d] sm:mt-0" onClick={selectedCopy.onViewSource} type="button">View source Record</button> : null}</dd></div>
        </dl>
        {printing ? (
          <div className="flex flex-col gap-3 border-t border-zinc-200 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-wide text-zinc-500">Product source</p>
              <p className="mt-1 truncate text-sm font-bold text-zinc-800" title={productUrlLabel}>{productUrlLabel}</p>
              <p className="mt-0.5 text-xs font-medium text-zinc-500">Refetch this link to correct rarity and its linked card metadata.</p>
            </div>
            <div className="flex shrink-0 flex-col gap-2 min-[390px]:flex-row">
              {productUrl ? <a className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-bold text-zinc-700 transition hover:border-zinc-500 hover:text-zinc-950 focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-offset-2" href={productUrl} rel="noreferrer" target="_blank">Open link<ArrowUpRight aria-hidden="true" className="size-4" /></a> : null}
              {onEditProductSource ? <button className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-zinc-950 px-3 text-sm font-bold text-white transition hover:bg-zinc-800 focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-offset-2" onClick={onEditProductSource} type="button"><RefreshCcw aria-hidden="true" className="size-4" />{productUrl ? "Edit & refetch" : "Add & fetch link"}</button> : null}
            </div>
          </div>
        ) : null}
      </details>
    </section>
  );
}

function CardSourceDialog({
  onClose,
  onSaved,
  printing,
  source,
  target,
}: {
  onClose: () => void;
  onSaved: (message: string) => void;
  printing: CardPrinting;
  source: RecordsDataSource;
  target: WishlistTarget;
}) {
  const initialUrl = printing.tcgplayerUrl || target.tcgplayerUrl || "";
  const [url, setUrl] = useState(initialUrl);
  const [preview, setPreview] = useState<ResolvedProductMetadata | null>(null);
  const [fetchedUrl, setFetchedUrl] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useViewportOverlay<HTMLDivElement>({ isOpen: true, onClose });
  const normalizedUrl = url.trim();
  const fetchedCurrentUrl = Boolean(preview && fetchedUrl === normalizedUrl);

  async function fetchDetails() {
    setFetching(true);
    setError(null);
    setPreview(null);
    setFetchedUrl(null);
    const result = await source.resolveTcgplayerProduct(normalizedUrl);
    setFetching(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    if (!result.metadata.rarity.trim()) {
      setError("This link did not return a rarity. Nothing can be updated from it.");
      return;
    }
    setPreview(result.metadata);
    setFetchedUrl(normalizedUrl);
  }

  async function saveDetails() {
    if (!preview || !fetchedCurrentUrl) {
      setError("Fetch the current link before saving.");
      return;
    }
    setSaving(true);
    setError(null);
    const result = await source.updateCardSource({
      targetId: target.id,
      printingId: printing.id,
      tcgplayerUrl: normalizedUrl,
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onSaved(result.warning ?? "Product source and fetched card details updated.");
    onClose();
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <div aria-describedby="card-source-description" aria-labelledby="card-source-title" aria-modal="true" className="fixed inset-0 z-50 grid place-items-end bg-zinc-950/55 p-3 sm:place-items-center sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }} role="dialog">
      <div className="max-h-[calc(100dvh-1.5rem)] w-full max-w-xl overflow-y-auto rounded-xl border border-zinc-300 bg-[#f6f4ef] shadow-2xl sm:max-h-[calc(100dvh-3rem)]" ref={dialogRef} tabIndex={-1}>
        <header className="flex items-start justify-between gap-4 border-b border-zinc-300 bg-white px-4 py-4 sm:px-6">
          <div className="min-w-0"><span className="text-xs font-bold uppercase tracking-[0.12em] text-[#8a1f2d]">Product source</span><h2 className="mt-1 text-xl font-black" id="card-source-title">Edit and refetch link</h2><p className="mt-1 text-sm font-medium leading-5 text-zinc-500" id="card-source-description">Change only the TCGplayer link. The fetched card details are read-only and will update together.</p></div>
          <button aria-label="Close product source editor" className="grid size-11 shrink-0 place-items-center rounded-md border border-zinc-300 bg-white text-zinc-600 transition hover:text-zinc-950 focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-offset-2" disabled={saving} onClick={onClose} type="button"><X aria-hidden="true" className="size-5" /></button>
        </header>
        <div className="grid gap-4 p-4 sm:p-6">
          <div>
            <label className="text-sm font-bold text-zinc-700" htmlFor="card-source-url">TCGplayer product link <span className="text-rose-700">*</span></label>
            <input aria-describedby="card-source-url-help" autoComplete="off" className="mt-1 h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-base font-semibold outline-none transition focus:border-[#8a1f2d] focus:ring-2 focus:ring-[#8a1f2d]/20 sm:text-sm" id="card-source-url" onChange={(event) => { setUrl(event.target.value); setPreview(null); setFetchedUrl(null); setError(null); }} placeholder="https://www.tcgplayer.com/product/…" spellCheck={false} type="url" value={url} />
            <span className="mt-1 block text-xs font-medium leading-5 text-zinc-500" id="card-source-url-help">Fetching this link refreshes rarity, card name, edition, set/code, image, and card type. Those values are not manually editable here.</span>
          </div>
          <button className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-[#8a1f2d]/30 bg-rose-50 px-4 text-sm font-black text-[#8a1f2d] transition hover:border-[#8a1f2d] hover:bg-rose-100 focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-50" disabled={fetching || saving || !normalizedUrl} onClick={() => void fetchDetails()} type="button"><RefreshCcw aria-hidden="true" className={`size-4 ${fetching ? "animate-spin" : ""}`} />{fetching ? "Fetching card details…" : "Fetch details from link"}</button>
          {error ? <p className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-3 text-sm font-bold leading-5 text-rose-900" role="alert">{error}</p> : null}
          {preview ? (
            <section aria-labelledby="fetched-card-title" className="overflow-hidden rounded-lg border border-emerald-300 bg-white shadow-sm">
              <div className="flex items-center gap-2 border-b border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-900"><Check aria-hidden="true" className="size-4" /><h3 className="text-sm font-black" id="fetched-card-title">Fetched and ready to save</h3></div>
              <div className="grid gap-4 p-3 sm:grid-cols-[4rem_minmax(0,1fr)]">
                <div className="mx-auto grid aspect-[59/86] w-16 place-items-center overflow-hidden rounded-md border border-zinc-200 bg-zinc-100 sm:mx-0">{preview.imageUrl ? <Image alt="" className="h-full w-full object-contain" height={120} src={`/api/image-proxy?url=${encodeURIComponent(preview.imageUrl)}`} unoptimized width={82} /> : <WalletCards aria-hidden="true" className="size-6 text-zinc-400" />}</div>
                <dl className="grid min-w-0 gap-2 text-sm">
                  <div><dt className="text-xs font-bold uppercase tracking-wide text-zinc-500">Card</dt><dd className="mt-0.5 break-words font-black text-zinc-950">{preview.title || target.name}</dd></div>
                  <div className="grid grid-cols-2 gap-3"><div><dt className="text-xs font-bold uppercase tracking-wide text-zinc-500">New rarity</dt><dd className="mt-0.5 font-black text-[#8a1f2d]">{preview.rarity}</dd></div><div><dt className="text-xs font-bold uppercase tracking-wide text-zinc-500">Current rarity</dt><dd className="mt-0.5 font-bold text-zinc-600">{target.rarity}</dd></div></div>
                  <div><dt className="text-xs font-bold uppercase tracking-wide text-zinc-500">Printing</dt><dd className="mt-0.5 font-bold text-zinc-700">{preview.setName || printing.setName}{preview.setCode || printing.setCode ? ` · ${preview.setCode || printing.setCode}` : ""}{preview.edition ? ` · ${preview.edition}` : ""}</dd></div>
                </dl>
              </div>
            </section>
          ) : (
            <div className="rounded-lg border border-dashed border-zinc-300 bg-white px-4 py-5 text-center"><RefreshCcw aria-hidden="true" className="mx-auto size-5 text-zinc-400" /><p className="mt-2 text-sm font-bold text-zinc-700">Fetch the link to preview the new rarity</p><p className="mt-1 text-xs font-medium text-zinc-500">Nothing is written to the database until you review and save.</p></div>
          )}
        </div>
        <footer className="flex flex-col-reverse gap-2 border-t border-zinc-300 bg-white p-4 sm:flex-row sm:justify-end sm:px-6"><button className="min-h-11 rounded-md border border-zinc-300 bg-white px-4 text-sm font-bold text-zinc-700 transition hover:border-zinc-500 hover:text-zinc-950" disabled={saving} onClick={onClose} type="button">Cancel</button><button className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 text-sm font-bold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-45" disabled={!fetchedCurrentUrl || saving || fetching} onClick={() => void saveDetails()} type="button">{saving ? <><RefreshCcw aria-hidden="true" className="size-4 animate-spin" />Refetching and saving…</> : "Save refreshed details"}</button></footer>
      </div>
    </div>,
    document.body,
  );
}

function PhysicalCopyCombobox({
  onSelect,
  options,
  selectedCopyId,
}: {
  onSelect: (copyId: string) => void;
  options: SearchablePicklistOption[];
  selectedCopyId: string;
}) {
  return (
    <div className="max-w-xl">
      <SearchablePicklist emptyMessage="No Copies match that search." label="Physical Copy" onSelect={onSelect} options={options} placeholder="Search by Copy number, set, or sticker" resultsLabel="Physical Copies" selectedId={selectedCopyId} />
    </div>
  );
}

function InventoryCardDetailContent({
  source,
  targetId,
}: {
  source: RecordsDataSource;
  targetId: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const listState = parseInventoryListState(new URLSearchParams(searchParams.toString()));
  const [editingSource, setEditingSource] = useState<{ lineId: string | null; recordId: string } | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<{ copyId: string } | null>(null);
  const [removingCopyId, setRemovingCopyId] = useState<string | null>(null);
  const [savingCopy, setSavingCopy] = useState(false);
  const [confirmTargetRemoval, setConfirmTargetRemoval] = useState(false);
  const [deletingTarget, setDeletingTarget] = useState(false);
  const [editingCardSource, setEditingCardSource] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<InventoryCardSection>("details");
  const target = source.snapshot.targets.find((item) => item.id === targetId) ?? null;
  const sourceGroups = target ? inventoryCopySourceGroups(source.snapshot, target) : [];
  const copies = orderCopies(sourceGroups.flatMap((group) => group.copies.map(({ copy }) => copy)));
  const copyDetails = copies.flatMap((copy) => sourceGroups.flatMap((group) => group.copies.filter((item) => item.copy.id === copy.id).map((item) => ({ ...item, group }))));
  const requestedCopyId = searchParams.get("copy");
  const effectiveCopyId = requestedCopyId && copies.some((copy) => copy.id === requestedCopyId)
    ? requestedCopyId
    : copies[0]?.id ?? null;
  const selectedDetail = copyDetails.find((item) => item.copy.id === effectiveCopyId) ?? null;
  const productSourcePrinting = selectedDetail?.printing
    ?? source.snapshot.printings.find((printing) => printing.targetId === targetId)
    ?? null;
  const selectedVariantCopyIds = selectedDetail
    ? copyDetails.flatMap((item) => (
      item.printing.id === selectedDetail.printing.id
        && item.copy.condition === selectedDetail.copy.condition
        && item.copy.status !== "void"
        ? [item.copy.id]
        : []
    ))
    : [];
  const copyExposureByCopyId = new Map(source.snapshot.copyEbayExposures.map((exposure) => [exposure.copyId, exposure]));
  const copyPickerOptions = copyDetails.map(({ copy, printing }) => {
    const copyNumber = copies.findIndex((item) => item.id === copy.id) + 1;
    const label = copyDisplayLabel(copies, copy.id);
    const detail = `#${copyShortReference(copy.id)} · ${printing.setCode || "Unknown set"} · ${copy.stickerNumber ? `Sticker ${copy.stickerNumber}` : copy.condition}`;
    return {
      detail,
      displayText: `${label} · ${detail}`,
      id: copy.id,
      label,
      searchText: [`Copy ${copyNumber}`, copyShortReference(copy.id), printing.setCode, copy.stickerNumber].filter(Boolean).join(" ").toLocaleLowerCase("en-GB"),
    };
  });
  const selectedExposure = selectedDetail ? copyExposureByCopyId.get(selectedDetail.copy.id) : undefined;
  const selectedCopyRemoval = copyRemovalDecision(selectedExposure);
  const ownedCopies = copies.filter((copy) => copy.status === "available");
  const ownedQuantity = ownedCopies.length;
  const soldQuantity = copies.filter((copy) => copy.status === "sold").length;
  const knownPurchaseValueCount = ownedCopies.filter((copy) => copy.allocationPence !== null).length;
  const unknownPurchaseValueCount = ownedCopies.length - knownPurchaseValueCount;
  const purchaseValuePence = ownedCopies.reduce((sum, copy) => sum + (copy.allocationPence ?? 0), 0);
  const libraryStatus = target
    ? getLibraryCardStatus(target.desiredQuantity, ownedQuantity)
    : null;
  const editingRecord = editingSource
    ? source.snapshot.records.find((record) => record.id === editingSource.recordId) ?? null
    : null;

  if (!target || !libraryStatus) {
    return (
      <section className="rounded-lg border border-zinc-300 bg-white px-5 py-10 text-center shadow-sm" role="status">
        <WalletCards aria-hidden="true" className="mx-auto size-8 text-zinc-400" />
        <h2 className="mt-4 text-xl font-black">Card not found</h2>
        <p className="mx-auto mt-2 max-w-lg text-sm font-medium leading-6 text-zinc-600">This card may have been removed or is no longer available in the current Records snapshot.</p>
        <Link className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-md bg-zinc-950 px-4 text-sm font-bold text-white focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2" href={inventoryListHref(listState)}><ArrowLeft className="size-4" /> Back to inventory</Link>
      </section>
    );
  }

  if (editingSource && editingRecord) {
    return (
      <RecordEditorDialog
        backLabel={`Back to ${target.name}`}
        initialCardLineId={editingSource.lineId}
        initialPanel={editingSource.lineId ? "items" : "details"}
        key={`${editingRecord.id}-${editingSource.lineId ?? "details"}`}
        onClose={() => setEditingSource(null)}
        onSaved={setMessage}
        record={editingRecord}
        source={source}
      />
    );
  }

  async function removeCopyFromInventory() {
    if (!pendingRemoval) return;
    setRemovingCopyId(pendingRemoval.copyId);
    const result = await source.removeCardCopy(pendingRemoval.copyId);

    setRemovingCopyId(null);
    setPendingRemoval(null);
    setMessage(dataSourceMessage(
      result,
      "The selected Copy was removed and its source Record was updated.",
    ));
  }

  async function removeWishlistTarget() {
    setDeletingTarget(true);
    const result = await source.deleteWishlistTarget(targetId);
    setDeletingTarget(false);
    if (result.ok) {
      if (result.warning) {
        setConfirmTargetRemoval(false);
        setMessage(result.warning);
        return;
      }
      router.replace(inventoryListHref(listState));
      return;
    }
    setConfirmTargetRemoval(false);
    setMessage(result.message);
  }

  async function saveCopyDetails(copyId: string, form: FormData) {
    const condition = String(form.get("condition") || "");
    if (!isCardCondition(condition)) {
      setMessage("Choose a card condition before saving this Copy.");
      return;
    }
    setSavingCopy(true);
    const result = await source.updateCardCopy(copyId, {
      condition,
      location: String(form.get("location") || ""),
      stickerNumber: String(form.get("stickerNumber") || ""),
      privateNote: String(form.get("note") || ""),
    });
    setSavingCopy(false);
    setMessage(dataSourceMessage(result, "Copy details saved."));
  }

  function navigateInventorySections(event: KeyboardEvent<HTMLButtonElement>, currentIndex: number) {
    let nextIndex = currentIndex;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % inventoryCardSections.length;
    else if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + inventoryCardSections.length) % inventoryCardSections.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = inventoryCardSections.length - 1;
    else return;

    event.preventDefault();
    const nextSection = inventoryCardSections[nextIndex];
    setActiveSection(nextSection.value);
    window.requestAnimationFrame(() => document.getElementById(`inventory-card-section-tab-${nextSection.value}`)?.focus());
  }

  return (
    <div className="grid gap-5 sm:gap-6">
      {editingCardSource && productSourcePrinting ? <CardSourceDialog onClose={() => setEditingCardSource(false)} onSaved={setMessage} printing={productSourcePrinting} source={source} target={target} /> : null}
      <nav aria-label="Inventory breadcrumb">
        <Link className="inline-flex min-h-11 items-center gap-2 rounded-md text-sm font-bold text-zinc-600 transition hover:text-zinc-950 focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-offset-2" href={inventoryListHref(listState)}><ArrowLeft aria-hidden="true" className="size-4" /> Back to inventory</Link>
      </nav>

      <InventoryCardSummary libraryStatus={libraryStatus} knownPurchaseValueCount={knownPurchaseValueCount} onEditProductSource={productSourcePrinting ? () => setEditingCardSource(true) : undefined} printing={productSourcePrinting} purchaseValuePence={purchaseValuePence} selectedCopy={selectedDetail ? { costPence: selectedDetail.copy.allocationPence, onViewSource: selectedDetail.group.record ? () => setEditingSource({ lineId: selectedDetail.group.relevantLineId, recordId: selectedDetail.group.record!.id }) : undefined, record: selectedDetail.group.record } : null} soldQuantity={soldQuantity} target={target} unknownPurchaseValueCount={unknownPurchaseValueCount} />

      {selectedDetail ? (
        <nav aria-label="Card inventory sections" className="rounded-xl border border-zinc-300 bg-zinc-100 p-0.5 shadow-sm">
          <div aria-orientation="horizontal" className="grid grid-cols-3 gap-1" role="tablist">
            {inventoryCardSections.map((section, index) => {
              const Icon = section.icon;
              const active = activeSection === section.value;
              return (
                <button
                  aria-controls={`inventory-card-section-panel-${section.value}`}
                  aria-selected={active}
                  className={`flex min-h-11 min-w-0 cursor-pointer items-center justify-center gap-1 rounded-lg px-1 py-1 text-center text-[11px] font-bold transition focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-100 sm:gap-2 sm:px-3 sm:text-sm ${active ? "bg-white text-[#8a1f2d] shadow-sm" : "text-zinc-600 hover:bg-white/70 hover:text-zinc-950"}`}
                  id={`inventory-card-section-tab-${section.value}`}
                  key={section.value}
                  onClick={() => setActiveSection(section.value)}
                  onKeyDown={(event) => navigateInventorySections(event, index)}
                  role="tab"
                  tabIndex={active ? 0 : -1}
                  type="button"
                >
                  <Icon aria-hidden="true" className="size-4 shrink-0" />
                  <span className="min-w-0 leading-tight">{section.label}</span>
                </button>
              );
            })}
          </div>
        </nav>
      ) : null}

      <div aria-describedby="inventory-card-description" className="grid min-w-0 gap-4 sm:gap-5">
          {message ? <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800" role="status">{message}</p> : null}
          {pendingRemoval ? (
            <section aria-labelledby="remove-copy-title" className="rounded-lg border border-rose-300 bg-rose-50 p-4" role="alert">
              <h3 className="font-black text-rose-950" id="remove-copy-title">Remove this physical Copy?</h3>
              <p className="mt-1 text-sm font-medium leading-5 text-rose-900">This updates the Record that added it. If this is the only card in its source Record, that Record will be voided instead so its history stays recoverable.</p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:justify-end">
                <button className="min-h-11 rounded-md border border-rose-300 bg-white px-4 text-sm font-bold text-rose-950" disabled={Boolean(removingCopyId)} onClick={() => setPendingRemoval(null)} type="button">Cancel</button>
                <button className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-rose-700 px-4 text-sm font-bold text-white disabled:cursor-wait disabled:opacity-60" disabled={Boolean(removingCopyId)} onClick={() => void removeCopyFromInventory()} type="button"><Trash2 className="size-4" />{removingCopyId ? "Removing…" : "Remove Copy"}</button>
              </div>
            </section>
          ) : null}
          {confirmTargetRemoval ? (
            <section aria-labelledby="remove-wishlist-title" className="rounded-lg border border-rose-300 bg-rose-50 p-4" role="alert">
              <h3 className="font-black text-rose-950" id="remove-wishlist-title">Remove this card from your Wishlist?</h3>
              <p className="mt-1 text-sm font-medium leading-5 text-rose-900">This removes the Target and its saved printing details. It is only available while this card has no Copy history.</p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:justify-end">
                <button className="min-h-11 rounded-md border border-rose-300 bg-white px-4 text-sm font-bold text-rose-950" disabled={deletingTarget} onClick={() => setConfirmTargetRemoval(false)} type="button">Cancel</button>
                <button className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-rose-700 px-4 text-sm font-bold text-white disabled:cursor-wait disabled:opacity-60" disabled={deletingTarget} onClick={() => void removeWishlistTarget()} type="button"><Trash2 className="size-4" />{deletingTarget ? "Removing…" : "Remove from Wishlist"}</button>
              </div>
            </section>
          ) : null}
          <section aria-labelledby="physical-copies-title" className="overflow-hidden rounded-xl border border-zinc-300 bg-white shadow-sm">
            <header className="flex flex-col gap-3 border-b border-zinc-200 px-4 py-4 sm:flex-row sm:items-end sm:justify-between sm:px-5">
              <div>
                <h3 className="text-lg font-black" id="physical-copies-title">Physical copies</h3>
                <p className="mt-1 text-sm font-medium leading-5 text-zinc-500">Manage each Copy, or create one listing plan for the selected matching variant.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2"><span className="shrink-0 text-sm font-bold text-zinc-500">{copies.length} {copies.length === 1 ? "Copy" : "Copies"}</span>{selectedDetail ? <Link className="inline-flex min-h-11 items-center justify-center rounded-md bg-[#8a1f2d] px-3 text-sm font-bold text-white transition hover:bg-[#711826] focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-offset-2" href={linkedListingHref(target.id, selectedDetail.printing.id, selectedDetail.copy.condition)}>Create listing</Link> : null}</div>
            </header>

            {selectedDetail ? (
              <div className="grid gap-4 p-3 sm:p-4 md:p-5">
                {copies.length > 1 ? (
                  <PhysicalCopyCombobox key={selectedDetail.copy.id} onSelect={(copyId) => { router.replace(inventoryCardDetailHref(target.id, listState, copyId), { scroll: false }); setMessage(null); }} options={copyPickerOptions} selectedCopyId={selectedDetail.copy.id} />
                ) : null}

                <article className="grid min-w-0 gap-4">
                  <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2"><h4 className="text-lg font-black">{copyDisplayLabel(copies, selectedDetail.copy.id)}</h4><span className={`rounded px-2 py-0.5 text-xs font-bold ${selectedExposure?.physical.state === "owned" ? "bg-emerald-50 text-emerald-700" : selectedExposure?.physical.state === "sold" ? "bg-zinc-100 text-zinc-700" : "bg-amber-50 text-amber-800"}`}>{selectedExposure ? physicalCopyStateLabel(selectedExposure) : selectedDetail.copy.status === "available" ? "Owned" : selectedDetail.copy.status === "sold" ? "Sold" : "Unavailable"}</span></div>
                      <p className="mt-1 break-words text-sm font-medium leading-5 text-zinc-500">Ref #{copyShortReference(selectedDetail.copy.id)} · {selectedDetail.printing.setCode || "Unknown code"} · {selectedDetail.printing.setName || "Unknown set"}</p>
                      {selectedDetail.copy.stickerNumber || selectedDetail.copy.location ? <p className="mt-2 flex flex-wrap gap-2 text-xs font-bold text-zinc-700">{selectedDetail.copy.stickerNumber ? <span className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1">Sticker {selectedDetail.copy.stickerNumber}</span> : null}{selectedDetail.copy.location ? <span className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1">{selectedDetail.copy.location}</span> : null}</p> : null}
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
                      {selectedDetail.copy.status === "available" && selectedDetail.group.record?.status === "active" ? selectedCopyRemoval.available ? (
                        <button className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-rose-300 px-3 text-sm font-bold text-rose-800 transition hover:bg-rose-50 focus-visible:ring-2 focus-visible:ring-rose-700 focus-visible:ring-offset-2 sm:w-auto" disabled={Boolean(removingCopyId)} onClick={() => setPendingRemoval({ copyId: selectedDetail.copy.id })} type="button"><Trash2 aria-hidden="true" className="size-4" />Remove Copy</button>
                      ) : <UnavailableAction icon={Trash2} label="Remove Copy" reason={selectedCopyRemoval.reason ?? "This Copy cannot be removed."} /> : null}
                    </div>
                  </header>

                  {selectedExposure ? <EbayCopyExposure exposure={selectedExposure} /> : null}

                  <form aria-labelledby="inventory-card-section-tab-details" className="grid gap-4 rounded-lg border border-zinc-200 bg-zinc-50 p-4" hidden={activeSection !== "details"} id="inventory-card-section-panel-details" key={`copy-form-${selectedDetail.copy.id}`} onSubmit={(event) => { event.preventDefault(); void saveCopyDetails(selectedDetail.copy.id, new FormData(event.currentTarget)); }} role="tabpanel">
                    <div><h5 className="font-black" id={`copy-details-title-${selectedDetail.copy.id}`}>Copy details</h5><p className="mt-1 text-sm font-medium leading-5 text-zinc-500">Record how this Copy looks and where to find it in your physical collection.</p></div>
                    <div className="grid min-w-0 gap-4">
                      <label className="grid min-w-0 content-start gap-1.5 text-sm font-bold">Condition<select className="min-h-11 w-full min-w-0 rounded-md border border-zinc-300 bg-white px-3 text-base font-medium focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-offset-2" defaultValue={isCardCondition(selectedDetail.copy.condition) ? selectedDetail.copy.condition : ""} name="condition" required>{!isCardCondition(selectedDetail.copy.condition) ? <option disabled value="">Choose a condition (currently {selectedDetail.copy.condition})</option> : null}{cardConditionOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><span className="text-xs font-medium leading-5 text-zinc-500">Uses the same grading choices as the eBay listing form.</span></label>
                      <label className="grid min-w-0 content-start gap-1.5 text-sm font-bold">Sticker number<input aria-describedby={`sticker-number-help-${selectedDetail.copy.id}`} className="min-h-11 w-full min-w-0 rounded-md border border-zinc-300 bg-white px-3 text-base font-medium tabular-nums focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-offset-2" defaultValue={selectedDetail.copy.stickerNumber ?? ""} inputMode="numeric" maxLength={20} name="stickerNumber" pattern="[0-9]*" placeholder="e.g. 00042" /><span className="text-xs font-medium leading-5 text-zinc-500" id={`sticker-number-help-${selectedDetail.copy.id}`}>Optional, digits only, and unique to this collection. Leading zeroes are kept.</span></label>
                      <label className="grid min-w-0 gap-1.5 text-sm font-bold">Card location<input aria-describedby={`card-location-help-${selectedDetail.copy.id}`} className="min-h-11 w-full min-w-0 rounded-md border border-zinc-300 bg-white px-3 text-base font-medium focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-offset-2" defaultValue={selectedDetail.copy.location ?? ""} maxLength={160} name="location" placeholder="e.g. Binder 2 · Page 7 · Slot 3" /><span className="text-xs font-medium leading-5 text-zinc-500" id={`card-location-help-${selectedDetail.copy.id}`}>Optional. Use whatever location format matches how you store your cards.</span></label>
                    </div>
                    <label className="grid gap-1.5 text-sm font-bold">Private note<textarea className="min-h-24 resize-y rounded-md border border-zinc-300 bg-white p-3 text-base font-medium focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-offset-2" defaultValue={selectedDetail.copy.privateNote} maxLength={1_000} name="note" /></label>
                    <button className="min-h-11 w-full rounded-md bg-[#8a1f2d] px-4 text-sm font-bold text-white transition hover:bg-[#741a26] focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-offset-2 disabled:opacity-60 sm:w-auto sm:justify-self-start" disabled={savingCopy} type="submit">{savingCopy ? "Saving…" : "Save copy details"}</button>
                  </form>

                  <div aria-labelledby="inventory-card-section-tab-listing-photos" hidden={activeSection !== "listing-photos"} id="inventory-card-section-panel-listing-photos" role="tabpanel">{isCardCondition(selectedDetail.copy.condition) ? <InventoryListingPhotoSets canManage={source.mode === "live"} cardName={target.name} condition={selectedDetail.copy.condition} edition={target.edition} printingId={selectedDetail.printing.id} sourceCopyIds={selectedVariantCopyIds} /> : <p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-950">Choose a valid condition in Copy details before managing listing photos.</p>}</div>
                  <div aria-labelledby="inventory-card-section-tab-copy-photos" hidden={activeSection !== "copy-photos"} id="inventory-card-section-panel-copy-photos" role="tabpanel"><CardInventoryImages canUpload={source.mode === "live" && selectedDetail.copy.status !== "void"} cardName={target.name} copyId={selectedDetail.copy.id} isPreview={source.mode !== "live"} key={`copy-images-${selectedDetail.copy.id}`} /></div>
                </article>
              </div>
            ) : (
              <div className="px-4 py-5 sm:px-5">
                <div className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-4 py-10 text-center"><WalletCards aria-hidden="true" className="mx-auto size-7 text-zinc-400" /><p className="mt-3 font-bold">No physical Copies yet</p><p className="mx-auto mt-1 max-w-md text-sm font-medium leading-6 text-zinc-500">This card is still on your Wishlist. Its condition, photos, and acquisition source will appear here after you add a Copy.</p></div>
                <div className="mt-5 flex flex-col gap-3 rounded-lg border border-rose-200 bg-rose-50 p-4 sm:flex-row sm:items-center sm:justify-between"><div><h4 className="font-black text-rose-950">Wishlist settings</h4><p className="mt-1 text-sm font-medium leading-5 text-rose-900">Remove this card if you no longer want to track it.</p></div><button className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-md border border-rose-300 bg-white px-4 text-sm font-bold text-rose-800 transition hover:bg-rose-100 focus-visible:ring-2 focus-visible:ring-rose-700 focus-visible:ring-offset-2" onClick={() => setConfirmTargetRemoval(true)} type="button"><Trash2 aria-hidden="true" className="size-4" />Remove from Wishlist</button></div>
              </div>
            )}
          </section>
        </div>
    </div>
  );
}

export function InventoryCardDetail({ targetId }: { targetId: string }) {
  const source = useRecordsDataSource();

  if (source.status === "loading") {
    return (
      <div className="grid min-h-72 place-items-center rounded-lg border border-zinc-300 bg-white" role="status">
        <div className="text-center"><Clock3 className="mx-auto size-7 animate-pulse text-[#8a1f2d]" /><p className="mt-3 font-bold">Preparing card inventory</p></div>
      </div>
    );
  }

  if (source.status === "error") {
    return <DataLoadError message={source.errorMessage || "Nothing has been changed. Try loading Records again."} onRetry={source.refresh} title="Card inventory could not be loaded" />;
  }

  return <InventoryCardDetailContent source={source} targetId={targetId} />;
}

function InventoryFilterModal({
  activeFilterCount,
  editionOptions,
  listState,
  onClear,
  onClose,
  onUpdate,
  rarityOptions,
}: {
  activeFilterCount: number;
  editionOptions: string[];
  listState: InventoryListState;
  onClear: () => void;
  onClose: () => void;
  onUpdate: (update: Partial<InventoryListState>) => void;
  rarityOptions: string[];
}) {
  const dialogRef = useViewportOverlay<HTMLDivElement>({
    isOpen: true,
    onClose,
  });
  const [raritySearch, setRaritySearch] = useState("");
  const visibleRarities = useMemo(() => {
    const search = raritySearch.trim().toLocaleLowerCase("en-GB");
    return search ? rarityOptions.filter((rarity) => rarity.toLocaleLowerCase("en-GB").includes(search)) : rarityOptions;
  }, [rarityOptions, raritySearch]);
  const allRaritiesSelected = rarityOptions.length > 0 && listState.rarity.length === rarityOptions.length;

  function toggleRarity(rarity: string) {
    onUpdate({
      page: 1,
      rarity: listState.rarity.includes(rarity)
        ? listState.rarity.filter((selectedRarity) => selectedRarity !== rarity)
        : [...listState.rarity, rarity],
    });
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <div aria-describedby="inventory-filter-description" aria-labelledby="inventory-filter-title" aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-black/30 px-4 py-6" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }} role="dialog">
      <section className="flex max-h-[88dvh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-zinc-300 bg-white shadow-xl" ref={dialogRef} tabIndex={-1}>
        <div className="flex items-start justify-between gap-4 border-b border-zinc-200 p-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#8a1f2d]">Filters</p>
            <h2 className="mt-1 text-xl font-bold" id="inventory-filter-title">Refine inventory</h2>
            <p className="mt-1 text-sm font-medium text-zinc-500" id="inventory-filter-description">{activeFilterCount ? `${activeFilterCount} active` : "No filters active"} <span className="text-zinc-400">· narrow down your collection</span></p>
          </div>
          <button aria-label="Close filters" className="grid size-11 place-items-center rounded-md border border-zinc-300 text-zinc-600 transition hover:border-zinc-950 hover:text-zinc-950" onClick={onClose} type="button"><X className="size-4" /></button>
        </div>

        <div className="grid gap-4 overflow-auto p-4">
          <div className="rounded-lg border border-zinc-200 bg-zinc-50/60 p-3">
            <div className="flex items-center justify-between gap-3"><span className="text-sm font-medium text-zinc-700">Inventory type</span>{listState.kind !== "cards" ? <button className="text-xs font-bold text-[#8a1f2d] transition hover:text-[#711826]" onClick={() => onUpdate({ kind: "cards", page: 1 })} type="button">Cards</button> : null}</div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {inventoryTabs.map((tab) => {
                const selected = listState.kind === tab.value;
                return <button aria-pressed={selected} className={`min-h-11 rounded-md border px-3 text-sm font-semibold transition ${selected ? "border-[#8a1f2d]/30 bg-rose-50 text-[#8a1f2d]" : "border-zinc-300 bg-white text-zinc-600 hover:border-zinc-950 hover:text-zinc-950"}`} key={tab.value} onClick={() => onUpdate({ kind: tab.value, page: 1 })} type="button">{tab.label}</button>;
              })}
            </div>
          </div>

          <div className="rounded-lg border border-zinc-200 bg-zinc-50/60 p-3">
            <div className="flex items-center justify-between gap-3"><span className="text-sm font-medium text-zinc-700">Copies</span>{listState.copyQuantity !== "all" ? <button className="text-xs font-bold text-[#8a1f2d] transition hover:text-[#711826]" onClick={() => onUpdate({ copyQuantity: "all", page: 1 })} type="button">Any quantity</button> : null}</div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {[{ label: "All copies", value: "all" }, { label: "2+ copies (same name)", value: "multiple" }].map((option) => {
                const selected = listState.copyQuantity === option.value;
                return <button aria-pressed={selected} className={`min-h-11 rounded-md border px-3 text-sm font-semibold transition ${selected ? "border-[#8a1f2d]/30 bg-rose-50 text-[#8a1f2d]" : "border-zinc-300 bg-white text-zinc-600 hover:border-zinc-950 hover:text-zinc-950"}`} key={option.value} onClick={() => onUpdate({ copyQuantity: option.value as InventoryListState["copyQuantity"], page: 1 })} type="button">{option.label}</button>;
              })}
            </div>
          </div>

          <div className="rounded-lg border border-zinc-200 bg-zinc-50/60 p-3">
            <div className="flex items-center justify-between gap-3"><div><span className="text-sm font-medium text-zinc-700">Rarity</span><span className="ml-2 text-xs font-semibold text-zinc-500">{listState.rarity.length ? `${listState.rarity.length} selected` : "Any rarity"}</span></div><div className="flex items-center gap-3"><button className="text-xs font-bold text-[#8a1f2d] transition hover:text-[#711826] disabled:text-zinc-400" disabled={allRaritiesSelected || !rarityOptions.length} onClick={() => onUpdate({ page: 1, rarity: rarityOptions })} type="button">Select all</button><button className="text-xs font-bold text-[#8a1f2d] transition hover:text-[#711826] disabled:text-zinc-400" disabled={!listState.rarity.length} onClick={() => onUpdate({ page: 1, rarity: [] })} type="button">Deselect all</button></div></div>
            <label className="relative mt-2 block"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" /><input aria-label="Search rarity filters" className="h-10 w-full rounded-md border border-zinc-300 bg-white pl-9 pr-3 text-sm outline-none transition focus:border-[#8a1f2d]" onChange={(event) => setRaritySearch(event.target.value)} placeholder="Search and select multiple rarities" value={raritySearch} /></label>
            <div className="mt-2 max-h-44 overflow-auto rounded-md border border-zinc-200 bg-white p-2">
              {visibleRarities.length ? <div className="flex flex-wrap gap-2">{visibleRarities.map((rarity) => { const selected = listState.rarity.includes(rarity); return <button aria-pressed={selected} className={`inline-flex min-h-9 items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-sm font-semibold transition ${selected ? "border-[#8a1f2d]/30 bg-rose-50 text-[#8a1f2d]" : "border-zinc-300 bg-white text-zinc-600 hover:border-zinc-950 hover:text-zinc-950"}`} key={rarity} onClick={() => toggleRarity(rarity)} type="button"><span>{rarity}</span>{selected ? <Check className="size-4 shrink-0" /> : null}</button>; })}</div> : <p className="px-2 py-3 text-sm font-semibold text-zinc-500">No rarities match that search.</p>}
            </div>
          </div>

          <div className="rounded-lg border border-zinc-200 bg-zinc-50/60 p-3">
            <div className="flex items-center justify-between gap-3"><span className="text-sm font-medium text-zinc-700">Edition</span>{listState.edition !== "all" ? <button className="text-xs font-bold text-[#8a1f2d] transition hover:text-[#711826]" onClick={() => onUpdate({ edition: "all", page: 1 })} type="button">Any edition</button> : null}</div>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">{["all", ...editionOptions].map((edition) => { const selected = listState.edition === edition; return <button aria-pressed={selected} className={`min-h-11 rounded-md border px-3 text-sm font-semibold transition ${selected ? "border-[#8a1f2d]/30 bg-rose-50 text-[#8a1f2d]" : "border-zinc-300 bg-white text-zinc-600 hover:border-zinc-950 hover:text-zinc-950"}`} key={edition} onClick={() => onUpdate({ edition, page: 1 })} type="button">{edition === "all" ? "All editions" : edition}</button>; })}</div>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-zinc-200 bg-white p-4"><button className="min-h-11 rounded-md border border-zinc-300 px-3 text-sm font-semibold text-zinc-700 transition hover:border-zinc-950 hover:text-zinc-950 disabled:cursor-not-allowed disabled:opacity-40" disabled={!activeFilterCount} onClick={onClear} type="button">Clear filters</button><button className="min-h-11 rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white transition hover:bg-zinc-800" onClick={onClose} type="button">Done</button></div>
      </section>
    </div>,
    document.body,
  );
}

function InventoryView() {
  const source = useRecordsDataSource();
  const router = useRouter();
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  const searchParams = useSearchParams();
  const searchParamsString = searchParams.toString();
  const listState = useMemo(
    () => parseInventoryListState(new URLSearchParams(searchParamsString)),
    [searchParamsString],
  );
  const activeTab: InventoryTab = listState.kind;
  const { snapshot } = source;
  const cardPageSize = 24;
  const inventoryCards = useMemo(() => {
    const printingsByTarget = new Map<string, CardPrinting[]>();
    const targetIdByPrintingId = new Map<string, string>();
    const copiesByTarget = new Map<string, CardCopy[]>();
    const exposureByCopyId = new Map(snapshot.copyEbayExposures.map((exposure) => [exposure.copyId, exposure]));

    for (const printing of snapshot.printings) {
      targetIdByPrintingId.set(printing.id, printing.targetId);
      const printings = printingsByTarget.get(printing.targetId) ?? [];
      printings.push(printing);
      printingsByTarget.set(printing.targetId, printings);
    }

    for (const copy of snapshot.copies) {
      const targetId = targetIdByPrintingId.get(copy.printingId);
      if (!targetId) continue;
      const copies = copiesByTarget.get(targetId) ?? [];
      copies.push(copy);
      copiesByTarget.set(targetId, copies);
    }

    return snapshot.targets.map((target) => {
      const printings = printingsByTarget.get(target.id) ?? [];
      const copies = copiesByTarget.get(target.id) ?? [];
      const ownedCopies = copies.filter((copy) => copy.status === "available");
      const offersByListingId = new Map<string, EbayOfferExposure>();
      for (const copy of copies) {
        for (const offer of exposureByCopyId.get(copy.id)?.offers ?? []) {
          offersByListingId.set(offer.listingId, offer);
        }
      }
      const offers = [...offersByListingId.values()];
      return {
        copies,
        endedOfferCount: offers.filter((offer) => offer.listingState === "ended").length,
        knownPurchaseValueCount: ownedCopies.filter((copy) => copy.allocationPence !== null).length,
        libraryStatus: getLibraryCardStatus(target.desiredQuantity, ownedCopies.length),
        liveOfferCount: offers.filter((offer) => offer.listingState === "active").length,
        printings,
        purchaseValuePence: ownedCopies.reduce((sum, copy) => sum + (copy.allocationPence ?? 0), 0),
        target,
        unknownPurchaseValueCount: ownedCopies.filter((copy) => copy.allocationPence === null).length,
      };
    });
  }, [snapshot.copyEbayExposures, snapshot.copies, snapshot.printings, snapshot.targets]);
  const rarityOptions = Array.from(new Set(snapshot.targets.map((target) => target.rarity))).sort();
  const editionOptions = Array.from(new Set(snapshot.targets.map((target) => target.edition))).sort();
  const activeCopyCountByName = useMemo(() => {
    const copyCounts = new Map<string, number>();

    for (const { copies, target } of inventoryCards) {
      const name = target.name.trim().toLocaleLowerCase("en-GB");
      const activeCopyCount = copies.filter((copy) => copy.status !== "void").length;
      if (!name || activeCopyCount === 0) continue;
      copyCounts.set(name, (copyCounts.get(name) ?? 0) + activeCopyCount);
    }

    return copyCounts;
  }, [inventoryCards]);
  const filteredTargets = inventoryCards.filter(({ copies, libraryStatus, target }) => {
    const search = listState.card.trim().toLocaleLowerCase("en-GB");
    const normalizedName = target.name.trim().toLocaleLowerCase("en-GB");
    const hasActiveCopy = copies.some((copy) => copy.status !== "void");
    return (
      (listState.status === "all" || libraryStatus.status === listState.status)
      && (listState.copyQuantity !== "multiple" || (hasActiveCopy && (activeCopyCountByName.get(normalizedName) ?? 0) > 1))
      && (!listState.rarity.length || listState.rarity.includes(target.rarity))
      && (listState.edition === "all" || target.edition === listState.edition)
      && (!search || [target.name, target.rarity, target.edition].join(" ").toLocaleLowerCase("en-GB").includes(search))
    );
  });
  const cardPageCount = Math.max(1, Math.ceil(filteredTargets.length / cardPageSize));
  const cardPage = Math.min(listState.page, cardPageCount);
  const visibleTargets = filteredTargets.slice((cardPage - 1) * cardPageSize, cardPage * cardPageSize);

  useEffect(() => {
    if (cardPage !== listState.page) {
      router.replace(inventoryListHref({ ...listState, page: cardPage }), { scroll: false });
    }
  }, [cardPage, listState, router]);

  function updateListState(update: Partial<InventoryListState>) {
    window.history.replaceState(null, "", inventoryListHref({ ...listState, ...update }));
  }

  const activeFilterCount =
    (listState.kind === "cards" ? 0 : 1)
    + (listState.copyQuantity === "all" ? 0 : 1)
    + listState.rarity.length
    + (listState.edition === "all" ? 0 : 1);

  function clearFilters() {
    updateListState({ copyQuantity: "all", edition: "all", kind: "cards", page: 1, rarity: [] });
  }

  return (
    <div className="grid gap-4">
      {activeTab !== "cards" ? <div className="flex justify-end"><button className="inline-flex min-h-11 items-center gap-2 rounded-md border border-[#8a1f2d]/30 bg-rose-50 px-3 text-sm font-semibold text-[#8a1f2d] transition hover:bg-rose-100" onClick={() => setFilterModalOpen(true)} type="button"><SlidersHorizontal className="size-4" />Filters <span className="rounded bg-[#8a1f2d] px-1.5 py-0.5 text-xs font-bold text-white">{activeFilterCount}</span></button></div> : null}

      {activeTab === "cards" ? (
        <div className="grid gap-3">
          <div className="flex flex-col gap-3 rounded-lg border border-zinc-300 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex rounded-md border border-zinc-300 bg-zinc-100 p-1">
                {(["all", "wishlist", "owned"] as const).map((status) => <button aria-pressed={listState.status === status} className={`min-h-10 rounded px-3 text-sm font-semibold transition ${listState.status === status ? "bg-white text-zinc-950 shadow-sm" : "text-zinc-600 hover:text-zinc-950"}`} key={status} onClick={() => updateListState({ page: 1, status })} type="button">{status === "all" ? "All" : status === "wishlist" ? "Wishlist" : "Owned"}</button>)}
              </div>
              <label className="relative min-w-0 flex-1 basis-64"><span className="sr-only">Search card inventory</span><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" /><input className="h-11 w-full rounded-md border border-zinc-300 bg-zinc-50 pl-9 pr-3 text-sm outline-none transition focus:border-[#8a1f2d] focus:bg-white" onChange={(event) => updateListState({ card: event.target.value, page: 1 })} placeholder="Search cards, rarity, or edition" value={listState.card} /></label>
              <div className="flex flex-wrap items-center gap-2 sm:ml-auto"><p className="mr-auto text-sm font-bold text-zinc-500 sm:mr-1">{filteredTargets.length} card target{filteredTargets.length === 1 ? "" : "s"}</p><button className={`inline-flex min-h-11 items-center gap-2 rounded-md border px-3 text-sm font-semibold transition ${activeFilterCount ? "border-[#8a1f2d]/30 bg-rose-50 text-[#8a1f2d]" : "border-zinc-300 bg-white text-zinc-700 hover:border-zinc-950 hover:text-zinc-950"}`} onClick={() => setFilterModalOpen(true)} type="button"><SlidersHorizontal className="size-4" />Filters{activeFilterCount ? <span className="rounded bg-[#8a1f2d] px-1.5 py-0.5 text-xs font-bold text-white">{activeFilterCount}</span> : null}</button><button className="min-h-11 rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-600 transition hover:border-zinc-950 hover:text-zinc-950 disabled:cursor-not-allowed disabled:opacity-40" disabled={!activeFilterCount} onClick={clearFilters} type="button">Clear filters</button></div>
            </div>
          </div>
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visibleTargets.map(({ copies, endedOfferCount, knownPurchaseValueCount, libraryStatus, liveOfferCount, printings, purchaseValuePence, target, unknownPurchaseValueCount }) => {
            const ebayListings = inventoryEbayListingSummary(liveOfferCount, endedOfferCount);
            return (
              <Link aria-label={`${copies.length ? "View copies and source" : "View Wishlist Target"} for ${target.name}. Wanted ${libraryStatus.wantedQuantity}. Owned ${libraryStatus.ownedQuantity}. ${copies.filter((copy) => copy.status === "sold").length} sold. ${ebayListings.accessibleLabel}`} className="group flex min-w-0 gap-3 rounded-lg border border-zinc-300 bg-white p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-[#8a1f2d] hover:shadow-md active:translate-y-0 focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-offset-2 motion-reduce:transform-none motion-reduce:transition-none" href={inventoryCardDetailHref(target.id, listState)} key={target.id}>
                <span className="grid h-24 w-16 shrink-0 self-center place-items-center overflow-hidden rounded-md border border-zinc-200 bg-zinc-100">
                  {target.imageUrl ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img alt={`${target.name} card`} className="h-full w-full object-cover" decoding="async" loading="lazy" src={target.imageUrl} />
                    </>
                  ) : (
                    <WalletCards aria-hidden="true" className="size-5 text-zinc-400" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-start justify-between gap-2">
                    <span className="min-w-0 flex-1 truncate font-bold leading-5">{target.name}</span>
                    <span className={`shrink-0 rounded-md px-2 py-1 text-[11px] font-bold ${libraryStatus.status === "wishlist" ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>{libraryStatus.status === "wishlist" ? "Wishlist" : "Owned"}</span>
                  </span>
                  <span className="mt-1 block text-xs font-semibold text-zinc-500">Wanted {libraryStatus.wantedQuantity} · Owned {libraryStatus.ownedQuantity}{libraryStatus.wishlistRemainingQuantity ? ` · ${libraryStatus.wishlistRemainingQuantity} still wanted` : ""} · {copies.filter((copy) => copy.status === "sold").length} sold</span>
                  <span className="mt-2 block text-xs font-bold text-zinc-700"><span className="text-zinc-500">{ebayListings.heading}</span><span aria-hidden="true"> · </span><span>{ebayListings.summary}</span></span>
                  {libraryStatus.ownedQuantity ? <span className="mt-1 block text-xs font-bold text-emerald-700">{ownedCardTotalLabel(libraryStatus.ownedQuantity)} {knownPurchaseValueCount === 0 ? "unknown" : paidCostSummary({ formattedKnownTotal: formatCurrency(purchaseValuePence), knownCopyCount: knownPurchaseValueCount, unknownCopyCount: unknownPurchaseValueCount })}</span> : null}
                  <span className="mt-2 flex flex-wrap gap-1">
                    {printings.map((printing) => <span className="rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[11px] font-bold text-zinc-600" key={printing.id}>{printing.setCode}</span>)}
                  </span>
                  <span className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-[#8a1f2d]">{copies.length ? "View copies and sources" : "View Wishlist Target"} <ChevronRight className="size-3.5 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" /></span>
                </span>
              </Link>
            );
          })}
          {visibleTargets.length === 0 ? <div className="col-span-full grid min-h-48 place-items-center rounded-lg border border-dashed border-zinc-300 bg-white text-center"><div><Search className="mx-auto size-6 text-zinc-400" /><p className="mt-2 font-bold">No matching cards</p></div></div> : null}
          </section>
          {cardPageCount > 1 ? <nav aria-label="Card inventory pages" className="flex items-center justify-between rounded-lg border border-zinc-300 bg-white p-3 text-sm font-bold text-zinc-600"><button aria-label="Previous card inventory page" className="grid size-11 place-items-center rounded-md border border-zinc-300 disabled:opacity-40" disabled={cardPage === 1} onClick={() => updateListState({ page: Math.max(1, cardPage - 1) })} type="button"><ChevronLeft className="size-4" /></button><span>Page {cardPage} of {cardPageCount}</span><button aria-label="Next card inventory page" className="grid size-11 place-items-center rounded-md border border-zinc-300 disabled:opacity-40" disabled={cardPage === cardPageCount} onClick={() => updateListState({ page: Math.min(cardPageCount, cardPage + 1) })} type="button"><ChevronRight className="size-4" /></button></nav> : null}
        </div>
      ) : null}

      {filterModalOpen ? <InventoryFilterModal activeFilterCount={activeFilterCount} editionOptions={editionOptions} listState={listState} onClear={clearFilters} onClose={() => setFilterModalOpen(false)} onUpdate={updateListState} rarityOptions={rarityOptions} /> : null}

      {activeTab === "sealed" ? (
        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {snapshot.sealedUnits.map((item) => (
            <article className="rounded-lg border border-zinc-300 bg-white p-4 shadow-sm" key={item.id}>
              <div className="flex items-start gap-3">
                <span className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-md border border-zinc-200 bg-zinc-100">
                  {item.imageUrl ? <Image alt={`${item.name} sealed product`} className="h-full w-full object-contain p-1" height={80} loading="lazy" src={`/api/image-proxy?url=${encodeURIComponent(item.imageUrl)}`} unoptimized width={80} /> : <PackageCheck aria-hidden="true" className="size-6 text-[#8a1f2d]" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex justify-end"><span className="rounded-md bg-zinc-100 px-2 py-1 text-xs font-bold capitalize text-zinc-600">{item.status}</span></div>
                  <h3 className="mt-2 font-bold">{item.name}</h3><p className="mt-1 text-sm font-medium text-zinc-500">{item.edition ? `${item.edition} · ` : ""}Quantity {item.quantity}</p>
                </div>
              </div>
              {item.status === "sealed" ? <Link className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-md bg-zinc-950 px-3 text-sm font-bold text-white" href={`/records/new/opening?sealedId=${encodeURIComponent(item.id)}`}><PackageOpen className="size-4" /> Open product</Link> : null}
            </article>
          ))}
        </section>
      ) : null}

      {activeTab === "bulk" ? (
        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {snapshot.bulkLots.map((lot) => (
            <article className="rounded-lg border border-zinc-300 bg-white p-4 shadow-sm" key={lot.id}>
              <div className="flex items-start justify-between gap-3"><Boxes className="size-6 text-[#8a1f2d]" /><span className="rounded-md bg-amber-50 px-2 py-1 text-xs font-bold capitalize text-amber-800">{lot.status}</span></div>
              <h3 className="mt-4 font-bold">{lot.name}</h3><p className="mt-1 text-sm font-medium text-zinc-500">{lot.itemizedQuantity} identified of {lot.totalQuantity} total cards</p>
            </article>
          ))}
        </section>
      ) : null}

      {activeTab === "supplies" ? (
        <section className="overflow-hidden rounded-lg border border-zinc-300 bg-white shadow-sm">
          <div className="divide-y divide-zinc-200">
            {snapshot.supplies.map((item) => (
              <article className="flex items-center gap-3 p-4" key={item.id}>
                <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-zinc-100 text-zinc-600"><PackageCheck className="size-5" /></span>
                <div className="min-w-0 flex-1"><h3 className="font-bold">{item.name}</h3><p className="mt-0.5 text-sm font-medium capitalize text-zinc-500">{item.category} · {item.status}</p></div>
                <span className="font-black tabular-nums">×{item.quantity}</span>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

export function RecordsApp({ view }: { view: RecordsView }) {
  const source = useRecordsDataSource();

  return (
    <>
      {source.status === "loading" ? (
        <div className="grid min-h-72 place-items-center rounded-lg border border-zinc-300 bg-white" role="status">
          <div className="text-center"><Clock3 className="mx-auto size-7 animate-pulse text-[#8a1f2d]" /><p className="mt-3 font-bold">Preparing Records</p></div>
        </div>
      ) : source.status === "error" ? <DataLoadError message={source.errorMessage || "Nothing has been changed. Try loading Records again."} onRetry={source.refresh} title="Records could not be loaded" /> : view === "overview" ? <Overview /> : view === "history" ? <HistoryView /> : <InventoryView />}
    </>
  );
}

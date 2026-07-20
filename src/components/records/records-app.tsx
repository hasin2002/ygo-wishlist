"use client";

import {
  AlertTriangle,
  ArrowLeft,
  ArrowDownLeft,
  ArrowUpRight,
  Boxes,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  ExternalLink,
  History,
  PackageCheck,
  PackageOpen,
  Pencil,
  RefreshCcw,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  Undo2,
  WalletCards,
  X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import {
  CardContentsEditor,
  type CardContentsDraft,
} from "@/components/records/card-contents-editor";
import { poundsToPence } from "@/components/records/entry-form-ui";
import { useRecordsDataSource } from "@/components/records/records-preview-provider";
import { getLibraryCardStatus } from "@/lib/records/library-status";
import {
  recordImagePreviewsFor,
  type RecordImagePreview,
} from "@/lib/records/record-images";
import type {
  CardAttentionUpdate,
  CardCopy,
  CardPrinting,
  RecordEntry,
  RecordEntryType,
  RecordLine,
  RecordsDataSource,
  RecordsSnapshot,
  ProductEdition,
  SupplyCategory,
  WishlistTarget,
} from "@/lib/records/types";

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
  if (record.amountKnown === false) return "Cost unknown";
  if (record.type === "sale") return `+${formatCurrency(record.amountPence)}`;
  if (record.amountPence > 0) return `−${formatCurrency(record.amountPence)}`;
  return "No cashflow";
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

export function RecordsNavigation({ view }: { view: RecordsView }) {
  const items = [
    { href: "/records", label: "Overview", value: "overview" },
    { href: "/records/history", label: "History", value: "history" },
    { href: "/records/inventory", label: "Inventory", value: "inventory" },
  ] satisfies Array<{ href: string; label: string; value: RecordsView }>;

  return (
    <nav
      aria-label="Records"
      className="grid grid-cols-3 rounded-lg border border-zinc-300 bg-zinc-100 p-1"
    >
      {items.map((item) => (
        <Link
          aria-current={view === item.value ? "page" : undefined}
          className={`inline-flex min-h-11 items-center justify-center rounded-md px-3 text-sm font-bold transition ${
            view === item.value
              ? "bg-white text-zinc-950 shadow-sm"
              : "text-zinc-600 hover:text-zinc-950"
          }`}
          href={item.href}
          key={item.href}
          onClick={(event) => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            window.history.pushState(null, "", item.href);
          }}
        >
          {item.label}
        </Link>
      ))}
    </nav>
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
                  Void
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
          <p
            className={`font-black tabular-nums ${
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
      setMessage("Card items saved.");
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
            <p className="mt-1 text-sm font-medium text-zinc-500">{openedProduct.edition ? `${openedProduct.edition} · ` : ""}This product is read-only here; edit the pulled cards below.</p>
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
  const [query, setQuery] = useState("");
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const candidates = source.snapshot.copies.flatMap((copy) => {
    if (copy.status !== "available" && copy.soldRecordId !== record.id) return [];
    const printing = source.snapshot.printings.find((item) => item.id === copy.printingId);
    const target = printing ? source.snapshot.targets.find((item) => item.id === printing.targetId) : null;
    if (!printing || !target) return [];
    return [{ copy, printing, target }];
  });
  const search = query.trim().toLowerCase();
  const filtered = candidates.filter((item) => (!selectedOnly || selectedIds.includes(item.copy.id)) && (!search || [item.target.name, item.target.rarity, item.printing.setCode].join(" ").toLowerCase().includes(search)));
  const pageSize = 12;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visible = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  function toggle(copyId: string) {
    setSelectedIds((current) => current.includes(copyId) ? current.filter((id) => id !== copyId) : [...current, copyId]);
  }

  async function saveCopies() {
    setSaving(true);
    const result = await source.replaceSaleCopies(record.id, selectedIds);
    setSaving(false);
    setMessage(result.ok ? "Sold Copies saved." : result.message);
  }

  return (
    <section className="grid gap-3">
      <div><h3 className="font-bold">Cards sold</h3><p className="mt-1 text-sm font-medium text-zinc-500">Select the exact physical Copies included in this Sale. Removing one returns it to available inventory.</p></div>
      {message ? <p className={`rounded-md border px-3 py-2 text-sm font-bold ${message === "Sold Copies saved." ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-300 bg-rose-50 text-rose-900"}`} role="status">{message}</p> : null}
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <label className="relative"><span className="sr-only">Search available Copies</span><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" /><input className="h-11 w-full rounded-md border border-zinc-300 bg-white pl-9 pr-3 text-sm outline-none focus:border-[#8a1f2d] focus:ring-2 focus:ring-[#8a1f2d]/20" onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Search cards, rarity, or code" value={query} /></label>
        <label className="inline-flex min-h-11 items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-bold"><input checked={selectedOnly} className="size-4 accent-[#8a1f2d]" onChange={(event) => { setSelectedOnly(event.target.checked); setPage(1); }} type="checkbox" /> Selected only</label>
      </div>
      <p className="text-sm font-bold text-zinc-600">{selectedIds.length} physical {selectedIds.length === 1 ? "Copy" : "Copies"} selected</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {visible.map(({ copy, printing, target }) => {
          const selected = selectedIds.includes(copy.id);
          return <button aria-pressed={selected} className={`min-w-0 rounded-lg border p-2 text-left transition focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-offset-2 ${selected ? "border-[#8a1f2d] bg-rose-50" : "border-zinc-300 bg-white hover:border-zinc-500"}`} key={copy.id} onClick={() => toggle(copy.id)} type="button"><div className="flex items-start gap-2">{target.imageUrl ? <Image alt="" className="h-16 w-11 shrink-0 rounded object-cover" height={64} src={`/api/image-proxy?url=${encodeURIComponent(target.imageUrl)}`} unoptimized width={44} /> : <span className="grid h-16 w-11 shrink-0 place-items-center rounded bg-zinc-100 text-[10px] font-bold text-zinc-400">CARD</span>}<div className="min-w-0"><p className="line-clamp-2 text-xs font-bold leading-4">{target.name}</p><p className="mt-1 text-[11px] font-semibold text-zinc-500">{printing.setCode}</p><p className="mt-1 text-[10px] font-bold text-[#8a1f2d]">{selected ? "Selected" : "Available"}</p></div></div></button>;
        })}
      </div>
      {!visible.length ? <div className="rounded-lg border border-dashed border-zinc-300 bg-white px-4 py-8 text-center text-sm font-bold text-zinc-500">No matching Copies</div> : null}
      {pageCount > 1 ? <nav aria-label="Sale Copy pages" className="flex items-center justify-between rounded-md border border-zinc-300 bg-white p-2 text-sm font-bold"><button className="grid size-11 place-items-center rounded border border-zinc-300 disabled:opacity-40" disabled={currentPage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))} type="button"><ChevronLeft className="size-4" /></button><span>Page {currentPage} of {pageCount}</span><button className="grid size-11 place-items-center rounded border border-zinc-300 disabled:opacity-40" disabled={currentPage === pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} type="button"><ChevronRight className="size-4" /></button></nav> : null}
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
    setMessage(result.ok ? "Item saved." : result.message);
    if (result.ok) setExpanded(false);
  }

    return <article className="rounded-lg border border-zinc-300 bg-white p-3">{expanded ? <div className="grid gap-3"><div className="flex items-center justify-between gap-3"><h4 className="font-bold capitalize">Edit {line.kind} item</h4><button className="min-h-11 rounded-md px-3 text-sm font-bold text-zinc-600 hover:bg-zinc-100" disabled={saving} onClick={() => setExpanded(false)} type="button">Cancel</button></div>{message && message !== "Item saved." ? <p className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-900">{message}</p> : null}<div className="grid gap-3 sm:grid-cols-2"><label className="sm:col-span-2"><span className="text-sm font-bold text-zinc-700">{line.kind === "sealed" ? "Product name" : "Item name"}</span><input className="mt-1 h-11 w-full rounded-md border border-zinc-300 px-3 text-sm font-semibold outline-none focus:border-[#8a1f2d] focus:ring-2 focus:ring-[#8a1f2d]/20" onChange={(event) => setName(event.target.value)} value={name} /></label>{line.kind === "bulk" ? <label><span className="text-sm font-bold text-zinc-700">Total cards in lot</span><input className="mt-1 h-11 w-full rounded-md border border-zinc-300 px-3 text-sm font-semibold outline-none focus:border-[#8a1f2d] focus:ring-2 focus:ring-[#8a1f2d]/20" min={bulkLot?.itemizedQuantity ?? 1} onChange={(event) => setTotalQuantity(Number(event.target.value))} type="number" value={totalQuantity} /><span className="mt-1 block text-xs font-medium text-zinc-500">Changing this recalculates the lot&apos;s per-card allocation and is blocked after a card is sold.</span></label> : <label><span className="text-sm font-bold text-zinc-700">Quantity</span><input className="mt-1 h-11 w-full rounded-md border border-zinc-300 px-3 text-sm font-semibold outline-none focus:border-[#8a1f2d] focus:ring-2 focus:ring-[#8a1f2d]/20" min="1" onChange={(event) => setQuantity(Number(event.target.value))} type="number" value={quantity} /></label>}{line.kind === "sealed" ? <label><span className="text-sm font-bold text-zinc-700">Product edition</span><select className="mt-1 h-11 w-full rounded-md border border-zinc-300 px-3 text-sm font-semibold outline-none focus:border-[#8a1f2d] focus:ring-2 focus:ring-[#8a1f2d]/20" onChange={(event) => setEdition(event.target.value as ProductEdition)} value={edition}><option value="1st Edition">1st Edition</option><option value="Unlimited Edition">Unlimited Edition</option></select></label> : null}{line.kind === "supply" ? <label><span className="text-sm font-bold text-zinc-700">Category</span><select className="mt-1 h-11 w-full rounded-md border border-zinc-300 px-3 text-sm font-semibold outline-none focus:border-[#8a1f2d] focus:ring-2 focus:ring-[#8a1f2d]/20" onChange={(event) => setCategory(event.target.value as SupplyCategory)} value={category}><option value="sleeves">Sleeves</option><option value="binder">Binder</option><option value="storage">Storage</option><option value="playmat">Playmat</option><option value="other">Other</option></select></label> : null}{line.kind === "bulk" ? <label><span className="text-sm font-bold text-zinc-700">Lot details</span><input className="mt-1 h-11 w-full rounded-md border border-zinc-300 px-3 text-sm font-semibold outline-none focus:border-[#8a1f2d] focus:ring-2 focus:ring-[#8a1f2d]/20" onChange={(event) => setDetail(event.target.value)} value={detail} /></label> : null}</div><button className="min-h-11 rounded-md bg-zinc-950 px-4 text-sm font-bold text-white disabled:cursor-wait disabled:opacity-60 sm:justify-self-start" disabled={saving} onClick={saveLine} type="button">{saving ? "Saving…" : "Save item"}</button></div> : <div className="flex items-center justify-between gap-3"><div><p className="font-bold">{name}</p><p className="mt-1 text-sm font-medium text-zinc-500">{line.kind === "bulk" ? `${bulkLot?.itemizedQuantity ?? 0} identified of ${totalQuantity} total cards` : `Quantity ${quantity}`}{line.kind === "sealed" ? ` · ${edition}` : line.kind === "supply" ? ` · ${category}` : line.kind === "bulk" ? "" : detail ? ` · ${detail}` : ""}</p>{message === "Item saved." ? <p className="mt-1 text-xs font-bold text-emerald-700">Saved</p> : null}</div><button className="inline-flex min-h-11 items-center gap-2 rounded-md border border-zinc-300 px-3 text-sm font-bold" onClick={() => setExpanded(true)} type="button"><Pencil className="size-4" /> Edit</button></div>}</article>;
}

function RecordEditorDialog({
  backLabel,
  costOnly = false,
  initialCardLineId = null,
  initialPanel = "details",
  onClose,
  onSaved,
  record,
  source,
}: {
  backLabel?: string;
  costOnly?: boolean;
  initialCardLineId?: string | null;
  initialPanel?: "details" | "items";
  onClose: () => void;
  onSaved: (message: string) => void;
  record: RecordEntry;
  source: RecordsDataSource;
}) {
  const [title, setTitle] = useState(record.title);
  const [date, setDate] = useState(record.date);
  const [recordSource, setRecordSource] = useState(record.source);
  const [listingUrl, setListingUrl] = useState(record.listingUrl ?? "");
  const [amount, setAmount] = useState((record.amountPence / 100).toFixed(2));
  const [notes, setNotes] = useState(record.notes);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [activePanel, setActivePanel] = useState<"details" | "items">(initialPanel);
  const editsCashflow = record.type === "purchase" || record.type === "sale" || record.type === "imported-acquisition";
  const editsListing = record.type === "purchase" || record.type === "imported-acquisition";

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  async function save() {
    setSaving(true);
    const result = await source.updateRecordDetails(record.id, {
      title,
      date,
      source: recordSource,
      listingUrl: editsListing ? listingUrl : null,
      amountPence: editsCashflow ? poundsToPence(amount) : record.amountPence,
      notes,
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onSaved(`Saved changes to “${title.trim()}”.`);
    onClose();
  }

  async function changeStatus() {
    setSaving(true);
    const result = await (record.status === "void" ? source.restoreRecord(record.id) : source.voidRecord(record.id));
    setSaving(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onSaved(`${record.status === "void" ? "Restored" : "Voided"} “${record.title}”.`);
    onClose();
  }

  return (
    <div aria-labelledby="record-editor-title" aria-modal="true" className="fixed inset-0 z-50 grid place-items-end bg-zinc-950/45 p-3 sm:place-items-center sm:p-6" role="dialog">
      <div className="max-h-[calc(100vh-1.5rem)] w-full max-w-2xl overflow-y-auto rounded-xl border border-zinc-300 bg-[#f6f4ef] shadow-2xl sm:max-h-[calc(100vh-3rem)]">
        <div className="flex items-start justify-between gap-4 border-b border-zinc-300 bg-white px-4 py-4 sm:px-6">
          <div><span className="text-xs font-bold uppercase tracking-[0.12em] text-[#8a1f2d]">{costOnly ? "Resolve attention" : recordTypeLabels[record.type]}</span><h2 className="mt-1 text-xl font-black" id="record-editor-title">{costOnly ? "Add acquisition cost" : "Edit record"}</h2></div>
          <button aria-label={backLabel || "Close record editor"} autoFocus className="grid size-11 place-items-center rounded-md border border-zinc-300 bg-white text-zinc-600 transition hover:border-zinc-950 hover:text-zinc-950 focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-offset-2" onClick={onClose} type="button">{backLabel ? <ArrowLeft className="size-5" /> : <X className="size-5" />}</button>
        </div>
        {!costOnly ? <div className="border-b border-zinc-300 bg-white px-4 sm:px-6"><div className="grid grid-cols-2 rounded-t-lg border-x border-t border-zinc-300 bg-zinc-100 p-1"><button aria-pressed={activePanel === "details"} className={`min-h-11 rounded-md px-3 text-sm font-bold transition ${activePanel === "details" ? "bg-white text-zinc-950 shadow-sm" : "text-zinc-600 hover:text-zinc-950"}`} onClick={() => setActivePanel("details")} type="button">Record details</button><button aria-pressed={activePanel === "items"} className={`min-h-11 rounded-md px-3 text-sm font-bold transition ${activePanel === "items" ? "bg-white text-zinc-950 shadow-sm" : "text-zinc-600 hover:text-zinc-950"}`} onClick={() => setActivePanel("items")} type="button">Items ({record.lines.filter((line) => line.kind !== "bulk").reduce((sum, line) => sum + line.quantity, 0)})</button></div></div> : null}
        {activePanel === "details" ? <div className="grid gap-5 p-4 sm:p-6">
          <div><h3 className="font-bold">{costOnly ? record.title : "Record details"}</h3><p className="mt-1 text-sm font-medium text-zinc-500">{costOnly ? "Enter the full amount paid. Saving removes this item from Needs attention and includes it in your totals." : `Edit the shared information that identifies this ${recordTypeLabels[record.type].toLowerCase()}.`}</p></div>
          {error ? <div className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-3 text-sm font-bold text-rose-900" role="alert">{error}</div> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            {costOnly ? <label className="sm:col-span-2"><span className="text-sm font-bold text-zinc-700">All-in amount paid <span className="text-rose-700">*</span></span><div className="relative mt-1"><span className="pointer-events-none absolute inset-y-0 left-0 flex w-10 items-center justify-center text-lg font-bold text-zinc-500">£</span><input autoFocus className="h-11 w-full rounded-md border border-zinc-300 bg-white pl-10 pr-3 text-sm font-semibold outline-none focus:border-[#8a1f2d] focus:ring-2 focus:ring-[#8a1f2d]/20" inputMode="decimal" min="0" onChange={(event) => setAmount(event.target.value)} required step="0.01" type="number" value={amount} /></div></label> : <>
            <label className="sm:col-span-2"><span className="text-sm font-bold text-zinc-700">Record name <span className="text-rose-700">*</span></span><input className="mt-1 h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold outline-none focus:border-[#8a1f2d] focus:ring-2 focus:ring-[#8a1f2d]/20" maxLength={80} onChange={(event) => setTitle(event.target.value)} value={title} /></label>
            <label><span className="text-sm font-bold text-zinc-700">Date <span className="text-rose-700">*</span></span><input className="mt-1 h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold outline-none focus:border-[#8a1f2d] focus:ring-2 focus:ring-[#8a1f2d]/20" onChange={(event) => setDate(event.target.value)} type="date" value={date} /></label>
            <label><span className="text-sm font-bold text-zinc-700">{record.type === "sale" ? "Buyer or marketplace" : "Seller or source"} <span className="text-rose-700">*</span></span><input className="mt-1 h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold outline-none focus:border-[#8a1f2d] focus:ring-2 focus:ring-[#8a1f2d]/20" onChange={(event) => setRecordSource(event.target.value)} value={recordSource} /></label>
            {editsCashflow ? <label><span className="text-sm font-bold text-zinc-700">{record.type === "sale" ? "Net proceeds" : "All-in amount paid"}</span><div className="relative mt-1"><span className="pointer-events-none absolute inset-y-0 left-0 flex w-10 items-center justify-center text-lg font-bold text-zinc-500">£</span><input className="h-11 w-full rounded-md border border-zinc-300 bg-white pl-10 pr-3 text-sm font-semibold outline-none focus:border-[#8a1f2d] focus:ring-2 focus:ring-[#8a1f2d]/20" inputMode="decimal" min="0" onChange={(event) => setAmount(event.target.value)} step="0.01" type="number" value={amount} /></div></label> : null}
            {editsListing ? <label className="sm:col-span-2"><span className="text-sm font-bold text-zinc-700">Original listing <span className="font-medium text-zinc-400">(optional)</span></span><input className="mt-1 h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold outline-none focus:border-[#8a1f2d] focus:ring-2 focus:ring-[#8a1f2d]/20" inputMode="url" onChange={(event) => setListingUrl(event.target.value)} placeholder="https://…" type="url" value={listingUrl} /></label> : null}
            <label className="sm:col-span-2"><span className="text-sm font-bold text-zinc-700">Notes <span className="font-medium text-zinc-400">(optional)</span></span><textarea className="mt-1 min-h-24 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium outline-none focus:border-[#8a1f2d] focus:ring-2 focus:ring-[#8a1f2d]/20" onChange={(event) => setNotes(event.target.value)} value={notes} /></label>
            </>}
          </div>
        </div> : <div className="grid gap-6 p-4 sm:p-6">
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm font-medium leading-5 text-amber-950"><strong className="block font-bold">Dependency-safe item editing</strong><p className="mt-1">Items and quantities can be corrected here. If a Copy was later sold, removed, or a sealed unit was opened, changes that would contradict that history are blocked with a specific explanation.</p></div>
          {record.status === "void" ? <div className="rounded-lg border border-zinc-300 bg-white px-4 py-8 text-center"><p className="font-bold">Restore this Record to edit its items</p><p className="mt-1 text-sm font-medium text-zinc-500">Voided inventory stays frozen so it cannot leak back into the active collection.</p></div> : <>{record.type === "sale" ? <SaleCopyItemsEditor record={record} source={source} /> : <RecordCardItemsEditor initialCardLineId={initialCardLineId} record={record} source={source} />}{record.lines.filter((line) => line.kind !== "card").map((line) => <NonCardLineEditor key={line.id} line={line} record={record} source={source} />)}</>}
        </div>}
        <div className="flex flex-col-reverse gap-3 border-t border-zinc-300 bg-white p-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          {!costOnly ? <button className={`inline-flex min-h-11 items-center justify-center rounded-md border px-3 text-sm font-bold transition focus-visible:ring-2 focus-visible:ring-rose-700 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60 ${record.status === "void" ? "border-emerald-300 bg-emerald-50 text-emerald-800 hover:border-emerald-700" : "border-rose-300 bg-rose-50 text-rose-800 hover:border-rose-700"}`} disabled={saving} onClick={changeStatus} type="button">{record.status === "void" ? "Restore record" : "Void record"}</button> : <span />}
          <div className="flex flex-col-reverse gap-2 sm:flex-row"><button className="inline-flex min-h-11 items-center justify-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-bold text-zinc-700 transition hover:border-zinc-950" disabled={saving} onClick={onClose} type="button">{activePanel === "details" ? "Cancel" : "Close"}</button>{activePanel === "details" ? <button className="inline-flex min-h-11 items-center justify-center rounded-md bg-zinc-950 px-4 text-sm font-bold text-white transition hover:bg-zinc-800 focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60" disabled={saving} onClick={save} type="button">{saving ? "Saving…" : costOnly ? "Save acquisition cost" : "Save details"}</button> : null}</div>
        </div>
      </div>
    </div>
  );
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

function CardAttentionDialog({
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
  const showTcgplayerUrl = !tcgplayerUrl;
  const showName = !target?.name;
  const showRarity = !target?.rarity;
  const showEdition = item.field === "edition";
  const showSetName = !printingSetName;

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

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
    onSaved(`Resolved attention for “${name.trim()}”.`);
    onClose();
  }

  return (
    <div aria-labelledby="card-attention-title" aria-modal="true" className="fixed inset-0 z-50 grid place-items-end bg-zinc-950/50 p-3 sm:place-items-center sm:p-6" role="dialog">
      <div className="max-h-[calc(100dvh-1.5rem)] w-full max-w-xl overflow-y-auto rounded-xl border border-zinc-300 bg-[#f6f4ef] shadow-2xl sm:max-h-[calc(100dvh-3rem)]">
        <header className="flex items-start justify-between gap-4 border-b border-zinc-300 bg-white px-4 py-4 sm:px-6">
          <div><span className="text-xs font-bold uppercase tracking-[0.12em] text-[#8a1f2d]">Resolve attention</span><h2 className="mt-1 text-xl font-black" id="card-attention-title">Confirm card details</h2><p className="mt-1 text-sm font-medium text-zinc-500">Save the missing metadata once, and this item will leave the attention list.</p></div>
          <button aria-label="Close card resolution" autoFocus className="grid size-11 shrink-0 place-items-center rounded-md border border-zinc-300 bg-white text-zinc-600 focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-offset-2" onClick={onClose} type="button"><X className="size-5" /></button>
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
    </div>
  );
}

function Overview() {
  const source = useRecordsDataSource();
  const { snapshot } = source;
  const [period, setPeriod] = useState<OverviewPeriod>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [attentionItemId, setAttentionItemId] = useState<string | null>(null);
  const [attentionRecordId, setAttentionRecordId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const range = overviewDateRange(period, customFrom, customTo);
  const activeRecords = snapshot.records.filter((record) => (
    record.status === "active"
    && (!range.from || record.date >= range.from)
    && (!range.to || record.date <= range.to)
  ));
  const cost = activeRecords
    .filter((record) => (record.type === "purchase" || record.type === "imported-acquisition") && record.amountKnown !== false)
    .reduce((sum, record) => sum + record.amountPence, 0);
  const proceeds = activeRecords
    .filter((record) => record.type === "sale")
    .reduce((sum, record) => sum + record.amountPence, 0);
  const availableCopies = snapshot.copies.filter((copy) => copy.status === "available").length;
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
        <MetricCard detail="All-in acquisition amounts" icon={<ArrowDownLeft className="size-5" />} label="Actual cost" tone="negative" value={formatCurrency(cost)} />
        <MetricCard detail="Net after fees and postage" icon={<ArrowUpRight className="size-5" />} label="Net proceeds" tone="positive" value={formatCurrency(proceeds)} />
        <MetricCard detail="Proceeds minus actual cost" icon={<CircleDollarSign className="size-5" />} label="Cash position" tone={proceeds - cost >= 0 ? "positive" : "negative"} value={formatCurrency(proceeds - cost)} />
        <MetricCard detail={`${wishlistTargetCount} Wishlist target${wishlistTargetCount === 1 ? "" : "s"}`} icon={<WalletCards className="size-5" />} label="Physical copies" value={String(availableCopies)} />
      </section>

      {message ? <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800" role="status">{message}</p> : null}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(280px,0.7fr)]">
        <section className="overflow-hidden rounded-lg border border-zinc-300 bg-white shadow-sm">
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

        <section className="rounded-lg border border-zinc-300 bg-white p-4 shadow-sm">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-amber-50 text-amber-700"><AlertTriangle className="size-5" /></span>
            <div>
              <h2 className="font-bold">Needs attention</h2>
              <p className="mt-0.5 text-sm font-medium text-zinc-500">Legacy details to confirm later</p>
            </div>
          </div>
          <div className="mt-4 grid gap-2">
            {snapshot.attention.length ? snapshot.attention.slice(0, 5).map((item) => (
              <button className="w-full rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-left transition hover:border-[#8a1f2d] hover:bg-rose-50 focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-offset-2" key={item.id} onClick={() => {
                const recordId = item.field === "cost" ? item.id.replace(/^attention-cost-/, "") : null;
                const record = recordId ? snapshot.records.find((value) => value.id === recordId) : null;
                if (record) setAttentionRecordId(record.id);
                else setAttentionItemId(item.id);
              }} type="button">
                <p className="text-sm font-bold text-zinc-800">{item.label}</p>
                <p className="mt-0.5 text-xs font-medium leading-5 text-zinc-500">{item.detail}</p><span className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-[#8a1f2d]">Resolve details <ChevronRight className="size-3.5" /></span>
              </button>
            )) : (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-4 text-sm font-bold text-emerald-800">
                <CheckCircle2 className="mr-2 inline size-4" /> {source.mode === "preview" ? "Sample data is complete." : "No details need attention."}
              </div>
            )}
          </div>
        </section>
      </div>
      {attentionItemId ? <CardAttentionDialog item={snapshot.attention.find((item) => item.id === attentionItemId)!} onClose={() => setAttentionItemId(null)} onSaved={setMessage} source={source} /> : null}
      {attentionRecordId ? <RecordEditorDialog costOnly key={attentionRecordId} initialPanel="details" onClose={() => setAttentionRecordId(null)} onSaved={setMessage} record={snapshot.records.find((record) => record.id === attentionRecordId)!} source={source} /> : null}
    </div>
  );
}

function HistoryView() {
  const source = useRecordsDataSource();
  const [query, setQuery] = useState("");
  const [type, setType] = useState<"all" | RecordEntryType>("all");
  const [includeVoid, setIncludeVoid] = useState(true);
  const [page, setPage] = useState(1);
  const [message, setMessage] = useState<string | null>(null);
  const [editingRecordId, setEditingRecordId] = useState<string | null>(null);
  const [changingRecordId, setChangingRecordId] = useState<string | null>(null);
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

  async function toggleRecordStatus(record: RecordEntry) {
    setChangingRecordId(record.id);
    const result = await (record.status === "void"
      ? source.restoreRecord(record.id)
      : source.voidRecord(record.id));
    setChangingRecordId(null);
    setMessage(result.ok
      ? `${record.status === "void" ? "Restored" : "Voided"} “${record.title}”.`
      : result.message);
  }

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
          Show void
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
                  disabled={changingRecordId === record.id}
                  onClick={() => toggleRecordStatus(record)}
                  type="button"
                >
                  {record.status === "void" ? <RotateCcw className="size-3.5" /> : <Undo2 className="size-3.5" />}
                  {record.status === "void" ? "Restore" : "Void"}
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
    {editingRecord ? <RecordEditorDialog key={editingRecord.id} onClose={() => setEditingRecordId(null)} onSaved={setMessage} record={editingRecord} source={source} /> : null}
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

function InventoryCardDialog({
  onClose,
  source,
  targetId,
}: {
  onClose: () => void;
  source: RecordsDataSource;
  targetId: string;
}) {
  const [editingSource, setEditingSource] = useState<{ lineId: string | null; recordId: string } | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<{ copyId: string; recordId: string } | null>(null);
  const [removingCopyId, setRemovingCopyId] = useState<string | null>(null);
  const [confirmTargetRemoval, setConfirmTargetRemoval] = useState(false);
  const [deletingTarget, setDeletingTarget] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const target = source.snapshot.targets.find((item) => item.id === targetId) ?? null;
  const sourceGroups = target ? inventoryCopySourceGroups(source.snapshot, target) : [];
  const copies = sourceGroups.flatMap((group) => group.copies.map(({ copy }) => copy));
  const ownedCopies = copies.filter((copy) => copy.status === "available");
  const ownedQuantity = ownedCopies.length;
  const soldQuantity = copies.filter((copy) => copy.status === "sold").length;
  const hasKnownPurchaseValue = ownedCopies.some((copy) => copy.allocationPence !== null);
  const purchaseValuePence = ownedCopies.reduce((sum, copy) => sum + (copy.allocationPence ?? 0), 0);
  const libraryStatus = target
    ? getLibraryCardStatus(target.desiredQuantity, ownedQuantity)
    : null;
  const editingRecord = editingSource
    ? source.snapshot.records.find((record) => record.id === editingSource.recordId) ?? null
    : null;

  useEffect(() => {
    if (editingSource) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [editingSource, onClose]);

  if (!target || !libraryStatus) return null;

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
    const record = source.snapshot.records.find((item) => item.id === pendingRemoval.recordId);
    const sourceLine = record?.lines.find((line) => (
      line.kind === "card" && line.entityIds.includes(pendingRemoval.copyId)
    ));
    if (!record || !sourceLine) {
      setMessage("This Copy's source Record is no longer available. Refresh and try again.");
      setPendingRemoval(null);
      return;
    }

    setRemovingCopyId(pendingRemoval.copyId);
    const rows = cardDraftsForRecord(record, source.snapshot);
    const nextRows = rows.flatMap((row) => {
      if (row.id !== sourceLine.id) return [row];
      return row.quantity > 1 ? [{ ...row, quantity: row.quantity - 1 }] : [];
    });
    const result = nextRows.length
      ? await source.replaceRecordCards(record.id, nextRows.map((row) => ({
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
        })))
      : record.type !== "pack-opening"
        ? await source.voidRecord(record.id)
        : await source.replaceRecordCards(record.id, []);

    setRemovingCopyId(null);
    setPendingRemoval(null);
    setMessage(result.ok
      ? nextRows.length
        ? "Copy removed from Inventory and its source Record updated."
        : record.type !== "pack-opening"
          ? "Copy removed and its one-item source Record was voided. You can restore it from History."
          : "Copy removed from Inventory; the Pack Opening remains in History."
      : result.message);
  }

  async function removeWishlistTarget() {
    setDeletingTarget(true);
    const result = await source.deleteWishlistTarget(targetId);
    setDeletingTarget(false);
    if (result.ok) {
      onClose();
      return;
    }
    setConfirmTargetRemoval(false);
    setMessage(result.message);
  }

  return (
    <div aria-describedby="inventory-card-description" aria-labelledby="inventory-card-title" aria-modal="true" className="fixed inset-0 z-50 grid place-items-end bg-zinc-950/50 p-3 sm:place-items-center sm:p-6" role="dialog">
      <div className="max-h-[calc(100dvh-1.5rem)] w-full max-w-3xl overflow-y-auto overscroll-contain rounded-xl border border-zinc-300 bg-[#f6f4ef] shadow-2xl sm:max-h-[calc(100dvh-3rem)]">
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-zinc-300 bg-white px-4 py-4 sm:px-6">
          <div>
            <span className="text-xs font-bold uppercase tracking-[0.12em] text-[#8a1f2d]">Card inventory</span>
            <h2 className="mt-1 text-xl font-black" id="inventory-card-title">{target.name}</h2>
            <p className="mt-1 text-sm font-medium text-zinc-500" id="inventory-card-description">See every physical Copy and the Record it came from.</p>
          </div>
          <button aria-label="Close card inventory" autoFocus className="grid size-11 shrink-0 place-items-center rounded-md border border-zinc-300 bg-white text-zinc-600 transition hover:border-zinc-950 hover:text-zinc-950 focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-offset-2" onClick={onClose} type="button"><X className="size-5" /></button>
        </header>

        <div className="grid gap-5 px-4 pb-24 pt-4 sm:p-6">
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

          <section className="flex flex-col gap-4 rounded-lg border border-zinc-300 bg-white p-4 sm:flex-row sm:items-center">
            <div className="mx-auto grid h-32 w-24 shrink-0 place-items-center overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100 sm:mx-0">
              {target.imageUrl ? <Image alt={`${target.name} card`} className="h-full w-full object-contain" height={128} loading="eager" src={`/api/image-proxy?url=${encodeURIComponent(target.imageUrl)}`} unoptimized width={96} /> : <WalletCards aria-hidden="true" className="size-7 text-zinc-400" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-md px-2 py-1 text-xs font-bold ${libraryStatus.status === "wishlist" ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>{libraryStatus.status === "wishlist" ? "Wishlist" : "Owned"}</span>
                <span className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs font-bold text-zinc-600">{target.rarity}</span>
                <span className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs font-bold text-zinc-600">{target.edition}</span>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-2 text-center sm:grid-cols-4 sm:max-w-xl">
                <div className="rounded-md bg-zinc-50 px-2 py-3"><dt className="text-[11px] font-bold uppercase tracking-wide text-zinc-500">Wanted</dt><dd className="mt-1 text-xl font-black tabular-nums">{libraryStatus.wantedQuantity}</dd></div>
                <div className="rounded-md bg-zinc-50 px-2 py-3"><dt className="text-[11px] font-bold uppercase tracking-wide text-zinc-500">Owned</dt><dd className="mt-1 text-xl font-black tabular-nums">{libraryStatus.ownedQuantity}</dd></div>
                <div className="rounded-md bg-zinc-50 px-2 py-3"><dt className="text-[11px] font-bold uppercase tracking-wide text-zinc-500">Sold</dt><dd className="mt-1 text-xl font-black tabular-nums">{soldQuantity}</dd></div>
                <div className="rounded-md bg-zinc-50 px-2 py-3"><dt className="text-[11px] font-bold uppercase tracking-wide text-zinc-500">Purchase value</dt><dd className="mt-1 text-base font-black tabular-nums">{hasKnownPurchaseValue ? formatCurrency(purchaseValuePence) : "Unknown"}</dd></div>
              </dl>
            </div>
          </section>

          <section>
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div><h3 className="font-black">Copies and sources</h3><p className="mt-1 text-sm font-medium text-zinc-500">Changes are made through the Record that originally added each Copy.</p></div>
              <span className="text-sm font-bold text-zinc-500">{copies.length} physical {copies.length === 1 ? "Copy" : "Copies"}</span>
            </div>

            <div className="mt-3 grid gap-3">
              {sourceGroups.map((group) => {
                const record = group.record;
                return (
                  <article className="overflow-hidden rounded-lg border border-zinc-300 bg-white" key={record?.id ?? group.copies[0]?.copy.acquiredRecordId}>
                    <div className="grid gap-3 border-b border-zinc-200 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">{record ? <RecordTypeBadge type={record.type} /> : <span className="rounded-md bg-amber-50 px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-amber-800">Source unavailable</span>}<span className="text-xs font-semibold text-zinc-500">{record ? formatDate(record.date) : "Unknown date"}</span></div>
                        <h4 className="mt-2 font-black">{record?.title ?? "Missing acquisition record"}</h4>
                        <p className="mt-1 text-sm font-medium text-zinc-600">{record ? `Seller or source: ${record.source}` : "This preview Copy cannot be matched to its original Record."}</p>
                        {record?.listingUrl ? <a className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-md text-sm font-bold text-[#8a1f2d] underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-offset-2" href={record.listingUrl} rel="noreferrer" target="_blank">Original listing <ExternalLink className="size-4" /></a> : null}
                      </div>
                      {record ? <button className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-bold text-zinc-700 transition hover:border-[#8a1f2d] hover:text-[#8a1f2d] focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-offset-2" onClick={() => setEditingSource({ lineId: group.relevantLineId, recordId: record.id })} type="button"><Pencil className="size-4" /> {group.relevantLineId ? "Edit source record" : "View source record"}</button> : null}
                    </div>
                    <div className="divide-y divide-zinc-200">
                      {group.copies.map(({ copy, printing }, index) => {
                        const sale = copy.soldRecordId ? source.snapshot.records.find((recordItem) => recordItem.id === copy.soldRecordId) ?? null : null;
                        const copyLabel = group.copies.length === 1 ? "Physical Copy" : `Physical Copy ${index + 1}`;
                        return <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3" key={copy.id}><div><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-bold">{copyLabel}</p><span className={`rounded px-2 py-0.5 text-[11px] font-bold ${copy.status === "available" ? "bg-emerald-50 text-emerald-700" : copy.status === "sold" ? "bg-zinc-100 text-zinc-700" : "bg-amber-50 text-amber-800"}`}>{copy.status === "available" ? "Owned" : copy.status.charAt(0).toUpperCase() + copy.status.slice(1)}</span></div><p className="mt-1 text-sm font-medium text-zinc-500">{printing.setCode || "Unknown code"} · {printing.setName || "Unknown set"} · {copy.condition}</p>{sale ? <p className="mt-1 text-xs font-semibold text-zinc-500">Sold through “{sale.title}” on {formatDate(sale.date)}</p> : null}</div>{copy.status === "available" && record?.status === "active" ? <button className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-rose-300 bg-white px-3 text-sm font-bold text-rose-800 transition hover:bg-rose-50 focus-visible:ring-2 focus-visible:ring-rose-700 focus-visible:ring-offset-2" disabled={Boolean(removingCopyId)} onClick={() => setPendingRemoval({ copyId: copy.id, recordId: record.id })} type="button"><Trash2 className="size-4" /> Remove</button> : <p className="text-xs font-semibold text-zinc-500">{copy.status === "sold" ? "Edit the Sale before removing this Copy." : "Restore the source Record before editing this Copy."}</p>}</div>;
                      })}
                    </div>
                  </article>
                );
              })}
              {!sourceGroups.length ? <div className="rounded-lg border border-dashed border-zinc-300 bg-white px-4 py-10 text-center"><WalletCards className="mx-auto size-7 text-zinc-400" /><p className="mt-3 font-bold">No physical Copies yet</p><p className="mt-1 text-sm font-medium text-zinc-500">This card is on your Wishlist, so there is no acquisition source to edit.</p></div> : null}
            </div>
          </section>
        </div>

        <footer className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-zinc-300 bg-white p-4 sm:px-6">{copies.length === 0 ? <button className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-rose-300 bg-white px-4 text-sm font-bold text-rose-800 transition hover:bg-rose-50 focus-visible:ring-2 focus-visible:ring-rose-700 focus-visible:ring-offset-2" onClick={() => setConfirmTargetRemoval(true)} type="button"><Trash2 className="size-4" /> Remove from Wishlist</button> : <span />}<button className="inline-flex min-h-11 items-center justify-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-bold text-zinc-700 transition hover:border-zinc-950 focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2" onClick={onClose} type="button">Close</button></footer>
      </div>
    </div>
  );
}

function InventoryView() {
  const source = useRecordsDataSource();
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get("kind");
  const activeTab: InventoryTab = inventoryTabs.some((tab) => tab.value === requestedTab) ? requestedTab as InventoryTab : "cards";
  const { snapshot } = source;
  const [cardQuery, setCardQuery] = useState(searchParams.get("card") ?? "");
  const [cardStatusFilter, setCardStatusFilter] = useState<"all" | "wishlist" | "owned">("all");
  const [rarityFilter, setRarityFilter] = useState("all");
  const [editionFilter, setEditionFilter] = useState("all");
  const [cardPage, setCardPage] = useState(1);
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const cardPageSize = 24;
  const inventoryCards = useMemo(() => {
    const printingsByTarget = new Map<string, CardPrinting[]>();
    const targetIdByPrintingId = new Map<string, string>();
    const copiesByTarget = new Map<string, CardCopy[]>();

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
      return {
        copies,
        hasKnownPurchaseValue: ownedCopies.some((copy) => copy.allocationPence !== null),
        libraryStatus: getLibraryCardStatus(target.desiredQuantity, ownedCopies.length),
        printings,
        purchaseValuePence: ownedCopies.reduce((sum, copy) => sum + (copy.allocationPence ?? 0), 0),
        target,
      };
    });
  }, [snapshot.copies, snapshot.printings, snapshot.targets]);
  const rarityOptions = Array.from(new Set(snapshot.targets.map((target) => target.rarity))).sort();
  const editionOptions = Array.from(new Set(snapshot.targets.map((target) => target.edition))).sort();
  const filteredTargets = inventoryCards.filter(({ libraryStatus, target }) => {
    const search = cardQuery.trim().toLocaleLowerCase("en-GB");
    return (
      (cardStatusFilter === "all" || libraryStatus.status === cardStatusFilter)
      && (rarityFilter === "all" || target.rarity === rarityFilter)
      && (editionFilter === "all" || target.edition === editionFilter)
      && (!search || [target.name, target.rarity, target.edition].join(" ").toLocaleLowerCase("en-GB").includes(search))
    );
  });
  const cardPageCount = Math.max(1, Math.ceil(filteredTargets.length / cardPageSize));
  const visibleTargets = filteredTargets.slice((cardPage - 1) * cardPageSize, cardPage * cardPageSize);

  function switchInventoryTab(event: MouseEvent<HTMLAnchorElement>, href: string) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    window.history.pushState(null, "", href);
  }

  return (
    <div className="grid gap-4">
      <nav aria-label="Inventory type" className="flex gap-2 overflow-x-auto pb-1">
        {inventoryTabs.map((tab) => (
          <Link
            aria-current={activeTab === tab.value ? "page" : undefined}
            className={`inline-flex min-h-11 shrink-0 items-center rounded-md border px-4 text-sm font-bold transition ${activeTab === tab.value ? "border-[#8a1f2d] bg-[#8a1f2d] text-white" : "border-zinc-300 bg-white text-zinc-700 hover:border-zinc-950"}`}
            href={`/records/inventory?kind=${tab.value}`}
            key={tab.value}
            onClick={(event) => switchInventoryTab(event, `/records/inventory?kind=${tab.value}`)}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      {activeTab === "cards" ? (
        <div className="grid gap-3">
          <div className="flex flex-col gap-3 rounded-lg border border-zinc-300 bg-white p-3 shadow-sm">
            <div className="flex rounded-md border border-zinc-300 bg-zinc-100 p-1 sm:self-start">
              {(["all", "wishlist", "owned"] as const).map((status) => (
                <button className={`h-9 rounded px-3 text-sm font-semibold transition ${cardStatusFilter === status ? "bg-white text-zinc-950 shadow-sm" : "text-zinc-600 hover:text-zinc-950"}`} key={status} onClick={() => { setCardStatusFilter(status); setCardPage(1); }} type="button">{status === "all" ? "All" : status === "wishlist" ? "Wishlist" : "Owned"}</button>
              ))}
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <label className="relative w-full sm:max-w-md">
              <span className="sr-only">Search card inventory</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
              <input className="h-11 w-full rounded-md border border-zinc-300 bg-zinc-50 pl-9 pr-3 text-sm outline-none focus:border-[#8a1f2d] focus:bg-white" onChange={(event) => { setCardQuery(event.target.value); setCardPage(1); }} placeholder="Search cards, rarity, or edition" value={cardQuery} />
            </label>
            <div className="flex flex-wrap gap-2">
              <select aria-label="Filter inventory by rarity" className="h-11 min-w-40 rounded-md border border-zinc-300 bg-zinc-50 px-3 text-sm font-semibold text-zinc-700 outline-none focus:border-[#8a1f2d]" onChange={(event) => { setRarityFilter(event.target.value); setCardPage(1); }} value={rarityFilter}><option value="all">All rarities</option>{rarityOptions.map((rarity) => <option key={rarity} value={rarity}>{rarity}</option>)}</select>
              <select aria-label="Filter inventory by edition" className="h-11 min-w-40 rounded-md border border-zinc-300 bg-zinc-50 px-3 text-sm font-semibold text-zinc-700 outline-none focus:border-[#8a1f2d]" onChange={(event) => { setEditionFilter(event.target.value); setCardPage(1); }} value={editionFilter}><option value="all">All editions</option>{editionOptions.map((edition) => <option key={edition} value={edition}>{edition}</option>)}</select>
              <p className="flex min-h-11 items-center text-sm font-bold text-zinc-500">{filteredTargets.length} card target{filteredTargets.length === 1 ? "" : "s"}</p>
            </div>
            </div>
          </div>
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visibleTargets.map(({ copies, hasKnownPurchaseValue, libraryStatus, printings, purchaseValuePence, target }) => {
            return (
              <button aria-label={`${copies.length ? "View copies and source" : "View Wishlist Target"} for ${target.name}`} className="group flex min-w-0 gap-3 rounded-lg border border-zinc-300 bg-white p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-[#8a1f2d] hover:shadow-md active:translate-y-0 focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-offset-2 motion-reduce:transform-none motion-reduce:transition-none" key={target.id} onClick={() => setSelectedTargetId(target.id)} type="button">
                <span className="grid h-24 w-16 shrink-0 place-items-center overflow-hidden rounded-md border border-zinc-200 bg-zinc-100">
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
                    <span className="line-clamp-2 font-bold leading-5">{target.name}</span>
                    <span className={`shrink-0 rounded-md px-2 py-1 text-[11px] font-bold ${libraryStatus.status === "wishlist" ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>{libraryStatus.status === "wishlist" ? "Wishlist" : "Owned"}</span>
                  </span>
                  <span className="mt-1 block text-xs font-semibold text-zinc-500">Wanted {libraryStatus.wantedQuantity} · Owned {libraryStatus.ownedQuantity}{libraryStatus.wishlistRemainingQuantity ? ` · ${libraryStatus.wishlistRemainingQuantity} still wanted` : ""} · {copies.filter((copy) => copy.status === "sold").length} sold</span>
                  {libraryStatus.ownedQuantity ? <span className="mt-1 block text-xs font-bold text-emerald-700">Purchase value {hasKnownPurchaseValue ? formatCurrency(purchaseValuePence) : "unknown"}</span> : null}
                  <span className="mt-2 flex flex-wrap gap-1">
                    {printings.map((printing) => <span className="rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[11px] font-bold text-zinc-600" key={printing.id}>{printing.setCode}</span>)}
                  </span>
                  <span className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-[#8a1f2d]">{copies.length ? "View copies and sources" : "View Wishlist Target"} <ChevronRight className="size-3.5 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" /></span>
                </span>
              </button>
            );
          })}
          {visibleTargets.length === 0 ? <div className="col-span-full grid min-h-48 place-items-center rounded-lg border border-dashed border-zinc-300 bg-white text-center"><div><Search className="mx-auto size-6 text-zinc-400" /><p className="mt-2 font-bold">No matching cards</p></div></div> : null}
          </section>
          {cardPageCount > 1 ? <nav aria-label="Card inventory pages" className="flex items-center justify-between rounded-lg border border-zinc-300 bg-white p-3 text-sm font-bold text-zinc-600"><button aria-label="Previous card inventory page" className="grid size-11 place-items-center rounded-md border border-zinc-300 disabled:opacity-40" disabled={cardPage === 1} onClick={() => setCardPage((current) => Math.max(1, current - 1))} type="button"><ChevronLeft className="size-4" /></button><span>Page {cardPage} of {cardPageCount}</span><button aria-label="Next card inventory page" className="grid size-11 place-items-center rounded-md border border-zinc-300 disabled:opacity-40" disabled={cardPage === cardPageCount} onClick={() => setCardPage((current) => Math.min(cardPageCount, current + 1))} type="button"><ChevronRight className="size-4" /></button></nav> : null}
        </div>
      ) : null}

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
      {selectedTargetId ? <InventoryCardDialog key={selectedTargetId} onClose={() => setSelectedTargetId(null)} source={source} targetId={selectedTargetId} /> : null}
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
      ) : source.status === "error" ? (
        <div className="rounded-lg border border-rose-300 bg-rose-50 px-5 py-8 text-center text-rose-950" role="alert">
          <p className="font-black">Records could not be loaded</p>
          <p className="mx-auto mt-2 max-w-xl text-sm font-medium leading-6">{source.errorMessage || "Refresh the page and try again."}</p>
        </div>
      ) : view === "overview" ? <Overview /> : view === "history" ? <HistoryView /> : <InventoryView />}
    </>
  );
}

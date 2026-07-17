"use client";

import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Boxes,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  History,
  PackageCheck,
  PackageOpen,
  ReceiptText,
  RefreshCcw,
  RotateCcw,
  Search,
  ShoppingBag,
  Sparkles,
  Undo2,
  WalletCards,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState, type ReactNode } from "react";
import { AppHeader } from "@/components/app-header";
import { useRecordsDataSource } from "@/components/records/records-preview-provider";
import type {
  RecordEntry,
  RecordEntryType,
} from "@/lib/records/types";

export type RecordsView = "overview" | "history" | "inventory";

const recordTypeLabels: Record<RecordEntryType, string> = {
  purchase: "Purchase",
  "pack-opening": "Pack opening",
  sale: "Sale",
  adjustment: "Adjustment",
  "imported-acquisition": "Imported acquisition",
  "bulk-itemization": "Bulk itemization",
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

function PreviewBanner() {
  const source = useRecordsDataSource();

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
            source.resetPreview();
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

function RecordsNavigation({ view }: { view: RecordsView }) {
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
  return (
    <span className="inline-flex rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-[11px] font-bold uppercase tracking-[0.1em] text-zinc-600">
      {recordTypeLabels[type]}
    </span>
  );
}

function RecordRow({
  actions,
  record,
}: {
  actions?: ReactNode;
  record: RecordEntry;
}) {
  return (
    <article className={`p-4 ${record.status === "void" ? "bg-zinc-50 opacity-70" : "bg-white"}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
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
        <div className="flex shrink-0 items-center justify-between gap-3 sm:flex-col sm:items-end">
          <p
            className={`font-black tabular-nums ${
              record.type === "sale"
                ? "text-emerald-700"
                : record.amountKnown === false
                  ? "text-amber-700"
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

function QuickTask({
  detail,
  href,
  icon,
  title,
}: {
  detail: string;
  href: string;
  icon: ReactNode;
  title: string;
}) {
  return (
    <Link
      className="group flex min-h-20 items-center gap-3 rounded-lg border border-zinc-300 bg-white p-3 shadow-sm transition hover:border-[#8a1f2d] hover:bg-rose-50/40"
      href={href}
    >
      <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-rose-50 text-[#8a1f2d]">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-bold text-zinc-950">{title}</span>
        <span className="mt-0.5 block text-sm font-medium text-zinc-500">{detail}</span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-zinc-400 transition group-hover:translate-x-0.5 group-hover:text-[#8a1f2d]" />
    </Link>
  );
}

function Overview() {
  const { snapshot } = useRecordsDataSource();
  const activeRecords = snapshot.records.filter((record) => record.status === "active");
  const cost = activeRecords
    .filter((record) => (record.type === "purchase" || record.type === "imported-acquisition") && record.amountKnown !== false)
    .reduce((sum, record) => sum + record.amountPence, 0);
  const proceeds = activeRecords
    .filter((record) => record.type === "sale")
    .reduce((sum, record) => sum + record.amountPence, 0);
  const availableCopies = snapshot.copies.filter((copy) => copy.status === "available").length;
  const openTargetCount = snapshot.targets.filter((target) => {
    const printingIds = snapshot.printings.filter((printing) => printing.targetId === target.id).map((printing) => printing.id);
    const owned = snapshot.copies.filter((copy) => printingIds.includes(copy.printingId) && copy.status === "available").length;
    return owned < target.desiredQuantity;
  }).length;

  return (
    <div className="grid gap-5">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard detail="All-in acquisition amounts" icon={<ArrowDownLeft className="size-5" />} label="Actual cost" tone="negative" value={formatCurrency(cost)} />
        <MetricCard detail="Net after fees and postage" icon={<ArrowUpRight className="size-5" />} label="Net proceeds" tone="positive" value={formatCurrency(proceeds)} />
        <MetricCard detail="Proceeds minus actual cost" icon={<CircleDollarSign className="size-5" />} label="Cash position" tone={proceeds - cost >= 0 ? "positive" : "negative"} value={formatCurrency(proceeds - cost)} />
        <MetricCard detail={`${openTargetCount} wishlist target${openTargetCount === 1 ? "" : "s"} still open`} icon={<WalletCards className="size-5" />} label="Physical copies" value={String(availableCopies)} />
      </section>

      <section>
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">Add to your records</h2>
            <p className="mt-1 text-sm font-medium text-zinc-500">Choose the event that actually happened.</p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <QuickTask detail="Singles, sealed, bulk, and supplies together" href="/records/new/purchase" icon={<ShoppingBag className="size-5" />} title="Record purchase" />
          <QuickTask detail="Open sealed product and list your pulls" href="/records/new/opening" icon={<PackageOpen className="size-5" />} title="Record pack opening" />
          <QuickTask detail="Choose exact copies and enter net proceeds" href="/records/new/sale" icon={<ReceiptText className="size-5" />} title="Record sale" />
        </div>
      </section>

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
            {snapshot.records.slice(0, 5).map((record) => <RecordRow key={record.id} record={record} />)}
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
              <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2" key={item.id}>
                <p className="text-sm font-bold text-zinc-800">{item.label}</p>
                <p className="mt-0.5 text-xs font-medium leading-5 text-zinc-500">{item.detail}</p>
              </div>
            )) : (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-4 text-sm font-bold text-emerald-800">
                <CheckCircle2 className="mr-2 inline size-4" /> Sample data is complete.
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function HistoryView() {
  const source = useRecordsDataSource();
  const [query, setQuery] = useState("");
  const [type, setType] = useState<"all" | RecordEntryType>("all");
  const [includeVoid, setIncludeVoid] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const records = source.snapshot.records.filter((record) => {
    if (type !== "all" && record.type !== type) return false;
    if (!includeVoid && record.status === "void") return false;
    const search = query.trim().toLowerCase();
    return !search || [record.title, record.source, record.notes, ...record.lines.map((line) => line.name)].join(" ").toLowerCase().includes(search);
  });

  return (
    <section className="overflow-hidden rounded-lg border border-zinc-300 bg-white shadow-sm">
      <div className="grid gap-3 border-b border-zinc-200 bg-white p-3 md:grid-cols-[minmax(0,1fr)_220px_auto] md:items-center">
        <label className="relative">
          <span className="sr-only">Search record history</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
          <input className="h-11 w-full rounded-md border border-zinc-300 bg-zinc-50 pl-9 pr-3 text-sm outline-none focus:border-[#8a1f2d] focus:bg-white" onChange={(event) => setQuery(event.target.value)} placeholder="Search entries, items, or source" value={query} />
        </label>
        <label>
          <span className="sr-only">Record type</span>
          <select className="h-11 w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 text-sm font-semibold outline-none focus:border-[#8a1f2d]" onChange={(event) => setType(event.target.value as "all" | RecordEntryType)} value={type}>
            <option value="all">All record types</option>
            {Object.entries(recordTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="inline-flex min-h-11 items-center gap-2 rounded-md border border-zinc-300 px-3 text-sm font-bold text-zinc-700">
          <input checked={includeVoid} className="size-4 accent-[#8a1f2d]" onChange={(event) => setIncludeVoid(event.target.checked)} type="checkbox" />
          Show void
        </label>
      </div>
      {message ? <p className="border-b border-zinc-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900" role="status">{message}</p> : null}
      <div className="divide-y divide-zinc-200">
        {records.length ? records.map((record) => (
          <RecordRow
            actions={
              <button
                className="inline-flex min-h-10 items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-xs font-bold text-zinc-700 transition hover:border-[#8a1f2d] hover:text-[#8a1f2d]"
                onClick={() => {
                  const result = record.status === "void" ? source.restoreRecord(record.id) : source.voidRecord(record.id);
                  setMessage(result.ok ? `${record.status === "void" ? "Restored" : "Voided"} “${record.title}”.` : result.message);
                }}
                type="button"
              >
                {record.status === "void" ? <RotateCcw className="size-3.5" /> : <Undo2 className="size-3.5" />}
                {record.status === "void" ? "Restore" : "Void"}
              </button>
            }
            key={record.id}
            record={record}
          />
        )) : (
          <div className="grid min-h-56 place-items-center px-4 text-center">
            <div><History className="mx-auto size-7 text-zinc-400" /><p className="mt-3 font-bold">No matching history</p><p className="mt-1 text-sm text-zinc-500">Try a different search or filter.</p></div>
          </div>
        )}
      </div>
    </section>
  );
}

function InventoryView() {
  const source = useRecordsDataSource();
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get("kind");
  const activeTab: InventoryTab = inventoryTabs.some((tab) => tab.value === requestedTab) ? requestedTab as InventoryTab : "cards";
  const { snapshot } = source;
  const [cardQuery, setCardQuery] = useState(searchParams.get("card") ?? "");
  const [cardPage, setCardPage] = useState(1);
  const cardPageSize = 24;
  const filteredTargets = snapshot.targets.filter((target) => {
    const search = cardQuery.trim().toLocaleLowerCase("en-GB");
    return !search || [target.name, target.rarity, target.edition].join(" ").toLocaleLowerCase("en-GB").includes(search);
  });
  const cardPageCount = Math.max(1, Math.ceil(filteredTargets.length / cardPageSize));
  const visibleTargets = filteredTargets.slice((cardPage - 1) * cardPageSize, cardPage * cardPageSize);

  return (
    <div className="grid gap-4">
      <nav aria-label="Inventory type" className="flex gap-2 overflow-x-auto pb-1">
        {inventoryTabs.map((tab) => (
          <Link
            aria-current={activeTab === tab.value ? "page" : undefined}
            className={`inline-flex min-h-11 shrink-0 items-center rounded-md border px-4 text-sm font-bold transition ${activeTab === tab.value ? "border-[#8a1f2d] bg-[#8a1f2d] text-white" : "border-zinc-300 bg-white text-zinc-700 hover:border-zinc-950"}`}
            href={`/records/inventory?kind=${tab.value}`}
            key={tab.value}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      {activeTab === "cards" ? (
        <div className="grid gap-3">
          <div className="flex flex-col gap-3 rounded-lg border border-zinc-300 bg-white p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
            <label className="relative w-full sm:max-w-md">
              <span className="sr-only">Search card inventory</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
              <input className="h-11 w-full rounded-md border border-zinc-300 bg-zinc-50 pl-9 pr-3 text-sm outline-none focus:border-[#8a1f2d] focus:bg-white" onChange={(event) => { setCardQuery(event.target.value); setCardPage(1); }} placeholder="Search cards, rarity, or edition" value={cardQuery} />
            </label>
            <p className="text-sm font-bold text-zinc-500">{filteredTargets.length} card target{filteredTargets.length === 1 ? "" : "s"}</p>
          </div>
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visibleTargets.map((target) => {
            const printings = snapshot.printings.filter((printing) => printing.targetId === target.id);
            const printingIds = printings.map((printing) => printing.id);
            const copies = snapshot.copies.filter((copy) => printingIds.includes(copy.printingId));
            const available = copies.filter((copy) => copy.status === "available").length;
            const open = Math.max(0, target.desiredQuantity - available);
            return (
              <article className="flex min-w-0 gap-3 rounded-lg border border-zinc-300 bg-white p-3 shadow-sm" key={target.id}>
                <div className="grid h-24 w-16 shrink-0 place-items-center overflow-hidden rounded-md border border-zinc-200 bg-zinc-100">
                  {target.imageUrl ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img alt="" className="h-full w-full object-cover" src={target.imageUrl} />
                    </>
                  ) : (
                    <WalletCards className="size-5 text-zinc-400" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="line-clamp-2 font-bold leading-5">{target.name}</h3>
                    <span className={`shrink-0 rounded-md px-2 py-1 text-[11px] font-bold ${open ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>{open ? `${open} open` : "Satisfied"}</span>
                  </div>
                  <p className="mt-1 text-xs font-semibold text-zinc-500">Want {target.desiredQuantity} · Own {available} · {copies.filter((copy) => copy.status === "sold").length} sold</p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {printings.map((printing) => <span className="rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[11px] font-bold text-zinc-600" key={printing.id}>{printing.setCode}</span>)}
                  </div>
                </div>
              </article>
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
              <div className="flex items-start justify-between gap-3"><PackageCheck className="size-6 text-[#8a1f2d]" /><span className="rounded-md bg-zinc-100 px-2 py-1 text-xs font-bold capitalize text-zinc-600">{item.status}</span></div>
              <h3 className="mt-4 font-bold">{item.name}</h3><p className="mt-1 text-sm font-medium text-zinc-500">{item.edition ? `${item.edition} · ` : ""}Quantity {item.quantity}</p>
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
              <h3 className="mt-4 font-bold">{lot.name}</h3><p className="mt-1 text-sm font-medium text-zinc-500">{lot.itemizedQuantity} itemized{lot.estimatedQuantity ? ` of about ${lot.estimatedQuantity}` : ""}</p>
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
    <main className="app-page-shell min-h-screen bg-[#f6f4ef] px-4 py-5 text-zinc-950 sm:px-6">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
        <AppHeader eyebrow="Private collection records" title="Records" />
        <PreviewBanner />
        <RecordsNavigation view={view} />
        {source.status === "loading" ? (
          <div className="grid min-h-72 place-items-center rounded-lg border border-zinc-300 bg-white" role="status">
            <div className="text-center"><Clock3 className="mx-auto size-7 animate-pulse text-[#8a1f2d]" /><p className="mt-3 font-bold">Preparing your preview</p></div>
          </div>
        ) : view === "overview" ? <Overview /> : view === "history" ? <HistoryView /> : <InventoryView />}
      </div>
    </main>
  );
}

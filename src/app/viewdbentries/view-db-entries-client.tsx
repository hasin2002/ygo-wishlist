"use client";

import {
  ArrowLeft,
  CheckCircle2,
  CircleAlert,
  CircleDollarSign,
  ExternalLink,
  Filter,
  RefreshCcw,
  Search,
  SlidersHorizontal,
  WalletCards,
  X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useMemo, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { AppHeader } from "@/components/app-header";
import { DataLoadError } from "@/components/data-load-error";
import { usePricingRefresh } from "@/components/pricing-refresh-provider";
import { useViewportOverlay } from "@/components/use-viewport-overlay";
import { linkedListingHref } from "@/lib/records/inventory-route-state";
import {
  isCardCondition,
  type CardCondition,
  type CopyEbayExposureState,
  type EbayOfferExposure,
  type RecordsSnapshot,
} from "@/lib/records/types";
import { trpc } from "@/trpc/client";

type CardEntry = {
  activeOffers: EbayOfferExposure[];
  associatedOffers: EbayOfferExposure[];
  condition: CardCondition;
  copyIds: string[];
  ebaySearchUrl: string | null;
  edition: string;
  estimatedPricePence: number | null;
  imageUrl: string | null;
  hasListingAttention: boolean;
  hasPaymentPending: boolean;
  listingOpportunity: boolean;
  listableCopyCount: number;
  name: string;
  printingId: string;
  quantity: number;
  rarity: string;
  sampleSize: number;
  selectedTargetId: string | null;
  setCode: string;
  setName: string;
  tcgplayerUrl: string | null;
  usedConditionFallback: boolean;
};

type TargetFilter = "all" | "with-target" | "without-target";
type ListingFilter = "all" | "active" | "no-active" | "associated" | "unassociated" | "opportunity";
type RecordCardFilterOptions = {
  conditions: string[];
  editions: string[];
  rarities: string[];
  setCodes: string[];
  setNames: string[];
};

const listingOpportunityMinimumPence = 500;
const currentListingStates = new Set<CopyEbayExposureState["aggregateState"]>([
  "live",
  "reserved_by_order",
  "payment_pending",
  "ending_automatically",
  "needs_takedown",
  "needs_attention",
]);

const fieldClass = "h-11 w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 text-sm font-semibold text-zinc-800 outline-none transition focus:border-[#8a1f2d] focus:bg-white focus:ring-2 focus:ring-[#8a1f2d]/10";

function formatPrice(value: number | null) {
  return value === null
    ? "Not estimated"
    : new Intl.NumberFormat("en-GB", { currency: "GBP", style: "currency" }).format(value / 100);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00`));
}

function setCodePrefix(setCode: string) {
  return setCode.split("-", 1)[0]?.trim() || setCode;
}

function uniqueOffers(offers: EbayOfferExposure[]) {
  return [...new Map(offers.map((offer) => [offer.listingId, offer])).values()];
}

function entriesForRecord(recordId: string, snapshot: RecordsSnapshot): CardEntry[] {
  const record = snapshot.records.find((item) => item.id === recordId);
  if (!record) return [];
  const copyById = new Map(snapshot.copies.map((copy) => [copy.id, copy]));
  const printingById = new Map(snapshot.printings.map((printing) => [printing.id, printing]));
  const targetById = new Map(snapshot.targets.map((target) => [target.id, target]));
  const exposureByCopyId = new Map(snapshot.copyEbayExposures.map((exposure) => [exposure.copyId, exposure]));
  const pricingByVariant = new Map((snapshot.pricingEstimates ?? []).map((pricing) => (
    [`${pricing.printingId}::${pricing.condition}`, pricing]
  )));
  const grouped = new Map<string, CardEntry>();

  for (const copyId of record.lines.filter((line) => line.kind === "card").flatMap((line) => line.entityIds)) {
    const copy = copyById.get(copyId);
    if (!copy || !isCardCondition(copy.condition)) continue;
    const printing = printingById.get(copy.printingId);
    const target = printing ? targetById.get(printing.targetId) : null;
    if (!printing || !target) continue;
    const key = `${printing.id}::${copy.condition}`;
    const current = grouped.get(key);
    if (current) {
      if (!current.copyIds.includes(copy.id)) {
        current.copyIds.push(copy.id);
        current.quantity += 1;
      }
      continue;
    }
    const pricing = pricingByVariant.get(key);
    grouped.set(key, {
      activeOffers: [],
      associatedOffers: [],
      condition: copy.condition,
      copyIds: [copy.id],
      ebaySearchUrl: pricing?.ebaySearchUrl ?? null,
      edition: target.edition,
      estimatedPricePence: pricing?.estimatedPricePence ?? null,
      imageUrl: printing.imageUrl || target.imageUrl,
      hasListingAttention: false,
      hasPaymentPending: false,
      listingOpportunity: false,
      listableCopyCount: 0,
      name: target.name,
      printingId: printing.id,
      quantity: 1,
      rarity: target.rarity,
      sampleSize: pricing?.sampleSize ?? 0,
      selectedTargetId: target.id,
      setCode: printing.setCode,
      setName: printing.setName,
      tcgplayerUrl: printing.tcgplayerUrl || target.tcgplayerUrl,
      usedConditionFallback: pricing?.usedConditionFallback ?? false,
    });
  }

  return [...grouped.values()].map((entry) => {
    const exposures = entry.copyIds.flatMap((copyId) => {
      const exposure = exposureByCopyId.get(copyId);
      return exposure ? [exposure] : [];
    });
    const associatedOffers = uniqueOffers(exposures.flatMap((exposure) => exposure.offers));
    const activeOffers = associatedOffers.filter((offer) => offer.listingState === "active");
    const hasPaymentPending = exposures.some((exposure) => (
      exposure.aggregateState === "reserved_by_order"
      || exposure.aggregateState === "payment_pending"
      || exposure.aggregateState === "ending_automatically"
    ));
    const hasListingAttention = exposures.some((exposure) => (
      exposure.aggregateState === "needs_attention"
      || exposure.aggregateState === "needs_takedown"
    ));
    const listableCopyCount = entry.copyIds.filter((copyId) => {
      const copy = copyById.get(copyId);
      const exposure = exposureByCopyId.get(copyId);
      return copy?.status === "available" && (!exposure || exposure.action.disposition === "sell");
    }).length;
    const hasCurrentListing = exposures.some((exposure) => currentListingStates.has(exposure.aggregateState));
    return {
      ...entry,
      activeOffers,
      associatedOffers,
      hasListingAttention,
      hasPaymentPending,
      listingOpportunity: entry.estimatedPricePence !== null
        && entry.estimatedPricePence > listingOpportunityMinimumPence
        && listableCopyCount > 0
        && !hasCurrentListing,
      listableCopyCount,
    };
  }).sort((left, right) => (
    left.name.localeCompare(right.name) || left.setCode.localeCompare(right.setCode)
  ));
}

function FilterSelect({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  options: string[];
  value: string;
}) {
  return (
    <label className="grid gap-1.5 text-xs font-bold uppercase tracking-[0.08em] text-zinc-500">
      {label}
      <select className={fieldClass} onChange={(event) => onChange(event.target.value)} value={value}>
        <option value="">All</option>
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
}

function RecordCardFiltersModal({
  activeFilterCount,
  conditionFilter,
  editionFilter,
  listingFilter,
  listingOpportunityCount,
  maxPrice,
  minPrice,
  onClear,
  onClose,
  options,
  rarityFilter,
  setCodeFilter,
  setConditionFilter,
  setEditionFilter,
  setListingFilter,
  setMaxPrice,
  setMinPrice,
  setNameFilter,
  setRarityFilter,
  setSetCodeFilter,
  setSetNameFilter,
  setTargetFilter,
  targetFilter,
  triggerRef,
}: {
  activeFilterCount: number;
  conditionFilter: string;
  editionFilter: string;
  listingFilter: ListingFilter;
  listingOpportunityCount: number;
  maxPrice: string;
  minPrice: string;
  onClear: () => void;
  onClose: () => void;
  options: RecordCardFilterOptions;
  rarityFilter: string;
  setCodeFilter: string;
  setConditionFilter: (value: string) => void;
  setEditionFilter: (value: string) => void;
  setListingFilter: (value: ListingFilter) => void;
  setMaxPrice: (value: string) => void;
  setMinPrice: (value: string) => void;
  setNameFilter: string;
  setRarityFilter: (value: string) => void;
  setSetCodeFilter: (value: string) => void;
  setSetNameFilter: (value: string) => void;
  setTargetFilter: (value: TargetFilter) => void;
  targetFilter: TargetFilter;
  triggerRef: RefObject<HTMLButtonElement | null>;
}) {
  const dialogRef = useViewportOverlay<HTMLElement>({
    isOpen: true,
    onClose,
    triggerRef,
  });

  if (typeof document === "undefined") return null;

  return createPortal(
    <div aria-describedby="record-card-filters-description" aria-labelledby="record-card-filters-title" aria-modal="true" className="fixed inset-0 z-[70] grid place-items-end bg-zinc-950/45 p-3 backdrop-blur-sm sm:place-items-center sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }} role="dialog">
      <section className="flex max-h-[88dvh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-zinc-300 bg-white shadow-xl" ref={dialogRef} tabIndex={-1}>
        <header className="flex items-start justify-between gap-4 border-b border-zinc-200 p-4 sm:p-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#8a1f2d]">Filters</p>
            <h2 className="mt-1 text-xl font-black text-zinc-950" id="record-card-filters-title">Refine Record cards</h2>
            <p className="mt-1 text-sm font-medium text-zinc-500" id="record-card-filters-description">{activeFilterCount ? `${activeFilterCount} active` : "No filters active"} · changes apply immediately</p>
          </div>
          <button aria-label="Close filters" className="grid size-11 shrink-0 place-items-center rounded-md border border-zinc-300 text-zinc-600 transition hover:border-zinc-950 hover:text-zinc-950 focus-visible:ring-2 focus-visible:ring-[#8a1f2d]" onClick={onClose} type="button"><X aria-hidden className="size-4" /></button>
        </header>

        <div className="grid gap-4 overflow-y-auto bg-zinc-50/60 p-4 sm:grid-cols-2 sm:p-5">
          <button
            aria-pressed={listingFilter === "opportunity"}
            className={`flex min-h-20 items-center gap-3 rounded-lg border p-3 text-left transition focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-offset-2 sm:col-span-2 ${listingFilter === "opportunity" ? "border-[#8a1f2d] bg-rose-50 text-[#8a1f2d]" : "border-zinc-300 bg-white text-zinc-800 hover:border-[#8a1f2d]/60 hover:bg-rose-50/50"}`}
            onClick={() => setListingFilter(listingFilter === "opportunity" ? "all" : "opportunity")}
            type="button"
          >
            <span className={`grid size-11 shrink-0 place-items-center rounded-md ${listingFilter === "opportunity" ? "bg-[#8a1f2d] text-white" : "bg-rose-50 text-[#8a1f2d]"}`}><CircleDollarSign aria-hidden className="size-5" /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-black">Suggested to list</span>
              <span className="mt-0.5 block text-xs font-semibold leading-5 text-zinc-600">Show listable cards valued over £5 without a current listing.</span>
            </span>
            <span className="grid min-w-9 place-items-center rounded-full bg-zinc-950 px-2 py-1 text-xs font-black tabular-nums text-white" aria-label={`${listingOpportunityCount} suggested to list`}>{listingOpportunityCount}</span>
          </button>
          <FilterSelect label="Set name" onChange={setSetNameFilter} options={options.setNames} value={setNameFilter} />
          <FilterSelect label="Set code" onChange={setSetCodeFilter} options={options.setCodes} value={setCodeFilter} />
          <FilterSelect label="Rarity" onChange={setRarityFilter} options={options.rarities} value={rarityFilter} />
          <FilterSelect label="Edition" onChange={setEditionFilter} options={options.editions} value={editionFilter} />
          <FilterSelect label="Condition" onChange={setConditionFilter} options={options.conditions} value={conditionFilter} />
          <label className="grid gap-1.5 text-xs font-bold uppercase tracking-[0.08em] text-zinc-500">Selected target<select className={fieldClass} onChange={(event) => setTargetFilter(event.target.value as TargetFilter)} value={targetFilter}><option value="all">All</option><option value="with-target">With target</option><option value="without-target">Without target</option></select></label>
          <label className="grid gap-1.5 text-xs font-bold uppercase tracking-[0.08em] text-zinc-500 sm:col-span-2">Listing status<select className={fieldClass} onChange={(event) => setListingFilter(event.target.value as ListingFilter)} value={listingFilter}><option value="all">All</option><option value="active">Active listing</option><option value="no-active">No active listing</option><option value="associated">Has associated listing</option><option value="unassociated">Never listed</option><option value="opportunity">Suggested to list (&gt;£5)</option></select></label>
          <label className="grid gap-1.5 text-xs font-bold uppercase tracking-[0.08em] text-zinc-500">Min price (£)<input className={fieldClass} inputMode="decimal" min="0" onChange={(event) => setMinPrice(event.target.value)} placeholder="0.00" step="0.01" type="number" value={minPrice} /></label>
          <label className="grid gap-1.5 text-xs font-bold uppercase tracking-[0.08em] text-zinc-500">Max price (£)<input className={fieldClass} inputMode="decimal" min="0" onChange={(event) => setMaxPrice(event.target.value)} placeholder="20.00" step="0.01" type="number" value={maxPrice} /></label>
        </div>

        <footer className="flex flex-col-reverse gap-2 border-t border-zinc-200 bg-white p-4 sm:flex-row sm:justify-end sm:p-5">
          <button className="min-h-11 rounded-md border border-zinc-300 px-4 text-sm font-bold text-zinc-700 transition hover:border-zinc-950 hover:text-zinc-950 disabled:cursor-not-allowed disabled:opacity-40" disabled={!activeFilterCount} onClick={onClear} type="button">Clear filters</button>
          <button className="min-h-11 rounded-md bg-zinc-950 px-5 text-sm font-bold text-white transition hover:bg-zinc-800 focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2" onClick={onClose} type="button">Done</button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

function CopyReferences({ copyIds }: { copyIds: string[] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Exact physical Copies">
      {copyIds.map((copyId) => (
        <span className="rounded bg-zinc-100 px-1.5 py-1 font-mono text-[10px] font-semibold text-zinc-600" key={copyId} title={copyId}>
          {copyId.slice(-8)}
        </span>
      ))}
    </div>
  );
}

function CardLinks({ entry }: { entry: CardEntry }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {entry.tcgplayerUrl ? (
        <a className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-2.5 text-xs font-bold text-zinc-700 transition hover:border-[#8a1f2d] hover:bg-rose-50 hover:text-[#8a1f2d] focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-offset-2" href={entry.tcgplayerUrl} rel="noreferrer" target="_blank">
          TCGplayer <ExternalLink aria-hidden className="size-3.5" />
        </a>
      ) : null}
      {entry.ebaySearchUrl ? (
        <a aria-label={`Search eBay for ${entry.name} (opens in a new tab)`} className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-2.5 text-xs font-bold text-zinc-700 transition hover:border-[#8a1f2d] hover:bg-rose-50 hover:text-[#8a1f2d] focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-offset-2" href={entry.ebaySearchUrl} rel="noreferrer" target="_blank">
          eBay <ExternalLink aria-hidden className="size-3.5" />
        </a>
      ) : null}
    </div>
  );
}

export function ViewDbEntriesClient({ recordId }: { recordId: string | null }) {
  const [search, setSearch] = useState("");
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  const [setNameFilter, setSetNameFilter] = useState("");
  const [setCodeFilter, setSetCodeFilter] = useState("");
  const [rarityFilter, setRarityFilter] = useState("");
  const [editionFilter, setEditionFilter] = useState("");
  const [conditionFilter, setConditionFilter] = useState("");
  const [targetFilter, setTargetFilter] = useState<TargetFilter>("all");
  const [listingFilter, setListingFilter] = useState<ListingFilter>("all");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const filterButtonRef = useRef<HTMLButtonElement>(null);
  const { activeRun, startRecordRefresh } = usePricingRefresh();
  const query = trpc.records.history.useQuery({
    includeVoid: true,
    page: 1,
    query: "",
    recordId,
    type: "all",
  }, { enabled: Boolean(recordId) });
  const snapshot = query.data?.snapshot;
  const record = snapshot?.records.find((item) => item.id === recordId) ?? null;
  const entries = useMemo(
    () => recordId && snapshot ? entriesForRecord(recordId, snapshot) : [],
    [recordId, snapshot],
  );
  const recordPricingRunning = Boolean(
    activeRun?.running
    && activeRun.source.kind === "record"
    && activeRun.source.recordId === recordId,
  );

  const options = useMemo(() => ({
    conditions: [...new Set(entries.map((entry) => entry.condition))].sort(),
    editions: [...new Set(entries.map((entry) => entry.edition))].sort(),
    rarities: [...new Set(entries.map((entry) => entry.rarity))].sort(),
    setCodes: [...new Set(entries.map((entry) => setCodePrefix(entry.setCode)))].sort(),
    setNames: [...new Set(entries.map((entry) => entry.setName))].sort(),
  }), [entries]);

  const filteredEntries = useMemo(() => {
    const normalizedQuery = search.trim().toLocaleLowerCase("en-GB");
    const minimum = minPrice.trim() ? Number.parseFloat(minPrice) * 100 : null;
    const maximum = maxPrice.trim() ? Number.parseFloat(maxPrice) * 100 : null;
    return entries.filter((entry) => {
      if (normalizedQuery && ![
        entry.name,
        entry.setName,
        entry.setCode,
        entry.rarity,
        entry.edition,
        entry.condition,
        entry.printingId,
        ...entry.associatedOffers.flatMap((offer) => [offer.title, offer.itemId]),
        ...entry.copyIds,
      ].join(" ").toLocaleLowerCase("en-GB").includes(normalizedQuery)) return false;
      if (setNameFilter && entry.setName !== setNameFilter) return false;
      if (setCodeFilter && setCodePrefix(entry.setCode) !== setCodeFilter) return false;
      if (rarityFilter && entry.rarity !== rarityFilter) return false;
      if (editionFilter && entry.edition !== editionFilter) return false;
      if (conditionFilter && entry.condition !== conditionFilter) return false;
      if (targetFilter === "with-target" && !entry.selectedTargetId) return false;
      if (targetFilter === "without-target" && entry.selectedTargetId) return false;
      if (listingFilter === "active" && !entry.activeOffers.length) return false;
      if (listingFilter === "no-active" && entry.activeOffers.length) return false;
      if (listingFilter === "associated" && !entry.associatedOffers.length) return false;
      if (listingFilter === "unassociated" && entry.associatedOffers.length) return false;
      if (listingFilter === "opportunity" && !entry.listingOpportunity) return false;
      if (minimum !== null && (!Number.isFinite(minimum) || entry.estimatedPricePence === null || entry.estimatedPricePence < minimum)) return false;
      if (maximum !== null && (!Number.isFinite(maximum) || entry.estimatedPricePence === null || entry.estimatedPricePence > maximum)) return false;
      return true;
    });
  }, [conditionFilter, editionFilter, entries, listingFilter, maxPrice, minPrice, rarityFilter, search, setCodeFilter, setNameFilter, targetFilter]);

  const activeFilters: { id: string; label: string; onRemove: () => void }[] = [];
  if (search) activeFilters.push({ id: "search", label: `Search: ${search}`, onRemove: () => setSearch("") });
  if (setNameFilter) activeFilters.push({ id: "set-name", label: `Set: ${setNameFilter}`, onRemove: () => setSetNameFilter("") });
  if (setCodeFilter) activeFilters.push({ id: "set-code", label: `Code: ${setCodeFilter}`, onRemove: () => setSetCodeFilter("") });
  if (rarityFilter) activeFilters.push({ id: "rarity", label: `Rarity: ${rarityFilter}`, onRemove: () => setRarityFilter("") });
  if (editionFilter) activeFilters.push({ id: "edition", label: `Edition: ${editionFilter}`, onRemove: () => setEditionFilter("") });
  if (conditionFilter) activeFilters.push({ id: "condition", label: `Condition: ${conditionFilter}`, onRemove: () => setConditionFilter("") });
  if (targetFilter !== "all") activeFilters.push({ id: "target", label: targetFilter === "with-target" ? "With target" : "Without target", onRemove: () => setTargetFilter("all") });
  if (listingFilter !== "all") activeFilters.push({
    id: "listing",
    label: ({
      active: "Active listing",
      "no-active": "No active listing",
      associated: "Associated listing",
      unassociated: "Never listed",
      opportunity: "Suggested to list (>£5)",
    } satisfies Record<Exclude<ListingFilter, "all">, string>)[listingFilter],
    onRemove: () => setListingFilter("all"),
  });
  if (minPrice) activeFilters.push({ id: "min-price", label: `Min £${minPrice}`, onRemove: () => setMinPrice("") });
  if (maxPrice) activeFilters.push({ id: "max-price", label: `Max £${maxPrice}`, onRemove: () => setMaxPrice("") });

  function clearFilters() {
    setSearch("");
    setSetNameFilter("");
    setSetCodeFilter("");
    setRarityFilter("");
    setEditionFilter("");
    setConditionFilter("");
    setTargetFilter("all");
    setListingFilter("all");
    setMinPrice("");
    setMaxPrice("");
  }

  if (!recordId) {
    return <ViewerMessage title="Choose a Record" message="Open a Purchase or Pack Opening from Records History to inspect its cards." />;
  }
  if (query.isPending) {
    return <main className="app-page-shell min-h-screen bg-[#f6f4ef] px-4 py-5 sm:px-6"><div className="mx-auto grid min-h-72 max-w-7xl place-items-center rounded-lg border border-zinc-300 bg-white font-bold" role="status">Loading Record cards…</div></main>;
  }
  if (query.isError) {
    return <main className="app-page-shell min-h-screen bg-[#f6f4ef] px-4 py-5 sm:px-6"><div className="mx-auto max-w-7xl"><DataLoadError message={query.error.message} onRetry={() => query.refetch()} title="Record cards could not be loaded" /></div></main>;
  }
  if (!record || (record.type !== "purchase" && record.type !== "pack-opening")) {
    return <ViewerMessage title="Record unavailable" message="This Record is missing or does not contain a Purchase or Pack Opening card view." />;
  }

  const totalCopies = entries.reduce((sum, entry) => sum + entry.quantity, 0);
  const knownValuePence = entries.reduce((sum, entry) => sum + (entry.estimatedPricePence ?? 0) * entry.quantity, 0);
  const knownCopies = entries.reduce((sum, entry) => sum + (entry.estimatedPricePence === null ? 0 : entry.quantity), 0);
  const listingOpportunityCount = entries.filter((entry) => entry.listingOpportunity).length;

  return (
    <main className="app-page-shell min-h-screen bg-[#f6f4ef] px-4 py-5 text-zinc-950 sm:px-6">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
        <AppHeader actions={<Link className="inline-flex min-h-11 items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-bold text-zinc-700 shadow-sm transition hover:border-[#8a1f2d] hover:text-[#8a1f2d] focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-offset-2" href="/records/history"><ArrowLeft aria-hidden className="size-4" /> History</Link>} title="Record cards" />

        <section className="rounded-lg border border-zinc-300 bg-white p-4 shadow-sm sm:p-5">
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-xs font-bold uppercase tracking-[0.1em] text-zinc-500">
                <span className="rounded-md bg-rose-50 px-2 py-1 text-[#8a1f2d]">{record.type === "purchase" ? "Purchase" : "Pack opening"}</span>
                <span>{formatDate(record.date)}</span>
                {record.status === "void" ? <span className="rounded-md bg-zinc-100 px-2 py-1">Voided</span> : null}
              </div>
              <h2 className="mt-3 text-xl font-black text-zinc-950 sm:text-2xl">{record.title}</h2>
              <div className="mt-1 flex items-center justify-between gap-3">
                <p className="min-w-0 text-sm font-medium text-zinc-500">{record.source} · {totalCopies} exact physical Cop{totalCopies === 1 ? "y" : "ies"}</p>
                {entries.length ? <button
                  aria-label={`Refresh UK eBay estimates for ${record.title}`}
                  className="grid size-9 shrink-0 place-items-center rounded-md text-zinc-400 transition hover:bg-zinc-100 hover:text-[#8a1f2d] focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-offset-2"
                  onClick={() => void startRecordRefresh({
                    candidates: entries.map(({ condition, printingId }) => ({ condition, printingId })),
                    recordId: record.id,
                  })}
                  title="Refresh estimates for this Record"
                  type="button"
                >
                  <RefreshCcw aria-hidden className={`size-3.5 ${recordPricingRunning ? "animate-spin motion-reduce:animate-none" : ""}`} />
                </button> : null}
              </div>
              {record.notes ? <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-600">{record.notes}</p> : null}
            </div>
            <div className="grid grid-cols-3 gap-2 sm:min-w-[390px]">
              <SummaryStat label="Copies" value={String(totalCopies)} />
              <SummaryStat label="Variants" value={String(entries.length)} />
              <SummaryStat label={knownCopies === totalCopies ? "Est. value" : `Est. ${knownCopies}/${totalCopies}`} value={formatPrice(knownValuePence)} />
            </div>
          </div>
        </section>

        <section aria-label="Card filters" className="rounded-lg border border-zinc-300 bg-white shadow-sm">
          <div className="grid gap-3 p-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
            <label className="grid gap-1.5 text-xs font-bold uppercase tracking-[0.08em] text-zinc-500">
              Search this Record
              <span className="relative block">
                <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
                <input className={`${fieldClass} pl-9`} onChange={(event) => setSearch(event.target.value)} placeholder="Card, set, Printing, or Copy reference" value={search} />
              </span>
            </label>
            <div className="flex w-full items-center gap-2 md:w-auto">
              <button aria-expanded={filterModalOpen} aria-haspopup="dialog" className={`inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-md border px-3 text-sm font-bold transition focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-offset-2 md:flex-none ${activeFilters.length ? "border-[#8a1f2d]/30 bg-rose-50 text-[#8a1f2d]" : "border-zinc-300 bg-white text-zinc-700 hover:border-[#8a1f2d] hover:text-[#8a1f2d]"}`} onClick={() => setFilterModalOpen(true)} ref={filterButtonRef} type="button"><SlidersHorizontal aria-hidden className="size-4" /> Filters{activeFilters.length ? <span className="rounded bg-[#8a1f2d] px-1.5 py-0.5 text-xs font-black text-white">{activeFilters.length}</span> : null}</button>
            </div>
          </div>
          {activeFilters.length ? (
            <div className="flex flex-wrap items-center gap-2 border-t border-zinc-200 px-3 py-2">
              <Filter aria-hidden className="size-4 shrink-0 text-zinc-400" />
              {activeFilters.map((filter) => (
                <button
                  aria-label={`Remove ${filter.label} filter`}
                  className="inline-flex min-h-11 max-w-full touch-manipulation items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-3 text-left text-xs font-bold text-[#8a1f2d] transition hover:border-[#8a1f2d]/40 hover:bg-rose-100 focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-offset-2"
                  key={filter.id}
                  onClick={filter.onRemove}
                  type="button"
                >
                  <span className="truncate">{filter.label}</span>
                  <X aria-hidden className="size-3.5 shrink-0" />
                </button>
              ))}
              <button className="ml-auto inline-flex min-h-11 touch-manipulation items-center justify-center rounded-md px-3 text-xs font-bold text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-950 focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2" onClick={clearFilters} type="button">Clear all</button>
            </div>
          ) : null}
        </section>

        <section className="overflow-hidden rounded-lg border border-zinc-300 bg-white shadow-sm" aria-labelledby="results-heading">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 px-4 py-3">
            <h2 className="font-black text-zinc-950" id="results-heading">Cards in this Record</h2>
            <p className="text-sm font-semibold text-zinc-500">{filteredEntries.length} of {entries.length} variant{entries.length === 1 ? "" : "s"}</p>
          </div>
          {!filteredEntries.length ? <div className="grid min-h-56 place-items-center px-4 text-center"><div><WalletCards aria-hidden className="mx-auto size-7 text-zinc-400" /><p className="mt-3 font-bold">No matching cards</p><p className="mt-1 text-sm text-zinc-500">Try clearing one or more filters.</p></div></div> : (
            <div className="divide-y divide-zinc-200">{filteredEntries.map((entry) => <EntryCard entry={entry} key={`${entry.printingId}:${entry.condition}`} />)}</div>
          )}
        </section>
        {filterModalOpen ? <RecordCardFiltersModal activeFilterCount={activeFilters.length} conditionFilter={conditionFilter} editionFilter={editionFilter} listingFilter={listingFilter} listingOpportunityCount={listingOpportunityCount} maxPrice={maxPrice} minPrice={minPrice} onClear={clearFilters} onClose={() => setFilterModalOpen(false)} options={options} rarityFilter={rarityFilter} setCodeFilter={setCodeFilter} setConditionFilter={setConditionFilter} setEditionFilter={setEditionFilter} setListingFilter={setListingFilter} setMaxPrice={setMaxPrice} setMinPrice={setMinPrice} setNameFilter={setNameFilter} setRarityFilter={setRarityFilter} setSetCodeFilter={setSetCodeFilter} setSetNameFilter={setSetNameFilter} setTargetFilter={setTargetFilter} targetFilter={targetFilter} triggerRef={filterButtonRef} /> : null}
      </div>
    </main>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3"><p className="text-[10px] font-bold uppercase tracking-[0.1em] text-zinc-500">{label}</p><p className="mt-1 font-black tabular-nums text-zinc-950">{value}</p></div>;
}

function CardIdentity({ entry }: { entry: CardEntry }) {
  return <div className="flex min-w-0 items-start gap-3">{entry.imageUrl ? <Image alt="" className="h-20 w-14 shrink-0 rounded-md border border-zinc-300 object-cover shadow-sm lg:h-[72px] lg:w-[50px]" height={80} loading="lazy" src={entry.imageUrl} unoptimized width={56} /> : <span className="grid h-20 w-14 shrink-0 place-items-center rounded-md border border-zinc-300 bg-zinc-100 lg:h-[72px] lg:w-[50px]"><WalletCards aria-hidden className="size-5 text-zinc-400" /></span>}<div className="min-w-0"><p className="font-bold leading-5 text-zinc-950">{entry.name}</p><p className="mt-0.5 text-xs font-semibold leading-5 text-zinc-500">{entry.rarity} · {entry.edition}</p><CopyReferences copyIds={entry.copyIds} /></div></div>;
}

function PricingValue({ entry }: { entry: CardEntry }) {
  return <div><p className="font-black tabular-nums text-zinc-950">{formatPrice(entry.estimatedPricePence)}</p>{entry.estimatedPricePence !== null ? <p className="mt-0.5 whitespace-nowrap text-xs font-semibold text-zinc-500">{entry.sampleSize} usable listing{entry.sampleSize === 1 ? "" : "s"}</p> : null}{entry.usedConditionFallback ? <p className="mt-1 inline-flex rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-bold leading-4 text-amber-800">Broader condition</p> : null}</div>;
}

function ListingSummary({ entry }: { entry: CardEntry }) {
  const latestAssociatedOffer = entry.associatedOffers.toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  return (
    <div className="grid min-w-0 justify-items-start gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {entry.hasListingAttention ? <span className="inline-flex min-h-7 items-center gap-1.5 rounded-full border border-rose-300 bg-rose-50 px-2.5 py-1 text-xs font-black text-rose-900"><CircleAlert aria-hidden className="size-3.5" />Needs attention</span>
          : entry.hasPaymentPending ? <span className="inline-flex min-h-7 items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-black text-amber-950"><CircleAlert aria-hidden className="size-3.5" />Payment in progress</span>
            : entry.activeOffers.length ? <span className="inline-flex min-h-7 items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-black text-emerald-900"><CheckCircle2 aria-hidden className="size-3.5" />{entry.activeOffers.length} active listing{entry.activeOffers.length === 1 ? "" : "s"}</span>
              : entry.listingOpportunity ? <Link aria-label={`Create listing for ${entry.name}`} className="inline-flex min-h-11 items-center gap-1.5 rounded-md bg-[#8a1f2d] px-3 text-xs font-black text-white shadow-sm transition hover:bg-[#711826] focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-offset-2" href={linkedListingHref(entry.selectedTargetId ?? undefined, entry.printingId, entry.condition)}><CircleDollarSign aria-hidden className="size-4" />Suggested to list · over £5</Link>
                : <span className="inline-flex min-h-7 items-center rounded-full border border-zinc-300 bg-zinc-100 px-2.5 py-1 text-xs font-black text-zinc-700">{entry.associatedOffers.length ? "No active listing" : "Never listed"}</span>}
      </div>
      {entry.activeOffers.length ? <div className="flex flex-wrap gap-1">{entry.activeOffers.slice(0, 2).map((offer, index) => <Link className="inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-xs font-bold text-[#8a1f2d] hover:bg-rose-50 focus-visible:ring-2 focus-visible:ring-[#8a1f2d]" href={`/records/listings/${encodeURIComponent(offer.listingId)}`} key={offer.listingId}>Listing {index + 1}<ExternalLink aria-hidden className="size-3.5" /></Link>)}</div> : null}
      {!entry.activeOffers.length && latestAssociatedOffer ? <Link className="inline-flex min-h-11 items-center rounded-md px-2 text-xs font-bold text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950 focus-visible:ring-2 focus-visible:ring-[#8a1f2d]" href={`/records/listings/${encodeURIComponent(latestAssociatedOffer.listingId)}`}>Listing history</Link> : null}
    </div>
  );
}

function EntryCard({ entry }: { entry: CardEntry }) {
  return (
    <article className="grid gap-4 p-4 transition hover:bg-zinc-50/60 sm:p-5 lg:min-h-40 lg:grid-cols-[minmax(240px,0.95fr)_minmax(430px,1.55fr)_minmax(220px,0.8fr)] lg:items-center">
      <CardIdentity entry={entry} />

      <dl className={`${entry.listingOpportunity ? "order-3" : "order-2"} grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border border-zinc-200 bg-zinc-50/80 p-3 text-sm sm:grid-cols-[minmax(0,1.6fr)_minmax(0,0.9fr)_60px_minmax(110px,1fr)] lg:order-none`}>
        <div className="col-span-2 min-w-0 sm:col-span-1">
          <dt className="text-[10px] font-bold uppercase tracking-[0.1em] text-zinc-500">Printing</dt>
          <dd className="mt-1 font-bold leading-5 text-zinc-800">{entry.setName}</dd>
          <dd className="mt-0.5 font-mono text-xs font-bold text-[#8a1f2d]">{entry.setCode}</dd>
        </div>
        <div>
          <dt className="text-[10px] font-bold uppercase tracking-[0.1em] text-zinc-500">Condition</dt>
          <dd className="mt-1 font-bold leading-5 text-zinc-800">{entry.condition}</dd>
        </div>
        <div>
          <dt className="text-[10px] font-bold uppercase tracking-[0.1em] text-zinc-500">Copies</dt>
          <dd className="mt-1 font-black tabular-nums text-zinc-950">{entry.quantity}</dd>
        </div>
        <div>
          <dt className="text-[10px] font-bold uppercase tracking-[0.1em] text-zinc-500">Estimate</dt>
          <dd className="mt-1"><PricingValue entry={entry} /></dd>
        </div>
      </dl>

      <div className={`${entry.listingOpportunity ? "order-2" : "order-3"} border-t border-zinc-200 pt-3 lg:order-none lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0`}>
        <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.1em] text-zinc-500">Listing and research</p>
        <ListingSummary entry={entry} />
        <div className="mt-2"><CardLinks entry={entry} /></div>
      </div>
    </article>
  );
}

function ViewerMessage({ message, title }: { message: string; title: string }) {
  return <main className="app-page-shell min-h-screen bg-[#f6f4ef] px-4 py-5 text-zinc-950 sm:px-6"><div className="mx-auto flex w-full max-w-7xl flex-col gap-5"><AppHeader title="Record cards" /><section className="grid min-h-72 place-items-center rounded-lg border border-zinc-300 bg-white px-4 text-center shadow-sm"><div><WalletCards aria-hidden className="mx-auto size-8 text-zinc-400" /><h2 className="mt-4 text-lg font-black">{title}</h2><p className="mt-2 max-w-md text-sm text-zinc-500">{message}</p><Link className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-md bg-[#8a1f2d] px-4 text-sm font-bold text-white transition hover:bg-[#711826] focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-offset-2" href="/records/history"><ArrowLeft aria-hidden className="size-4" /> Return to History</Link></div></section></div></main>;
}

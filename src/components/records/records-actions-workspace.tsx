"use client";

import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  ImageIcon,
  Lightbulb,
  Link2,
  RefreshCw,
  Search,
  Sparkles,
  Wrench,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useId, useRef, useState, type ReactNode } from "react";
import { CardImagePreviewDialog } from "@/components/records/card-image-preview-dialog";
import {
  deriveSnapshotRecordsActions,
  filterRecordsActions,
  type ActionArea,
  type ActionKind,
  type RecordsAction,
} from "@/lib/records/actions";
import { rarityAbbreviation } from "@/lib/rarity-abbreviations";
import type { RecordsSnapshot } from "@/lib/records/types";
import { useRecordsDataSource } from "@/components/records/records-preview-provider";
import { trpc } from "@/trpc/client";

type ActionView = "all" | "attention" | "suggestions" | "history";
const actionsPerPage = 8;

const areaLabels: Record<ActionArea, string> = {
  records: "Records",
  inventory: "Inventory",
  listings: "Listings",
  orders: "Orders",
  sales: "Sales",
  ebay: "eBay",
};

const destinationLabels: Record<ActionKind, string> = {
  metadata: "Review card details",
  unknown_cost: "Add purchase cost",
  copy_link_confirm: "Review listing",
  copy_link_review: "Review listing",
  listing_sync: "Review listing",
  order_conflict: "Review order listing",
  proceeds_review: "Review paid sale",
  ebay_authorization: "Open eBay settings",
  set_offer: "Review available Copies",
  relist: "Review relist option",
};

function actionDestination(action: RecordsAction) {
  if (action.references.listingId) return `/records/listings/${action.references.listingId}`;
  if (action.references.targetId) return `/records/inventory/cards/${action.references.targetId}`;
  if (action.references.recordId) return `/records/history?recordId=${encodeURIComponent(action.references.recordId)}`;
  return null;
}

function statusDate(action: RecordsAction) {
  if (action.status === "resolved") return action.resolvedAt;
  if (action.status === "dismissed") return action.dismissedAt;
  return null;
}

function actionError(error: unknown) {
  return error instanceof Error ? error.message : "The action could not be completed. Refresh and try again.";
}

function formatDate(value: Date | string | null | undefined) {
  if (!value) return null;
  return new Date(value).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function unique(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function actionContext(action: RecordsAction, snapshot: RecordsSnapshot) {
  const copies = (action.references.copyIds ?? []).flatMap((copyId) => {
    const copy = snapshot.copies.find((candidate) => candidate.id === copyId);
    return copy ? [copy] : [];
  });
  const printing = snapshot.printings.find((candidate) => (
    candidate.id === action.references.printingId || candidate.id === copies[0]?.printingId
  ));
  const target = snapshot.targets.find((candidate) => (
    candidate.id === action.references.targetId || candidate.id === printing?.targetId
  ));
  const record = snapshot.records.find((candidate) => candidate.id === action.references.recordId);
  const offer = snapshot.copyEbayExposures
    .flatMap((exposure) => exposure.offers)
    .find((candidate) => candidate.listingId === action.references.listingId);
  const subject = target?.name ?? offer?.title ?? record?.title ?? null;
  const facts: string[] = [];

  if (printing) facts.push([printing.setCode, printing.setName].filter(Boolean).join(" · "));
  if (target?.rarity) facts.push(target.rarity);
  if (copies.length) {
    facts.push(`${copies.length} physical Cop${copies.length === 1 ? "y" : "ies"}`);
    const conditions = unique(copies.map((copy) => copy.condition));
    if (conditions.length <= 2) facts.push(conditions.join(" / "));
    const locations = unique(copies.map((copy) => copy.location));
    if (locations.length === 1) facts.push(locations[0]!);
  }
  if (record) facts.push([record.date, record.source].filter(Boolean).join(" · "));
  if (offer?.itemId) facts.push(`eBay item ${offer.itemId}`);

  return {
    cardImageUrl: target?.imageUrl ?? printing?.imageUrl ?? null,
    facts: unique(facts),
    rarity: target?.rarity ?? null,
    rarityCode: rarityAbbreviation(target?.rarity),
    subject,
  };
}

function matchesHumanContext(action: RecordsAction, snapshot: RecordsSnapshot, search: string) {
  const query = search.trim().toLocaleLowerCase("en-GB");
  if (!query) return true;
  const context = actionContext(action, snapshot);
  return [
    action.title,
    action.detail,
    areaLabels[action.area],
    context.subject,
    ...context.facts,
    action.references.recordId,
    action.references.listingId,
    ...(action.references.copyIds ?? []),
    ...(action.references.orderLineIds ?? []),
  ].filter(Boolean).join(" ").toLocaleLowerCase("en-GB").includes(query);
}

function referenceRows(action: RecordsAction) {
  const changedAt = statusDate(action);
  return [
    action.references.copyIds?.length
      ? { label: "Exact Copy IDs", value: action.references.copyIds.join(", ") }
      : null,
    action.references.listingId
      ? { label: "Listing reference", value: action.references.listingId }
      : null,
    action.references.orderLineIds?.length
      ? { label: "Order line references", value: action.references.orderLineIds.join(", ") }
      : null,
    action.references.recordId
      ? { label: "Record reference", value: action.references.recordId }
      : null,
    changedAt
      ? { label: action.status === "resolved" ? "Resolved" : "Dismissed", value: formatDate(changedAt)! }
      : null,
  ].filter((row): row is { label: string; value: string } => Boolean(row));
}

const primaryButtonClass = "col-span-2 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-[#8a1f2d] px-4 text-sm font-bold text-white transition hover:bg-[#711826] focus:outline-none focus:ring-2 focus:ring-[#8a1f2d]/30 disabled:cursor-not-allowed disabled:opacity-50 sm:col-auto sm:w-auto";
const secondaryButtonClass = "inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-4 text-sm font-bold text-zinc-800 transition hover:border-zinc-500 hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-[#8a1f2d]/20 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto";

function ActionCard({ action, live, snapshot }: { action: RecordsAction; live: boolean; snapshot: RecordsSnapshot }) {
  const utils = trpc.useUtils();
  const [error, setError] = useState<string | null>(null);
  const refreshQueries = async () => {
    await Promise.all([
      utils.records.actions.invalidate(),
      utils.records.urgentActionCount.invalidate(),
      utils.records.snapshot.invalidate(),
    ]);
  };
  const dismiss = trpc.records.dismissSuggestion.useMutation({ onSuccess: refreshQueries });
  const refresh = trpc.ebay.refreshListingStatusById.useMutation({ onSuccess: refreshQueries });
  const confirmCopyLink = trpc.records.resolveEbayCopyLinkAttention.useMutation({ onSuccess: refreshQueries });
  const destination = actionDestination(action);
  const pending = dismiss.isPending || refresh.isPending || confirmCopyLink.isPending;
  const context = actionContext(action, snapshot);
  const imageTriggerRef = useRef<HTMLButtonElement>(null);
  const [imageOpen, setImageOpen] = useState(false);
  const [referencesOpen, setReferencesOpen] = useState(false);
  const referencesId = useId();
  const references = referenceRows(action);
  const required = action.category === "required";
  const open = action.status === "open";

  async function perform(change: Promise<unknown>) {
    setError(null);
    try {
      await change;
    } catch (reason) {
      setError(actionError(reason));
    }
  }

  let primaryAction: ReactNode = null;
  if (open && live && action.recovery.includes("reconnect_ebay")) {
    primaryAction = <Link className={primaryButtonClass} href="/ebay"><Wrench aria-hidden="true" className="size-4" />Reconnect eBay</Link>;
  } else if (open && live && action.recovery.includes("confirm_copy_link") && action.references.listingId) {
    primaryAction = (
      <button className={primaryButtonClass} disabled={pending} onClick={() => void perform(confirmCopyLink.mutateAsync({ listingId: action.references.listingId! }))} type="button">
        <Link2 aria-hidden="true" className="size-4" />{confirmCopyLink.isPending ? "Confirming…" : "Confirm Copy link"}
      </button>
    );
  } else if (open && live && action.recovery.includes("refresh_status") && action.references.listingId) {
    primaryAction = (
      <button className={primaryButtonClass} disabled={pending} onClick={() => void perform(refresh.mutateAsync({ listingId: action.references.listingId! }))} type="button">
        <RefreshCw aria-hidden="true" className={`size-4 ${refresh.isPending ? "motion-safe:animate-spin" : ""}`} />{refresh.isPending ? "Refreshing…" : "Refresh from eBay"}
      </button>
    );
  } else if (open && destination) {
    primaryAction = (
      <Link className={primaryButtonClass} href={destination}>
        {required ? "Resolve action" : "Review"}<ChevronRight aria-hidden="true" className="size-4" />
      </Link>
    );
  }

  return (
    <article className="overflow-hidden rounded-lg border border-zinc-300 bg-white shadow-sm">
      <div className="grid grid-cols-1 gap-x-3 gap-y-2 p-3 sm:p-4 md:grid-cols-[auto_minmax(0,1fr)] md:items-stretch">
        {context.cardImageUrl ? (
          <div className="relative hidden aspect-[59/86] overflow-hidden rounded-md border border-zinc-200 bg-zinc-100 shadow-sm md:row-span-2 md:block md:h-full md:min-h-0 md:w-auto">
            <Image
              alt={`${context.subject ?? "Related"} card`}
              className="object-contain"
              fill
              sizes="(max-width: 639px) 76px, 96px"
              src={`/api/image-proxy?url=${encodeURIComponent(context.cardImageUrl)}`}
              unoptimized
            />
          </div>
        ) : (
          <span className={`hidden size-10 shrink-0 place-items-center self-start rounded-full md:row-span-2 md:grid ${required ? "bg-amber-100 text-amber-900" : "bg-indigo-100 text-indigo-800"}`}>
            {required ? <AlertTriangle aria-hidden="true" className="size-5" /> : <Lightbulb aria-hidden="true" className="size-5" />}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
            <span className={`inline-flex items-center gap-1 ${required ? "text-amber-900" : "text-indigo-800"}`}>
              {required ? <AlertTriangle aria-hidden="true" className="size-3.5" /> : <Lightbulb aria-hidden="true" className="size-3.5" />}
              {required ? (action.severity === "urgent" ? "Action required" : "Needs review") : "Optional idea"}
            </span>
            <span aria-hidden="true" className="text-zinc-300">•</span>
            <span className="text-zinc-600">{areaLabels[action.area]}</span>
            {!open ? <span className="rounded-full bg-zinc-100 px-2 py-1 capitalize text-zinc-600">{action.status}</span> : null}
          </div>
          <h3 className="mt-1 line-clamp-2 text-base font-black leading-5 text-zinc-950 sm:truncate sm:text-lg sm:leading-6">{action.title}</h3>
          {context.subject ? (
            <div className="flex min-w-0 items-center gap-2">
              {context.subject !== action.title ? <p className="min-w-0 truncate font-bold leading-5 text-zinc-700">{context.subject}</p> : null}
              {context.cardImageUrl ? (
                <button
                  aria-label={`View card image for ${context.subject}`}
                  className="relative grid size-8 shrink-0 place-items-center rounded-full border border-zinc-200 bg-zinc-50 text-zinc-500 transition after:absolute after:-inset-1.5 after:content-[''] hover:border-zinc-300 hover:bg-zinc-100 hover:text-zinc-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8a1f2d]/30 md:hidden"
                  onClick={() => setImageOpen(true)}
                  ref={imageTriggerRef}
                  title="View card image"
                  type="button"
                >
                  <ImageIcon aria-hidden="true" className="size-4" />
                </button>
              ) : null}
              {context.rarityCode ? (
                <span
                  aria-label={`Rarity ${context.rarity ?? context.rarityCode}`}
                  className="inline-flex h-6 shrink-0 items-center rounded-md border border-zinc-200 bg-zinc-50 px-1.5 text-[11px] font-black uppercase tracking-[0.08em] text-zinc-700"
                  title={context.rarity ?? context.rarityCode}
                >
                  {context.rarityCode}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
        <p className="line-clamp-2 text-sm font-medium leading-5 text-zinc-600 md:col-start-2">{action.detail}</p>
      </div>

      {error ? <p className="mx-3 mb-3 rounded-md border border-rose-300 bg-rose-50 p-3 text-sm font-bold text-rose-900 sm:mx-4" role="alert">{error}</p> : null}

      <div className="grid grid-cols-2 gap-2 border-t border-zinc-200 p-3 sm:flex sm:flex-row sm:flex-wrap sm:items-center">
        {open ? (
          <>
            {primaryAction}
            {destination && primaryAction && (action.recovery.includes("confirm_copy_link") || action.recovery.includes("refresh_status")) ? <Link className={secondaryButtonClass} href={destination}>{destinationLabels[action.kind]}</Link> : null}
            {live && action.recovery.includes("open_ebay") && action.references.listingUrl ? (
              <a className={secondaryButtonClass} href={action.references.listingUrl} rel="noreferrer" target="_blank"><ExternalLink aria-hidden="true" className="size-4" /><span className="sm:hidden">View eBay</span><span className="hidden sm:inline">Open live listing</span><span className="sr-only"> (opens in a new tab)</span></a>
            ) : null}
            {live && action.category === "suggestion" ? (
              <button className={secondaryButtonClass} disabled={pending} onClick={() => void perform(dismiss.mutateAsync({ dedupeKey: action.dedupeKey }))} type="button">{dismiss.isPending ? "Dismissing…" : "Dismiss"}</button>
            ) : null}
          </>
        ) : (
          <p className="min-h-11 py-3 text-sm font-bold text-zinc-600">{action.status === "resolved" ? "Resolved" : "Dismissed"}{statusDate(action) ? ` ${formatDate(statusDate(action))}` : ""}</p>
        )}

        {references.length ? (
          <div className="col-start-2 min-w-0 text-sm sm:ml-auto">
            <button
              aria-controls={referencesId}
              aria-expanded={referencesOpen}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-bold text-zinc-700 transition hover:border-zinc-500 hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-[#8a1f2d]/20 sm:w-auto"
              onClick={() => setReferencesOpen((current) => !current)}
              type="button"
            >
              References
            </button>
          </div>
        ) : null}
        {referencesOpen && references.length ? (
          <dl className="col-span-2 grid gap-2 rounded-md bg-zinc-50 p-3 sm:order-last sm:basis-full" id={referencesId}>
            {references.map((row) => <div className="grid gap-1 sm:grid-cols-[10rem_minmax(0,1fr)]" key={row.label}><dt className="font-bold text-zinc-600">{row.label}</dt><dd className="break-all font-mono text-xs leading-5 text-zinc-700">{row.value}</dd></div>)}
          </dl>
        ) : null}
      </div>
      {imageOpen && context.cardImageUrl ? (
        <CardImagePreviewDialog
          imageUrl={context.cardImageUrl}
          name={context.subject ?? action.title}
          onClose={() => setImageOpen(false)}
          rarity={context.rarity}
          triggerRef={imageTriggerRef}
        />
      ) : null}
    </article>
  );
}

export function RecordsActionsWorkspace() {
  const source = useRecordsDataSource();
  const query = trpc.records.actions.useQuery(undefined, {
    enabled: source.mode === "live" && source.status === "ready",
  });
  if (source.mode !== "live") {
    return (
      <section className="grid gap-5">
        <div className="flex items-start gap-3 rounded-lg border border-indigo-200 bg-indigo-50 p-4 text-indigo-950">
          <Sparkles aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
          <div><p className="font-black">Actions preview</p><p className="mt-1 text-sm font-medium leading-5">Preview shows required work and optional ideas from the current sample snapshot. Dismissal and eBay recovery controls save only in live Records.</p></div>
        </div>
        <ActionsList actions={deriveSnapshotRecordsActions(source.snapshot)} live={false} snapshot={source.snapshot} />
      </section>
    );
  }
  if (source.status === "loading" || query.isPending) {
    return <div className="grid min-h-48 place-items-center rounded-lg border border-zinc-300 bg-white font-bold" role="status">Loading Actions…</div>;
  }
  if (source.status === "error" || query.isError) {
    return (
      <div className="rounded-lg border border-rose-300 bg-rose-50 p-5" role="alert">
        <p className="font-black">Actions could not be loaded</p>
        <p className="mt-1 text-sm font-medium text-rose-900">{source.errorMessage ?? "Records could not build your work queue. Retry once, then check your database and eBay connection if it continues."}</p>
        <button className="mt-3 min-h-11 rounded-md border border-rose-400 bg-white px-3 text-sm font-bold" onClick={() => void (source.status === "error" ? source.refresh() : query.refetch())} type="button">Try again</button>
      </div>
    );
  }
  return <ActionsList actions={query.data ?? []} live snapshot={source.snapshot} />;
}

function ActionsList({ actions, live, snapshot }: { actions: RecordsAction[]; live: boolean; snapshot: RecordsSnapshot }) {
  const openAttention = actions.filter((action) => action.status === "open" && action.category === "required");
  const openSuggestions = actions.filter((action) => action.status === "open" && action.category === "suggestion");
  const history = actions.filter((action) => action.status !== "open");
  const [view, setView] = useState<ActionView>("all");
  const [search, setSearch] = useState("");
  const [area, setArea] = useState<"all" | ActionArea>("all");
  const [page, setPage] = useState(1);
  const viewActions = view === "all" ? actions : view === "attention" ? openAttention : view === "suggestions" ? openSuggestions : history;
  const filteredActions = filterRecordsActions(viewActions, {
    area,
    category: "all",
    search: "",
    status: "all",
  }).filter((action) => matchesHumanContext(action, snapshot, search)).sort((left, right) => (
    (left.status === "open" ? (left.category === "required" ? 0 : 1) : 2)
    - (right.status === "open" ? (right.category === "required" ? 0 : 1) : 2)
    || ({ urgent: 0, warning: 1, info: 2 })[left.severity] - ({ urgent: 0, warning: 1, info: 2 })[right.severity]
    || (right.updatedAt?.getTime() ?? 0) - (left.updatedAt?.getTime() ?? 0)
  ));
  const pageCount = Math.max(1, Math.ceil(filteredActions.length / actionsPerPage));
  const currentPage = Math.min(page, pageCount);
  const firstAction = (currentPage - 1) * actionsPerPage;
  const visible = filteredActions.slice(firstAction, firstAction + actionsPerPage);
  const filtered = search.trim().length > 0 || view !== "all" || area !== "all";
  const viewCopy = {
    all: {
      title: "All actions",
      description: "Required work appears first, followed by optional ideas and recent action history.",
      empty: filtered ? "No actions match your filters." : "There are no actions to show right now.",
      icon: <CheckCircle2 aria-hidden="true" className="size-6" />,
    },
    attention: {
      title: "Needs your attention",
      description: "Resolve these before trusting related inventory, listing, order, or sales data.",
      empty: filtered ? "No required actions match your filters." : "Nothing needs your attention right now.",
      icon: <CheckCircle2 aria-hidden="true" className="size-6" />,
    },
    suggestions: {
      title: "Selling ideas",
      description: "Optional opportunities based on available stock. They never block other Records work.",
      empty: filtered ? "No selling ideas match your filters." : "There are no selling ideas to review right now.",
      icon: <Lightbulb aria-hidden="true" className="size-6" />,
    },
    history: {
      title: "Action history",
      description: "Recently resolved problems and dismissed suggestions remain here for reference.",
      empty: filtered ? "No previous actions match your filters." : "Resolved and dismissed actions will appear here.",
      icon: <Archive aria-hidden="true" className="size-6" />,
    },
  }[view];

  function clearFilters() {
    setSearch("");
    setView("all");
    setArea("all");
    setPage(1);
  }

  function changePage(nextPage: number) {
    setPage(nextPage);
    window.requestAnimationFrame(() => {
      document.getElementById(`actions-${view}-heading`)?.scrollIntoView({ block: "start" });
    });
  }

  return (
    <section className="grid gap-5">
      <div className="grid grid-cols-1 gap-3 rounded-lg border border-zinc-300 bg-white p-3 sm:grid-cols-2 sm:items-end sm:p-4 lg:grid-cols-[minmax(0,1fr)_12rem_12rem_auto]">
        <label className="grid gap-1.5 text-sm font-bold text-zinc-700 sm:col-span-2 lg:col-span-1">
          Find an action
          <span className="relative">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
            <input className="h-11 w-full rounded-md border border-zinc-300 bg-zinc-50 pl-9 pr-3 text-base outline-none transition focus:border-[#8a1f2d] focus:bg-white focus:ring-2 focus:ring-[#8a1f2d]/10 sm:text-sm" onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Card, record, listing…" type="search" value={search} />
          </span>
        </label>
        <label className="grid gap-1.5 text-sm font-bold text-zinc-700">
          Type
          <select aria-label="Filter actions by type" className="h-11 rounded-md border border-zinc-300 bg-zinc-50 px-3 text-base outline-none transition focus:border-[#8a1f2d] focus:bg-white focus:ring-2 focus:ring-[#8a1f2d]/10 sm:text-sm" onChange={(event) => { setView(event.target.value as ActionView); setPage(1); }} value={view}>
            <option value="all">All actions ({actions.length})</option>
            <option value="attention">Needs attention ({openAttention.length})</option>
            <option value="suggestions">Suggestions ({openSuggestions.length})</option>
            <option value="history">History ({history.length})</option>
          </select>
        </label>
        <label className="grid gap-1.5 text-sm font-bold text-zinc-700">
          Area
          <select className="h-11 rounded-md border border-zinc-300 bg-zinc-50 px-3 text-base outline-none transition focus:border-[#8a1f2d] focus:bg-white focus:ring-2 focus:ring-[#8a1f2d]/10 sm:text-sm" onChange={(event) => { setArea(event.target.value as "all" | ActionArea); setPage(1); }} value={area}>
            <option value="all">Everywhere</option><option value="records">Records</option><option value="inventory">Inventory</option><option value="listings">Listings</option><option value="orders">Orders</option><option value="sales">Sales</option><option value="ebay">eBay</option>
          </select>
        </label>
        {filtered ? <button className="min-h-11 rounded-md border border-zinc-300 px-3 text-sm font-bold text-zinc-700 transition hover:border-zinc-500 sm:col-span-2 lg:col-span-1" onClick={clearFilters} type="button">Clear filters</button> : null}
      </div>

      <section aria-labelledby={`actions-${view}-heading`}>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-lg font-black text-zinc-950" id={`actions-${view}-heading`}>{viewCopy.title}</h2>
            <p className="mt-1 max-w-3xl text-sm font-medium leading-5 text-zinc-600">{viewCopy.description}</p>
          </div>
          <p aria-live="polite" className="text-sm font-bold text-zinc-600">
            {filteredActions.length ? `Showing ${firstAction + 1}–${firstAction + visible.length} of ${filteredActions.length}` : "0 actions"}
          </p>
        </div>
        <div className="mt-3 grid gap-3">
          {visible.length ? visible.map((action) => <ActionCard action={action} key={action.dedupeKey} live={live} snapshot={snapshot} />) : (
            <div className="grid min-h-40 place-items-center rounded-lg border border-dashed border-zinc-300 bg-white p-6 text-center">
              <div>
                <span className="mx-auto grid size-12 place-items-center rounded-full bg-zinc-100 text-zinc-600">{viewCopy.icon}</span>
                <p className="mt-3 font-black text-zinc-900">{viewCopy.empty}</p>
                {filtered ? <button className="mt-3 min-h-11 rounded-md border border-zinc-300 px-4 text-sm font-bold hover:border-zinc-500" onClick={clearFilters} type="button">Clear filters</button> : null}
              </div>
            </div>
          )}
        </div>
        {filteredActions.length > actionsPerPage ? (
          <nav aria-label="Actions pagination" className="mt-4 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 rounded-lg border border-zinc-300 bg-white p-3 sm:flex sm:justify-between sm:gap-3">
            <button className={secondaryButtonClass} disabled={currentPage === 1} onClick={() => changePage(Math.max(1, currentPage - 1))} type="button">
              <ChevronLeft aria-hidden="true" className="size-4" />Previous
            </button>
            <p className="text-center text-sm font-bold text-zinc-700">Page {currentPage} of {pageCount}</p>
            <button className={secondaryButtonClass} disabled={currentPage === pageCount} onClick={() => changePage(Math.min(pageCount, currentPage + 1))} type="button">
              Next<ChevronRight aria-hidden="true" className="size-4" />
            </button>
          </nav>
        ) : null}
      </section>
    </section>
  );
}

"use client";

import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  PackageSearch,
  RefreshCw,
  Unplug,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useSession } from "@/lib/auth-client";
import {
  ebayListingDetailHref,
  ebayListingsHref,
  type EbayListingsRouteState,
} from "@/lib/records/ebay-listings-route-state";
import { inventoryCardDetailHref, inventoryCopySellHref } from "@/lib/records/inventory-route-state";
import { useRecordsDataSource } from "@/components/records/records-preview-provider";
import { trpc } from "@/trpc/client";

const lifecycleOptions = [
  ["all", "All states"],
  ["live", "Live"],
  ["pending", "Pending"],
  ["paid", "Paid"],
  ["ended", "Ended"],
  ["cancelled", "Cancelled"],
  ["needs_attention", "Needs attention"],
] as const;
const compositionOptions = [["all", "All offer types"], ["individual", "Individual"], ["quantity", "Quantity"], ["bundle", "Bundle"]] as const;

function dateTime(value: Date | string | null) {
  if (!value) return "Not synced yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function lifecycleLabel(listing: { lastError: string | null; listingState: string; saleState: string }) {
  if (listing.lastError || listing.saleState === "needs_review" || listing.listingState === "unknown" || listing.listingState === "suspended") return "Needs attention";
  if (listing.saleState === "paid") return "Paid";
  if (listing.saleState === "pending") return "Payment pending";
  if (listing.saleState === "cancelled") return "Cancelled";
  if (listing.listingState === "active") return "Live";
  if (listing.listingState === "ended") return "Ended";
  return "Status unknown";
}

function compositionLabel(kind: string) {
  return kind === "quantity" ? "Quantity offer" : kind === "bundle" ? "Bundle offer" : "Individual offer";
}

function isStale(lastSyncedAt: Date | string | null) {
  if (!lastSyncedAt) return true;
  const timestamp = new Date(lastSyncedAt).getTime();
  return !Number.isFinite(timestamp) || Date.now() - timestamp > 24 * 60 * 60 * 1_000;
}

function ListingThumbnail({ imageUrl, title }: { imageUrl: string | null; title: string }) {
  return (
    <div className="grid h-16 w-12 shrink-0 place-items-center overflow-hidden rounded-md border border-zinc-300 bg-zinc-100 sm:h-20 sm:w-14">
      {imageUrl ? <Image alt="" className="h-full w-full object-cover" height={80} src={`/api/image-proxy?url=${encodeURIComponent(imageUrl)}`} unoptimized width={56} /> : <PackageSearch aria-hidden="true" className="size-5 text-zinc-400" />}
      <span className="sr-only">{title}</span>
    </div>
  );
}

type ListingWorkspaceItem = {
  endingReason: string | null;
  id: string;
  itemId: string;
  kind: string;
  lastError: string | null;
  lastSyncedAt: Date | null;
  listingState: string;
  listingUrl: string;
  members: Array<{
    copyId: string;
    copyStatus: string;
    fulfilmentPosition: number;
    id: string;
    imageUrl: string | null;
    name: string;
    setCode: string;
    setName: string;
    stickerNumber: string | null;
    targetId: string;
  }>;
  memberCount: number;
  orderLines: Array<{
    id: string;
    orderId: string | null;
    orderLineItemId: string | null;
    paymentState: string;
    quantityPurchased: number;
    saleRecordId: string | null;
    transactionId: string | null;
    updatedAt: Date;
  }>;
  orderLineCount: number;
  overlapCount: number;
  remoteListingStatus: string | null;
  remoteOrderStatus: string | null;
  saleRecordId: string | null;
  saleState: string;
  title: string;
};

function ListingActions({
  listing,
}: {
  listing: {
    id: string;
    listingState: string;
    listingUrl: string;
    kind: string;
    members: Array<{ copyId: string; copyStatus: string; targetId: string }>;
    saleRecordId: string | null;
    saleState: string;
  };
}) {
  const { data: session } = useSession();
  const utils = trpc.useUtils();
  const refresh = trpc.ebay.refreshListingStatusById.useMutation();
  const [error, setError] = useState<string | null>(null);
  const member = listing.members[0];
  const canRelist = listing.kind === "individual" && listing.members.length === 1 && member?.copyStatus === "available" && listing.listingState === "ended" && (listing.saleState === "none" || listing.saleState === "cancelled") && !listing.saleRecordId;

  async function refreshStatus() {
    setError(null);
    try {
      await refresh.mutateAsync({ listingId: listing.id });
      await utils.records.listEbayListings.invalidate();
      await utils.records.snapshot.invalidate();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The listing status could not be refreshed.");
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap">
      {listing.listingUrl ? <a className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-bold text-zinc-800 transition hover:border-[#8a1f2d] hover:text-[#8a1f2d]" href={listing.listingUrl} rel="noreferrer" target="_blank"><ExternalLink aria-hidden="true" className="size-4" />Open on eBay<span className="sr-only"> (opens in a new tab)</span></a> : null}
      {session?.user.role === "admin" ? <button className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-bold text-zinc-800 transition hover:border-[#8a1f2d] hover:text-[#8a1f2d] disabled:cursor-wait disabled:opacity-60" disabled={refresh.isPending} onClick={() => void refreshStatus()} type="button"><RefreshCw aria-hidden="true" className={`size-4 ${refresh.isPending ? "animate-spin" : ""}`} />{refresh.isPending ? "Refreshing…" : "Refresh status"}</button> : null}
      {listing.saleRecordId ? <Link className="inline-flex min-h-11 items-center justify-center rounded-md border border-zinc-300 bg-white px-3 text-sm font-bold text-zinc-800 transition hover:border-[#8a1f2d] hover:text-[#8a1f2d]" href={`/records/history?record=${encodeURIComponent(listing.saleRecordId)}`}>Review Sale</Link> : null}
      {canRelist && member ? <Link className="inline-flex min-h-11 items-center justify-center rounded-md bg-[#8a1f2d] px-3 text-sm font-bold text-white transition hover:bg-[#711826]" href={inventoryCopySellHref(member.targetId, member.copyId, { card: "", copyQuantity: "all", edition: "all", kind: "cards", page: 1, rarity: [], status: "all" })}>Relist from Copy</Link> : null}
      {error ? <p className="basis-full text-sm font-semibold text-rose-700" role="alert">{error}</p> : null}
    </div>
  );
}

function ListingCard({ listing, state }: { listing: ListingWorkspaceItem; state: EbayListingsRouteState }) {
  const firstMember = listing.members[0];
  const status = isStale(listing.lastSyncedAt) && !listing.lastError ? "Status stale" : lifecycleLabel(listing);
  return (
    <article className="rounded-lg border border-zinc-300 bg-white p-4 shadow-sm">
      <div className="flex min-w-0 gap-3">
        <ListingThumbnail imageUrl={firstMember?.imageUrl ?? null} title={listing.title} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2"><span className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs font-bold text-zinc-700">Offer type · {compositionLabel(listing.kind)}</span><span className={`rounded-md border px-2 py-1 text-xs font-bold ${status === "Needs attention" ? "border-rose-300 bg-rose-50 text-rose-800" : "border-zinc-200 bg-zinc-50 text-zinc-700"}`}>{status}</span></div>
          <h2 className="mt-2 break-words text-lg font-black text-zinc-950"><Link aria-label={`View listing details for ${listing.title}`} className="inline-flex items-center gap-1 rounded underline decoration-[#8a1f2d]/40 decoration-2 underline-offset-4 transition hover:text-[#8a1f2d] hover:decoration-[#8a1f2d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8a1f2d]" href={ebayListingDetailHref(listing.id, state)}>{listing.title}<ChevronRight aria-hidden="true" className="size-5 shrink-0" /></Link></h2>
          <p className="mt-1 text-sm font-medium text-zinc-600">{listing.memberCount} card{listing.memberCount === 1 ? "" : "s"} in this offer · {listing.overlapCount} other live offer{listing.overlapCount === 1 ? "" : "s"} · eBay item {listing.itemId}</p>
        </div>
      </div>
      <dl className="mt-4 grid gap-3 border-t border-zinc-200 pt-4 text-sm sm:grid-cols-3">
        <div><dt className="font-bold text-zinc-500">Last sync</dt><dd className="mt-1 break-words font-semibold text-zinc-800">{dateTime(listing.lastSyncedAt)}</dd></div>
        <div><dt className="font-bold text-zinc-500">Ending reason</dt><dd className="mt-1 break-words font-semibold text-zinc-800">{listing.endingReason || "Not ended"}</dd></div>
        <div><dt className="font-bold text-zinc-500">eBay order events</dt><dd className="mt-1 font-semibold text-zinc-800">{listing.orderLineCount}</dd></div>
        <div><dt className="font-bold text-zinc-500">Remote listing state</dt><dd className="mt-1 break-words font-semibold text-zinc-800">{listing.remoteListingStatus || "Not reported"}</dd></div>
        <div><dt className="font-bold text-zinc-500">Remote order state</dt><dd className="mt-1 break-words font-semibold text-zinc-800">{listing.remoteOrderStatus || "Not reported"}</dd></div>
      </dl>
      {listing.lastError ? <p className="mt-3 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-900"><AlertTriangle aria-hidden="true" className="mr-1 inline size-4" />{listing.lastError}</p> : null}
      <div className="mt-4"><ListingActions listing={listing} /></div>
    </article>
  );
}

export function EbayListingsWorkspace({ initialState }: { initialState: EbayListingsRouteState }) {
  const router = useRouter();
  const source = useRecordsDataSource();
  const { data: session, isPending: sessionPending } = useSession();
  const liveAdmin = source.mode === "live" && session?.user.role === "admin";
  const listings = trpc.records.listEbayListings.useQuery(initialState, { enabled: liveAdmin, staleTime: 10_000 });
  const ebayStatus = trpc.ebay.status.useQuery(undefined, { enabled: liveAdmin, staleTime: 30_000 });

  useEffect(() => {
    if (listings.data && listings.data.page !== initialState.page) {
      router.replace(ebayListingsHref({ ...initialState, page: listings.data.page }));
    }
  }, [initialState, listings.data, router]);

  function update(next: Partial<EbayListingsRouteState>) {
    router.push(ebayListingsHref({ ...initialState, ...next, page: next.page ?? 1 }));
  }

  if (source.status === "loading" || sessionPending) return <div className="grid min-h-72 place-items-center rounded-lg border border-zinc-300 bg-white font-bold" role="status">Loading tracked eBay listings…</div>;
  if (source.status === "error") return <div className="rounded-lg border border-rose-300 bg-rose-50 p-5 text-rose-950" role="alert"><p className="font-black">Records could not be loaded</p><p className="mt-1 text-sm font-medium">{source.errorMessage || "Refresh the page and try again."}</p></div>;
  if (source.mode !== "live") return <section className="rounded-lg border border-zinc-300 bg-white p-6 text-center"><PackageSearch aria-hidden="true" className="mx-auto size-7 text-zinc-400" /><h1 className="mt-3 text-xl font-black">Listings are available in live Records</h1><p className="mx-auto mt-2 max-w-lg text-sm font-medium text-zinc-600">This preview does not connect to tracked eBay listings.</p></section>;
  if (session?.user.role !== "admin") return <section className="rounded-lg border border-amber-300 bg-amber-50 p-6 text-center text-amber-950"><h1 className="font-black">Admin access required</h1><p className="mt-2 text-sm font-medium">Only the collection owner can view and manage tracked eBay listings.</p></section>;

  return <section aria-labelledby="listings-title" className="grid gap-4">
    <header><p className="text-xs font-bold uppercase tracking-[0.14em] text-[#8a1f2d]">Records</p><h1 className="mt-1 text-2xl font-black" id="listings-title">Listings</h1><p className="mt-1 text-sm font-medium text-zinc-600">Find tracked eBay listings, inspect the exact Copies in each offer, and recover safely when a status needs attention.</p></header>
    {ebayStatus.data && (!ebayStatus.data.configured || !ebayStatus.data.connection) ? <aside className="flex flex-col gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950 sm:flex-row sm:items-center sm:justify-between"><div className="flex gap-3"><Unplug aria-hidden="true" className="mt-0.5 size-5 shrink-0" /><div><p className="font-black">eBay is disconnected</p><p className="mt-1 text-sm font-medium">Reconnect eBay before refreshing a Listing or taking a selling action.</p></div></div><Link className="inline-flex min-h-11 items-center justify-center rounded-md bg-zinc-950 px-4 text-sm font-bold text-white" href="/ebay">Reconnect eBay</Link></aside> : null}
    <form className="grid gap-3 rounded-lg border border-zinc-300 bg-white p-4 md:grid-cols-[minmax(0,1fr)_12rem_12rem_auto]" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); update({ page: 1, query: String(form.get("query") || "") }); }}>
      <label className="min-w-0"><span className="sr-only">Search listings</span><input className="h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold outline-none focus:border-[#8a1f2d] focus:ring-2 focus:ring-[#8a1f2d]/20" defaultValue={initialState.query} name="query" placeholder="Search title, card, set, Copy reference, or item ID" /></label>
      <label><span className="sr-only">Lifecycle state</span><select className="h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold" onChange={(event) => update({ lifecycle: event.target.value as EbayListingsRouteState["lifecycle"], page: 1 })} value={initialState.lifecycle}>{lifecycleOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label><span className="sr-only">Offer type</span><select className="h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold" onChange={(event) => update({ composition: event.target.value as EbayListingsRouteState["composition"], page: 1 })} value={initialState.composition}>{compositionOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <button className="min-h-11 rounded-md bg-[#8a1f2d] px-4 text-sm font-bold text-white transition hover:bg-[#711826]" type="submit">Search</button>
    </form>
    {listings.isPending ? <div className="grid min-h-48 place-items-center rounded-lg border border-zinc-300 bg-white font-bold" role="status">Loading listings…</div> : listings.isError ? <div className="rounded-lg border border-rose-300 bg-rose-50 p-5 text-rose-950" role="alert"><p className="font-black">Listings could not be loaded</p><p className="mt-1 text-sm font-medium">{listings.error.message}</p><button className="mt-3 min-h-11 rounded-md border border-rose-400 bg-white px-4 text-sm font-bold" onClick={() => void listings.refetch()} type="button">Try again</button></div> : listings.data?.recoveryMessage ? <div className="rounded-lg border border-amber-300 bg-amber-50 p-5 text-amber-950" role="alert"><p className="font-black">Listings need a Records update</p><p className="mt-1 text-sm font-medium">{listings.data.recoveryMessage}</p></div> : listings.data?.items.length ? <><p className="text-sm font-semibold text-zinc-600">{listings.data.total} tracked listing{listings.data.total === 1 ? "" : "s"}</p><div className="grid gap-4">{listings.data.items.map((listing) => <ListingCard key={listing.id} listing={listing} state={initialState} />)}</div>{listings.data.pageCount > 1 ? <nav aria-label="Listings pages" className="flex items-center justify-between gap-3 rounded-lg border border-zinc-300 bg-white p-3"><button className="inline-flex min-h-11 items-center gap-1 rounded-md px-3 text-sm font-bold disabled:opacity-40" disabled={listings.data.page <= 1} onClick={() => update({ page: listings.data!.page - 1 })} type="button"><ChevronLeft aria-hidden="true" className="size-4" />Previous</button><span className="text-sm font-bold text-zinc-600">Page {listings.data.page} of {listings.data.pageCount}</span><button className="inline-flex min-h-11 items-center gap-1 rounded-md px-3 text-sm font-bold disabled:opacity-40" disabled={listings.data.page >= listings.data.pageCount} onClick={() => update({ page: listings.data!.page + 1 })} type="button">Next<ChevronRight aria-hidden="true" className="size-4" /></button></nav> : null}</> : <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-8 text-center"><PackageSearch aria-hidden="true" className="mx-auto size-7 text-zinc-400" /><h2 className="mt-3 font-black">No tracked listings match</h2><p className="mt-1 text-sm font-medium text-zinc-600">Try a different search or clear one of the filters.</p></div>}
  </section>;
}

export function EbayListingDetail({ initialState, listingId }: { initialState: EbayListingsRouteState; listingId: string }) {
  const source = useRecordsDataSource();
  const { data: session, isPending } = useSession();
  const liveAdmin = source.mode === "live" && session?.user.role === "admin";
  const listing = trpc.records.listEbayListings.useQuery({ ...initialState, listingId, page: 1 }, { enabled: liveAdmin, staleTime: 10_000 });
  if (isPending || source.status === "loading" || listing.isPending) return <div className="grid min-h-72 place-items-center rounded-lg border border-zinc-300 bg-white font-bold" role="status">Loading listing detail…</div>;
  if (listing.isError) return <section className="rounded-lg border border-rose-300 bg-rose-50 p-6 text-center text-rose-950" role="alert"><h1 className="text-xl font-black">Listing detail could not be loaded</h1><p className="mt-2 text-sm font-medium">{listing.error.message}</p><button className="mt-4 min-h-11 rounded-md border border-rose-400 bg-white px-4 text-sm font-bold" onClick={() => void listing.refetch()} type="button">Try again</button></section>;
  const item = listing.data?.items[0];
  if (!item) return <section className="rounded-lg border border-zinc-300 bg-white p-6 text-center"><h1 className="text-xl font-black">Listing not found</h1><p className="mt-2 text-sm font-medium text-zinc-600">It may belong to another collection or no longer be available.</p><Link className="mt-4 inline-flex min-h-11 items-center rounded-md bg-zinc-950 px-4 text-sm font-bold text-white" href={ebayListingsHref(initialState)}>Back to Listings</Link></section>;
  return <section aria-labelledby="listing-detail-title" className="grid gap-4"><nav aria-label="Listing breadcrumb"><Link className="inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-sm font-bold text-[#8a1f2d] hover:bg-rose-50" href={ebayListingsHref(initialState)}><ChevronLeft aria-hidden="true" className="size-4" />Listings</Link></nav><header><p className="text-xs font-bold uppercase tracking-[0.14em] text-[#8a1f2d]">Offer type · {compositionLabel(item.kind)}</p><h1 className="mt-1 break-words text-2xl font-black" id="listing-detail-title">{item.title}</h1><p className="mt-1 text-sm font-medium text-zinc-600">{lifecycleLabel(item)} · eBay item {item.itemId}</p></header><ListingCard listing={item} state={initialState} /><section className="rounded-lg border border-zinc-300 bg-white p-4"><h2 className="text-lg font-black">Exact cards in fulfilment order</h2><ol className="mt-3 grid gap-2">{item.members.map((member) => <li className="flex min-w-0 items-center gap-3 rounded-md border border-zinc-200 p-3" key={member.id}><span className="grid size-7 shrink-0 place-items-center rounded-full bg-zinc-100 text-xs font-black">{member.fulfilmentPosition + 1}</span><div className="min-w-0 flex-1"><p className="break-words font-bold">{member.name}</p><p className="text-sm font-medium text-zinc-600">{member.setName}{member.setCode ? ` · ${member.setCode}` : ""}{member.stickerNumber ? ` · Sticker ${member.stickerNumber}` : ""}</p></div><Link className="inline-flex min-h-11 items-center rounded-md px-2 text-sm font-bold text-[#8a1f2d] hover:bg-rose-50" href={inventoryCardDetailHref(member.targetId, { card: "", copyQuantity: "all", edition: "all", kind: "cards", page: 1, rarity: [], status: "all" }, member.copyId)}>Open card</Link></li>)}</ol></section><section className="rounded-lg border border-zinc-300 bg-white p-4"><h2 className="text-lg font-black">Known eBay purchase events</h2>{item.orderLines.length ? <ol className="mt-3 grid gap-2">{item.orderLines.map((line) => <li className="rounded-md border border-zinc-200 p-3" key={line.id}><p className="font-bold">{line.paymentState === "paid" ? "Paid" : line.paymentState === "pending" ? "Payment pending" : line.paymentState === "cancelled" ? "Cancelled" : "Needs review"} · Quantity {line.quantityPurchased}</p><p className="mt-1 break-words text-sm font-medium text-zinc-600">eBay order {line.orderId || "not supplied"} · Reference {line.transactionId || line.orderLineItemId || "not supplied"}</p><p className="mt-1 text-sm font-medium text-zinc-600">Updated {dateTime(line.updatedAt)}</p>{line.saleRecordId ? <Link className="mt-2 inline-flex min-h-11 items-center rounded-md px-2 text-sm font-bold text-[#8a1f2d] hover:bg-rose-50" href={`/records/history?record=${encodeURIComponent(line.saleRecordId)}`}>Review Sale</Link> : null}</li>)}</ol> : <p className="mt-2 text-sm font-medium text-zinc-600">No eBay purchase events have been recorded for this listing.</p>}</section></section>;
}

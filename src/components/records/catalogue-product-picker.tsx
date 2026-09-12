"use client";

import Image from "next/image";
import { ChevronLeft, ChevronRight, Loader2, Plus, Search, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useViewportOverlay } from "@/components/use-viewport-overlay";
import { fieldClass } from "@/components/records/entry-form-ui";
import { cataloguePriceLabel } from "@/lib/card-catalogue";
import { trpc } from "@/trpc/client";
import type { OwnedCardProduct } from "@/lib/records/owned-cards";

type Props = { onSelect: (product: OwnedCardProduct) => void; onClose: () => void };

/** Uses the indexed catalogue; choosing a result never fetches an external product page. */
export function CatalogueProductPicker({ onSelect, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [searchText, setSearchText] = useState("");
  const [page, setPage] = useState(1);
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const dialogRef = useViewportOverlay<HTMLDivElement>({ isOpen: true, onClose, initialFocusRef: inputRef });
  useEffect(() => {
    const timer = window.setTimeout(() => { setSearchText(query.trim()); setPage(1); }, 300);
    return () => window.clearTimeout(timer);
  }, [query]);
  const results = trpc.cardCatalogue.search.useQuery({ query: searchText, page }, {
    enabled: Boolean(searchText), retry: false, staleTime: 60_000,
  });
  const waiting = query.trim() !== searchText || results.isFetching;
  return createPortal(<div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Choose card printing" className="max-h-[calc(100dvh-2rem)] w-full max-w-xl overflow-y-auto rounded-xl border border-zinc-300 bg-white p-4 shadow-xl">
      <div className="mb-3 flex items-center justify-between"><h2 className="text-lg font-bold">Choose card printing</h2><button type="button" aria-label="Close card search" onClick={onClose} className="grid size-11 place-items-center rounded-md hover:bg-zinc-100"><X className="size-4" /></button></div>
      <label htmlFor={id} className="text-sm font-bold">Card name or set code</label>
      <div className="relative"><Search className="pointer-events-none absolute left-3 top-4 size-4 text-zinc-400" /><input ref={inputRef} id={id} autoComplete="off" className={`${fieldClass} pl-9`} placeholder="e.g. Blue-Eyes, MP24-EN001, RA02 ultra rare" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
      <p className="mt-2 text-xs text-zinc-500">Include a rarity to narrow your search.</p>
      <div role="status" className="mt-3 text-sm text-zinc-500">{waiting ? <span className="flex items-center gap-2"><Loader2 className="size-4 animate-spin" /> Searching cards…</span> : !searchText ? "Search for the printing on your card." : results.isError ? null : results.data?.status.ready ? `${results.data.total} matching printings` : "The catalogue is being prepared. Try again shortly."}</div>
      {results.isError ? <div role="alert" className="mt-3 text-sm text-rose-700">{results.error.message}<button type="button" className="ml-2 min-h-11 underline" onClick={() => void results.refetch()}>Retry</button></div> : null}
      {!waiting && searchText && !results.isError ? <ul className="mt-2 max-h-[50dvh] divide-y divide-zinc-200 overflow-y-auto">{results.data?.products.map((product) => <li key={product.productId}><button type="button" aria-label={`Choose ${product.name}, ${product.setCode}, ${product.rarity}`} className="flex w-full items-center gap-3 rounded-md py-2 text-left hover:bg-rose-50 focus-visible:outline-2 focus-visible:outline-[#8a1f2d]" onClick={() => onSelect(product)}>
        <span className="grid h-[70px] w-12 shrink-0 place-items-center rounded bg-zinc-100">{product.imageUrl ? <Image alt="" width={48} height={70} className="h-full w-full object-contain" unoptimized src={`/api/image-proxy?url=${encodeURIComponent(product.imageUrl)}`} /> : <span className="text-xs text-zinc-400">Card</span>}</span>
        <span className="min-w-0 flex-1"><span className="block text-sm font-bold">{product.name}</span><span className="block truncate text-xs text-zinc-500">{product.setName}</span><span className="block text-xs font-semibold text-[#8a1f2d]">{product.setCode} · {product.rarity}</span>{cataloguePriceLabel(product.marketPricesUsdCents) ? <span className="block text-xs text-zinc-500">TCGplayer · {cataloguePriceLabel(product.marketPricesUsdCents)}</span> : null}</span><Plus className="mr-2 size-4 shrink-0" />
      </button></li>)}</ul> : null}
      {!waiting && searchText && (results.data?.pageCount ?? 0) > 1 ? <div className="mt-3 flex items-center justify-between text-xs text-zinc-500"><button type="button" aria-label="Previous results" disabled={page <= 1} className="grid size-11 place-items-center rounded border border-zinc-300 disabled:opacity-30" onClick={() => setPage(page - 1)}><ChevronLeft className="size-4" /></button>Page {page} of {results.data?.pageCount}<button type="button" aria-label="Next results" disabled={page >= (results.data?.pageCount ?? 1)} className="grid size-11 place-items-center rounded border border-zinc-300 disabled:opacity-30" onClick={() => setPage(page + 1)}><ChevronRight className="size-4" /></button></div> : null}
    </div>
  </div>, document.body);
}

"use client";

import { ArrowLeft, Check, ChevronLeft, ChevronRight, Loader2, Minus, Plus, Search, SlidersHorizontal, Trash2, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useViewportOverlay } from "@/components/use-viewport-overlay";
import { SearchablePicklist } from "@/components/records/searchable-picklist";
import { AppHeader } from "@/components/app-header";
import { fieldClass, textAreaClass, today } from "@/components/records/entry-form-ui";
import { useRecordsDataSource } from "@/components/records/records-preview-provider";
import { addOwnedCardsSchema, matchingOwnedCardCopies, ownedCardsDraftSchema, ownedCardVariantKey, type AddOwnedCardsDraft, type OwnedCardDraft, type OwnedCardProduct } from "@/lib/records/owned-cards";
import { cardConditions, type CardCondition, type ProductEdition } from "@/lib/records/types";
import { taskReturnHref } from "@/lib/navigation-intent";
import { cataloguePriceLabel } from "@/lib/card-catalogue";
import { rarityAbbreviation } from "@/lib/rarity-abbreviations";
import { trpc } from "@/trpc/client";

const queuePageSize = 20;
const editions: ProductEdition[] = ["1st Edition", "Unlimited Edition", "Limited Edition"];
const primaryButton = "inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-[#8a1f2d] px-4 text-sm font-bold text-white hover:bg-[#711826] focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-offset-2 disabled:opacity-50";
const secondaryButton = "inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-bold hover:bg-zinc-50 focus-visible:ring-2 focus-visible:ring-[#8a1f2d] disabled:opacity-40";

function OwnedDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useViewportOverlay<HTMLDivElement>({ isOpen: true, onClose });
  return createPortal(<div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div aria-label={title} aria-modal="true" role="dialog" ref={ref} tabIndex={-1} className="max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto rounded-xl border border-zinc-300 bg-white p-4 shadow-xl">
      <div className="mb-3 flex items-center justify-between gap-3"><h2 className="text-lg font-bold">{title}</h2><button type="button" aria-label={`Close ${title}`} onClick={onClose} className="grid size-11 place-items-center rounded-md hover:bg-zinc-100"><X className="size-4" /></button></div>
      {children}
    </div>
  </div>, document.body);
}

function CardArtwork({ product, small = false, tile = false }: { product: OwnedCardProduct; small?: boolean; tile?: boolean }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  return <div className={`grid shrink-0 place-items-center overflow-hidden rounded border border-zinc-200 bg-zinc-100 ${tile ? "aspect-[5/7] w-full" : small ? "h-14 w-10" : "h-[72px] w-12"}`}>
    {product.imageUrl && failedUrl === product.imageUrl ? <span className="px-1 text-center text-[10px] text-zinc-500">Image unavailable</span> : product.imageUrl ? <Image onError={() => setFailedUrl(product.imageUrl)} alt="" className="h-full w-full object-contain" height={96} src={`/api/image-proxy?url=${encodeURIComponent(product.imageUrl)}`} unoptimized width={64} /> : <span className="px-1 text-center text-xs text-zinc-500">No image</span>}
  </div>;
}

function CompactPicklist({ label, value, values, onChange, inlineOptions = false }: { inlineOptions?: boolean; label: string; value: string; values: string[]; onChange: (value: string) => void }) {
  return <SearchablePicklist key={value} compact inlineOptions={inlineOptions} emptyMessage="No options found" label={label}
    maxResults={100} onSelect={onChange} options={values.map((item) => ({ id: item || "all", label: item || "All rarities", displayText: item || "All rarities", detail: "", searchText: (item || "All rarities").toLowerCase() }))}
    placeholder={label} resultsLabel={label + " options"} selectedId={value || "all"} />;
}

function QuantityStepper({ label, value, min = 1, max = 1000, onChange }: { label: string; value: number; min?: number; max?: number; onChange: (value: number) => void }) {
  return <div className="inline-flex h-11 shrink-0 items-center overflow-hidden rounded-md border border-zinc-300 bg-white" role="group" aria-label={label}>
    <button aria-label={`Decrease ${label.toLowerCase()}`} className="grid size-11 place-items-center text-zinc-600 hover:bg-zinc-100 disabled:opacity-30" disabled={value <= min} onClick={() => onChange(value - 1)} type="button"><Minus className="size-3.5" /></button>
    <input aria-label={label} className="h-10 w-10 border-x border-zinc-200 bg-transparent text-center text-sm font-bold tabular-nums outline-none focus:bg-rose-50 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" inputMode="numeric" min={min} max={max} onFocus={(event) => event.target.select()} onChange={(event) => { const next = Number(event.target.value); if (Number.isInteger(next) && next >= min && next <= max) onChange(next); }} type="number" value={value} />
    <button aria-label={`Increase ${label.toLowerCase()}`} className="grid size-11 place-items-center text-zinc-600 hover:bg-zinc-100 disabled:opacity-30" disabled={value >= max} onClick={() => onChange(value + 1)} type="button"><Plus className="size-3.5" /></button>
  </div>;
}

function newDraft(): AddOwnedCardsDraft {
  return { operationId: crypto.randomUUID(), date: today(), source: "", notes: "", cards: [] };
}

export function OwnedCardsApp() {
  const source = useRecordsDataSource();
  if (source.status !== "ready") return <main className="app-page-shell p-6"><p role="status">Preparing your collection…</p></main>;
  return <OwnedCardsForm key={source.draftOwnerScope} />;
}

function OwnedCardsForm() {
  const source = useRecordsDataSource();
  const params = useSearchParams();
  const storageKey = `ygo:owned-cards:v1:${source.draftOwnerScope}`;
  const [draft, setDraft] = useState<AddOwnedCardsDraft | null>(null);
  const [query, setQuery] = useState(params.get("cardName") || "");
  const [searchText, setSearchText] = useState(query);
  const [rarity, setRarity] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [selected, setSelected] = useState<OwnedCardProduct | null>(null);
  const [edition, setEdition] = useState<ProductEdition>("1st Edition");
  const [condition, setCondition] = useState<CardCondition>("Near Mint");
  const [quantity, setQuantity] = useState("1");
  const [message, setMessage] = useState<string | null>(null);
  const [storageMessage, setStorageMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [saved, setSaved] = useState<{ id: string; quantity: number; warning?: string } | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [queueQuery, setQueueQuery] = useState("");
  const [queuePage, setQueuePage] = useState(1);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const stored = sessionStorage.getItem(storageKey);
        const parsed = stored ? ownedCardsDraftSchema.safeParse(JSON.parse(stored)) : null;
        setDraft(parsed?.success ? parsed.data : newDraft());
        if (stored && !parsed?.success) setStorageMessage("The previous draft could not be restored. Start a new list below.");
      } catch {
        setDraft(newDraft());
        setStorageMessage("Browser storage is unavailable. Keep this page open until you save your cards.");
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [storageKey]);

  useEffect(() => {
    if (!draft || saved) return;
    try { sessionStorage.setItem(storageKey, JSON.stringify(draft)); }
    catch { /* The save operation remains available if browser storage is full. */ }
  }, [draft, saved, storageKey]);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearchText(query.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  const results = trpc.cardCatalogue.search.useQuery({ query: searchText, rarity, page }, {
    enabled: Boolean(draft), retry: false, staleTime: 60_000,
  });
  const products = results.data?.products ?? [];
  const totalQuantity = draft?.cards.reduce((sum, card) => sum + card.quantity, 0) ?? 0;
  const queueCards = (draft?.cards ?? []).filter((card) => [card.name, card.setCode, card.rarity, card.edition, card.condition].join(" ").toLowerCase().includes(queueQuery.trim().toLowerCase()));
  const queuePages = Math.max(1, Math.ceil(queueCards.length / queuePageSize));
  const currentQueuePage = Math.min(queuePage, queuePages);
  const visibleQueueCards = queueCards.slice((currentQueuePage - 1) * queuePageSize, currentQueuePage * queuePageSize);
  const activeRarity = rarity ?? results.data?.detectedRarity ?? "";
  const selectedAllCopies = selected ? matchingOwnedCardCopies(source.snapshot, { ...selected, edition }) : [];
  const selectedConditionCounts = [...new Set(selectedAllCopies.map((copy) => copy.condition))].map((condition) => `${selectedAllCopies.filter((copy) => copy.condition === condition).length} ${condition}`).join(" · ");
  const selectedOwned = selected ? matchingOwnedCardCopies(source.snapshot, { ...selected, edition, condition }).length : 0;
  const selectedKey = selected ? ownedCardVariantKey({ ...selected, edition, condition, quantity: 1 }) : "";
  const selectedQueued = draft?.cards.find((card) => ownedCardVariantKey(card) === selectedKey)?.quantity ?? 0;
  const editingCard = draft?.cards.find((card) => ownedCardVariantKey(card) === editingKey);
  const editingOtherQuantity = editingKey !== selectedKey ? editingCard?.quantity ?? 0 : 0;
  const selectedAdditional = Number(quantity) - selectedOwned;
  const searching = query.trim() !== searchText || results.isFetching;

  function changeQuery(value: string) {
    setQuery(value); setPage(1); setRarity(undefined);
  }

  function initialQuantity(product: OwnedCardProduct, nextEdition: ProductEdition, nextCondition: CardCondition) {
    const variant = { ...product, edition: nextEdition, condition: nextCondition, quantity: 1 };
    const owned = matchingOwnedCardCopies(source.snapshot, variant).length;
    const queued = draft?.cards.find((card) => ownedCardVariantKey(card) === ownedCardVariantKey(variant))?.quantity ?? 0;
    return String(owned + queued || 1);
  }

  function choose(product: OwnedCardProduct) {
    setEditingKey(null); setSelected(product); setEdition("1st Edition");
    setQuantity(initialQuantity(product, "1st Edition", condition)); setMessage(null);
  }

  function changeVariant(nextEdition: ProductEdition, nextCondition: CardCondition) {
    setEdition(nextEdition); setCondition(nextCondition);
    if (selected) {
      if (editingCard) {
        const variant = { ...selected, edition: nextEdition, condition: nextCondition, quantity: 1 };
        const owned = matchingOwnedCardCopies(source.snapshot, variant).length;
        const other = draft?.cards.find((card) => ownedCardVariantKey(card) === ownedCardVariantKey(variant) && ownedCardVariantKey(card) !== editingKey)?.quantity ?? 0;
        setQuantity(String(owned + editingCard.quantity + other));
      } else setQuantity(initialQuantity(selected, nextEdition, nextCondition));
    }
    setMessage(null);
  }

  function addSelection() {
    if (!draft || !selected) return;
    const count = selectedAdditional;
    if (!Number.isInteger(count) || count < 0 || totalQuantity - selectedQueued - editingOtherQuantity + count > 1000) {
      setMessage("Add up to 1,000 new copies at a time."); return;
    }
    const cards = draft.cards.filter((card) => ownedCardVariantKey(card) !== selectedKey && ownedCardVariantKey(card) !== editingKey);
    if (count > 0) cards.push({ ...selected, edition, condition, quantity: count });
    if (cards.length > 100) { setMessage("Save this list before adding more than 100 different variants."); return; }
    setDraft({ ...draft, cards }); setSelected(null); setMessage(null);
    searchRef.current?.focus();
  }

  function editCard(card: OwnedCardDraft) {
    setEditingKey(ownedCardVariantKey(card)); setSelected(card);
    setEdition(card.edition); setCondition(card.condition);
    setQuantity(String(matchingOwnedCardCopies(source.snapshot, card).length + card.quantity));
    setMessage(null);
  }

  async function save() {
    if (!draft || savingRef.current) return;
    const parsed = addOwnedCardsSchema.safeParse(draft);
    if (!parsed.success) { setMessage(parsed.error.issues[0]?.message || "Check your card list."); return; }
    savingRef.current = true; setSaving(true); setMessage(null);
    try {
      const result = await source.addOwnedCards(draft);
      if (!result.ok) { setMessage(result.message); return; }
      setSaved({ id: result.id!, quantity: totalQuantity, warning: result.warning });
      try { sessionStorage.removeItem(storageKey); } catch { /* Confirmed save must not become a retry. */ }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Cards could not be saved. Your list is still here; retry safely.");
    } finally { savingRef.current = false; setSaving(false); }
  }

  return <main className="app-page-shell min-h-screen bg-[#f6f4ef] px-4 py-5 text-zinc-950 sm:px-6">
    <div className="mx-auto flex max-w-6xl flex-col gap-3">
      <AppHeader title="Add owned cards" />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link className="inline-flex min-h-11 items-center gap-2 text-sm font-bold text-zinc-600" href={taskReturnHref(params.get("origin"), "/records/inventory")}><ArrowLeft className="size-4" /> Back to collection</Link>
        <Link className="text-sm font-semibold text-zinc-600 underline underline-offset-4" href="/records/new/purchase">Other records</Link>
      </div>
      {storageMessage ? <p className="text-sm text-amber-800" role="status">{storageMessage}</p> : null}
      {!draft ? <p role="status">Preparing your card list…</p> : saved ? <section className="rounded-lg border border-zinc-300 bg-white p-8 text-center">
        <Check className="mx-auto size-10 text-emerald-700" />
        <h1 className="mt-3 text-2xl font-black">{saved.quantity} {saved.quantity === 1 ? "card" : "cards"} added</h1>
        <p className="mt-2 text-sm text-zinc-600">{source.mode === "preview" ? "Saved to the local preview only." : "Your cards are in Inventory, ready for photos and eBay listing."}</p>
        {saved.warning ? <p className="mt-3 text-sm text-amber-800" role="alert">{saved.warning}</p> : null}
        <div className="mt-6 flex flex-wrap justify-center gap-3"><Link className={primaryButton} href="/records/inventory">View inventory</Link><button className={secondaryButton} onClick={() => { setDraft(newDraft()); setSaved(null); }} type="button"><Plus className="size-4" /> Add more cards</button></div>
      </section> : <>
        <p className="max-w-2xl text-sm leading-6 text-zinc-600">Search a card name or set code. Include a rarity to narrow the results, then choose the printing you own.</p>
        {source.mode === "preview" ? <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">Preview mode: saving changes only this browser tab.</p> : null}
        <fieldset className="grid min-w-0 items-start gap-3 disabled:opacity-70 md:grid-cols-[minmax(0,1.15fr)_minmax(280px,.85fr)]" disabled={saving}>
          <div className="min-w-0 space-y-4">
            <section className="rounded-lg border border-zinc-300 bg-white p-3" aria-label="Find cards">
              <div className="flex min-h-8 items-center justify-between gap-2">
                <label className="text-sm font-bold" htmlFor="owned-card-search">Card name or set code</label>
                <button type="button" aria-haspopup="dialog" title={activeRarity || "Filter rarity"} className="relative inline-flex shrink-0 items-center gap-1.5 rounded-md py-1 text-sm font-semibold text-zinc-600 after:absolute after:-inset-y-2 after:inset-x-0 hover:text-[#8a1f2d] focus-visible:outline-2 focus-visible:outline-[#8a1f2d]" onClick={() => setFilterOpen(true)}><SlidersHorizontal className="size-3.5" />Filter rarity{activeRarity ? <span aria-label={`Active rarity: ${activeRarity}`} className="size-1.5 rounded-full bg-[#8a1f2d]" /> : null}</button>
              </div>
              <div className="relative"><Search className="pointer-events-none absolute left-3 top-4 size-5 text-zinc-400" /><input autoComplete="off" className={`${fieldClass} pl-10`} id="owned-card-search" maxLength={200} onChange={(event) => changeQuery(event.target.value)} placeholder="e.g. Blue-Eyes, LOB-001, RA02 ultra rare" ref={searchRef} value={query} /></div>
              {rarity === undefined && results.data?.detectedRarity ? <div className="mt-2 flex flex-wrap items-center gap-2">
                {rarity === undefined && results.data?.detectedRarity ? <button className="inline-flex min-h-11 items-center gap-1 rounded-full bg-rose-50 px-3 text-xs font-bold text-[#8a1f2d]" onClick={() => { setRarity(""); setPage(1); }} type="button" aria-label="Remove detected rarity filter">{results.data.detectedRarity}<X className="size-3" /></button> : null}
              </div> : null}
              <div className="mt-2" aria-live="polite">
                {searching ? <p className="flex items-center gap-2 text-sm text-zinc-500"><Loader2 className="size-4 animate-spin" /> Searching cards…</p> : results.isError ? <div role="alert"><p className="text-sm text-rose-700">{results.error.message}</p><button className={secondaryButton + " mt-3"} onClick={() => void results.refetch()} type="button">Retry search</button></div> : !results.data?.status.ready ? <p className="text-sm text-zinc-600">The card catalogue is being prepared. Please try again shortly.</p> : !searchText && !rarity ? <p className="text-sm text-zinc-500">Start with a name or the code printed below the artwork.</p> : <p className="text-sm text-zinc-500">{results.data.total} matching {results.data.total === 1 ? "printing" : "printings"}{!products.length ? ". Try a shorter name, another set code or remove the rarity filter." : " · Choose the one you own."}</p>}
              </div>
              {results.data?.status.stale ? <p className="mt-2 text-xs text-amber-800">Showing the last saved catalogue. Recently released cards may be missing.</p> : null}
              {!searching && !results.isError && (searchText || rarity) ? <ul className="mt-3 max-h-72 md:max-h-[calc(100dvh-310px)] overflow-y-auto overscroll-contain divide-y divide-zinc-200">{products.map((product) => <li key={product.productId}><button aria-label={`Choose ${product.name}, ${product.setCode}, ${product.rarity}`} className={`flex w-full items-center gap-2 rounded-md px-1 py-2 text-left transition hover:bg-rose-50 focus-visible:outline-2 focus-visible:outline-[#8a1f2d] ${selected?.productId === product.productId ? "bg-rose-50" : ""}`} onClick={() => choose(product)} type="button"><CardArtwork product={product} /><span className="min-w-0 flex-1"><span className="line-clamp-2 text-sm font-bold leading-5">{product.name}</span><span className="block truncate text-xs leading-5 text-zinc-500" title={product.setName}>{product.setName}</span><span className="mt-1 block text-xs font-semibold text-[#8a1f2d]">{product.setCode} · {product.rarity}</span>{cataloguePriceLabel(product.marketPricesUsdCents) ? <span className="mt-0.5 block text-xs tabular-nums text-zinc-500" title={`TCGplayer market estimate via TCGCSV (USD), not condition-specific. ${Object.entries(product.marketPricesUsdCents ?? {}).map(([edition, cents]) => edition + ": US$" + (cents / 100).toFixed(2)).join(" · ")}`}>TCGplayer · {cataloguePriceLabel(product.marketPricesUsdCents)}</span> : null}</span><Plus className="mr-2 size-4 shrink-0" /></button></li>)}</ul> : null}
              {(results.data?.pageCount ?? 0) > 1 ? <div className="mt-3 flex items-center justify-between"><button aria-label="Previous results" className={secondaryButton} disabled={page === 1 || searching} onClick={() => setPage(page - 1)} type="button"><ChevronLeft className="size-4" /></button><span className="text-xs text-zinc-500">Page {page} of {results.data?.pageCount}</span><button aria-label="Next results" className={secondaryButton} disabled={page >= (results.data?.pageCount ?? 1) || searching} onClick={() => setPage(page + 1)} type="button"><ChevronRight className="size-4" /></button></div> : null}
            </section>
          </div>
          <div className="min-w-0 space-y-3 md:sticky md:top-3">
          <section aria-label="Cards to add" className="min-w-0 rounded-lg border border-zinc-300 bg-white p-3">
            <div className="flex items-baseline justify-between gap-2"><h2 className="text-lg font-bold">Your cards</h2><div className="flex items-center gap-2">{draft.cards.length ? <button type="button" className="min-h-11 px-2 text-xs text-zinc-500 hover:text-rose-800" onClick={() => setClearOpen(true)}>Clear all</button> : null}<span className="text-sm font-semibold text-zinc-500">{totalQuantity} {totalQuantity === 1 ? "copy" : "copies"}</span></div></div>
            <p className="mt-1 text-xs leading-5 text-zinc-500">Matching copies combine automatically.</p>
            {draft.cards.length ? <div className="relative mt-2"><Search className="pointer-events-none absolute left-2 top-3 size-4 text-zinc-400" /><input aria-label="Search your cards" placeholder="Search your cards" value={queueQuery} onChange={(event) => { setQueueQuery(event.target.value); setQueuePage(1); }} className="h-10 w-full rounded-md border border-zinc-200 bg-zinc-50 pl-8 pr-2 text-sm outline-none focus:border-[#8a1f2d]" /></div> : null}
            {!draft.cards.length ? <div className="my-3 rounded-md border border-dashed border-zinc-300 px-3 py-5 text-center text-sm text-zinc-500">Choose a printing to start your list.</div> : <ul className="mt-3 grid grid-cols-4 gap-2">{visibleQueueCards.map((card) => {
              const key = ownedCardVariantKey(card);
              const description = `${card.name}, ${card.setCode}, ${card.rarity}, ${card.edition}, ${card.condition}, ${card.quantity} to add`;
              return <li className="min-w-0" key={key}>
                <button aria-label={`Edit ${description}`} title={description} className="group relative block w-full overflow-hidden rounded-md text-left shadow-sm ring-1 ring-zinc-200 transition hover:ring-[#8a1f2d] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8a1f2d]" onClick={() => editCard(card)} type="button">
                  <CardArtwork product={card} tile />
                  <span className="absolute right-1 top-1 rounded bg-zinc-950/85 px-1 py-0.5 text-[10px] font-bold tabular-nums text-white">+{card.quantity}</span>
                  <span className="absolute inset-x-0 bottom-0 bg-zinc-950/85 px-1 py-1 text-white">
                    <span className="block text-[10px] font-bold leading-3">{rarityAbbreviation(card.rarity)}</span>
                    <span className="block truncate text-[9px] font-medium leading-3">{card.setCode}</span>
                  </span>
                </button>
              </li>;
            })}</ul>}
            {draft.cards.length && !queueCards.length ? <p className="py-4 text-center text-sm text-zinc-500">No cards match your search.</p> : null}
            {queuePages > 1 ? <nav aria-label="Your cards pages" className="flex items-center justify-between border-t border-zinc-100 pt-1"><button type="button" aria-label="Previous cards" className={secondaryButton} disabled={currentQueuePage === 1} onClick={() => setQueuePage(currentQueuePage - 1)}><ChevronLeft className="size-4" /></button><span className="text-xs text-zinc-500">{currentQueuePage} / {queuePages}</span><button type="button" aria-label="Next cards" className={secondaryButton} disabled={currentQueuePage === queuePages} onClick={() => setQueuePage(currentQueuePage + 1)}><ChevronRight className="size-4" /></button></nav> : null}
            <details className="mt-2 border-t border-zinc-200 pt-3"><summary className="cursor-pointer text-sm font-bold">Acquisition details <span className="font-normal text-zinc-500">(optional)</span></summary><div className="mt-3 space-y-3"><label className="block text-sm font-semibold">Date added<input className={fieldClass} onChange={(event) => setDraft({ ...draft, date: event.target.value })} type="date" value={draft.date} /></label><label className="block text-sm font-semibold">Source<input className={fieldClass} maxLength={120} onChange={(event) => setDraft({ ...draft, source: event.target.value })} placeholder="e.g. Existing collection, gift" value={draft.source} /></label><label className="block text-sm font-semibold">Notes<textarea className={textAreaClass} maxLength={4000} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} value={draft.notes} /></label><p className="text-xs leading-5 text-zinc-500">Purchase cost stays unknown. Use Record purchase when you want to track money paid.</p></div></details>
            <button className={`${primaryButton} mt-3 w-full`} disabled={!draft.cards.length || saving || Boolean(selected)} onClick={() => void save()} type="button">{saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}{saving ? "Adding cards…" : `Add ${totalQuantity || ""} ${totalQuantity === 1 ? "card" : "cards"} to collection`}</button>
            {selected ? <p className="mt-2 text-xs text-amber-800">Add the selected printing to your list, or cancel it before saving.</p> : null}
            <p className="mt-2 text-center text-xs leading-5 text-zinc-500">You can add photos and list these cards on eBay from Inventory.</p>
          </section>
          </div>
        </fieldset>
            {selected ? <OwnedDialog title="Selected printing" onClose={() => { setSelected(null); setMessage(null); }}>
              <div className="flex gap-2"><CardArtwork product={selected} small /><div className="min-w-0 flex-1"><h2 className="line-clamp-2 text-sm font-bold leading-5">{selected.name}</h2><p className="mt-1 text-xs text-zinc-500">{selected.setCode} · {selected.rarity}</p></div></div>
              <div className="mt-3 grid grid-cols-2 gap-2"><CompactPicklist inlineOptions label="Edition" value={edition} values={editions} onChange={(value) => changeVariant(value as ProductEdition, condition)} /><CompactPicklist inlineOptions label="Condition" value={condition} values={[...cardConditions]} onChange={(value) => changeVariant(edition, value as CardCondition)} /></div>
              <p className="mt-3 text-sm font-semibold text-zinc-700">Already owned: {selectedOwned}</p>
              {selectedAllCopies.length !== selectedOwned ? <p className="mt-1 text-xs text-zinc-600">{selectedAllCopies.length} owned across conditions: {selectedConditionCounts}. Quantity below is for {condition}.</p> : null}
              <p className="mt-1 text-xs text-zinc-500">Set the total you want to own. {selectedAdditional > 0 ? `${selectedAdditional} new ${selectedAdditional === 1 ? "copy" : "copies"} will be added.` : "No new copies to add."}</p>
              <div className="mt-2 flex flex-wrap gap-2"><QuantityStepper label="Quantity" value={Number(quantity)} min={Math.max(1, selectedOwned)} max={Math.max(1, selectedOwned + 1000 - totalQuantity + selectedQueued + editingOtherQuantity)} onChange={(value) => setQuantity(String(value))} /><button className={`${primaryButton} flex-1`} onClick={addSelection} type="button"><Plus className="size-4" /> {editingKey ? "Save changes" : selectedAdditional > 0 ? "Add to list" : "Done"}</button></div>
            {editingKey ? <button type="button" className="mt-3 inline-flex min-h-11 items-center gap-2 text-xs font-semibold text-rose-700 hover:text-rose-900" onClick={() => { setDraft({ ...draft, cards: draft.cards.filter((card) => ownedCardVariantKey(card) !== editingKey) }); setSelected(null); setEditingKey(null); setMessage(null); }}><Trash2 className="size-3.5" />Remove from list</button> : null}
            {message ? <p className="mt-3 text-sm text-rose-800" role="alert">{message}</p> : null}</OwnedDialog> : null}

        {filterOpen ? <OwnedDialog title="Filter rarity" onClose={() => setFilterOpen(false)}>
          <div className="grid gap-1">{["", ...Array.from(new Set([...(results.data?.rarities ?? []), ...(activeRarity ? [activeRarity] : [])]))].map((value) => <button type="button" key={value} aria-pressed={activeRarity === value} className={`flex min-h-11 items-center justify-between rounded-md px-3 text-left text-sm hover:bg-rose-50 ${activeRarity === value ? "bg-rose-50 font-bold text-[#8a1f2d]" : ""}`} onClick={() => { setRarity(value); setPage(1); setFilterOpen(false); }}>{value || "All rarities"}{activeRarity === value ? <Check className="size-4" /> : null}</button>)}</div>
        </OwnedDialog> : null}
        {clearOpen ? <OwnedDialog title="Clear your card list?" onClose={() => setClearOpen(false)}>
          <p className="text-sm text-zinc-600">Remove all {totalQuantity} copies from this unsaved list? Cards already in your collection stay saved.</p>
          <div className="mt-5 flex justify-end gap-2"><button className={secondaryButton} type="button" onClick={() => setClearOpen(false)}>Keep cards</button><button className={primaryButton} type="button" onClick={() => { setDraft({ ...draft, cards: [] }); setQueueQuery(""); setQueuePage(1); setClearOpen(false); }}>Clear list</button></div>
        </OwnedDialog> : null}
        {message && !selected ? <p className="sticky bottom-4 rounded-lg border border-rose-300 bg-rose-50 p-4 text-sm font-semibold text-rose-800 shadow-sm" role="alert">{message}</p> : null}
      </>}
    </div>
  </main>;
}

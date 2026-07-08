"use client";

import type { inferRouterOutputs } from "@trpc/server";
import {
  ArrowLeftRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Info,
  Loader2,
  RotateCcw,
  Search,
  X,
} from "lucide-react";
import {
  type DragEvent,
  type FormEvent,
  type MouseEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { PageFlip } from "page-flip";
import { AppHeader } from "@/components/app-header";
import { CardNoteIndicator } from "@/components/card-note-indicator";
import { DataLoadError } from "@/components/data-load-error";
import {
  rarityAbbreviation,
  rarityAbbreviations,
} from "@/lib/rarity-abbreviations";
import type { AppRouter } from "@/server/root";
import { trpc } from "@/trpc/client";

type Card = inferRouterOutputs<AppRouter>["cards"]["binderList"][number];
type CardTypeFilter =
  | "monster"
  | "normal"
  | "effect"
  | "fusion"
  | "synchro"
  | "xyz"
  | "link"
  | "ritual"
  | "pendulum"
  | "tuner"
  | "spell"
  | "trap"
  | "token";

const pageCount = 40;
const slotsPerPage = 9;
const stagingPageSize = 8;
const cardTypeFilters: { label: string; value: CardTypeFilter }[] = [
  { label: "Monster", value: "monster" },
  { label: "Normal", value: "normal" },
  { label: "Effect", value: "effect" },
  { label: "Fusion", value: "fusion" },
  { label: "Synchro", value: "synchro" },
  { label: "Xyz", value: "xyz" },
  { label: "Link", value: "link" },
  { label: "Ritual", value: "ritual" },
  { label: "Pendulum", value: "pendulum" },
  { label: "Tuner", value: "tuner" },
  { label: "Spell", value: "spell" },
  { label: "Trap", value: "trap" },
  { label: "Token", value: "token" },
];

function slotKey(pageIndex: number, slotIndex: number) {
  return `${pageIndex}:${slotIndex}`;
}

function statusLabel(card: Card) {
  return card.status === "owned" ? "Owned" : "Want";
}

function proxiedImageUrl(url: string) {
  return `/api/image-proxy?url=${encodeURIComponent(url)}`;
}

function clampPageIndex(pageIndex: number) {
  return Math.min(Math.max(pageIndex, 0), pageCount - 1);
}

function parsePageNumber(value: string) {
  const pageNumber = Number(value);

  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pageCount) {
    return null;
  }

  return pageNumber;
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-GB", {
    currency: "GBP",
    maximumFractionDigits: 0,
    style: "currency",
  }).format(value);
}

function estimatedPrice(card: Card) {
  const match = (card.marketPriceText ?? card.priceText)?.match(
    /£?\s?([\d,]+(?:\.\d{1,2})?)/,
  );

  if (!match) {
    return 0;
  }

  return Number(match[1].replace(/,/g, "")) || 0;
}

function cardMatchesType(card: Card, filter: CardTypeFilter) {
  const type = card.cardType?.toLowerCase() ?? "";

  if (!type) {
    return false;
  }

  if (filter === "monster") {
    return type.includes("monster");
  }

  if (filter === "spell") {
    return type.includes("spell");
  }

  if (filter === "trap") {
    return type.includes("trap");
  }

  return type.includes(filter);
}

function cardMatchesTypes(card: Card, filters: CardTypeFilter[]) {
  if (!filters.length) {
    return true;
  }

  return filters.some((filter) => cardMatchesType(card, filter));
}

function pageFlipIndexForPage(pageIndex: number) {
  return clampPageIndex(pageIndex) + 2;
}

function pageIndexFromPageFlipIndex(pageFlipIndex: number) {
  if (pageFlipIndex <= 1) {
    return 0;
  }

  return clampPageIndex(pageFlipIndex - 2);
}

function buildFrontCoverElement(plannedCards: number) {
  const page = document.createElement("section");
  page.className = "binder-v2-page binder-v2-cover-page";

  const content = document.createElement("div");
  content.className = "binder-v2-cover-content";

  const eyebrow = document.createElement("p");
  eyebrow.className = "binder-v2-cover-eyebrow";
  eyebrow.textContent = "Yu-Gi-Oh!";
  content.appendChild(eyebrow);

  const title = document.createElement("p");
  title.className = "binder-v2-cover-title";
  title.textContent = "Binder";
  content.appendChild(title);

  const count = document.createElement("p");
  count.className = "binder-v2-cover-count";
  count.textContent = `${plannedCards} cards planned`;
  content.appendChild(count);

  page.appendChild(content);
  return page;
}

function buildBlankPageElement() {
  const page = document.createElement("section");
  page.className = "binder-v2-page binder-v2-page-blank";
  page.dataset.blankPage = "true";

  const inner = document.createElement("div");
  inner.className = "binder-v2-inside-cover";
  page.appendChild(inner);

  return page;
}

function buildPageElement({
  cardById,
  dimWishlistCards,
  highlightedCardId,
  layout,
  pageIndex,
  pageTotals,
}: {
  cardById: Map<number, Card>;
  dimWishlistCards: boolean;
  highlightedCardId: number | null;
  layout: Map<string, { cardId: number }>;
  pageIndex: number;
  pageTotals: Map<number, { owned: number; wishlist: number }>;
}) {
  const page = document.createElement("section");
  page.className = "binder-v2-page";
  page.dataset.pageIndex = String(pageIndex);

  const header = document.createElement("div");
  header.className = "binder-v2-page-header";
  header.textContent = `Page ${pageIndex + 1}`;
  page.appendChild(header);

  const grid = document.createElement("div");
  grid.className = "binder-v2-pocket-grid";
  page.appendChild(grid);

  for (let slotIndex = 0; slotIndex < slotsPerPage; slotIndex += 1) {
    const slot = document.createElement("button");
    slot.className = "binder-v2-pocket";
    slot.dataset.pageIndex = String(pageIndex);
    slot.dataset.slotIndex = String(slotIndex);
    slot.type = "button";

    const label = document.createElement("span");
    label.className = "binder-v2-slot-label";
    label.textContent = `${String(pageIndex + 1).padStart(2, "0")}.${slotIndex + 1}`;
    slot.appendChild(label);

    const savedSlot = layout.get(slotKey(pageIndex, slotIndex));
    const card = savedSlot ? cardById.get(savedSlot.cardId) : null;

    if (card) {
      slot.dataset.cardId = String(card.id);
      slot.draggable = true;
      slot.classList.add("is-filled");

      if (dimWishlistCards && card.status === "wishlist") {
        slot.classList.add("is-wishlist-dimmed");
      }

      if (highlightedCardId === card.id) {
        slot.classList.add("is-found");
      }

      if (card.imageUrl) {
        const image = document.createElement("img");
        image.alt = card.name;
        image.draggable = false;
        image.src = proxiedImageUrl(card.imageUrl);
        slot.appendChild(image);
      }

      const badge = document.createElement("span");
      badge.className =
        card.status === "owned"
          ? "binder-v2-card-badge is-owned"
          : "binder-v2-card-badge is-want";
      badge.textContent = statusLabel(card);
      slot.appendChild(badge);

      const rarityCode = rarityAbbreviation(card.rarity);

      if (rarityCode) {
        const rarityBadge = document.createElement("span");
        rarityBadge.className = "binder-v2-rarity-badge";
        rarityBadge.textContent = rarityCode;
        rarityBadge.title = card.rarity ?? rarityCode;
        rarityBadge.setAttribute("aria-label", card.rarity ?? rarityCode);
        slot.appendChild(rarityBadge);
      }

      const title = document.createElement("span");
      title.className = "binder-v2-card-title";
      title.textContent = card.name;
      slot.appendChild(title);
    }

    grid.appendChild(slot);
  }

  const totals = pageTotals.get(pageIndex) ?? { owned: 0, wishlist: 0 };
  const footer = document.createElement("div");
  footer.className = "binder-v2-page-value";

  const ownedValue = document.createElement("span");
  ownedValue.className = "is-owned";
  ownedValue.textContent = `Owned ${formatMoney(totals.owned)}`;
  footer.appendChild(ownedValue);

  const wishlistValue = document.createElement("span");
  wishlistValue.className = "is-wishlist";
  wishlistValue.textContent = `Wishlist ${formatMoney(totals.wishlist)}`;
  footer.appendChild(wishlistValue);

  page.appendChild(footer);

  return page;
}

function PageValuePills({
  className = "",
  owned,
  wishlist,
}: {
  className?: string;
  owned: number;
  wishlist: number;
}) {
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-black uppercase leading-none tracking-[0.08em] text-emerald-700">
        Owned {formatMoney(owned)}
      </span>
      <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] font-black uppercase leading-none tracking-[0.08em] text-rose-700">
        Wishlist {formatMoney(wishlist)}
      </span>
    </div>
  );
}

function RarityLegendPopover() {
  return (
    <span className="group/rarity relative z-30 inline-flex">
      <button
        aria-label="View rarity abbreviation guide"
        className="inline-flex size-9 items-center justify-center rounded-md border border-amber-200 bg-amber-50 text-amber-700 shadow-[0_1px_0_rgba(0,0,0,0.03)] transition hover:border-amber-300 hover:bg-amber-100 hover:text-amber-800 focus-visible:bg-amber-100"
        title="Rarity abbreviation guide"
        type="button"
      >
        <Info aria-hidden="true" className="size-3.5" />
      </button>
      <span
        className="pointer-events-none absolute right-0 top-full mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-zinc-200 bg-white p-3 text-left opacity-0 shadow-xl ring-1 ring-black/5 transition duration-150 group-hover/rarity:pointer-events-auto group-hover/rarity:translate-y-0 group-hover/rarity:opacity-100 group-focus-within/rarity:pointer-events-auto group-focus-within/rarity:translate-y-0 group-focus-within/rarity:opacity-100"
        role="tooltip"
      >
        <span className="block text-[10px] font-black uppercase tracking-[0.16em] text-[#8a1f2d]">
          Rarity guide
        </span>
        <span className="mt-2 grid max-h-72 grid-cols-1 gap-1 overflow-y-auto pr-1 sm:grid-cols-2">
          {rarityAbbreviations.map((entry) => (
            <span
              className="flex items-center gap-2 rounded border border-zinc-100 bg-zinc-50 px-2 py-1"
              key={entry.rarity}
            >
              <span className="min-w-12 rounded bg-zinc-950 px-1.5 py-1 text-center text-[10px] font-black uppercase tracking-[0.08em] text-white">
                {entry.abbreviation}
              </span>
              <span className="min-w-0 truncate text-xs font-semibold text-zinc-700">
                {entry.rarity}
              </span>
            </span>
          ))}
        </span>
      </span>
    </span>
  );
}

export function BinderV2App() {
  const bookHostRef = useRef<HTMLDivElement | null>(null);
  const pageFlipRef = useRef<PageFlip | null>(null);
  const [selectedCardId, setSelectedCardId] = useState<number | null>(null);
  const [draggedCardId, setDraggedCardId] = useState<number | null>(null);
  const [finderQuery, setFinderQuery] = useState("");
  const [highlightedCardId, setHighlightedCardId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [typeFilters, setTypeFilters] = useState<CardTypeFilter[]>([]);
  const [closed, setClosed] = useState(false);
  const [dimWishlistCards, setDimWishlistCards] = useState(true);
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [swapModalOpen, setSwapModalOpen] = useState(false);
  const [swapFromPage, setSwapFromPage] = useState("1");
  const [swapToPage, setSwapToPage] = useState("2");
  const [swapError, setSwapError] = useState("");
  const [isNarrowViewport, setIsNarrowViewport] = useState(() =>
    typeof window === "undefined"
      ? false
      : Math.min(window.innerWidth, window.screen.width) < 768,
  );
  const [stagingPage, setStagingPage] = useState(1);
  const [currentPage, setCurrentPage] = useState(0);
  const [pageInput, setPageInput] = useState("1");
  const currentPageRef = useRef(0);
  const utils = trpc.useUtils();
  const cardsQuery = trpc.cards.binderList.useQuery(undefined, {
    staleTime: 30_000,
  });
  const layoutQuery = trpc.binder.layout.useQuery();
  const setSlot = trpc.binder.setSlot.useMutation({
    onSuccess: () => void utils.binder.layout.invalidate(),
  });
  const clearSlot = trpc.binder.clearSlot.useMutation({
    onSuccess: () => void utils.binder.layout.invalidate(),
  });
  const clearCard = trpc.binder.clearCard.useMutation({
    onSuccess: () => void utils.binder.layout.invalidate(),
  });
  const clearAll = trpc.binder.clearAll.useMutation({
    onSuccess: () => void utils.binder.layout.invalidate(),
  });
  const swapPages = trpc.binder.swapPages.useMutation({
    onSuccess: () => void utils.binder.layout.invalidate(),
  });

  const allCards = useMemo(
    () => [...(cardsQuery.data ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [cardsQuery.data],
  );
  const cardById = useMemo(
    () => new Map(allCards.map((card) => [card.id, card])),
    [allCards],
  );
  const layout = useMemo(
    () =>
      new Map(
        (layoutQuery.data ?? []).map((slot) => [
          slotKey(slot.pageIndex, slot.slotIndex),
          slot,
        ]),
      ),
    [layoutQuery.data],
  );
  const layoutByCardId = useMemo(
    () => new Map((layoutQuery.data ?? []).map((slot) => [slot.cardId, slot])),
    [layoutQuery.data],
  );
  const usedIds = useMemo(
    () => new Set((layoutQuery.data ?? []).map((slot) => slot.cardId)),
    [layoutQuery.data],
  );
  const stagingCards = useMemo(
    () => allCards.filter((card) => !usedIds.has(card.id)),
    [allCards, usedIds],
  );
  const finderResults = useMemo(() => {
    const search = finderQuery.toLowerCase().trim();

    if (!search) {
      return [];
    }

    return allCards
      .filter((card) =>
        [card.name, card.rarity, card.status, card.cardType].some((value) =>
          value?.toLowerCase().includes(search),
        ),
      )
      .slice(0, 8);
  }, [allCards, finderQuery]);
  const pageTotals = useMemo(() => {
    const totals = new Map<number, { owned: number; wishlist: number }>();

    for (const slot of layoutQuery.data ?? []) {
      const card = cardById.get(slot.cardId);

      if (!card) {
        continue;
      }

      const current = totals.get(slot.pageIndex) ?? { owned: 0, wishlist: 0 };
      const price = estimatedPrice(card);

      if (card.status === "owned") {
        current.owned += price;
      } else {
        current.wishlist += price;
      }

      totals.set(slot.pageIndex, current);
    }

    return totals;
  }, [cardById, layoutQuery.data]);
  const pageCardCounts = useMemo(() => {
    const counts = new Map<number, number>();

    for (const slot of layoutQuery.data ?? []) {
      counts.set(slot.pageIndex, (counts.get(slot.pageIndex) ?? 0) + 1);
    }

    return counts;
  }, [layoutQuery.data]);
  const filteredCards = useMemo(() => {
    const search = query.toLowerCase().trim();

    return stagingCards.filter((card) =>
      cardMatchesTypes(card, typeFilters) &&
      (!search ||
        [card.name, card.rarity, card.status, card.cardType].some((value) =>
          value?.toLowerCase().includes(search),
        )),
    );
  }, [query, stagingCards, typeFilters]);
  const stagingPageCount = Math.max(
    1,
    Math.ceil(filteredCards.length / stagingPageSize),
  );
  const currentStagingPage = Math.min(stagingPage, stagingPageCount);
  const paginatedCards = filteredCards.slice(
    (currentStagingPage - 1) * stagingPageSize,
    currentStagingPage * stagingPageSize,
  );
  const selectedCard = selectedCardId ? cardById.get(selectedCardId) ?? null : null;
  const plannedCards = layoutQuery.data?.length ?? 0;
  const binderBusy =
    setSlot.isPending ||
    clearSlot.isPending ||
    clearCard.isPending ||
    clearAll.isPending ||
    swapPages.isPending;

  useEffect(() => {
    function updateViewportMode() {
      setIsNarrowViewport(Math.min(window.innerWidth, window.screen.width) < 768);
    }

    updateViewportMode();
    window.addEventListener("resize", updateViewportMode);

    return () => window.removeEventListener("resize", updateViewportMode);
  }, []);

  useEffect(() => {
    if (isNarrowViewport) {
      pageFlipRef.current?.destroy();
      pageFlipRef.current = null;
      return;
    }

    const host = bookHostRef.current;

    if (!host || cardsQuery.isLoading || layoutQuery.isLoading) {
      return;
    }

    const pageElements = [
      buildFrontCoverElement(plannedCards),
      buildBlankPageElement(),
      ...Array.from({ length: pageCount }, (_, pageIndex) =>
        buildPageElement({
          cardById,
          dimWishlistCards,
          highlightedCardId,
          layout,
          pageIndex,
          pageTotals,
        }),
      ),
      buildBlankPageElement(),
    ];

    host.replaceChildren();
    const bookRoot = document.createElement("div");
    bookRoot.className = "binder-v2-pageflip-root";
    host.appendChild(bookRoot);
    bookRoot.replaceChildren(...pageElements);

    const pageFlip = new PageFlip(bookRoot, {
      autoSize: true,
      clickEventForward: true,
      disableFlipByClick: true,
      drawShadow: true,
      flippingTime: 950,
      height: isNarrowViewport ? 520 : 620,
      maxHeight: isNarrowViewport ? 620 : 760,
      maxShadowOpacity: 0.42,
      maxWidth: isNarrowViewport ? 360 : 500,
      minHeight: isNarrowViewport ? 420 : 420,
      minWidth: isNarrowViewport ? 260 : 280,
      mobileScrollSupport: false,
      showCover: true,
      showPageCorners: true,
      size: "stretch",
      startPage: closed ? 0 : pageFlipIndexForPage(currentPageRef.current),
      useMouseEvents: false,
      usePortrait: isNarrowViewport,
      width: isNarrowViewport ? 330 : 430,
    });

    pageFlip.on("flip", (event) => {
      if (typeof event.data === "number") {
        if (event.data === 0) {
          setClosed(true);
          currentPageRef.current = 0;
          setCurrentPage(0);
          setPageInput("1");
          return;
        }

        const nextPage = pageIndexFromPageFlipIndex(event.data);
        setClosed(false);
        currentPageRef.current = nextPage;
        setCurrentPage(nextPage);
        setPageInput(String(nextPage + 1));
      }
    });
    pageFlip.loadFromHTML(pageElements);
    pageFlipRef.current = pageFlip;

    return () => {
      pageFlipRef.current = null;
      pageFlip.destroy();
      if (bookRoot.parentElement === host) {
        bookRoot.remove();
      }
    };
  }, [
    cardById,
    cardsQuery.isLoading,
    closed,
    dimWishlistCards,
    highlightedCardId,
    isNarrowViewport,
    layout,
    layoutQuery.isLoading,
    plannedCards,
    pageTotals,
  ]);

  function placeCard(pageIndex: number, slotIndex: number, cardId: number) {
    setSlot.mutate({ cardId, pageIndex, slotIndex });
    setSelectedCardId(null);
  }

  function removeCardFromBinder(cardId: number | null = draggedCardId) {
    if (!cardId) {
      return;
    }

    clearCard.mutate({ cardId });
    setDraggedCardId(null);
    setSelectedCardId(null);
  }

  function toggleTypeFilter(type: CardTypeFilter) {
    setTypeFilters((current) =>
      current.includes(type)
        ? current.filter((selectedType) => selectedType !== type)
        : [...current, type],
    );
    setStagingPage(1);
  }

  function stagingPageForCard(cardId: number) {
    const index = stagingCards.findIndex((card) => card.id === cardId);
    return index >= 0 ? Math.floor(index / stagingPageSize) + 1 : 1;
  }

  function locationLabel(card: Card) {
    const slot = layoutByCardId.get(card.id);

    if (slot) {
      return `Binder page ${slot.pageIndex + 1}, slot ${String(slot.pageIndex + 1).padStart(2, "0")}.${slot.slotIndex + 1}`;
    }

    return `Staging page ${stagingPageForCard(card.id)}`;
  }

  function jumpToCard(card: Card) {
    const slot = layoutByCardId.get(card.id);
    setFinderQuery("");
    setDraggedCardId(null);

    if (slot) {
      setQuery("");
      setSelectedCardId(null);
      setHighlightedCardId(card.id);
      setClosed(false);
      goToPage(slot.pageIndex);
      return;
    }

    setHighlightedCardId(null);
    setSelectedCardId(card.id);
    setTypeFilters([]);
    setQuery("");
    setStagingPage(stagingPageForCard(card.id));
  }

  function handleSlotClick(event: MouseEvent<HTMLDivElement>) {
    const slot = (event.target as HTMLElement).closest<HTMLButtonElement>(
      "[data-page-index][data-slot-index]",
    );

    if (!slot) {
      return;
    }

    const pageIndex = Number(slot.dataset.pageIndex);
    const slotIndex = Number(slot.dataset.slotIndex);
    const cardId = slot.dataset.cardId ? Number(slot.dataset.cardId) : null;

    if (selectedCard) {
      placeCard(pageIndex, slotIndex, selectedCard.id);
      return;
    }

    if (cardId) {
      clearSlot.mutate({ pageIndex, slotIndex });
    }
  }

  function handleSlotDragStart(event: DragEvent<HTMLDivElement>) {
    const slot = (event.target as HTMLElement).closest<HTMLButtonElement>(
      "[data-card-id]",
    );

    if (!slot?.dataset.cardId) {
      return;
    }

    event.stopPropagation();
    setDraggedCardId(Number(slot.dataset.cardId));
  }

  function handleBookDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const slot = (event.target as HTMLElement).closest<HTMLButtonElement>(
      "[data-page-index][data-slot-index]",
    );

    if (!slot || !draggedCardId) {
      return;
    }

    placeCard(Number(slot.dataset.pageIndex), Number(slot.dataset.slotIndex), draggedCardId);
    setDraggedCardId(null);
  }

  function clearBinder() {
    clearAll.mutate();
    setSelectedCardId(null);
    setResetModalOpen(false);
  }

  function openSwapModal() {
    const fromPage = currentPage + 1;
    const toPage = fromPage >= pageCount ? fromPage - 1 : fromPage + 1;
    setSwapFromPage(String(fromPage));
    setSwapToPage(String(Math.max(1, Math.min(pageCount, toPage))));
    setSwapError("");
    setSwapModalOpen(true);
  }

  function swapPageSummary(pageNumber: number | null) {
    if (!pageNumber) {
      return null;
    }

    const pageIndex = pageNumber - 1;
    return {
      cards: pageCardCounts.get(pageIndex) ?? 0,
      totals: pageTotals.get(pageIndex) ?? { owned: 0, wishlist: 0 },
    };
  }

  function swapBinderPages(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const sourcePageNumber = parsePageNumber(swapFromPage);
    const targetPageNumber = parsePageNumber(swapToPage);

    if (!sourcePageNumber || !targetPageNumber) {
      setSwapError(`Use page numbers from 1 to ${pageCount}.`);
      return;
    }

    if (sourcePageNumber === targetPageNumber) {
      setSwapError("Pick two different pages to swap.");
      return;
    }

    setSwapError("");
    swapPages.mutate(
      {
        sourcePageIndex: sourcePageNumber - 1,
        targetPageIndex: targetPageNumber - 1,
      },
      {
        onSuccess: () => {
          setSwapModalOpen(false);
          goToPage(sourcePageNumber - 1);
        },
      },
    );
  }

  function goToPage(pageIndex: number) {
    const nextPage = clampPageIndex(pageIndex);
    currentPageRef.current = nextPage;
    setCurrentPage(nextPage);
    setPageInput(String(nextPage + 1));
    setClosed(false);

    if (!isNarrowViewport) {
      pageFlipRef.current?.turnToPage(pageFlipIndexForPage(nextPage));
    }
  }

  function handlePageJump(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const pageNumber = Number(pageInput);

    if (!Number.isFinite(pageNumber)) {
      setPageInput(String(currentPage + 1));
      return;
    }

    goToPage(pageNumber - 1);
  }

  function previousPage() {
    if (closed) {
      return;
    }

    if (isNarrowViewport) {
      if (currentPage <= 0) {
        setClosed(true);
        return;
      }

      goToPage(currentPage - 1);
      return;
    }

    pageFlipRef.current?.flipPrev("top");
  }

  function nextPage() {
    if (isNarrowViewport) {
      if (closed) {
        setClosed(false);
        goToPage(0);
        return;
      }

      goToPage(Math.min(pageCount - 1, currentPage + 1));
      return;
    }

    if (closed) {
      pageFlipRef.current?.flipNext("top");
      return;
    }

    pageFlipRef.current?.flipNext("top");
  }

  function mobileSlot(slotIndex: number) {
    const slot = layout.get(slotKey(currentPage, slotIndex));
    const card = slot ? cardById.get(slot.cardId) : null;
    const highlighted = card?.id === highlightedCardId;
    const rarityCode = rarityAbbreviation(card?.rarity);

    return (
      <button
        className={`relative aspect-[59/86] overflow-hidden rounded-md border text-left transition ${
          highlighted
            ? "border-[#8a1f2d] shadow-[0_0_0_2px_rgba(138,31,45,0.25)]"
            : "border-white/15"
        } ${card ? "bg-zinc-950" : "bg-white/5 hover:bg-white/10"}`}
        data-card-id={card?.id}
        data-page-index={currentPage}
        data-slot-index={slotIndex}
        draggable={Boolean(card)}
        key={slotIndex}
        type="button"
      >
        <span className="absolute left-1 top-1 z-10 rounded bg-zinc-950/75 px-1.5 py-0.5 text-[10px] font-bold text-zinc-200">
          {String(currentPage + 1).padStart(2, "0")}.{slotIndex + 1}
        </span>
        {card?.imageUrl ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              alt={card.name}
              className={`h-full w-full object-cover ${
                dimWishlistCards && card.status === "wishlist"
                  ? "grayscale opacity-45"
                  : ""
              }`}
              src={card.imageUrl}
            />
            <span
              className={`absolute right-1 top-1 z-10 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] ${
                card.status === "owned"
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-rose-50 text-rose-700"
              }`}
            >
              {statusLabel(card)}
            </span>
            {rarityCode ? (
              <span
                aria-label={card.rarity ?? rarityCode}
                className="absolute bottom-1 left-1 z-10 rounded border border-white/15 bg-zinc-950/82 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-[0.08em] text-white shadow-sm"
                title={card.rarity ?? rarityCode}
              >
                {rarityCode}
              </span>
            ) : null}
          </>
        ) : null}
      </button>
    );
  }

  const swapFromNumber = parsePageNumber(swapFromPage);
  const swapToNumber = parsePageNumber(swapToPage);
  const swapFromSummary = swapPageSummary(swapFromNumber);
  const swapToSummary = swapPageSummary(swapToNumber);
  const currentPageTotals = pageTotals.get(currentPage) ?? {
    owned: 0,
    wishlist: 0,
  };

  return (
    <main className="min-h-screen bg-[#f6f4ef] px-4 py-5 text-zinc-950 sm:px-6">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
        <AppHeader
          eyebrow="Binder planner"
          title="Page-flip binder"
          actions={
            <div className="flex items-center gap-2">
              <button
                aria-label="Clear binder"
                className="inline-flex size-10 items-center justify-center rounded-md border border-zinc-300 bg-white text-zinc-600 shadow-sm transition hover:border-zinc-950 hover:text-zinc-950 disabled:cursor-wait disabled:opacity-50"
                disabled={binderBusy}
                onClick={() => setResetModalOpen(true)}
                title="Clear binder"
                type="button"
              >
                <RotateCcw className="size-4" />
              </button>
            </div>
          }
        />

        <section className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
          <section className="min-w-0 rounded-lg border border-zinc-300 bg-white p-3 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-3">
              <button
                aria-label={currentPage <= 0 ? "Close binder" : "Previous pages"}
                className="inline-flex size-10 items-center justify-center rounded-md border border-zinc-300 text-zinc-600 transition hover:border-zinc-950 hover:text-zinc-950 disabled:opacity-40"
                disabled={closed}
                onClick={previousPage}
                title={currentPage <= 0 ? "Close binder" : "Previous pages"}
                type="button"
              >
                <ChevronLeft className="size-4" />
              </button>
              <div className="flex flex-col items-center gap-1 text-center">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-zinc-500">
                  {closed
                    ? "Closed"
                    : currentPage === 0
                      ? "Page 1"
                      : currentPage === pageCount - 1
                        ? `Page ${pageCount}`
                      : `Pages ${currentPage + 1}-${Math.min(pageCount, currentPage + 2)}`}
                </p>
                <p className="text-sm font-semibold text-zinc-950">
                  {plannedCards} / {pageCount * slotsPerPage}
                </p>
                <form
                  className="mt-1 flex items-center gap-1"
                  onSubmit={handlePageJump}
                >
                  <label className="sr-only" htmlFor="binder-page-jump">
                    Jump to binder page
                  </label>
                  <input
                    className="h-8 w-16 rounded-md border border-zinc-300 bg-white px-2 text-center text-sm font-semibold outline-none transition focus:border-[#8a1f2d]"
                    id="binder-page-jump"
                    inputMode="numeric"
                    max={pageCount}
                    min={1}
                    onChange={(event) => setPageInput(event.target.value)}
                    type="number"
                    value={pageInput}
                  />
                  <button
                    className="h-8 rounded-md border border-zinc-300 px-2 text-xs font-bold text-zinc-600 transition hover:border-zinc-950 hover:text-zinc-950"
                    type="submit"
                  >
                    Go
                  </button>
                </form>
                <button
                  className="mt-1 inline-flex min-h-11 items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-3 text-xs font-bold text-zinc-600 shadow-sm transition hover:border-zinc-950 hover:text-zinc-950 disabled:cursor-wait disabled:opacity-50"
                  disabled={binderBusy}
                  onClick={openSwapModal}
                  type="button"
                >
                  <ArrowLeftRight className="size-3.5" />
                  Swap pages
                </button>
              </div>
              <button
                aria-label={closed ? "Open binder" : "Next pages"}
                className="inline-flex size-10 items-center justify-center rounded-md border border-zinc-300 text-zinc-600 transition hover:border-zinc-950 hover:text-zinc-950 disabled:opacity-40"
                disabled={!closed && currentPage >= pageCount - 1}
                onClick={nextPage}
                title={closed ? "Open binder" : "Next pages"}
                type="button"
              >
                <ChevronRight className="size-4" />
              </button>
            </div>

            <div
              className="binder-v2-book-shell relative min-h-[560px] overflow-hidden rounded-lg border border-zinc-200 bg-[#f8f7f3] sm:min-h-[640px]"
              onClick={handleSlotClick}
              onDragOver={(event) => event.preventDefault()}
              onDragStart={handleSlotDragStart}
              onDrop={handleBookDrop}
            >
              {(cardsQuery.isError || layoutQuery.isError) && (
                <div className="absolute inset-0 z-10 grid place-items-center bg-white/90 p-4">
                  <DataLoadError
                    className="w-full max-w-md"
                    message={
                      cardsQuery.error?.message ?? layoutQuery.error?.message
                    }
                    onRetry={() => {
                      void cardsQuery.refetch();
                      void layoutQuery.refetch();
                    }}
                    title="Could not load binder"
                  />
                </div>
              )}
              {(cardsQuery.isLoading || layoutQuery.isLoading) &&
                !(cardsQuery.isError || layoutQuery.isError) && (
                <div className="absolute inset-0 z-10 grid place-items-center bg-white/70">
                  <Loader2 className="size-6 animate-spin text-[#8a1f2d]" />
                </div>
              )}
              {isNarrowViewport ? (
                <div className="grid w-full place-items-center p-3">
                  {closed ? (
                    <div className="grid aspect-[59/86] w-full max-w-[330px] place-items-center rounded-lg border border-zinc-900 bg-zinc-950 p-6 text-center text-white shadow-xl">
                      <div>
                        <p className="text-xs font-bold uppercase tracking-[0.24em] text-rose-100">
                          Yu-Gi-Oh!
                        </p>
                        <p className="mt-3 text-4xl font-bold">Binder</p>
                        <p className="mt-3 text-sm font-semibold text-zinc-400">
                          {plannedCards} cards planned
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div
                      className="w-full max-w-[360px] rounded-lg border border-zinc-900 bg-[#171719] p-4 text-white shadow-xl"
                      data-mobile-binder-board
                    >
                      <div className="mb-3 flex items-center justify-between">
                        <p className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-400">
                          Page {currentPage + 1}
                        </p>
                        <PageValuePills
                          className="justify-end"
                          owned={currentPageTotals.owned}
                          wishlist={currentPageTotals.wishlist}
                        />
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        {Array.from({ length: slotsPerPage }, (_, slotIndex) =>
                          mobileSlot(slotIndex),
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="binder-v2-book" ref={bookHostRef} />
              )}
            </div>
          </section>

          <aside
            className="flex min-h-[680px] min-w-0 flex-col rounded-lg border border-zinc-300 bg-white p-3 shadow-sm"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              removeCardFromBinder();
            }}
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-xs font-bold uppercase tracking-[0.14em] text-zinc-500">
                    Staging
                  </p>
                  <RarityLegendPopover />
                </div>
                <p className="text-lg font-bold">{stagingCards.length}</p>
              </div>
              {selectedCard ? (
                <button
                  className="flex max-w-48 items-center gap-2 rounded-md border border-[#8a1f2d]/20 bg-rose-50 px-2 py-1 text-sm font-bold text-[#8a1f2d]"
                  onClick={() => setSelectedCardId(null)}
                  title="Clear selected card"
                  type="button"
                >
                  <Check className="size-4 shrink-0" />
                  <span className="truncate">{selectedCard.name}</span>
                </button>
              ) : null}
            </div>

            <div className="relative mb-3">
              <label className="relative block">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#8a1f2d]" />
                <input
                  className="h-10 w-full rounded-md border border-zinc-300 bg-white pl-9 pr-3 text-sm font-semibold outline-none transition focus:border-[#8a1f2d]"
                  onChange={(event) => setFinderQuery(event.target.value)}
                  placeholder="Find card in binder"
                  value={finderQuery}
                />
              </label>
              {finderQuery.trim() ? (
                <div className="absolute left-0 right-0 z-30 mt-1 max-h-80 overflow-auto rounded-md border border-zinc-300 bg-white p-1 shadow-lg">
                  {finderResults.length ? (
                    finderResults.map((card) => (
                      <button
                        className="flex w-full items-center gap-3 rounded px-2 py-2 text-left transition hover:bg-zinc-50"
                        key={card.id}
                        onClick={() => jumpToCard(card)}
                        type="button"
                      >
                        <div className="aspect-[59/86] h-12 shrink-0 overflow-hidden rounded border border-zinc-200 bg-zinc-100">
                          {card.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              alt={card.name}
                              className="h-full w-full object-cover"
                              src={card.imageUrl}
                            />
                          ) : null}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-bold text-zinc-950">
                            {card.name}
                          </p>
                          <p className="mt-0.5 truncate text-xs font-semibold text-zinc-500">
                            {locationLabel(card)}
                          </p>
                        </div>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] ${
                            card.status === "owned"
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-rose-50 text-rose-700"
                          }`}
                        >
                          {statusLabel(card)}
                        </span>
                      </button>
                    ))
                  ) : (
                    <p className="px-3 py-2 text-sm font-medium text-zinc-500">
                      No tracked card found.
                    </p>
                  )}
                </div>
              ) : null}
            </div>

            <label className="relative mb-3 block">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
              <input
                className="h-10 w-full rounded-md border border-zinc-300 bg-zinc-50 pl-9 pr-3 text-sm outline-none transition focus:border-[#8a1f2d] focus:bg-white"
                onChange={(event) => {
                  setQuery(event.target.value);
                  setStagingPage(1);
                }}
                placeholder="Search cards"
                value={query}
              />
            </label>

            <div className="mb-3 rounded-md border border-zinc-200 bg-zinc-50 p-2">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-zinc-700">Card type</p>
                {typeFilters.length ? (
                  <button
                    className="text-xs font-bold text-[#8a1f2d] transition hover:text-[#711826]"
                    onClick={() => {
                      setTypeFilters([]);
                      setStagingPage(1);
                    }}
                    type="button"
                  >
                    Any type
                  </button>
                ) : null}
              </div>
              <div className="flex gap-1.5 overflow-x-auto pb-1">
                {cardTypeFilters.map((option) => {
                  const selected = typeFilters.includes(option.value);

                  return (
                    <button
                      aria-pressed={selected}
                      className={`shrink-0 rounded border px-2 py-1 text-xs font-bold transition ${
                        selected
                          ? "border-[#8a1f2d]/30 bg-rose-50 text-[#8a1f2d]"
                          : "border-zinc-300 bg-white text-zinc-600 hover:border-zinc-950 hover:text-zinc-950"
                      }`}
                      key={option.value}
                      onClick={() => toggleTypeFilter(option.value)}
                      type="button"
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <label className="mb-3 flex items-center justify-between rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2">
              <span className="text-sm font-semibold text-zinc-700">
                Dim wishlist cards in binder
              </span>
              <input
                checked={dimWishlistCards}
                className="size-4 accent-[#8a1f2d]"
                onChange={(event) => setDimWishlistCards(event.target.checked)}
                type="checkbox"
              />
            </label>

            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              <div className="grid grid-cols-2 gap-2">
                {paginatedCards.map((card) => {
                  const selected = selectedCardId === card.id;
                  const rarityCode = rarityAbbreviation(card.rarity);

                  return (
                    <div
                      className={`relative flex min-h-48 flex-col rounded-md border p-2 text-left transition ${
                        selected
                          ? "border-[#8a1f2d] bg-rose-50"
                          : "border-zinc-200 bg-white hover:border-zinc-400"
                      }`}
                      draggable
                      key={card.id}
                      onClick={() =>
                        setSelectedCardId((current) =>
                          current === card.id ? null : card.id,
                        )
                      }
                      onDragEnd={() => setDraggedCardId(null)}
                      onDragStart={() => setDraggedCardId(card.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedCardId((current) =>
                            current === card.id ? null : card.id,
                          );
                        }
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      <div className="mx-auto aspect-[59/86] h-24 overflow-hidden rounded border border-zinc-200 bg-zinc-100">
                        {card.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            alt={card.name}
                            className="h-full w-full object-cover"
                            src={card.imageUrl}
                          />
                        ) : null}
                      </div>
                      <div className="mt-2 min-w-0">
                        <p className="line-clamp-2 text-sm font-bold leading-5 text-zinc-950">
                          {card.name}
                        </p>
                        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] ${
                              card.status === "owned"
                                ? "bg-emerald-50 text-emerald-700"
                                : "bg-rose-50 text-rose-700"
                            }`}
                          >
                            {statusLabel(card)}
                          </span>
                          {card.rarity ? (
                            <>
                              {rarityCode ? (
                                <span
                                  className="rounded border border-zinc-200 bg-zinc-950 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-[0.08em] text-white"
                                  title={card.rarity}
                                >
                                  {rarityCode}
                                </span>
                              ) : null}
                              <span className="truncate text-xs font-semibold text-zinc-500">
                                {card.rarity}
                              </span>
                            </>
                          ) : null}
                          {card.cardType ? (
                            <span className="truncate text-xs font-semibold text-zinc-400">
                              {card.cardType}
                            </span>
                          ) : null}
                          <CardNoteIndicator
                            align="right"
                            label={`View note for ${card.name}`}
                            note={card.notes}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="mt-3 flex items-center justify-between border-t border-zinc-200 pt-3">
              <button
                aria-label="Previous staging page"
                className="inline-flex size-9 items-center justify-center rounded-md border border-zinc-300 text-zinc-600 transition hover:border-zinc-950 hover:text-zinc-950 disabled:opacity-40"
                disabled={currentStagingPage === 1}
                onClick={() =>
                  setStagingPage((current) => Math.max(1, current - 1))
                }
                title="Previous staging page"
                type="button"
              >
                <ChevronLeft className="size-4" />
              </button>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-zinc-500">
                {currentStagingPage} / {stagingPageCount}
              </p>
              <button
                aria-label="Next staging page"
                className="inline-flex size-9 items-center justify-center rounded-md border border-zinc-300 text-zinc-600 transition hover:border-zinc-950 hover:text-zinc-950 disabled:opacity-40"
                disabled={currentStagingPage === stagingPageCount}
                onClick={() =>
                  setStagingPage((current) =>
                    Math.min(stagingPageCount, current + 1),
                  )
                }
                title="Next staging page"
                type="button"
              >
                <ChevronRight className="size-4" />
              </button>
            </div>
          </aside>
        </section>
      </div>

      {swapModalOpen ? (
        <div
          aria-labelledby="swap-pages-title"
          aria-modal="true"
          className="fixed inset-0 z-50 grid place-items-center bg-zinc-950/35 px-4 backdrop-blur-sm"
          role="dialog"
        >
          <div className="w-full max-w-xl rounded-lg border border-zinc-300 bg-[#f6f4ef] p-4 text-zinc-950 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#8a1f2d]">
                  Binder pages
                </p>
                <h2
                  className="mt-2 text-2xl font-bold tracking-normal"
                  id="swap-pages-title"
                >
                  Swap whole pages
                </h2>
                <p className="mt-1 text-sm font-medium leading-6 text-zinc-600">
                  Exchange every card between two binder pages.
                </p>
              </div>
              <button
                aria-label="Close page swap"
                className="inline-flex size-11 items-center justify-center rounded-md border border-zinc-300 bg-white text-zinc-600 transition hover:border-zinc-950 hover:text-zinc-950"
                onClick={() => setSwapModalOpen(false)}
                type="button"
              >
                <X className="size-4" />
              </button>
            </div>

            <form className="mt-5 grid gap-4" onSubmit={swapBinderPages}>
              <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-stretch">
                <label className="flex min-w-0 flex-col rounded-lg border border-zinc-300 bg-white p-3">
                  <span className="text-xs font-bold uppercase tracking-[0.14em] text-zinc-500">
                    From page
                  </span>
                  <input
                    className="mt-2 h-11 rounded-md border border-zinc-300 bg-white px-3 text-lg font-bold outline-none transition focus:border-[#8a1f2d]"
                    inputMode="numeric"
                    max={pageCount}
                    min={1}
                    onChange={(event) => {
                      setSwapFromPage(event.target.value);
                      setSwapError("");
                    }}
                    type="number"
                    value={swapFromPage}
                  />
                  <div className="mt-3 flex flex-col gap-2">
                    <p className="text-sm font-bold text-zinc-950">
                      {swapFromSummary?.cards ?? 0} cards
                    </p>
                    <PageValuePills
                      owned={swapFromSummary?.totals.owned ?? 0}
                      wishlist={swapFromSummary?.totals.wishlist ?? 0}
                    />
                  </div>
                </label>

                <div className="hidden items-center justify-center sm:flex">
                  <span className="grid size-11 place-items-center rounded-full border border-zinc-300 bg-white text-zinc-600 shadow-sm">
                    <ArrowLeftRight className="size-4" />
                  </span>
                </div>

                <label className="flex min-w-0 flex-col rounded-lg border border-zinc-300 bg-white p-3">
                  <span className="text-xs font-bold uppercase tracking-[0.14em] text-zinc-500">
                    To page
                  </span>
                  <input
                    className="mt-2 h-11 rounded-md border border-zinc-300 bg-white px-3 text-lg font-bold outline-none transition focus:border-[#8a1f2d]"
                    inputMode="numeric"
                    max={pageCount}
                    min={1}
                    onChange={(event) => {
                      setSwapToPage(event.target.value);
                      setSwapError("");
                    }}
                    type="number"
                    value={swapToPage}
                  />
                  <div className="mt-3 flex flex-col gap-2">
                    <p className="text-sm font-bold text-zinc-950">
                      {swapToSummary?.cards ?? 0} cards
                    </p>
                    <PageValuePills
                      owned={swapToSummary?.totals.owned ?? 0}
                      wishlist={swapToSummary?.totals.wishlist ?? 0}
                    />
                  </div>
                </label>
              </div>

              {swapError ? (
                <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">
                  {swapError}
                </p>
              ) : null}

              <div className="flex justify-end gap-2 border-t border-zinc-200 pt-4">
                <button
                  className="min-h-11 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-700 transition hover:border-zinc-950 hover:text-zinc-950"
                  onClick={() => setSwapModalOpen(false)}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="inline-flex min-h-11 items-center gap-2 rounded-md border border-[#8a1f2d] bg-[#8a1f2d] px-4 py-2 text-sm font-bold text-white transition hover:bg-[#731925] disabled:cursor-wait disabled:opacity-60"
                  disabled={swapPages.isPending}
                  type="submit"
                >
                  <ArrowLeftRight className="size-4" />
                  {swapPages.isPending ? "Swapping..." : "Swap pages"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {resetModalOpen ? (
        <div
          aria-labelledby="reset-binder-title"
          aria-modal="true"
          className="fixed inset-0 z-50 grid place-items-center bg-zinc-950/35 px-4 backdrop-blur-sm"
          role="alertdialog"
        >
          <div className="w-full max-w-sm rounded-lg border border-zinc-300 bg-[#f6f4ef] p-4 text-zinc-950 shadow-2xl">
            <p
              className="text-xs font-bold uppercase tracking-[0.16em] text-[#8a1f2d]"
              id="reset-binder-title"
            >
              Reset binder
            </p>
            <h2 className="mt-2 text-2xl font-bold tracking-normal">
              Clear all slots?
            </h2>
            <p className="mt-2 text-sm font-medium leading-6 text-zinc-600">
              This removes every card from the binder layout. Your tracked cards
              stay in the wishlist and owned lists.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-700 transition hover:border-zinc-950 hover:text-zinc-950"
                onClick={() => setResetModalOpen(false)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="rounded-md border border-[#8a1f2d] bg-[#8a1f2d] px-3 py-2 text-sm font-bold text-white transition hover:bg-[#731925] disabled:cursor-wait disabled:opacity-60"
                disabled={clearAll.isPending}
                onClick={clearBinder}
                type="button"
              >
                Clear binder
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

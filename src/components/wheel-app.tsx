"use client";

import type { inferRouterOutputs } from "@trpc/server";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Loader2,
  RotateCcw,
  Search,
  ShoppingBag,
  Sparkles,
  X,
} from "lucide-react";
import {
  type FormEvent,
  type MouseEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppHeader } from "@/components/app-header";
import { CardNoteIndicator } from "@/components/card-note-indicator";
import { DataLoadError } from "@/components/data-load-error";
import { HolographicCardCanvas } from "@/components/holographic-card-canvas";
import type { AppRouter } from "@/server/root";
import { trpc } from "@/trpc/client";

type WheelItem = inferRouterOutputs<AppRouter>["wheel"]["state"]["active"][number];
type ChaseFilterValue = "unset" | "5" | "4" | "3" | "2" | "1";

const listPageSize = 8;
const chaseFilterOptions: { label: string; value: ChaseFilterValue }[] = [
  { label: "Unset", value: "unset" },
  { label: "5", value: "5" },
  { label: "4", value: "4" },
  { label: "3", value: "3" },
  { label: "2", value: "2" },
  { label: "1", value: "1" },
];

const colors = [
  "#9f1239",
  "#047857",
  "#b7791f",
  "#0369a1",
  "#7f1d1d",
  "#6d28d9",
  "#0f766e",
  "#be123c",
  "#4d7c0f",
  "#c2410c",
  "#1d4ed8",
  "#15803d",
];

type WheelSegment = {
  color: string;
  end: number;
  item?: WheelItem;
  start: number;
};
type PurchaseForm = {
  paidPriceText: string;
  purchaseMonth: string;
};

function formatCurrency(value: number | null) {
  if (value === null) {
    return "No estimate";
  }

  return new Intl.NumberFormat("en-GB", {
    currency: "GBP",
    maximumFractionDigits: 0,
    style: "currency",
  }).format(value);
}

function statusText(itemCount: number) {
  if (itemCount === 0) {
    return "Wheel empty";
  }

  if (itemCount === 1) {
    return "1 card left";
  }

  return `${itemCount} cards left`;
}

function ebaySearchUrl(item: WheelItem) {
  if (item.card.ebaySearchUrl) {
    return item.card.ebaySearchUrl;
  }

  const params = new URLSearchParams({
    _nkw: [item.card.name, item.card.rarity].filter(Boolean).join(" "),
    _sacat: "183454",
    LH_BIN: "1",
  });

  return `https://www.ebay.co.uk/sch/i.html?${params}`;
}

function chaseLabel(item: WheelItem) {
  return item.card.chaseLevel ? `Chase ${item.card.chaseLevel}` : "No chase";
}

function itemMatchesChaseFilters(
  item: WheelItem,
  chaseFilters: ChaseFilterValue[],
) {
  if (!chaseFilters.length) {
    return true;
  }

  if (!item.card.chaseLevel) {
    return chaseFilters.includes("unset");
  }

  return chaseFilters.includes(String(item.card.chaseLevel) as ChaseFilterValue);
}

function parsePriceFilter(value: string) {
  if (!value.trim()) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function currentMonthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function normalizePaidPrice(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return "";
  }

  const numeric = trimmed
    .replace(/^paid\s+/i, "")
    .replace(/^£/, "")
    .replace(/,/g, "")
    .trim();

  if (/^\d+(?:\.\d{1,2})?$/.test(numeric)) {
    return `£${Number(numeric).toFixed(2)}`;
  }

  return trimmed.replace(/^paid\s+/i, "");
}

function itemMatchesPriceFilter(
  item: WheelItem,
  minPrice: number | null,
  maxPrice: number | null,
) {
  if (minPrice === null && maxPrice === null) {
    return true;
  }

  if (item.priceValue === null) {
    return false;
  }

  if (minPrice !== null && item.priceValue < minPrice) {
    return false;
  }

  if (maxPrice !== null && item.priceValue > maxPrice) {
    return false;
  }

  return true;
}

function chaseFilterPayload(chaseFilters: ChaseFilterValue[]) {
  return chaseFilters.map((value) => (value === "unset" ? value : Number(value)));
}

function wheelSegments(items: WheelItem[]): WheelSegment[] {
  const totalWeight = items.reduce((total, item) => total + item.weight, 0);
  let cursor = 0;

  return items.map((item, index) => {
    const size = totalWeight ? (item.weight / totalWeight) * 360 : 0;
    const start = cursor;
    const end = cursor + size;
    cursor = end;

    return {
      color: colors[index % colors.length],
      end,
      item,
      start,
    };
  });
}

function wheelVisualSegments(items: WheelItem[]): WheelSegment[] {
  const maxVisualSegments = 72;

  if (items.length <= maxVisualSegments) {
    return wheelSegments(items);
  }

  const totalWeight = items.reduce((total, item) => total + item.weight, 0);
  const buckets = Array.from({ length: maxVisualSegments }, () => ({ weight: 0 }));

  items.forEach((item, index) => {
    const bucketIndex = Math.min(
      maxVisualSegments - 1,
      Math.floor((index / items.length) * maxVisualSegments),
    );

    buckets[bucketIndex].weight += item.weight;
  });

  let cursor = 0;

  return buckets.map((bucket, index) => {
    const size = totalWeight ? (bucket.weight / totalWeight) * 360 : 0;
    const start = cursor;
    const end = cursor + size;
    cursor = end;

    return {
      color: colors[index % colors.length],
      end,
      start,
    };
  });
}

function wheelBackground(segments: WheelSegment[]) {
  if (!segments.length) {
    return "linear-gradient(145deg, #18181b, #09090b)";
  }

  return `conic-gradient(${segments
    .map((segment) => `${segment.color} ${segment.start}deg ${segment.end}deg`)
    .join(", ")})`;
}

function pageCountFor(items: unknown[]) {
  return Math.max(1, Math.ceil(items.length / listPageSize));
}

function isDatabaseErrorMessage(message: string) {
  const normalized = message.toLowerCase();

  return [
    "failed query",
    "select \"",
    " from \"",
    "params:",
    "column ",
    "relation ",
    "does not exist",
    "syntax error",
  ].some((pattern) => normalized.includes(pattern));
}

function wheelLoadErrorMessage(message?: string) {
  if (!message) {
    return "Try again. If this keeps happening, the wheel data may need a database schema sync after approval.";
  }

  if (isDatabaseErrorMessage(message)) {
    return "The wheel could not load because the deployed database schema may be out of date. After this change is reviewed, approve a database schema sync before testing production again.";
  }

  return message;
}

function resetErrorMessage(error: unknown) {
  const message =
    error instanceof Error ? error.message : "The reset request did not complete.";
  const normalized = message.toLowerCase();

  if (
    normalized.includes("failed to fetch") ||
    normalized.includes("networkerror")
  ) {
    return "The reset request could not reach the app. Check the connection, then try again.";
  }

  if (normalized.includes("abort")) {
    return "The reset request timed out. Try again.";
  }

  if (isDatabaseErrorMessage(message)) {
    return "The wheel reset did not complete because the database rejected the request. Try again after the database has been checked.";
  }

  return message;
}

function resetSuccessMessage(resetCount: number) {
  if (resetCount === 0) {
    return "Wheel was already reset.";
  }

  if (resetCount === 1) {
    return "1 picked card was put back on the wheel.";
  }

  return `${resetCount} picked cards were put back on the wheel.`;
}

function Pager({
  currentPage,
  label,
  onChange,
  pageCount,
}: {
  currentPage: number;
  label: string;
  onChange: (page: number) => void;
  pageCount: number;
}) {
  return (
    <div className="mt-3 flex items-center justify-between border-t border-zinc-200 pt-3">
      <button
        aria-label={`Previous ${label} page`}
        className="inline-flex size-8 items-center justify-center rounded-md border border-zinc-300 text-zinc-600 transition hover:border-zinc-950 hover:text-zinc-950 disabled:opacity-40"
        disabled={currentPage === 1}
        onClick={() => onChange(Math.max(1, currentPage - 1))}
        title={`Previous ${label} page`}
        type="button"
      >
        <ChevronLeft className="size-4" />
      </button>
      <p className="text-xs font-bold uppercase tracking-[0.14em] text-zinc-500">
        {currentPage} / {pageCount}
      </p>
      <button
        aria-label={`Next ${label} page`}
        className="inline-flex size-8 items-center justify-center rounded-md border border-zinc-300 text-zinc-600 transition hover:border-zinc-950 hover:text-zinc-950 disabled:opacity-40"
        disabled={currentPage === pageCount}
        onClick={() => onChange(Math.min(pageCount, currentPage + 1))}
        title={`Next ${label} page`}
        type="button"
      >
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}

export function WheelApp() {
  const utils = trpc.useUtils();
  const wheelQuery = trpc.wheel.state.useQuery();
  const spinWheel = trpc.wheel.spin.useMutation();
  const markOwned = trpc.cards.markOwned.useMutation({
    onSuccess: () => {
      setPurchaseTarget(null);
      setPurchaseForm({ paidPriceText: "", purchaseMonth: currentMonthKey() });
      setPurchaseTouched(false);
      void utils.wheel.state.invalidate();
      void utils.cards.binderList.invalidate();
      void utils.cards.chaseQueue.invalidate();
      void utils.cards.list.invalidate();
      void utils.cards.summary.invalidate();
      void utils.cards.trackerPage.invalidate();
      void utils.spend.currentMonth.invalidate();
    },
  });
  const resetWheel = trpc.wheel.reset.useMutation();
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [winner, setWinner] = useState<WheelItem | null>(null);
  const [selectedCardModal, setSelectedCardModal] = useState<WheelItem | null>(
    null,
  );
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const [resetOpen, setResetOpen] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetStatus, setResetStatus] = useState("");
  const [activePage, setActivePage] = useState(1);
  const [pickedPage, setPickedPage] = useState(1);
  const [mobileWheelDetailsOpen, setMobileWheelDetailsOpen] = useState(false);
  const [purchaseTarget, setPurchaseTarget] = useState<WheelItem | null>(null);
  const [purchaseForm, setPurchaseForm] = useState<PurchaseForm>({
    paidPriceText: "",
    purchaseMonth: currentMonthKey(),
  });
  const [purchaseTouched, setPurchaseTouched] = useState(false);
  const [chaseFilters, setChaseFilters] = useState<ChaseFilterValue[]>([]);
  const [minPriceInput, setMinPriceInput] = useState("");
  const [maxPriceInput, setMaxPriceInput] = useState("");
  const resultTimerRef = useRef<number | null>(null);

  const active = useMemo(
    () => wheelQuery.data?.active ?? [],
    [wheelQuery.data?.active],
  );
  const history = useMemo(
    () => wheelQuery.data?.history ?? [],
    [wheelQuery.data?.history],
  );
  const minPriceFilter = parsePriceFilter(minPriceInput);
  const maxPriceFilter = parsePriceFilter(maxPriceInput);
  const hasPriceFilter = minPriceFilter !== null || maxPriceFilter !== null;
  const hasWheelFilters = chaseFilters.length > 0 || hasPriceFilter;
  const filteredActive = useMemo(
    () =>
      active.filter(
        (item) =>
          itemMatchesChaseFilters(item, chaseFilters) &&
          itemMatchesPriceFilter(item, minPriceFilter, maxPriceFilter),
      ),
    [active, chaseFilters, maxPriceFilter, minPriceFilter],
  );
  const spinSegments = useMemo(() => wheelSegments(filteredActive), [filteredActive]);
  const visualSegments = useMemo(
    () => wheelVisualSegments(filteredActive),
    [filteredActive],
  );
  const wheelStyle = useMemo(() => wheelBackground(visualSegments), [visualSegments]);
  const activePageCount = pageCountFor(filteredActive);
  const pickedPageCount = pageCountFor(history);
  const currentActivePage = Math.min(activePage, activePageCount);
  const currentPickedPage = Math.min(pickedPage, pickedPageCount);
  const paginatedActive = filteredActive.slice(
    (currentActivePage - 1) * listPageSize,
    currentActivePage * listPageSize,
  );
  const paginatedPicked = history.slice(
    (currentPickedPage - 1) * listPageSize,
    currentPickedPage * listPageSize,
  );
  const pickedEstimatedCount = history.filter(
    (item) => item.priceValue !== null,
  ).length;
  const pickedTotal = history.reduce(
    (total, item) => total + (item.priceValue ?? 0),
    0,
  );
  const purchasePaidPrice = normalizePaidPrice(purchaseForm.paidPriceText);
  const showPurchasePriceError = purchaseTouched && !purchasePaidPrice;
  const busy =
    wheelQuery.isLoading ||
    spinWheel.isPending ||
    resetWheel.isPending ||
    markOwned.isPending;

  useEffect(() => {
    return () => {
      if (resultTimerRef.current) {
        window.clearTimeout(resultTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!resetStatus) {
      return;
    }

    const timeoutId = window.setTimeout(() => setResetStatus(""), 5_000);

    return () => window.clearTimeout(timeoutId);
  }, [resetStatus]);

  useEffect(() => {
    if (!selectedCardModal && !purchaseTarget) {
      return;
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSelectedCardModal(null);
        setPurchaseTarget(null);
        setTilt({ x: 0, y: 0 });
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [purchaseTarget, selectedCardModal]);

  async function spin() {
    if (busy || spinning || !filteredActive.length) {
      return;
    }

    if (resultTimerRef.current) {
      window.clearTimeout(resultTimerRef.current);
    }

    setWinner(null);
    const result = await spinWheel.mutateAsync({
      chaseLevels: chaseFilterPayload(chaseFilters),
      maxPrice: maxPriceFilter ?? undefined,
      minPrice: minPriceFilter ?? undefined,
    });
    const winnerIndex = filteredActive.findIndex(
      (item) => item.card.id === result.selected.card.id,
    );
    const winnerSegment = spinSegments[winnerIndex];

    if (!winnerSegment) {
      await utils.wheel.state.invalidate();
      return;
    }

    const segmentCenter = (winnerSegment.start + winnerSegment.end) / 2;
    const currentRotation = ((rotation % 360) + 360) % 360;
    const targetPointerAngle = 270;
    let delta = targetPointerAngle - segmentCenter - currentRotation;
    delta = ((delta % 360) + 360) % 360;

    if (delta < 80) {
      delta += 360;
    }

    setSpinning(true);
    setRotation(rotation + 1800 + delta);

    resultTimerRef.current = window.setTimeout(() => {
      setWinner(result.selected);
      setSelectedCardModal(result.selected);
      setSpinning(false);
      void utils.wheel.state.invalidate();
    }, 2300);
  }

  async function reset() {
    if (resetWheel.isPending) {
      return;
    }

    setResetError(null);
    setResetStatus("");

    try {
      const result = await resetWheel.mutateAsync();

      setWinner(null);
      setRotation(0);
      setResetOpen(false);
      setSelectedCardModal(null);
      setTilt({ x: 0, y: 0 });
      setActivePage(1);
      setPickedPage(1);
      setResetStatus(resetSuccessMessage(result.resetCount));
      void utils.wheel.state.invalidate();
    } catch (error) {
      setResetError(resetErrorMessage(error));
    }
  }

  function openPurchaseSheet(item: WheelItem) {
    setSelectedCardModal(null);
    setTilt({ x: 0, y: 0 });
    setPurchaseTarget(item);
    setPurchaseForm({
      paidPriceText: "",
      purchaseMonth: currentMonthKey(),
    });
    setPurchaseTouched(false);
  }

  function submitPurchase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPurchaseTouched(true);

    if (!purchaseTarget || !purchasePaidPrice) {
      return;
    }

    markOwned.mutate({
      id: purchaseTarget.card.id,
      paidPriceText: purchasePaidPrice,
      purchaseMonth: purchaseForm.purchaseMonth || currentMonthKey(),
    });
  }

  function toggleChaseFilter(value: ChaseFilterValue) {
    setChaseFilters((current) =>
      current.includes(value)
        ? current.filter((filter) => filter !== value)
        : [...current, value],
    );
    setActivePage(1);
  }

  function updateMinPrice(value: string) {
    setMinPriceInput(value);
    setActivePage(1);
  }

  function updateMaxPrice(value: string) {
    setMaxPriceInput(value);
    setActivePage(1);
  }

  function updateTilt(event: MouseEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;

    setTilt({
      x: Number((-y * 14).toFixed(2)),
      y: Number((x * 16).toFixed(2)),
    });
  }

  return (
    <main className="app-page-shell min-h-screen bg-[#f6f4ef] px-4 py-5 text-zinc-950 sm:px-6">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
        <AppHeader
          eyebrow="Wishlist decider"
          title="Spin for next card"
          actions={
            <div className="flex items-center gap-2">
              <button
                aria-label="Reset wheel"
                className="inline-flex size-10 items-center justify-center rounded-md border border-zinc-300 bg-white text-zinc-600 shadow-sm transition hover:border-zinc-950 hover:text-zinc-950 disabled:cursor-wait disabled:opacity-50"
                disabled={busy}
                onClick={() => {
                  setResetError(null);
                  setResetOpen(true);
                }}
                title="Reset wheel"
                type="button"
              >
                <RotateCcw className="size-4" />
              </button>
            </div>
          }
        />

        <div aria-atomic="true" aria-live="polite">
          {resetStatus ? (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-900">
              <Check className="size-4 shrink-0" />
              <span>{resetStatus}</span>
            </div>
          ) : null}
        </div>

        <section className="grid min-w-0 gap-5 xl:grid-cols-[300px_minmax(0,1fr)_300px]">
          <aside className="order-4 flex min-w-0 flex-col rounded-lg border border-zinc-300 bg-white p-3 shadow-sm xl:order-1 xl:min-h-[640px]">
            <button
              aria-controls="wheel-card-details"
              aria-expanded={mobileWheelDetailsOpen}
              className="flex min-h-12 w-full items-center justify-between gap-3 text-left xl:pointer-events-none"
              onClick={() => setMobileWheelDetailsOpen((open) => !open)}
              type="button"
            >
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-zinc-500">
                  On wheel
                </p>
                <p className="text-lg font-bold">{filteredActive.length}</p>
              </div>
              <div className="flex items-center gap-2">
                <div className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs font-semibold text-zinc-500">
                  {activePageCount} pages
                </div>
                <ChevronDown
                  className={`size-4 text-zinc-500 transition xl:hidden ${
                    mobileWheelDetailsOpen ? "rotate-180" : ""
                  }`}
                />
              </div>
            </button>

            <div
              className={`min-h-0 flex-1 flex-col pt-3 xl:flex ${
                mobileWheelDetailsOpen ? "flex" : "hidden"
              }`}
              id="wheel-card-details"
            >
              <div className="mb-3 rounded-md border border-zinc-200 bg-zinc-50 p-2">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-zinc-700">
                    Chase filter
                  </p>
                  {chaseFilters.length ? (
                    <button
                      className="min-h-11 text-xs font-bold text-[#8a1f2d] transition hover:text-[#711826]"
                      onClick={() => {
                        setChaseFilters([]);
                        setActivePage(1);
                      }}
                      type="button"
                    >
                      All chase
                    </button>
                  ) : null}
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {chaseFilterOptions.map((option) => {
                    const selected = chaseFilters.includes(option.value);

                    return (
                      <button
                        aria-pressed={selected}
                        className={`h-11 rounded border text-xs font-bold transition ${
                          selected
                            ? "border-[#8a1f2d]/30 bg-rose-50 text-[#8a1f2d]"
                            : "border-zinc-300 bg-white text-zinc-600 hover:border-zinc-950 hover:text-zinc-950"
                        }`}
                        key={option.value}
                        onClick={() => toggleChaseFilter(option.value)}
                        type="button"
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="mb-3 rounded-md border border-zinc-200 bg-zinc-50 p-2">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-zinc-700">
                    Price filter
                  </p>
                  {hasPriceFilter ? (
                    <button
                      className="min-h-11 text-xs font-bold text-[#8a1f2d] transition hover:text-[#711826]"
                      onClick={() => {
                        setMinPriceInput("");
                        setMaxPriceInput("");
                        setActivePage(1);
                      }}
                      type="button"
                    >
                      Any price
                    </button>
                  ) : null}
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <label className="block">
                    <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.1em] text-zinc-500">
                      Min
                    </span>
                    <input
                      className="h-11 w-full rounded border border-zinc-300 bg-white px-2 text-sm font-semibold text-zinc-950 outline-none transition placeholder:text-zinc-400 focus:border-[#8a1f2d] focus:ring-2 focus:ring-[#8a1f2d]/10"
                      inputMode="decimal"
                      min="0"
                      onChange={(event) => updateMinPrice(event.target.value)}
                      placeholder="£0"
                      type="number"
                      value={minPriceInput}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.1em] text-zinc-500">
                      Max
                    </span>
                    <input
                      className="h-11 w-full rounded border border-zinc-300 bg-white px-2 text-sm font-semibold text-zinc-950 outline-none transition placeholder:text-zinc-400 focus:border-[#8a1f2d] focus:ring-2 focus:ring-[#8a1f2d]/10"
                      inputMode="decimal"
                      min="0"
                      onChange={(event) => updateMaxPrice(event.target.value)}
                      placeholder="£50"
                      type="number"
                      value={maxPriceInput}
                    />
                  </label>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-hidden">
                {filteredActive.length ? (
                  <div className="space-y-2">
                    {paginatedActive.map((item, index) => {
                      const colorIndex =
                        (currentActivePage - 1) * listPageSize + index;

                      return (
                        <div
                          className="flex gap-3 rounded-md border border-zinc-200 bg-white p-2"
                          key={item.card.id}
                        >
                          <div
                            className="mt-1 size-3 shrink-0 rounded-full"
                            style={{
                              background: colors[colorIndex % colors.length],
                            }}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-bold">
                              {item.card.name}
                            </p>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5">
                              <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-rose-700">
                                {chaseLabel(item)}
                              </span>
                              <span className="rounded border border-zinc-200 px-1.5 py-0.5 text-[10px] font-bold text-zinc-500">
                                {formatCurrency(item.priceValue)}
                              </span>
                              <span className="rounded border border-zinc-200 px-1.5 py-0.5 text-[10px] font-bold text-zinc-500">
                                {item.weight}x
                              </span>
                              <CardNoteIndicator
                                label={`View note for ${item.card.name}`}
                                note={item.card.notes}
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="grid h-full place-items-center rounded-md border border-dashed border-zinc-300 p-6 text-center">
                    <div>
                      <Search className="mx-auto size-6 text-zinc-400" />
                      <p className="mt-3 text-sm font-semibold text-zinc-600">
                        {hasWheelFilters
                          ? "No cards match these wheel filters."
                          : "No wishlist cards left on the wheel."}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <Pager
                currentPage={currentActivePage}
                label="wheel"
                onChange={setActivePage}
                pageCount={activePageCount}
              />
            </div>
          </aside>

          <section className="order-1 min-w-0 rounded-lg border border-zinc-300 bg-white p-3 shadow-sm sm:p-4 xl:order-2">
            <div className="flex flex-col items-center gap-5">
              {wheelQuery.isError ? (
                <DataLoadError
                  className="w-full"
                  message={wheelLoadErrorMessage(wheelQuery.error.message)}
                  onRetry={() => void wheelQuery.refetch()}
                  title="Could not load wheel"
                />
              ) : (
              <div className="relative grid aspect-square w-full max-w-[500px] place-items-center rounded-full">
                <div className="absolute -top-2 z-10 h-0 w-0 border-l-[16px] border-r-[16px] border-t-[30px] border-l-transparent border-r-transparent border-t-[#8a1f2d] drop-shadow" />
                <div
                  className="relative aspect-square w-full rounded-full border-[8px] border-zinc-950 shadow-2xl transition-transform duration-[2300ms] ease-out"
                  style={{
                    background: wheelStyle,
                    transform: `rotate(${rotation}deg)`,
                  }}
                >
                  <div className="absolute inset-[4%] rounded-full border border-white/25 shadow-[inset_0_0_22px_rgba(255,255,255,0.2)]" />
                  <div className="absolute inset-[30%] rounded-full border border-zinc-300 bg-[#f6f4ef] shadow-inner" />
                </div>
                <button
                  className="absolute grid size-36 place-items-center rounded-full border border-zinc-300 bg-white text-center shadow-lg transition hover:border-[#8a1f2d] hover:text-[#8a1f2d] disabled:cursor-not-allowed disabled:text-zinc-400 sm:size-40"
                  disabled={busy || spinning || filteredActive.length === 0}
                  onClick={spin}
                  type="button"
                >
                  {wheelQuery.isLoading ? (
                    <Loader2 className="size-6 animate-spin text-[#8a1f2d]" />
                  ) : (
                    <div>
                      <p className="flex items-center justify-center gap-1 text-xs font-bold uppercase tracking-[0.14em] text-zinc-500">
                        {spinning || spinWheel.isPending ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <Sparkles className="size-3" />
                        )}
                        Spin
                      </p>
                      <p className="mt-1 text-2xl font-bold">
                        {statusText(filteredActive.length)}
                      </p>
                    </div>
                  )}
                </button>
              </div>
              )}

              {winner ? (
                <div className="w-full rounded-lg border border-[#8a1f2d]/25 bg-rose-50 p-4">
                  <div className="flex items-center gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#8a1f2d]">
                        Pick this next
                      </p>
                      <p className="truncate text-xl font-bold">
                        {winner.card.name}
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </section>

          <aside className="order-3 flex min-h-[420px] min-w-0 flex-col rounded-lg border border-zinc-300 bg-white p-3 shadow-sm xl:min-h-[640px]">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-zinc-500">
                  Picked
                </p>
                <p className="text-lg font-bold">{history.length}</p>
                {history.length ? (
                  <p className="text-xs font-bold text-zinc-500">
                    Total{" "}
                    <span className="text-zinc-950">
                      {pickedEstimatedCount
                        ? formatCurrency(pickedTotal)
                        : "No estimates"}
                    </span>
                  </p>
                ) : null}
              </div>
              <div className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs font-semibold text-zinc-500">
                First picked
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-hidden">
              {history.length ? (
                <div className="space-y-2">
                  {paginatedPicked.map((item) => (
                    <div
                      className="flex items-center gap-3 rounded-md border border-zinc-200 bg-white p-2"
                      key={item.entry.id}
                    >
                      <div className="aspect-[59/86] h-14 shrink-0 overflow-hidden rounded border border-zinc-200 bg-zinc-100">
                        {item.card.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            alt={item.card.name}
                            className="h-full w-full object-cover"
                            src={item.card.imageUrl}
                          />
                        ) : null}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold">
                          {item.card.name}
                        </p>
                        {item.card.rarity ? (
                          <p className="mt-0.5 truncate text-xs font-semibold text-zinc-500">
                            {item.card.rarity}
                          </p>
                        ) : null}
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-rose-700">
                            #{item.entry.selectedOrder}
                          </span>
                          <span className="rounded border border-zinc-200 px-1.5 py-0.5 text-[10px] font-bold text-zinc-500">
                            {formatCurrency(item.priceValue)}
                          </span>
                          <a
                            aria-label={`Open eBay search for ${item.card.name}`}
                            className="relative inline-flex h-8 items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 text-[10px] font-bold text-zinc-600 shadow-[0_1px_0_rgba(0,0,0,0.02)] transition after:absolute after:-inset-1.5 after:rounded-lg after:content-[''] hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900"
                            href={ebaySearchUrl(item)}
                            rel="noreferrer"
                            target="_blank"
                          >
                            eBay
                            <ExternalLink className="size-3" />
                          </a>
                          <button
                            aria-label={`Add ${item.card.name} to owned cards`}
                            className="relative inline-flex size-8 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-500 shadow-[0_1px_0_rgba(0,0,0,0.02)] transition after:absolute after:-inset-1.5 after:rounded-lg after:content-[''] hover:border-[#8a1f2d]/30 hover:bg-rose-50 hover:text-[#8a1f2d]"
                            onClick={() => openPurchaseSheet(item)}
                            title="Add to owned"
                            type="button"
                          >
                            <ShoppingBag className="size-3" />
                          </button>
                          <CardNoteIndicator
                            align="right"
                            label={`View note for ${item.card.name}`}
                            note={item.card.notes}
                            size="compact"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="grid h-full place-items-center rounded-md border border-dashed border-zinc-300 p-6 text-center">
                  <div>
                    <Search className="mx-auto size-6 text-zinc-400" />
                    <p className="mt-3 text-sm font-semibold text-zinc-600">
                      No cards picked yet.
                    </p>
                  </div>
                </div>
              )}
            </div>

            <Pager
              currentPage={currentPickedPage}
              label="picked"
              onChange={setPickedPage}
              pageCount={pickedPageCount}
            />
          </aside>
        </section>
      </div>

      {resetOpen ? (
        <div
          aria-busy={resetWheel.isPending}
          aria-labelledby="reset-wheel-title"
          aria-modal="true"
          className="fixed inset-0 z-50 grid place-items-center bg-zinc-950/35 px-4 backdrop-blur-sm"
          role="alertdialog"
        >
          <div className="w-full max-w-sm rounded-lg border border-zinc-300 bg-[#f6f4ef] p-4 text-zinc-950 shadow-2xl">
            <p
              className="text-xs font-bold uppercase tracking-[0.16em] text-[#8a1f2d]"
              id="reset-wheel-title"
            >
              Reset wheel
            </p>
            <h2 className="mt-2 text-2xl font-bold tracking-normal">
              Put every wishlist card back?
            </h2>
            <p className="mt-2 text-sm font-medium leading-6 text-zinc-600">
              This clears the picked history and rebuilds the wheel from your
              current wishlist cards.
            </p>
            {resetError ? (
              <div
                className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold leading-5 text-rose-900"
                role="alert"
              >
                {resetError}
              </div>
            ) : null}
            <div className="mt-5 flex justify-end gap-2">
              <button
                className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-700 transition hover:border-zinc-950 hover:text-zinc-950 disabled:cursor-wait disabled:opacity-60"
                disabled={resetWheel.isPending}
                onClick={() => {
                  setResetError(null);
                  setResetOpen(false);
                }}
                type="button"
              >
                Cancel
              </button>
              <button
                className="inline-flex min-h-10 items-center gap-2 rounded-md border border-[#8a1f2d] bg-[#8a1f2d] px-3 py-2 text-sm font-bold text-white transition hover:bg-[#731925] disabled:cursor-wait disabled:opacity-60"
                disabled={resetWheel.isPending}
                onClick={reset}
                type="button"
              >
                {resetWheel.isPending ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Resetting...
                  </>
                ) : (
                  "Reset wheel"
                )}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {selectedCardModal ? (
        <div
          aria-labelledby="selected-card-title"
          aria-modal="true"
          className="fixed inset-0 z-50 grid place-items-center bg-zinc-950/70 px-4 backdrop-blur-sm"
          role="dialog"
        >
          <div className="relative w-full max-w-md text-center">
            <button
              aria-label="Close selected card"
              className="absolute right-0 top-0 z-10 grid size-9 translate-x-3 -translate-y-3 place-items-center rounded-md border border-zinc-700 bg-zinc-950/80 text-zinc-300 shadow-sm transition hover:border-white hover:text-white"
              onClick={() => {
                setSelectedCardModal(null);
                setTilt({ x: 0, y: 0 });
              }}
              title="Close selected card"
              type="button"
            >
              <X className="size-4" />
            </button>
            <div
              className="mx-auto w-[min(78vw,340px)]"
              onMouseLeave={() => setTilt({ x: 0, y: 0 })}
              onMouseMove={updateTilt}
              style={{ perspective: "1200px" }}
            >
              <div
                className="rounded-xl bg-zinc-950 p-3 shadow-2xl transition-transform duration-150"
                style={{
                  transform: `rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`,
                  transformStyle: "preserve-3d",
                }}
              >
                <HolographicCardCanvas
                  alt={selectedCardModal.card.name}
                  className="aspect-[59/86] overflow-hidden rounded-lg border border-white/15 bg-zinc-900"
                  imageUrl={selectedCardModal.card.imageUrl}
                  rarity={selectedCardModal.card.rarity}
                  tilt={tilt}
                />
              </div>
            </div>
            <p
              className="mt-4 text-xs font-bold uppercase tracking-[0.16em] text-[#f4d6d9]"
              id="selected-card-title"
            >
              Get this next
            </p>
            <p className="mt-1 text-2xl font-bold text-white">
              {selectedCardModal.card.name}
            </p>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-center">
              <a
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-white/20 bg-white/10 px-4 text-sm font-bold text-white transition hover:bg-white/15"
                href={ebaySearchUrl(selectedCardModal)}
                rel="noreferrer"
                target="_blank"
              >
                eBay
                <ExternalLink className="size-4" />
              </a>
              <button
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-white px-4 text-sm font-bold text-zinc-950 transition hover:bg-rose-50"
                onClick={() => openPurchaseSheet(selectedCardModal)}
                type="button"
              >
                <ShoppingBag className="size-4" />
                Add to owned
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {purchaseTarget ? (
        <div
          aria-labelledby="purchase-card-title"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-end justify-center bg-zinc-950/45 px-0 pt-10 backdrop-blur-sm sm:items-center sm:px-4 sm:py-6"
          role="dialog"
        >
          <section className="flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-lg border border-zinc-300 bg-white shadow-2xl sm:max-w-lg sm:rounded-lg">
            <div className="flex items-start justify-between gap-4 border-b border-zinc-200 p-4">
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#8a1f2d]">
                  Add to owned
                </p>
                <h2
                  className="mt-1 truncate text-xl font-bold"
                  id="purchase-card-title"
                >
                  {purchaseTarget.card.name}
                </h2>
                {purchaseTarget.card.rarity ? (
                  <p className="mt-1 text-sm font-semibold text-zinc-500">
                    {purchaseTarget.card.rarity}
                  </p>
                ) : null}
              </div>
              <button
                aria-label="Close add to owned form"
                className="grid size-10 shrink-0 place-items-center rounded-md border border-zinc-300 text-zinc-600 transition hover:border-zinc-950 hover:text-zinc-950"
                onClick={() => setPurchaseTarget(null)}
                type="button"
              >
                <X className="size-4" />
              </button>
            </div>

            <form className="space-y-4 overflow-auto p-4" onSubmit={submitPurchase}>
              <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.12em] text-zinc-500">
                      Status
                    </p>
                    <p className="mt-1 flex items-center gap-1 font-bold text-zinc-950">
                      <Check className="size-4 text-[#8a1f2d]" />
                      Owned
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.12em] text-zinc-500">
                      Estimate
                    </p>
                    <p className="mt-1 font-bold text-zinc-950">
                      {formatCurrency(purchaseTarget.priceValue)}
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {purchaseTarget.card.url ? (
                    <a
                      className="inline-flex min-h-11 items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-bold text-zinc-700 transition hover:border-[#8a1f2d] hover:text-[#8a1f2d]"
                      href={purchaseTarget.card.url}
                      rel="noreferrer"
                      target="_blank"
                    >
                      Open saved link
                      <ExternalLink className="size-4" />
                    </a>
                  ) : null}
                  <a
                    className="inline-flex min-h-11 items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-bold text-zinc-700 transition hover:border-[#8a1f2d] hover:text-[#8a1f2d]"
                    href={ebaySearchUrl(purchaseTarget)}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Open eBay search
                    <ExternalLink className="size-4" />
                  </a>
                </div>
              </div>

              <label className="block">
                <span className="text-sm font-medium text-zinc-700">
                  Paid price <span className="text-[#8a1f2d]">*</span>
                </span>
                <input
                  autoFocus
                  aria-describedby={
                    showPurchasePriceError ? "purchase-paid-error" : undefined
                  }
                  aria-invalid={showPurchasePriceError}
                  className="mt-1 h-11 w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 text-base outline-none transition placeholder:text-zinc-400 focus:border-[#8a1f2d] focus:bg-white focus:ring-2 focus:ring-[#8a1f2d]/10"
                  inputMode="decimal"
                  onBlur={() => setPurchaseTouched(true)}
                  onChange={(event) =>
                    setPurchaseForm((current) => ({
                      ...current,
                      paidPriceText: event.target.value,
                    }))
                  }
                  placeholder="£12.50 or pulled from pack"
                  value={purchaseForm.paidPriceText}
                />
                {showPurchasePriceError ? (
                  <p
                    className="mt-1 text-sm font-semibold text-red-700"
                    id="purchase-paid-error"
                    role="alert"
                  >
                    Enter what you paid before moving this card to owned.
                  </p>
                ) : (
                  <p className="mt-1 text-xs font-medium text-zinc-500">
                    This is the only required field.
                  </p>
                )}
              </label>

              <label className="block">
                <span className="text-sm font-medium text-zinc-700">
                  Bought month
                </span>
                <input
                  className="mt-1 h-11 w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 text-base outline-none transition focus:border-[#8a1f2d] focus:bg-white focus:ring-2 focus:ring-[#8a1f2d]/10"
                  onChange={(event) =>
                    setPurchaseForm((current) => ({
                      ...current,
                      purchaseMonth: event.target.value,
                    }))
                  }
                  type="month"
                  value={purchaseForm.purchaseMonth}
                />
              </label>

              {markOwned.error ? (
                <p
                  className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
                  role="alert"
                >
                  {markOwned.error.message}
                </p>
              ) : null}

              <button
                className="flex h-11 w-full items-center justify-center gap-2 rounded-md bg-[#8a1f2d] px-4 text-sm font-semibold text-white transition hover:bg-[#711826] disabled:cursor-not-allowed disabled:bg-zinc-300"
                disabled={markOwned.isPending || !purchasePaidPrice}
                type="submit"
              >
                {markOwned.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <ShoppingBag className="size-4" />
                )}
                Move to owned
              </button>
            </form>
          </section>
        </div>
      ) : null}
    </main>
  );
}

"use client";

import {
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Search,
  SlidersHorizontal,
  Star,
  X,
} from "lucide-react";
import type { inferRouterOutputs } from "@trpc/server";
import {
  FormEvent,
  MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { CardNoteIndicator } from "@/components/card-note-indicator";
import { DataLoadError } from "@/components/data-load-error";
import { HolographicCardCanvas } from "@/components/holographic-card-canvas";
import { RarityGuidePopover } from "@/components/rarity-guide-popover";
import { RarityCombobox } from "@/components/rarity-combobox";
import { DestructiveToast } from "@/components/records/entry-form-ui";
import { rarityAbbreviation } from "@/lib/rarity-abbreviations";
import { useClientReady } from "@/lib/use-client-ready";
import type { AppRouter } from "@/server/root";
import { trpc } from "@/trpc/client";

type StatusFilter = "all" | "wishlist" | "owned";
type SortOption =
  | "updated"
  | "name"
  | "price-high"
  | "price-low"
  | "chase-next"
  | "chase-relaxed"
  | "rarity";
type PriceSignalFilter = "estimated" | "unpriced" | "paid";
type ChaseFilter = "5" | "4" | "3" | "2" | "1" | "unset";
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
type Card = inferRouterOutputs<AppRouter>["cards"]["trackerPage"]["items"][number];
type CardStatus = "wishlist" | "owned";
type CardForm = {
  name: string;
  url: string;
  imageUrl: string;
  priceText: string;
  marketPriceText: string;
  purchaseMonth: string;
  rarity: string;
  edition: "1st Edition" | "Unlimited Edition" | "Limited Edition";
  chaseLevel: string;
  status: CardStatus;
  notes: string;
};
type EditForm = Omit<CardForm, "edition"> & {
  id: string;
  ebayListingUrl: string;
  paidPriceText: string;
  chaseLevel: string;
  edition: CardForm["edition"] | "Unknown edition";
};
type PricingRun = {
  completed: number;
  estimated: number;
  failed: number;
  minimized: boolean;
  noMatch: number;
  running: boolean;
  total: number;
};

const pageSize = 8;

const filters: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "wishlist", label: "Wishlist" },
  { value: "owned", label: "Owned" },
];

const sortOptions: { value: SortOption; label: string }[] = [
  { value: "updated", label: "Recently updated" },
  { value: "price-high", label: "Price: high to low" },
  { value: "price-low", label: "Price: low to high" },
  { value: "chase-next", label: "Chase: want next" },
  { value: "chase-relaxed", label: "Chase: not rushing" },
  { value: "name", label: "Name A-Z" },
  { value: "rarity", label: "Rarity A-Z" },
];

const priceSignalFilterOptions: {
  value: PriceSignalFilter;
  label: string;
  hint: string;
}[] = [
  { value: "estimated", label: "Has estimate", hint: "Manual or eBay price" },
  { value: "unpriced", label: "No estimate", hint: "Missing market price" },
  { value: "paid", label: "Has paid", hint: "Owned cost saved" },
];

const chaseFilterOptions: { value: ChaseFilter; label: string; hint: string }[] = [
  { value: "5", label: "5", hint: "Want next" },
  { value: "4", label: "4", hint: "High priority" },
  { value: "3", label: "3", hint: "Good target" },
  { value: "2", label: "2", hint: "Later" },
  { value: "1", label: "1", hint: "Nice to have" },
  { value: "unset", label: "Unset", hint: "No chase level" },
];

const cardTypeFilters: { value: CardTypeFilter; label: string }[] = [
  { value: "monster", label: "Monster" },
  { value: "normal", label: "Normal" },
  { value: "effect", label: "Effect" },
  { value: "fusion", label: "Fusion" },
  { value: "synchro", label: "Synchro" },
  { value: "xyz", label: "Xyz" },
  { value: "link", label: "Link" },
  { value: "ritual", label: "Ritual" },
  { value: "pendulum", label: "Pendulum" },
  { value: "tuner", label: "Tuner" },
  { value: "spell", label: "Spell" },
  { value: "trap", label: "Trap" },
  { value: "token", label: "Token" },
];

type TrackerUrlState = {
  chaseFilters: ChaseFilter[];
  filter: StatusFilter;
  page: number;
  priceMax: string;
  priceMin: string;
  priceSignalFilters: PriceSignalFilter[];
  query: string;
  rarityFilters: string[];
  sort: SortOption;
  typeFilters: CardTypeFilter[];
};

type TrackerUrlParam =
  | "chase"
  | "maxPrice"
  | "minPrice"
  | "page"
  | "priceSignal"
  | "q"
  | "rarity"
  | "sort"
  | "status"
  | "type";

type SearchParamsReader = Pick<URLSearchParams, "get" | "getAll">;

function optionValue<T extends string>(
  value: string | null,
  options: readonly { value: T }[],
  fallback: T,
) {
  return options.some((option) => option.value === value)
    ? (value as T)
    : fallback;
}

function optionValues<T extends string>(
  searchParams: SearchParamsReader,
  key: string,
  options: readonly { value: T }[],
) {
  const allowedValues = new Set(options.map((option) => option.value));

  return Array.from(new Set(searchParams.getAll(key))).filter(
    (value): value is T => allowedValues.has(value as T),
  );
}

function stringValues(searchParams: SearchParamsReader, key: string) {
  return Array.from(
    new Set(searchParams.getAll(key).map((value) => value.trim()).filter(Boolean)),
  );
}

function pageValue(value: string | null) {
  if (!value || !/^\d+$/.test(value)) {
    return 1;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

function trackerUrlState(searchParams: SearchParamsReader): TrackerUrlState {
  return {
    chaseFilters: optionValues(searchParams, "chase", chaseFilterOptions),
    filter: optionValue(searchParams.get("status"), filters, "all"),
    page: pageValue(searchParams.get("page")),
    priceMax: searchParams.get("maxPrice") ?? "",
    priceMin: searchParams.get("minPrice") ?? "",
    priceSignalFilters: optionValues(
      searchParams,
      "priceSignal",
      priceSignalFilterOptions,
    ),
    query: searchParams.get("q") ?? "",
    rarityFilters: stringValues(searchParams, "rarity"),
    sort: optionValue(searchParams.get("sort"), sortOptions, "updated"),
    typeFilters: optionValues(searchParams, "type", cardTypeFilters),
  };
}

function normalizeMarketPrice(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return "";
  }

  const numeric = trimmed
    .replace(/^manual\s+/i, "")
    .replace(/^market\s+/i, "")
    .replace(/^£/, "")
    .replace(/,/g, "")
    .trim();

  if (/^\d+(?:\.\d{1,2})?$/.test(numeric)) {
    return `£${Number(numeric).toFixed(2)}`;
  }

  return trimmed;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-GB", {
    currency: "GBP",
    maximumFractionDigits: 0,
    style: "currency",
  }).format(value);
}

function currentMonthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(monthKey: string | null) {
  if (!monthKey) {
    return null;
  }

  const [year, month] = monthKey.split("-").map(Number);

  if (!year || !month) {
    return monthKey;
  }

  return new Intl.DateTimeFormat("en-GB", {
    month: "short",
    year: "numeric",
  }).format(new Date(year, month - 1, 1));
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

function editFormFromCard(card: Card): EditForm {
  return {
    id: card.id,
    name: card.name,
    url: card.url ?? "",
    imageUrl: card.imageUrl ?? "",
    priceText: card.priceText ?? "",
    marketPriceText: card.marketPriceText ?? "",
    paidPriceText: card.paidPriceText ?? "",
    purchaseMonth: card.purchaseMonth ?? "",
    ebayListingUrl: card.ebayListingUrl ?? "",
    rarity: card.rarity ?? "",
    edition: card.edition === "Unlimited Edition" || card.edition === "1st Edition"
      ? card.edition
      : "Unknown edition",
    chaseLevel: card.chaseLevel ? String(card.chaseLevel) : "",
    status: card.status,
    notes: card.notes ?? "",
  };
}

function emptyForm(): CardForm {
  return {
    name: "",
    url: "",
    imageUrl: "",
    priceText: "",
    marketPriceText: "",
    purchaseMonth: currentMonthKey(),
    rarity: "",
    edition: "1st Edition",
    chaseLevel: "",
    status: "wishlist" as const,
    notes: "",
  };
}

function ebaySearchUrl(card: Card) {
  if (card.ebaySearchUrl) {
    return card.ebaySearchUrl;
  }

  const params = new URLSearchParams({
    _nkw: [card.name, card.rarity].filter(Boolean).join(" "),
    _sacat: "183454",
    LH_BIN: "1",
  });

  return `https://www.ebay.co.uk/sch/i.html?${params}`;
}

function isTcgplayerUrl(url: string | null) {
  return Boolean(url?.toLowerCase().includes("tcgplayer.com"));
}

function EditCardModal({
  form,
  saving,
  onClose,
  onDelete,
  onSave,
  setForm,
}: {
  form: EditForm;
  saving: boolean;
  onClose: () => void;
  onDelete: (id: string) => void;
  onSave: () => void;
  setForm: (updater: (current: EditForm) => EditForm) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 px-4 py-6">
      <section className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-lg border border-zinc-300 bg-white p-4 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">Edit card</h2>
          <button
            aria-label="Close edit modal"
            className="grid size-9 place-items-center rounded-md border border-zinc-300 text-zinc-600 transition hover:border-zinc-950 hover:text-zinc-950"
            onClick={onClose}
            type="button"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="text-sm font-medium text-zinc-700">Card name</span>
            <input
              className="mt-1 h-11 w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 text-sm outline-none transition focus:border-[#8a1f2d] focus:bg-white"
              onChange={(event) =>
                setForm((current) => ({ ...current, name: event.target.value }))
              }
              value={form.name}
            />
          </label>

          <label className="block sm:col-span-2">
            <span className="text-sm font-medium text-zinc-700">Link</span>
            <input
              className="mt-1 h-11 w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 text-sm outline-none transition focus:border-[#8a1f2d] focus:bg-white"
              onChange={(event) =>
                setForm((current) => ({ ...current, url: event.target.value }))
              }
              value={form.url}
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-zinc-700">
              Manual market price
            </span>
            <input
              className="mt-1 h-11 w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 text-sm outline-none transition focus:border-[#8a1f2d] focus:bg-white"
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  marketPriceText: event.target.value,
                }))
              }
              placeholder="£12.50"
              value={form.marketPriceText}
            />
            {form.priceText ? (
              <span className="mt-1 block text-xs font-medium text-zinc-500">
                eBay estimate: {form.priceText}
              </span>
            ) : null}
          </label>

          {form.status === "owned" ? (
            <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-3 text-sm font-medium leading-5 text-blue-950 sm:col-span-2">
              Purchase cost, date, and physical Copy details come from Records. Open this card&apos;s Copies to edit the originating Purchase or Pack Opening.
            </div>
          ) : null}

          <RarityCombobox
            value={form.rarity}
            onChange={(rarity) => setForm((current) => ({ ...current, rarity }))}
          />

          <label className="block">
            <span className="text-sm font-medium text-zinc-700">Edition</span>
            <select className="mt-1 h-11 w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 text-sm outline-none transition focus:border-[#8a1f2d] focus:bg-white" onChange={(event) => setForm((current) => ({ ...current, edition: event.target.value as EditForm["edition"] }))} value={form.edition}>
              {form.edition === "Unknown edition" ? <option value="Unknown edition">Unknown edition — choose one</option> : null}
              <option value="1st Edition">1st Edition</option>
              <option value="Unlimited Edition">Unlimited Edition</option>
              <option value="Limited Edition">Limited Edition</option>
            </select>
            {form.edition === "Unknown edition" ? <span className="mt-1 block text-xs font-semibold text-amber-700">Legacy data did not include an edition. Choose the physical card&apos;s edition before saving.</span> : null}
          </label>

          <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2">
            <span className="text-xs font-bold uppercase tracking-[0.12em] text-zinc-500">
              Library state
            </span>
            <p className="mt-1 text-sm font-bold capitalize text-zinc-800">
              {form.status === "wishlist" ? "Wishlist target" : "Owned from Records"}
            </p>
            <p className="mt-1 text-xs font-medium leading-5 text-zinc-500">
              Ownership changes belong in Records so acquisition history is preserved.
            </p>
          </div>

          {form.status === "wishlist" ? (
            <label className="block">
              <span className="text-sm font-medium text-zinc-700">
                Chase level
              </span>
              <select
                className="mt-1 h-11 w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 text-sm outline-none transition focus:border-[#8a1f2d] focus:bg-white"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    chaseLevel: event.target.value,
                  }))
                }
                value={form.chaseLevel}
              >
                <option value="">No chase</option>
                <option value="5">5 - next</option>
                <option value="4">4</option>
                <option value="3">3</option>
                <option value="2">2</option>
                <option value="1">1 - nice to have</option>
              </select>
            </label>
          ) : null}

          {form.status === "wishlist" ? (
            <label className="block sm:col-span-2">
              <span className="text-sm font-medium text-zinc-700">
                Saved eBay listing
              </span>
              <input
                className="mt-1 h-11 w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 text-sm outline-none transition focus:border-[#8a1f2d] focus:bg-white"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    ebayListingUrl: event.target.value,
                  }))
                }
                placeholder="https://www.ebay.co.uk/itm/..."
                type="url"
                value={form.ebayListingUrl}
              />
              <span className="mt-1 block text-xs font-medium text-zinc-500">
                Separate from the eBay pricing/search link.
              </span>
            </label>
          ) : null}

          <label className="block sm:col-span-2">
            <span className="text-sm font-medium text-zinc-700">Image URL</span>
            <input
              className="mt-1 h-11 w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 text-sm outline-none transition focus:border-[#8a1f2d] focus:bg-white"
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  imageUrl: event.target.value,
                }))
              }
              value={form.imageUrl}
            />
          </label>
        </div>

        <div className="mt-5 flex items-center justify-between gap-2 border-t border-zinc-200 pt-4">
          <button
            className="h-10 rounded-md px-3 text-sm font-semibold text-rose-700 transition hover:bg-rose-50 hover:text-rose-800"
            onClick={() => onDelete(form.id)}
            type="button"
          >
            Delete target
          </button>
          <div className="flex justify-end gap-2">
          <button
            className="h-10 rounded-md border border-zinc-300 px-4 text-sm font-semibold text-zinc-700 transition hover:border-zinc-950 hover:text-zinc-950"
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className="inline-flex h-10 items-center gap-2 rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:opacity-50"
            disabled={saving || form.edition === "Unknown edition"}
            onClick={onSave}
            type="button"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Save
          </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function CardFilterModal({
  activeFilterCount,
  canFilterPaid,
  chaseFilters,
  onClear,
  onClose,
  priceMax,
  priceMin,
  priceSignalFilters: selectedPriceSignalFilters,
  rarityFilters,
  rarityOptions,
  setChaseFilters,
  setPriceMax,
  setPriceMin,
  setPriceSignalFilters,
  setRarityFilters,
  setTypeFilters,
  typeFilters,
}: {
  activeFilterCount: number;
  canFilterPaid: boolean;
  chaseFilters: ChaseFilter[];
  onClear: () => void;
  onClose: () => void;
  priceMax: string;
  priceMin: string;
  priceSignalFilters: PriceSignalFilter[];
  rarityFilters: string[];
  rarityOptions: string[];
  setChaseFilters: (value: ChaseFilter[]) => void;
  setPriceMax: (value: string) => void;
  setPriceMin: (value: string) => void;
  setPriceSignalFilters: (value: PriceSignalFilter[]) => void;
  setRarityFilters: (value: string[]) => void;
  setTypeFilters: (value: CardTypeFilter[]) => void;
  typeFilters: CardTypeFilter[];
}) {
  const [raritySearch, setRaritySearch] = useState("");
  const allRaritiesSelected =
    rarityOptions.length > 0 && rarityFilters.length === rarityOptions.length;
  const visibleRarityOptions = useMemo(() => {
    const search = raritySearch.trim().toLowerCase();
    const sorted = [...rarityOptions].sort((a, b) => a.localeCompare(b));

    if (!search) {
      return sorted;
    }

    return sorted.filter((rarity) => rarity.toLowerCase().includes(search));
  }, [rarityOptions, raritySearch]);

  function toggleType(type: CardTypeFilter) {
    setTypeFilters(
      typeFilters.includes(type)
        ? typeFilters.filter((selectedType) => selectedType !== type)
        : [...typeFilters, type],
    );
  }

  function toggleRarity(rarity: string) {
    setRarityFilters(
      rarityFilters.includes(rarity)
        ? rarityFilters.filter((selectedRarity) => selectedRarity !== rarity)
        : [...rarityFilters, rarity],
    );
  }

  function selectAllRarities() {
    setRarityFilters(rarityOptions);
  }

  function togglePriceSignal(priceSignal: PriceSignalFilter) {
    setPriceSignalFilters(
      selectedPriceSignalFilters.includes(priceSignal)
        ? selectedPriceSignalFilters.filter(
            (selectedSignal) => selectedSignal !== priceSignal,
          )
        : [...selectedPriceSignalFilters, priceSignal],
    );
  }

  function toggleChase(chase: ChaseFilter) {
    setChaseFilters(
      chaseFilters.includes(chase)
        ? chaseFilters.filter((selectedChase) => selectedChase !== chase)
        : [...chaseFilters, chase],
    );
  }

  return (
    <div
      aria-labelledby="card-filter-title"
      aria-modal="true"
      className="fixed inset-0 z-50 grid place-items-center bg-black/30 px-4 py-6"
      role="dialog"
    >
      <section className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-zinc-300 bg-white shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-zinc-200 p-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#8a1f2d]">
              Filters
            </p>
            <h2 className="mt-1 text-xl font-bold" id="card-filter-title">
              Refine cards
            </h2>
            <p className="mt-1 text-sm font-medium text-zinc-500">
              {activeFilterCount
                ? `${activeFilterCount} active`
                : "No filters active"}{" "}
              <span className="text-zinc-400">
                · mix as many options as you need
              </span>
            </p>
          </div>
          <button
            aria-label="Close filters"
            className="grid size-9 place-items-center rounded-md border border-zinc-300 text-zinc-600 transition hover:border-zinc-950 hover:text-zinc-950"
            onClick={onClose}
            type="button"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="grid gap-4 overflow-auto p-4">
          <div className="rounded-lg border border-zinc-200 bg-zinc-50/60 p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-zinc-700">
                Card type
              </span>
              {typeFilters.length ? (
                <button
                  className="text-xs font-bold text-[#8a1f2d] transition hover:text-[#711826]"
                  onClick={() => setTypeFilters([])}
                  type="button"
                >
                  Any type
                </button>
              ) : null}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {cardTypeFilters.map((option) => {
                const selected = typeFilters.includes(option.value);

                return (
                  <button
                    aria-pressed={selected}
                    className={`rounded-md border px-2.5 py-1.5 text-sm font-semibold transition ${
                      selected
                        ? "border-[#8a1f2d]/30 bg-rose-50 text-[#8a1f2d]"
                        : "border-zinc-300 bg-white text-zinc-600 hover:border-zinc-950 hover:text-zinc-950"
                    }`}
                    key={option.value}
                    onClick={() => toggleType(option.value)}
                    type="button"
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-lg border border-zinc-200 bg-zinc-50/60 p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <span className="text-sm font-medium text-zinc-700">Rarity</span>
                <span className="ml-2 text-xs font-semibold text-zinc-500">
                  {rarityFilters.length
                    ? `${rarityFilters.length} selected`
                    : "Any rarity"}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <button
                  className="text-xs font-bold text-[#8a1f2d] transition hover:text-[#711826] disabled:text-zinc-400"
                  disabled={allRaritiesSelected || !rarityOptions.length}
                  onClick={selectAllRarities}
                  type="button"
                >
                  Select all
                </button>
                <button
                  className="text-xs font-bold text-[#8a1f2d] transition hover:text-[#711826] disabled:text-zinc-400"
                  disabled={!rarityFilters.length}
                  onClick={() => setRarityFilters([])}
                  type="button"
                >
                  Deselect all
                </button>
              </div>
            </div>
            <label className="relative mt-2 block">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
              <input
                aria-label="Search rarity filters"
                className="h-10 w-full rounded-md border border-zinc-300 bg-white pl-9 pr-3 text-sm outline-none transition focus:border-[#8a1f2d]"
                onChange={(event) => setRaritySearch(event.target.value)}
                placeholder="Search and select multiple rarities"
                value={raritySearch}
              />
            </label>
            <div className="mt-2 max-h-44 overflow-auto rounded-md border border-zinc-200 bg-white p-2">
              {visibleRarityOptions.length ? (
                <div className="flex flex-wrap gap-2">
                  {visibleRarityOptions.map((rarity) => {
                    const selected = rarityFilters.includes(rarity);

                    return (
                      <button
                        aria-pressed={selected}
                        className={`inline-flex min-h-9 items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-sm font-semibold transition ${
                          selected
                            ? "border-[#8a1f2d]/30 bg-rose-50 text-[#8a1f2d]"
                            : "border-zinc-300 bg-white text-zinc-600 hover:border-zinc-950 hover:text-zinc-950"
                        }`}
                        key={rarity}
                        onClick={() => toggleRarity(rarity)}
                        type="button"
                      >
                        <span>{rarity}</span>
                        {selected ? (
                          <Check className="size-4 shrink-0" />
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="px-2 py-3 text-sm font-semibold text-zinc-500">
                  No rarities match that search.
                </p>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-zinc-200 bg-zinc-50/60 p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-zinc-700">Price</span>
              {selectedPriceSignalFilters.length || priceMin || priceMax ? (
                <button
                  className="text-xs font-bold text-[#8a1f2d] transition hover:text-[#711826]"
                  onClick={() => {
                    setPriceSignalFilters([]);
                    setPriceMin("");
                    setPriceMax("");
                  }}
                  type="button"
                >
                  Any price
                </button>
              ) : null}
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {priceSignalFilterOptions
                .filter((option) => canFilterPaid || option.value !== "paid")
                .map((option) => {
                  const selected = selectedPriceSignalFilters.includes(option.value);

                  return (
                    <button
                      aria-pressed={selected}
                      className={`rounded-md border px-3 py-2 text-left transition ${
                        selected
                          ? "border-[#8a1f2d]/30 bg-rose-50 text-[#8a1f2d]"
                          : "border-zinc-300 bg-white text-zinc-600 hover:border-zinc-950 hover:text-zinc-950"
                      }`}
                      key={option.value}
                      onClick={() => togglePriceSignal(option.value)}
                      type="button"
                    >
                      <span className="block text-sm font-bold">
                        {option.label}
                      </span>
                      <span className="mt-0.5 block text-xs font-semibold opacity-70">
                        {option.hint}
                      </span>
                    </button>
                  );
                })}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-xs font-bold uppercase tracking-[0.12em] text-zinc-500">
                  Min
                </span>
                <input
                  className="mt-1 h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm outline-none transition focus:border-[#8a1f2d]"
                  inputMode="decimal"
                  onChange={(event) => setPriceMin(event.target.value)}
                  placeholder="£0"
                  value={priceMin}
                />
              </label>
              <label className="block">
                <span className="text-xs font-bold uppercase tracking-[0.12em] text-zinc-500">
                  Max
                </span>
                <input
                  className="mt-1 h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm outline-none transition focus:border-[#8a1f2d]"
                  inputMode="decimal"
                  onChange={(event) => setPriceMax(event.target.value)}
                  placeholder="£100"
                  value={priceMax}
                />
              </label>
            </div>
            <p className="mt-2 text-xs font-semibold leading-5 text-zinc-500">
              Range uses the visible market price: manual price first, then eBay
              estimate.
            </p>
          </div>

          <div className="rounded-lg border border-zinc-200 bg-zinc-50/60 p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-zinc-700">Chase</span>
              {chaseFilters.length ? (
                <button
                  className="text-xs font-bold text-[#8a1f2d] transition hover:text-[#711826]"
                  onClick={() => setChaseFilters([])}
                  type="button"
                >
                  Any chase
                </button>
              ) : null}
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {chaseFilterOptions.map((option) => {
                const selected = chaseFilters.includes(option.value);

                return (
                  <button
                    aria-pressed={selected}
                    className={`min-h-14 rounded-md border px-2 py-2 text-center transition ${
                      selected
                        ? "border-[#8a1f2d]/30 bg-rose-50 text-[#8a1f2d]"
                        : "border-zinc-300 bg-white text-zinc-600 hover:border-zinc-950 hover:text-zinc-950"
                    }`}
                    key={option.value}
                    onClick={() => toggleChase(option.value)}
                    type="button"
                  >
                    <span className="block text-base font-black">
                      {option.label}
                    </span>
                    <span className="mt-0.5 block text-[11px] font-semibold opacity-70">
                      {option.hint}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-zinc-200 bg-white p-4">
          <button
            className="h-10 rounded-md border border-zinc-300 px-3 text-sm font-semibold text-zinc-700 transition hover:border-zinc-950 hover:text-zinc-950 disabled:opacity-40"
            disabled={!activeFilterCount}
            onClick={onClear}
            type="button"
          >
            Clear filters
          </button>
          <button
            className="h-10 rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white transition hover:bg-zinc-800"
            onClick={onClose}
            type="button"
          >
            Done
          </button>
        </div>
      </section>
    </div>
  );
}

function AddCardForm({
  createError,
  form,
  isPending,
  onSubmit,
  setForm,
}: {
  createError: { message: string } | null;
  form: CardForm;
  isPending: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  setForm: (updater: (current: CardForm) => CardForm) => void;
}) {
  const [extracting, setExtracting] = useState(false);
  const [extractionError, setExtractionError] = useState<string | null>(null);
  const [extractedSummary, setExtractedSummary] = useState<string | null>(null);

  async function extractFromTcgplayer() {
    const url = form.url.trim();
    if (!url) {
      setExtractionError("Paste a TCGplayer product link first.");
      return;
    }
    setExtracting(true);
    setExtractionError(null);
    setExtractedSummary(null);
    setForm((current) => ({ ...current, name: "", rarity: "", imageUrl: "", priceText: "" }));
    try {
      const response = await fetch("/api/records/metadata", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const body = await response.json() as {
        message?: string;
        metadata?: {
          edition?: CardForm["edition"];
          imageUrl?: string;
          rarity?: string;
          setCode?: string;
          setName?: string;
          title?: string;
        };
      };
      if (!response.ok || !body.metadata) {
        throw new Error(body.message || "TCGplayer details could not be fetched. Try again or fill in the fields manually.");
      }
      const metadata = body.metadata;
      setForm((current) => ({
        ...current,
        name: metadata.title || "",
        rarity: metadata.rarity || "",
        edition: metadata.edition || current.edition || "1st Edition",
        imageUrl: metadata.imageUrl || "",
      }));
      setExtractedSummary([
        metadata.title,
        metadata.rarity,
        [metadata.setName, metadata.setCode].filter(Boolean).join(" · "),
      ].filter(Boolean).join(" — "));
    } catch (error) {
      setExtractionError(error instanceof Error ? error.message : "TCGplayer details could not be fetched.");
    } finally {
      setExtracting(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={onSubmit}>
      <label className="block">
        <span className="text-sm font-medium text-zinc-700">
          TCGplayer product link <span className="text-rose-700">*</span>
        </span>
        <div className="mt-1 flex gap-2">
          <input
            autoFocus
            className="h-11 min-w-0 flex-1 rounded-md border border-zinc-300 bg-zinc-50 px-3 text-sm outline-none transition focus:border-[#8a1f2d] focus:bg-white"
            onChange={(event) => {
              setExtractionError(null);
              setExtractedSummary(null);
              setForm((current) => ({ ...current, url: event.target.value }));
            }}
            placeholder="https://www.tcgplayer.com/product/..."
            type="url"
            value={form.url}
          />
          <button
            className="inline-flex h-11 shrink-0 items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-bold text-zinc-700 transition hover:border-[#8a1f2d] hover:bg-rose-50 hover:text-[#8a1f2d] disabled:cursor-wait disabled:opacity-50"
            disabled={extracting || !form.url.trim()}
            onClick={() => void extractFromTcgplayer()}
            type="button"
          >
            <RefreshCw className={`size-4 ${extracting ? "animate-spin" : ""}`} />
            {extracting ? "Fetching" : "Fetch details"}
          </button>
        </div>
        <span className="mt-1 block text-xs font-medium text-zinc-500">
          Fetch name, rarity, edition, set details, and image. Review the populated fields before adding.
        </span>
        {extractionError ? <p className="mt-2 text-sm font-semibold text-rose-700" role="alert">{extractionError}</p> : null}
        {extractedSummary ? <p className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800" role="status">Details loaded: {extractedSummary}</p> : null}
      </label>

      <label className="block">
        <span className="text-sm font-medium text-zinc-700">Card name</span>
        <input
          className="mt-1 h-11 w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 text-sm outline-none transition focus:border-[#8a1f2d] focus:bg-white"
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              name: event.target.value,
            }))
          }
          placeholder="Blue-Eyes White Dragon"
          value={form.name}
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="text-sm font-medium text-zinc-700">
              Manual market price
            </span>
          <input
            className="mt-1 h-11 w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 text-sm outline-none transition focus:border-[#8a1f2d] focus:bg-white"
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                priceText: event.target.value,
              }))
            }
            placeholder="£12.50"
            value={form.priceText}
          />
        </label>
        <RarityCombobox
          value={form.rarity}
          onChange={(rarity) => setForm((current) => ({ ...current, rarity }))}
        />
        <label className="block">
          <span className="text-sm font-medium text-zinc-700">Edition <span className="text-rose-700">*</span></span>
          <select className="mt-1 h-11 w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 text-sm outline-none transition focus:border-[#8a1f2d] focus:bg-white" onChange={(event) => setForm((current) => ({ ...current, edition: event.target.value as CardForm["edition"] }))} value={form.edition}>
            <option value="1st Edition">1st Edition</option>
            <option value="Unlimited Edition">Unlimited Edition</option>
            <option value="Limited Edition">Limited Edition</option>
          </select>
        </label>
      </div>

      <div className="grid gap-3 rounded-md border border-zinc-200 bg-zinc-50 p-3 sm:grid-cols-[1fr_1fr]">
        <div>
          <p className="text-sm font-bold text-zinc-800">Wishlist Target</p>
          <p className="mt-1 text-xs font-medium leading-5 text-zinc-500">
            Adding here records what you want. Use a Purchase or Pack opening to create physical copies.
          </p>
        </div>
        <label className="block">
          <span className="text-sm font-medium text-zinc-700">Chase</span>
          <select
            className="mt-1 h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm outline-none transition focus:border-[#8a1f2d]"
            onChange={(event) =>
              setForm((current) => ({ ...current, chaseLevel: event.target.value }))
            }
            value={form.chaseLevel}
          >
            <option value="">None</option>
            <option value="5">5 - next</option>
            <option value="4">4</option>
            <option value="3">3</option>
            <option value="2">2</option>
            <option value="1">1 - later</option>
          </select>
        </label>
      </div>

      <label className="block">
        <span className="text-sm font-medium text-zinc-700">Image URL</span>
        <input
          className="mt-1 h-11 w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 text-sm outline-none transition focus:border-[#8a1f2d] focus:bg-white"
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              imageUrl: event.target.value,
            }))
          }
          placeholder="Optional fallback image"
          type="url"
          value={form.imageUrl}
        />
      </label>

      <label className="block">
        <span className="text-sm font-medium text-zinc-700">Notes</span>
        <textarea
          className="mt-1 min-h-24 w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm outline-none transition focus:border-[#8a1f2d] focus:bg-white"
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              notes: event.target.value,
            }))
          }
          placeholder="Set, condition, max price..."
          value={form.notes}
        />
      </label>

      {createError ? (
        <p
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          role="alert"
        >
          {createError.message}
        </p>
      ) : null}

      <button
        className="flex h-11 w-full items-center justify-center gap-2 rounded-md bg-[#8a1f2d] px-4 text-sm font-semibold text-white transition hover:bg-[#711826] disabled:cursor-not-allowed disabled:bg-zinc-300"
        disabled={isPending || !form.url || !form.rarity}
        type="submit"
      >
        {isPending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Plus className="size-4" />
        )}
        Add wishlist target
      </button>
    </form>
  );
}

function AddCardDialog({
  createError,
  form,
  isPending,
  onClose,
  onSubmit,
  setForm,
}: {
  createError: { message: string } | null;
  form: CardForm;
  isPending: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  setForm: (updater: (current: CardForm) => CardForm) => void;
}) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return (
    <div
      aria-labelledby="add-card-title"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-end justify-center bg-zinc-950/40 px-0 pt-10 backdrop-blur-sm lg:items-center lg:px-4 lg:py-6"
      role="dialog"
    >
      <section className="flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-lg border border-zinc-300 bg-white shadow-2xl lg:max-h-[90vh] lg:max-w-2xl lg:rounded-lg">
        <div className="flex items-center justify-between gap-4 border-b border-zinc-200 p-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#8a1f2d]">
              Add wishlist target
            </p>
            <h2 className="mt-1 text-xl font-bold" id="add-card-title">
              Add to Library
            </h2>
          </div>
          <button
            aria-label="Close add wishlist target form"
            className="grid size-10 place-items-center rounded-md border border-zinc-300 text-zinc-600 transition hover:border-zinc-950 hover:text-zinc-950"
            onClick={onClose}
            type="button"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="overflow-auto p-4">
          <AddCardForm
            createError={createError}
            form={form}
            isPending={isPending}
            onSubmit={onSubmit}
            setForm={setForm}
          />
        </div>
      </section>
    </div>
  );
}

function CardImagePreviewDialog({
  card,
  onClose,
}: {
  card: Card;
  onClose: () => void;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  function updateTilt(event: MouseEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;

    setTilt({
      x: Number((-y * 10).toFixed(2)),
      y: Number((x * 12).toFixed(2)),
    });
  }

  return (
    <div
      aria-labelledby="card-image-preview-title"
      aria-modal="true"
      className="fixed inset-0 z-50 grid place-items-center bg-zinc-950/70 px-4 py-6 backdrop-blur-sm"
      role="dialog"
    >
      <div className="relative w-full max-w-md text-center">
        <button
          aria-label="Close card image"
          className="absolute right-0 top-0 z-10 grid size-10 translate-x-3 -translate-y-3 place-items-center rounded-md border border-zinc-700 bg-zinc-950/80 text-zinc-300 shadow-sm transition hover:border-white hover:text-white"
          onClick={onClose}
          ref={closeButtonRef}
          title="Close card image"
          type="button"
        >
          <X className="size-4" />
        </button>
        <div
          className="mx-auto w-[min(82vw,360px)]"
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
              alt={card.name}
              className="aspect-[59/86] overflow-hidden rounded-lg border border-white/15 bg-zinc-900"
              imageUrl={card.imageUrl}
              rarity={card.rarity}
              tilt={tilt}
            />
          </div>
        </div>
        <h2
          className="mt-4 text-2xl font-bold leading-tight text-white"
          id="card-image-preview-title"
        >
          {card.name}
        </h2>
        <div className="mt-4 flex justify-center">
          <a
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-white/20 bg-white/10 px-4 text-sm font-bold text-white transition hover:bg-white/15"
            href={ebaySearchUrl(card)}
            rel="noreferrer"
            target="_blank"
          >
            eBay
            <ExternalLink className="size-4" />
          </a>
        </div>
      </div>
    </div>
  );
}

export function WishlistApp() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const clientReady = useClientReady();
  const {
    chaseFilters,
    filter,
    page,
    priceMax,
    priceMin,
    priceSignalFilters,
    query,
    rarityFilters,
    sort,
    typeFilters,
  } = useMemo(() => trackerUrlState(searchParams), [searchParams]);
  const [searchInput, setSearchInput] = useState(query);
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  const [addFormOpen, setAddFormOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [imagePreviewCard, setImagePreviewCard] = useState<Card | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Card | null>(null);
  const [pricingError, setPricingError] = useState<string | null>(null);
  const [pricingRun, setPricingRun] = useState<PricingRun | null>(null);
  const utils = trpc.useUtils();

  const updateTrackerUrl = useCallback(function updateTrackerUrl(
    updates: Partial<
      Record<TrackerUrlParam, string | string[] | null | undefined>
    >,
    { replace = false }: { replace?: boolean } = {},
  ) {
    const nextSearchParams = new URLSearchParams(searchParams.toString());

    for (const [key, value] of Object.entries(updates)) {
      nextSearchParams.delete(key);

      if (Array.isArray(value)) {
        value.forEach((item) => nextSearchParams.append(key, item));
      } else if (value) {
        nextSearchParams.set(key, value);
      }
    }

    const queryString = nextSearchParams.toString();
    const href = queryString ? `${pathname}?${queryString}` : pathname;

    if (replace) {
      window.history.replaceState(null, "", href);
    } else {
      window.history.pushState(null, "", href);
    }
  }, [pathname, searchParams]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setSearchInput(query);
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [query]);

  useEffect(() => {
    if (searchInput === query) return;
    const timeoutId = window.setTimeout(() => {
      updateTrackerUrl(
        { page: null, q: searchInput || null },
        { replace: true },
      );
    }, 250);
    return () => window.clearTimeout(timeoutId);
  }, [query, searchInput, updateTrackerUrl]);

  function invalidateCardsAndSpend() {
    void utils.cards.binderList.invalidate();
    void utils.cards.chaseQueue.invalidate();
    void utils.cards.list.invalidate();
    void utils.cards.summary.invalidate();
    void utils.cards.trackerPage.invalidate();
    void utils.binder.layout.invalidate();
    void utils.spend.currentMonth.invalidate();
    void utils.spend.monthlyFavourites.invalidate();
    void utils.wheel.state.invalidate();
  }

  const trackerInput = useMemo(
    () => ({
      chaseFilters,
      page,
      pageSize,
      priceMax,
      priceMin,
      priceSignalFilters,
      query,
      rarityFilters,
      sort,
      status: filter,
      typeFilters,
    }),
    [
      chaseFilters,
      filter,
      page,
      priceMax,
      priceMin,
      priceSignalFilters,
      query,
      rarityFilters,
      sort,
      typeFilters,
    ],
  );
  const list = trpc.cards.trackerPage.useQuery(trackerInput, {
    enabled: clientReady,
    placeholderData: (previousData) => previousData,
    staleTime: 30_000,
  });
  const create = trpc.cards.create.useMutation({
    onSuccess: () => {
      setForm(emptyForm());
      setAddFormOpen(false);
      invalidateCardsAndSpend();
    },
  });
  const refreshPricing = trpc.cards.refreshPricing.useMutation();
  const deleteCard = trpc.cards.delete.useMutation({
    onSuccess: invalidateCardsAndSpend,
  });
  const updateCard = trpc.cards.update.useMutation({
    onSuccess: () => {
      setEditForm(null);
      invalidateCardsAndSpend();
    },
  });

  const rarityOptions = useMemo(
    () => list.data?.rarityOptions ?? [],
    [list.data?.rarityOptions],
  );
  const activeFilterCount = useMemo(
    () =>
      typeFilters.length +
      rarityFilters.length +
      priceSignalFilters.length +
      chaseFilters.length +
      [priceMin.trim(), priceMax.trim()].filter(Boolean).length,
    [
      chaseFilters.length,
      priceMax,
      priceMin,
      priceSignalFilters.length,
      rarityFilters.length,
      typeFilters.length,
    ],
  );
  const cards = list.data?.items ?? [];
  const totalCards = list.data?.total ?? 0;
  const totalPages = list.data?.totalPages ?? 1;
  const currentPage = list.data?.page ?? Math.min(page, totalPages);
  const paginatedCards = cards;
  const firstVisibleCard = totalCards ? (currentPage - 1) * pageSize + 1 : 0;
  const lastVisibleCard = Math.min(currentPage * pageSize, totalCards);
  const counts = list.data?.counts ?? { owned: 0, total: 0, wishlist: 0 };
  const values = list.data?.values ?? { owned: 0, paid: 0, wishlist: 0 };
  const canEdit = list.data?.canEdit ?? false;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canEdit) {
      return;
    }
    create.mutate({
      name: form.name || undefined,
      url: form.url,
      imageUrl: form.imageUrl || undefined,
      marketPriceText: normalizeMarketPrice(form.priceText) || undefined,
      rarity: form.rarity,
      edition: form.edition,
      chaseLevel: form.chaseLevel ? Number(form.chaseLevel) : null,
      status: "wishlist",
      notes: form.notes || undefined,
    });
  }

  function deleteCardById(cardId: string) {
    const card = cards.find((item) => item.id === cardId);
    if (!card) return;
    setEditForm(null);
    setDeleteTarget(card);
  }

  function clearFilters() {
    updateTrackerUrl({
      chase: null,
      maxPrice: null,
      minPrice: null,
      page: null,
      priceSignal: null,
      rarity: null,
      type: null,
    });
  }

  async function refreshAllPrices() {
    if (pricingRun?.running) return;
    setPricingError(null);
    try {
      const candidates = await utils.cards.pricingCandidates.fetch();
      const initial: PricingRun = {
        completed: 0,
        estimated: 0,
        failed: 0,
        minimized: false,
        noMatch: 0,
        running: true,
        total: candidates.length,
      };
      setPricingRun(initial);
      let completed = 0;
      let estimated = 0;
      let failed = 0;
      let noMatch = 0;
      let consecutiveFailures = 0;

      for (let index = 0; index < candidates.length; index += 2) {
        const batch = await Promise.allSettled(
          candidates.slice(index, index + 2).map((candidate) => (
            refreshPricing.mutateAsync({ id: candidate.id })
          )),
        );
        for (const result of batch) {
          completed += 1;
          if (result.status === "fulfilled") {
            consecutiveFailures = 0;
            if (result.value.estimatedPricePence === null) noMatch += 1;
            else estimated += 1;
          } else {
            failed += 1;
            consecutiveFailures += 1;
          }
        }
        setPricingRun((current) => ({
          completed,
          estimated,
          failed,
          minimized: current?.minimized ?? false,
          noMatch,
          running: true,
          total: candidates.length,
        }));
        if (consecutiveFailures >= 6) {
          throw new Error("eBay stopped responding repeatedly, so the refresh was paused to avoid losing progress visibility. Try again later.");
        }
        if (index + 2 < candidates.length) {
          await new Promise((resolve) => window.setTimeout(resolve, 150));
        }
      }
      setPricingRun((current) => ({ completed, estimated, failed, minimized: current?.minimized ?? false, noMatch, running: false, total: candidates.length }));
      invalidateCardsAndSpend();
    } catch (error) {
      setPricingRun((current) => current ? { ...current, running: false } : null);
      setPricingError(error instanceof Error ? error.message : "Price refresh stopped unexpectedly. Try again shortly.");
    }
  }

  function openCardEditor(card: Card) {
    if (!canEdit) {
      return;
    }
    setEditForm(editFormFromCard(card));
  }

  function saveEdit() {
    if (!editForm || editForm.edition === "Unknown edition") {
      return;
    }

    updateCard.mutate({
      id: editForm.id,
      name: editForm.name,
      url: editForm.url || undefined,
      imageUrl: editForm.imageUrl || undefined,
      priceText: editForm.priceText || undefined,
      marketPriceText: normalizeMarketPrice(editForm.marketPriceText) || undefined,
      ebayListingUrl: editForm.status === "wishlist" ? editForm.ebayListingUrl : "",
      rarity: editForm.rarity || undefined,
      edition: editForm.edition,
      chaseLevel:
        editForm.status === "wishlist" && editForm.chaseLevel
          ? Number(editForm.chaseLevel)
          : null,
      status: editForm.status,
      notes: editForm.notes || undefined,
    });
  }

  return (
    <main className="app-page-shell min-h-screen bg-[#f6f4ef] px-4 py-5 text-zinc-950 sm:px-6">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <AppHeader
          eyebrow="Cards, targets, and market estimates"
          title="Library"
          actions={
            <div className="grid w-full grid-cols-3 overflow-hidden rounded-lg border border-zinc-300 bg-white text-center shadow-sm sm:min-w-[420px]">
            <div className="border-r border-zinc-200 px-4 py-3">
              <p className="text-2xl font-bold">{counts.total}</p>
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500">
                Tracked
              </p>
            </div>
            <div className="border-r border-zinc-200 px-4 py-3">
              <p className="text-2xl font-bold text-[#8a1f2d]">
                {counts.wishlist}
              </p>
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500">
                Wants
              </p>
              <p className="mt-1 text-xs font-semibold text-zinc-400">
                {formatCurrency(values.wishlist)}
              </p>
            </div>
            <div className="px-4 py-3">
              <p className="text-2xl font-bold text-[#196047]">
                {counts.owned}
              </p>
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500">
                Owned
              </p>
              <div className="mt-1 flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 text-xs font-semibold leading-4 text-zinc-400">
                <span>Worth {formatCurrency(values.owned)}</span>
                {canEdit && values.paid ? (
                  <span>Paid {formatCurrency(values.paid)}</span>
                ) : null}
              </div>
            </div>
          </div>
          }
        />

        <section className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-col gap-3 rounded-lg border border-zinc-300 bg-white p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold">Cards</h2>
              <p className="mt-1 text-sm font-medium text-zinc-500">
                Browse wishlist targets and current cards. Use Records for purchases, pulls, and sales.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <RarityGuidePopover />
              {canEdit ? (
                <>
                  <button
                    aria-label="Refresh current UK eBay estimates for all cards"
                    className="grid size-11 place-items-center rounded-md border border-zinc-300 bg-white text-zinc-600 transition hover:border-[#8a1f2d] hover:bg-rose-50 hover:text-[#8a1f2d] disabled:cursor-wait disabled:opacity-50"
                    disabled={pricingRun?.running}
                    onClick={() => void refreshAllPrices()}
                    title="Refresh current UK eBay estimates"
                    type="button"
                  >
                    <RefreshCw
                      aria-hidden="true"
                      className={`size-4 ${
                        pricingRun?.running ? "animate-spin" : ""
                      }`}
                    />
                  </button>
                  <button
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-[#8a1f2d] px-4 text-sm font-semibold text-white transition hover:bg-[#711826]"
                    onClick={() => setAddFormOpen(true)}
                    type="button"
                  >
                    <Plus className="size-4" />
                    Add target
                  </button>
                </>
              ) : null}
            </div>
          </div>

          <section className="flex min-w-0 flex-col gap-4">
            <div className="flex flex-col gap-3 rounded-lg border border-zinc-300 bg-white p-3 shadow-sm">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="flex rounded-md border border-zinc-300 bg-zinc-100 p-1">
                  {filters.map((item) => (
                    <button
                      key={item.value}
                      onClick={() => {
                        updateTrackerUrl({
                          page: null,
                          status: item.value === "all" ? null : item.value,
                        });
                      }}
                      className={`h-9 rounded px-3 text-sm font-semibold transition ${
                        filter === item.value
                          ? "bg-white text-zinc-950 shadow-sm"
                          : "text-zinc-600 hover:text-zinc-950"
                      }`}
                      type="button"
                    >
                      {item.label}
                    </button>
                  ))}
                </div>

                <label className="relative w-full md:max-w-xs">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
                  <input
                    value={searchInput}
                    onChange={(event) => setSearchInput(event.target.value)}
                    className="h-10 w-full rounded-md border border-zinc-300 bg-zinc-50 pl-9 pr-3 text-sm outline-none transition focus:border-[#8a1f2d] focus:bg-white"
                    placeholder="Search cards, rarity, notes"
                  />
                </label>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <select
                  aria-label="Sort cards"
                  className="h-10 rounded-md border border-zinc-300 bg-zinc-50 px-3 text-sm font-semibold text-zinc-700 outline-none transition focus:border-[#8a1f2d] focus:bg-white sm:w-56"
                  onChange={(event) => {
                    const nextSort = event.target.value as SortOption;
                    updateTrackerUrl({
                      page: null,
                      sort: nextSort === "updated" ? null : nextSort,
                    });
                  }}
                  value={sort}
                >
                  {sortOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>

                <div className="flex items-center gap-2">
                  <button
                    className={`inline-flex h-10 items-center gap-2 rounded-md border px-3 text-sm font-semibold transition ${
                      activeFilterCount
                        ? "border-[#8a1f2d]/30 bg-rose-50 text-[#8a1f2d]"
                        : "border-zinc-300 bg-white text-zinc-700 hover:border-zinc-950 hover:text-zinc-950"
                    }`}
                    onClick={() => setFilterModalOpen(true)}
                    type="button"
                  >
                    <SlidersHorizontal className="size-4" />
                    Filters
                    {activeFilterCount ? (
                      <span className="rounded bg-[#8a1f2d] px-1.5 py-0.5 text-xs font-bold text-white">
                        {activeFilterCount}
                      </span>
                    ) : null}
                  </button>
                  <button
                    className="h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-600 transition hover:border-zinc-950 hover:text-zinc-950 disabled:cursor-not-allowed disabled:opacity-40"
                    disabled={!activeFilterCount}
                    onClick={clearFilters}
                    type="button"
                  >
                    Clear filters
                  </button>
                </div>
              </div>
            </div>

            {list.isError ? (
              <DataLoadError
                onRetry={() => void list.refetch()}
                title="We couldn’t open the collection"
              />
            ) : !clientReady || list.isLoading ? (
              <div className="grid min-h-80 place-items-center rounded-lg border border-zinc-300 bg-white">
                <Loader2 className="size-6 animate-spin text-[#8a1f2d]" />
              </div>
            ) : cards.length === 0 ? (
              <div className="grid min-h-80 place-items-center rounded-lg border border-dashed border-zinc-300 bg-white px-4 text-center">
                <div>
                  <Star className="mx-auto mb-3 size-8 text-[#8a1f2d]" />
                  <h2 className="text-lg font-semibold">No cards tracked yet</h2>
                  <p className="mt-1 max-w-sm text-sm text-zinc-500">
                    Add a marketplace link or type a card name manually to start
                    your local list.
                  </p>
                </div>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
                  {paginatedCards.map((card: Card) => (
                    <article
                      key={card.id}
                      className="group flex h-full min-w-0 flex-col overflow-hidden rounded-lg border border-zinc-300 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-zinc-400 hover:shadow-md"
                    >
                      <div className="grid aspect-[4/5] w-full place-items-center border-b border-zinc-200 bg-[#f7f6f2] p-3">
                        {card.imageUrl ? (
                          <button
                            aria-label={`Open larger image of ${card.name}`}
                            className="group/image relative grid h-full w-full cursor-zoom-in place-items-center rounded-md transition hover:bg-zinc-100 focus-visible:bg-zinc-100"
                            onClick={() => setImagePreviewCard(card)}
                            title="Open larger image"
                            type="button"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              alt={card.name}
                              className="aspect-[59/86] h-full max-h-full w-auto max-w-full rounded-sm object-contain shadow-sm transition duration-200 group-hover/image:scale-[1.03] group-focus-visible/image:scale-[1.03]"
                              loading="lazy"
                              src={card.imageUrl}
                            />
                            <span
                              aria-hidden
                              className="absolute right-1.5 top-1.5 grid size-7 place-items-center rounded-md border border-white/20 bg-zinc-950/75 text-white opacity-0 shadow-sm transition group-hover/image:opacity-100 group-focus-visible/image:opacity-100"
                            >
                              <Search className="size-3.5" />
                            </span>
                          </button>
                        ) : (
                          <div className="grid aspect-[59/86] h-full max-w-full place-items-center rounded border border-dashed border-zinc-300 px-3 text-center text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                            No image
                          </div>
                        )}
                      </div>

                      <div className="flex min-w-0 flex-1 flex-col gap-3 p-3">
                        <div className="flex min-w-0 items-start gap-2">
                          <div className="min-w-0 flex-1">
                            {canEdit ? (
                              <button
                                className="line-clamp-2 text-left text-[17px] font-bold leading-[1.2] text-zinc-950 underline-offset-4 transition hover:text-[#8a1f2d] hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8a1f2d] sm:text-lg"
                                onClick={() => openCardEditor(card)}
                                title={`Edit ${card.name}`}
                                type="button"
                              >
                                {card.name}
                              </button>
                            ) : (
                              <h3
                                className="line-clamp-2 text-[17px] font-bold leading-[1.2] text-zinc-950 sm:text-lg"
                                title={card.name}
                              >
                                {card.name}
                              </h3>
                            )}
                          </div>
                          <span
                            className={`shrink-0 rounded-md px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] ${
                              card.status === "owned"
                                ? "bg-emerald-50 text-emerald-700"
                                : "bg-rose-50 text-rose-700"
                            }`}
                          >
                            {card.status === "owned" ? "Owned" : "Want"}
                          </span>
                        </div>

                        <div className="grid gap-2">
                          {(card.marketPriceText || card.priceText) ? (
                            <div className="min-w-0">
                              <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
                                <span className="text-xl font-extrabold leading-none tabular-nums text-zinc-950">
                                  {card.marketPriceText ?? card.priceText}
                                </span>
                                {card.marketPriceText ? (
                                  <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-[#8a1f2d]">
                                    Manual
                                  </span>
                                ) : null}
                              </div>
                              {card.marketPriceText && card.priceText ? (
                                <p className="mt-1 truncate text-xs font-semibold text-zinc-500">
                                  eBay estimate {card.priceText}
                                </p>
                              ) : null}
                            </div>
                          ) : null}

                          <div className="flex flex-wrap items-center gap-1.5">
                            {rarityAbbreviation(card.rarity) ? (
                              <span
                                className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs font-bold uppercase tracking-[0.08em] text-zinc-700"
                                title={card.rarity ?? undefined}
                              >
                                {rarityAbbreviation(card.rarity)}
                              </span>
                            ) : null}
                            {card.status === "wishlist" && card.chaseLevel ? (
                              <span className="rounded-md border border-rose-100 bg-rose-50 px-2 py-1 text-xs font-bold text-rose-700">
                                Chase {card.chaseLevel}
                              </span>
                            ) : null}
                            {card.status === "owned" && card.paidPriceText ? (
                              <span className="rounded-md border border-emerald-100 bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-700">
                                {normalizePaidPrice(card.paidPriceText)}
                              </span>
                            ) : null}
                            {card.status === "owned" && card.purchaseMonth ? (
                              <span className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs font-semibold text-zinc-600">
                                {monthLabel(card.purchaseMonth)}
                              </span>
                            ) : null}
                            <CardNoteIndicator
                              align="right"
                              label={`View note for ${card.name}`}
                              note={card.notes}
                            />
                          </div>
                        </div>

                        <div className="mt-auto flex flex-col gap-2 border-t border-zinc-100 pt-3">
                          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                            {isTcgplayerUrl(card.url) ? (
                              <a
                                aria-label={`Open ${card.name} on TCGplayer`}
                                className="inline-flex h-8 items-center justify-center rounded-md border border-zinc-300 bg-white px-2 text-xs font-bold text-zinc-700 transition hover:border-[#8a1f2d] hover:bg-rose-50 hover:text-[#8a1f2d]"
                                href={card.url ?? undefined}
                                rel="noreferrer"
                                target="_blank"
                                title="TCGplayer"
                              >
                                TCG
                              </a>
                            ) : null}
                            <a
                              aria-label={`Open eBay search for ${card.name}`}
                              className="inline-flex h-8 items-center justify-center rounded-md border border-zinc-300 bg-white px-2 text-xs font-bold text-zinc-700 transition hover:border-[#8a1f2d] hover:bg-rose-50 hover:text-[#8a1f2d]"
                              href={ebaySearchUrl(card)}
                              rel="noreferrer"
                              target="_blank"
                              title="eBay search"
                            >
                              eBay
                            </a>
                            {card.url && !isTcgplayerUrl(card.url) ? (
                              <a
                                aria-label={`Open saved link for ${card.name}`}
                                className="inline-flex size-8 items-center justify-center rounded-md border border-zinc-300 bg-white text-zinc-600 transition hover:border-[#8a1f2d] hover:bg-rose-50 hover:text-[#8a1f2d]"
                                href={card.url}
                                rel="noreferrer"
                                target="_blank"
                                title="Saved link"
                              >
                                <ExternalLink className="size-4" />
                              </a>
                            ) : null}
                          </div>

                        </div>
                      </div>
                    </article>
                  ))}
                </div>

                {totalPages > 1 ? (
                  <nav className="flex flex-col gap-3 rounded-lg border border-zinc-300 bg-white px-3 py-3 text-sm text-zinc-600 shadow-sm sm:flex-row sm:items-center sm:justify-between">
                    <span>
                      Showing {firstVisibleCard}-{lastVisibleCard} of{" "}
                      {totalCards}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        aria-label="Previous page"
                        className="grid size-9 place-items-center rounded-md border border-zinc-300 text-zinc-600 transition hover:border-zinc-950 hover:text-zinc-950 disabled:cursor-not-allowed disabled:opacity-40"
                        disabled={currentPage === 1}
                        onClick={() => {
                          const previousPage = Math.max(1, currentPage - 1);
                          updateTrackerUrl({
                            page: previousPage === 1 ? null : String(previousPage),
                          });
                        }}
                        type="button"
                      >
                        <ChevronLeft className="size-4" />
                      </button>
                      <span className="min-w-20 text-center font-semibold text-zinc-800">
                        {currentPage} / {totalPages}
                      </span>
                      <button
                        aria-label="Next page"
                        className="grid size-9 place-items-center rounded-md border border-zinc-300 text-zinc-600 transition hover:border-zinc-950 hover:text-zinc-950 disabled:cursor-not-allowed disabled:opacity-40"
                        disabled={currentPage === totalPages}
                        onClick={() =>
                          updateTrackerUrl({
                            page: String(Math.min(totalPages, currentPage + 1)),
                          })
                        }
                        type="button"
                      >
                        <ChevronRight className="size-4" />
                      </button>
                    </div>
                  </nav>
                ) : null}
              </>
            )}
          </section>
        </section>
      </div>
      {pricingRun ? (
        <aside
          aria-label="Price refresh progress"
          className="fixed bottom-4 right-4 z-40 w-[min(24rem,calc(100vw-2rem))] rounded-lg border border-zinc-300 bg-white p-4 shadow-xl"
        >
          {pricingRun.minimized ? (
            <button
              className="flex w-full items-center justify-between gap-3 text-left"
              onClick={() => setPricingRun((current) => current ? { ...current, minimized: false } : current)}
              type="button"
            >
              <span className="font-bold text-zinc-900">{pricingRun.running ? "Refreshing estimates" : "Estimate refresh complete"}</span>
              <span className="text-sm font-bold tabular-nums text-zinc-600">{pricingRun.completed}/{pricingRun.total}</span>
            </button>
          ) : (
            <>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-black text-zinc-950">{pricingRun.running ? "Refreshing UK eBay estimates" : "Estimate refresh complete"}</p>
                  <p className="mt-1 text-sm font-medium text-zinc-600">{pricingRun.completed} of {pricingRun.total} checked</p>
                </div>
                <button
                  aria-label="Minimise price refresh progress"
                  className="grid size-10 place-items-center rounded-md border border-zinc-300 text-sm font-black text-zinc-600 transition hover:border-zinc-950 hover:text-zinc-950"
                  onClick={() => setPricingRun((current) => current ? { ...current, minimized: true } : current)}
                  type="button"
                >
                  −
                </button>
              </div>
              <div
                aria-label={`${pricingRun.completed} of ${pricingRun.total} prices checked`}
                aria-valuemax={pricingRun.total}
                aria-valuemin={0}
                aria-valuenow={pricingRun.completed}
                className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-200"
                role="progressbar"
              >
                <div className="h-full bg-[#8a1f2d] transition-[width] duration-200 ease-out" style={{ width: `${pricingRun.total ? (pricingRun.completed / pricingRun.total) * 100 : 0}%` }} />
              </div>
              <p className="mt-3 text-xs font-semibold leading-5 text-zinc-600">
                {pricingRun.estimated} estimated · {pricingRun.noMatch} no usable listing · {pricingRun.failed} failed
              </p>
              {!pricingRun.running ? (
                <button
                  className="mt-3 min-h-11 rounded-md border border-zinc-300 px-3 text-sm font-bold text-zinc-700 transition hover:border-zinc-950 hover:text-zinc-950"
                  onClick={() => setPricingRun(null)}
                  type="button"
                >
                  Dismiss
                </button>
              ) : null}
            </>
          )}
        </aside>
      ) : null}
      <DestructiveToast message={pricingError} onDismiss={() => setPricingError(null)} title="Pricing refresh stopped" />
      {imagePreviewCard ? (
        <CardImagePreviewDialog
          card={imagePreviewCard}
          onClose={() => setImagePreviewCard(null)}
        />
      ) : null}
      {addFormOpen ? (
        <AddCardDialog
          createError={create.error}
          form={form}
          isPending={create.isPending}
          onClose={() => setAddFormOpen(false)}
          onSubmit={submit}
          setForm={setForm}
        />
      ) : null}
      {canEdit && deleteTarget ? (
        <div
          aria-labelledby="delete-card-title"
          aria-modal="true"
          className="fixed inset-0 z-50 grid place-items-center bg-zinc-950/35 px-4 backdrop-blur-sm"
          role="alertdialog"
        >
          <div className="w-full max-w-sm rounded-lg border border-zinc-300 bg-[#f6f4ef] p-4 text-zinc-950 shadow-2xl">
            <p
              className="text-xs font-bold uppercase tracking-[0.16em] text-[#8a1f2d]"
              id="delete-card-title"
            >
              Delete card
            </p>
            <h2 className="mt-2 text-2xl font-bold tracking-normal">
              Remove this card?
            </h2>
            <p className="mt-2 text-sm font-medium leading-6 text-zinc-600">
              {deleteTarget.name} will be removed from the Library and any binder
              slot it appears in.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-700 transition hover:border-zinc-950 hover:text-zinc-950"
                onClick={() => setDeleteTarget(null)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="rounded-md border border-[#8a1f2d] bg-[#8a1f2d] px-3 py-2 text-sm font-bold text-white transition hover:bg-[#731925] disabled:cursor-wait disabled:opacity-60"
                disabled={deleteCard.isPending}
                onClick={() =>
                  deleteCard.mutate(
                    { id: deleteTarget.id },
                    { onSuccess: () => setDeleteTarget(null) },
                  )
                }
                type="button"
              >
                Delete card
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {canEdit && editForm ? (
        <EditCardModal
          form={editForm}
          onClose={() => setEditForm(null)}
          onDelete={deleteCardById}
          onSave={saveEdit}
          saving={updateCard.isPending}
          setForm={(updater) =>
            setEditForm((current) => (current ? updater(current) : current))
          }
        />
      ) : null}
      {filterModalOpen ? (
        <CardFilterModal
          activeFilterCount={activeFilterCount}
          canFilterPaid={canEdit}
          chaseFilters={chaseFilters}
          onClear={clearFilters}
          onClose={() => setFilterModalOpen(false)}
          priceMax={priceMax}
          priceMin={priceMin}
          priceSignalFilters={priceSignalFilters}
          rarityFilters={rarityFilters}
          rarityOptions={rarityOptions}
          setChaseFilters={(value) => {
            updateTrackerUrl({ chase: value, page: null });
          }}
          setPriceMax={(value) => {
            updateTrackerUrl(
              { maxPrice: value || null, page: null },
              { replace: true },
            );
          }}
          setPriceMin={(value) => {
            updateTrackerUrl(
              { minPrice: value || null, page: null },
              { replace: true },
            );
          }}
          setPriceSignalFilters={(value) => {
            updateTrackerUrl({ page: null, priceSignal: value });
          }}
          setRarityFilters={(value) => {
            updateTrackerUrl({ page: null, rarity: value });
          }}
          setTypeFilters={(value) => {
            updateTrackerUrl({ page: null, type: value });
          }}
          typeFilters={typeFilters}
        />
      ) : null}
    </main>
  );
}

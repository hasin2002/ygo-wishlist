"use client";

import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  ShoppingBag,
  SlidersHorizontal,
  Star,
  Trash2,
  X,
} from "lucide-react";
import type { inferRouterOutputs } from "@trpc/server";
import {
  FormEvent,
  MouseEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppHeader } from "@/components/app-header";
import { CardNoteIndicator } from "@/components/card-note-indicator";
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
type Card = inferRouterOutputs<AppRouter>["cards"]["list"][number];
type CardStatus = "wishlist" | "owned";
type WishlistAppProps = {
  initialCards?: Card[];
};
type CardForm = {
  name: string;
  url: string;
  imageUrl: string;
  priceText: string;
  marketPriceText: string;
  purchaseMonth: string;
  rarity: string;
  chaseLevel: string;
  status: CardStatus;
  notes: string;
};
type EditForm = CardForm & {
  id: number;
  ebayListingUrl: string;
  paidPriceText: string;
  chaseLevel: string;
};

const pageSize = 8;

const rarities = [
  "Common",
  "Short Print",
  "Super Short Print",
  "Rare",
  "Super Rare",
  "Ultra Rare",
  "Overframe Ultra Rare",
  "Secret Rare",
  "Ultimate Rare",
  "Ghost Rare",
  "Gold Rare",
  "Gold Secret Rare",
  "Premium Gold Rare",
  "Platinum Rare",
  "Platinum Secret Rare",
  "Collector's Rare",
  "Starlight Rare",
  "Overframe Starlight Rare",
  "Quarter Century Secret Rare",
  "Prismatic Secret Rare",
  "Parallel Rare",
  "Duel Terminal Normal Parallel Rare",
  "Duel Terminal Rare Parallel Rare",
  "Duel Terminal Super Parallel Rare",
  "Duel Terminal Ultra Parallel Rare",
  "Duel Terminal Secret Parallel Rare",
  "Mosaic Rare",
  "Starfoil Rare",
  "Shatterfoil Rare",
  "Pharaoh's Rare",
  "Millennium Rare",
  "Extra Secret Rare",
  "20th Secret Rare",
  "10000 Secret Rare",
];

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

function cardMatchesType(card: Card, typeFilter: CardTypeFilter) {
  const type = card.cardType?.toLowerCase() ?? "";

  if (!type) {
    return false;
  }

  if (typeFilter === "monster") {
    return type.includes("monster");
  }

  if (typeFilter === "spell") {
    return type.includes("spell");
  }

  if (typeFilter === "trap") {
    return type.includes("trap");
  }

  return type.includes(typeFilter);
}

function cardMatchesTypes(card: Card, typeFilters: CardTypeFilter[]) {
  if (!typeFilters.length) {
    return true;
  }

  return typeFilters.some((typeFilter) => cardMatchesType(card, typeFilter));
}

function priceValue(priceText: string | null) {
  const match = priceText?.match(/\d+(?:[,.]\d{1,2})?/);
  return match ? Number(match[0].replace(",", "")) : null;
}

function filterNumber(value: string) {
  if (!value.trim()) {
    return null;
  }

  const normalized = value.replace(/^£/, "").replace(/,/g, "").trim();
  const parsed = Number(normalized);

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function marketValue(card: Card) {
  return priceValue(card.marketPriceText) ?? priceValue(card.priceText);
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

function paidDisplay(value: string | null) {
  if (!value) {
    return null;
  }

  const normalized = normalizePaidPrice(value);
  return normalized.startsWith("£") ? `Paid ${normalized}` : normalized;
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

function RarityCombobox({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const visibleRarities = useMemo(() => {
    const search = value.toLowerCase().trim();

    if (!search) {
      return rarities;
    }

    return rarities.filter((rarity) => rarity.toLowerCase().includes(search));
  }, [value]);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  return (
    <div className="relative" ref={wrapperRef}>
      <label className="block">
        <span className="text-sm font-medium text-zinc-700">Rarity</span>
        <div className="relative mt-1">
          <input
            aria-controls="rarity-options"
            aria-expanded={open}
            aria-label="Rarity"
            autoComplete="off"
            className="h-11 w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 pr-9 text-sm outline-none transition focus:border-[#8a1f2d] focus:bg-white"
            onChange={(event) => {
              onChange(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder="Search rarity"
            role="combobox"
            value={value}
          />
          <button
            aria-label="Show rarities"
            className="absolute right-1.5 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-950"
            onClick={() => setOpen((current) => !current)}
            type="button"
          >
            <ChevronDown className="size-4" />
          </button>
        </div>
      </label>

      {open ? (
        <div
          className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border border-zinc-300 bg-white p-1 shadow-lg"
          id="rarity-options"
        >
          {visibleRarities.length ? (
            visibleRarities.map((rarity) => (
              <button
                className="block w-full rounded px-3 py-2 text-left text-sm text-zinc-700 transition hover:bg-zinc-100 hover:text-zinc-950"
                key={rarity}
                onClick={() => {
                  onChange(rarity);
                  setOpen(false);
                }}
                type="button"
              >
                {rarity}
              </button>
            ))
          ) : (
            <p className="px-3 py-2 text-sm text-zinc-500">No rarity found</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function EditCardModal({
  form,
  saving,
  onClose,
  onSave,
  setForm,
}: {
  form: EditForm;
  saving: boolean;
  onClose: () => void;
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
            <label className="block">
              <span className="text-sm font-medium text-zinc-700">
                Paid price
              </span>
              <input
                className="mt-1 h-11 w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 text-sm outline-none transition focus:border-[#8a1f2d] focus:bg-white"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    paidPriceText: event.target.value,
                  }))
                }
                placeholder="£12.50"
                value={form.paidPriceText}
              />
            </label>
          ) : null}

          {form.status === "owned" ? (
            <label className="block">
              <span className="text-sm font-medium text-zinc-700">
                Bought month
              </span>
              <input
                className="mt-1 h-11 w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 text-sm outline-none transition focus:border-[#8a1f2d] focus:bg-white"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    purchaseMonth: event.target.value,
                  }))
                }
                type="month"
                value={form.purchaseMonth}
              />
            </label>
          ) : null}

          <RarityCombobox
            value={form.rarity}
            onChange={(rarity) => setForm((current) => ({ ...current, rarity }))}
          />

          <label className="block">
            <span className="text-sm font-medium text-zinc-700">Status</span>
            <select
              className="mt-1 h-11 w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 text-sm outline-none transition focus:border-[#8a1f2d] focus:bg-white"
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  chaseLevel:
                    event.target.value === "owned" ? "" : current.chaseLevel,
                  ebayListingUrl:
                    event.target.value === "owned" ? "" : current.ebayListingUrl,
                  purchaseMonth:
                    event.target.value === "owned"
                      ? current.purchaseMonth || currentMonthKey()
                      : "",
                  status: event.target.value as CardStatus,
                }))
              }
              value={form.status}
            >
              <option value="wishlist">Wishlist</option>
              <option value="owned">Owned</option>
            </select>
          </label>

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

        <div className="mt-5 flex justify-end gap-2">
          <button
            className="h-10 rounded-md border border-zinc-300 px-4 text-sm font-semibold text-zinc-700 transition hover:border-zinc-950 hover:text-zinc-950"
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className="inline-flex h-10 items-center gap-2 rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:opacity-50"
            disabled={saving}
            onClick={onSave}
            type="button"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Save
          </button>
        </div>
      </section>
    </div>
  );
}

function CardFilterModal({
  activeFilterCount,
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
              {priceSignalFilterOptions.map((option) => {
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
  return (
    <form className="space-y-4" onSubmit={onSubmit}>
      <label className="block">
        <span className="text-sm font-medium text-zinc-700">
          TCGplayer or eBay link
        </span>
        <input
          autoFocus
          className="mt-1 h-11 w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 text-sm outline-none transition focus:border-[#8a1f2d] focus:bg-white"
          onChange={(event) =>
            setForm((current) => ({ ...current, url: event.target.value }))
          }
          placeholder="https://www.ebay.co.uk/itm/..."
          type="url"
          value={form.url}
        />
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

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-sm font-medium text-zinc-700">
            {form.status === "owned" ? "Paid price" : "Manual market price"}
          </span>
          <input
            className="mt-1 h-11 w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 text-sm outline-none transition focus:border-[#8a1f2d] focus:bg-white"
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                priceText: event.target.value,
              }))
            }
            placeholder={form.status === "owned" ? "12 or pulled from pack" : "£12.50"}
            value={form.priceText}
          />
        </label>
        <RarityCombobox
          value={form.rarity}
          onChange={(rarity) => setForm((current) => ({ ...current, rarity }))}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-sm font-medium text-zinc-700">Status</span>
          <select
            className="mt-1 h-11 w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 text-sm outline-none transition focus:border-[#8a1f2d] focus:bg-white"
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                chaseLevel:
                  event.target.value === "owned" ? "" : current.chaseLevel,
                purchaseMonth:
                  event.target.value === "owned"
                    ? current.purchaseMonth || currentMonthKey()
                    : current.purchaseMonth,
                status: event.target.value as "wishlist" | "owned",
              }))
            }
            value={form.status}
          >
            <option value="wishlist">Wishlist</option>
            <option value="owned">Owned</option>
          </select>
        </label>
        {form.status === "wishlist" ? (
          <label className="block">
            <span className="text-sm font-medium text-zinc-700">Chase</span>
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
              <option value="">None</option>
              <option value="5">5 - next</option>
              <option value="4">4</option>
              <option value="3">3</option>
              <option value="2">2</option>
              <option value="1">1 - later</option>
            </select>
          </label>
        ) : (
          <label className="block">
            <span className="text-sm font-medium text-zinc-700">
              Bought month
            </span>
            <input
              className="mt-1 h-11 w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 text-sm outline-none transition focus:border-[#8a1f2d] focus:bg-white"
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  purchaseMonth: event.target.value,
                }))
              }
              type="month"
              value={form.purchaseMonth}
            />
          </label>
        )}
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
        disabled={isPending || (!form.name && !form.url)}
        type="submit"
      >
        {isPending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Plus className="size-4" />
        )}
        Add to tracker
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
              Add card
            </p>
            <h2 className="mt-1 text-xl font-bold" id="add-card-title">
              Add to tracker
            </h2>
          </div>
          <button
            aria-label="Close add card form"
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

export function WishlistApp({ initialCards }: WishlistAppProps) {
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortOption>("updated");
  const [rarityFilters, setRarityFilters] = useState<string[]>([]);
  const [priceSignalFilters, setPriceSignalFilters] = useState<
    PriceSignalFilter[]
  >([]);
  const [priceMin, setPriceMin] = useState("");
  const [priceMax, setPriceMax] = useState("");
  const [chaseFilters, setChaseFilters] = useState<ChaseFilter[]>([]);
  const [typeFilters, setTypeFilters] = useState<CardTypeFilter[]>([]);
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  const [addFormOpen, setAddFormOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [form, setForm] = useState(emptyForm);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Card | null>(null);
  const utils = trpc.useUtils();
  function invalidateCardsAndSpend() {
    void utils.cards.list.invalidate();
    void utils.spend.currentMonth.invalidate();
  }

  const list = trpc.cards.list.useQuery(
    { status: "all", query },
    {
      initialData:
        query || initialCards === undefined ? undefined : initialCards,
      staleTime: 30_000,
    },
  );
  const create = trpc.cards.create.useMutation({
    onSuccess: () => {
      setForm(emptyForm());
      setAddFormOpen(false);
      invalidateCardsAndSpend();
    },
  });
  const setStatus = trpc.cards.setStatus.useMutation({
    onSuccess: invalidateCardsAndSpend,
  });
  const refreshPricing = trpc.cards.refreshPricing.useMutation({
    onSuccess: () => void utils.cards.list.invalidate(),
  });
  const deleteCard = trpc.cards.delete.useMutation({
    onSuccess: invalidateCardsAndSpend,
  });
  const updateCard = trpc.cards.update.useMutation({
    onSuccess: () => {
      setEditForm(null);
      invalidateCardsAndSpend();
    },
  });

  const allCards = useMemo<Card[]>(() => list.data ?? [], [list.data]);
  const rarityOptions = useMemo(
    () =>
      Array.from(
        new Set(allCards.map((card) => card.rarity).filter(Boolean) as string[]),
      ).sort((a, b) => a.localeCompare(b)),
    [allCards],
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
  const cards = useMemo(() => {
    const minPrice = filterNumber(priceMin);
    const maxPrice = filterNumber(priceMax);
    const filtered = allCards.filter((card) => {
      const cardMarketValue = marketValue(card);

      if (filter !== "all" && card.status !== filter) {
        return false;
      }

      if (!cardMatchesTypes(card, typeFilters)) {
        return false;
      }

      if (
        rarityFilters.length &&
        (!card.rarity || !rarityFilters.includes(card.rarity))
      ) {
        return false;
      }

      if (priceSignalFilters.length) {
        const matchesPriceSignal = priceSignalFilters.some((priceSignal) => {
          if (priceSignal === "estimated") {
            return cardMarketValue !== null;
          }

          if (priceSignal === "unpriced") {
            return cardMarketValue === null;
          }

          return Boolean(card.paidPriceText);
        });

        if (!matchesPriceSignal) {
          return false;
        }
      }

      if (minPrice !== null || maxPrice !== null) {
        if (cardMarketValue === null) {
          return false;
        }

        if (minPrice !== null && cardMarketValue < minPrice) {
          return false;
        }

        if (maxPrice !== null && cardMarketValue > maxPrice) {
          return false;
        }
      }

      if (chaseFilters.length) {
        const cardChase = card.chaseLevel
          ? (String(card.chaseLevel) as ChaseFilter)
          : "unset";

        if (!chaseFilters.includes(cardChase)) {
          return false;
        }
      }

      return true;
    });

    return filtered.sort((a, b) => {
      if (sort === "name") {
        return a.name.localeCompare(b.name);
      }

      if (sort === "rarity") {
        return (a.rarity ?? "").localeCompare(b.rarity ?? "");
      }

      if (sort === "price-high" || sort === "price-low") {
        const aPrice = marketValue(a);
        const bPrice = marketValue(b);

        if (aPrice === null && bPrice === null) {
          return 0;
        }

        if (aPrice === null) {
          return 1;
        }

        if (bPrice === null) {
          return -1;
        }

        return sort === "price-high" ? bPrice - aPrice : aPrice - bPrice;
      }

      if (sort === "chase-next") {
        return (b.chaseLevel ?? 0) - (a.chaseLevel ?? 0);
      }

      if (sort === "chase-relaxed") {
        return (a.chaseLevel ?? 6) - (b.chaseLevel ?? 6);
      }

      return (
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
    });
  }, [
    allCards,
    chaseFilters,
    filter,
    priceMax,
    priceMin,
    priceSignalFilters,
    rarityFilters,
    sort,
    typeFilters,
  ]);
  const totalPages = Math.max(1, Math.ceil(cards.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paginatedCards = useMemo(
    () => cards.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [cards, currentPage],
  );
  const firstVisibleCard = cards.length ? (currentPage - 1) * pageSize + 1 : 0;
  const lastVisibleCard = Math.min(currentPage * pageSize, cards.length);
  const counts = useMemo(
    () => ({
      wishlist: cards.filter((card) => card.status === "wishlist").length,
      owned: cards.filter((card) => card.status === "owned").length,
      total: cards.length,
    }),
    [cards],
  );
  const values = useMemo(() => {
    const wishlist = cards
      .filter((card) => card.status === "wishlist")
      .reduce((sum, card) => sum + (marketValue(card) ?? 0), 0);
    const owned = cards
      .filter((card) => card.status === "owned")
      .reduce((sum, card) => sum + (marketValue(card) ?? 0), 0);
    const paid = cards
      .filter((card) => card.status === "owned")
      .reduce((sum, card) => sum + (priceValue(card.paidPriceText) ?? 0), 0);

    return { owned, paid, wishlist };
  }, [cards]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const isOwned = form.status === "owned";

    create.mutate({
      name: form.name || undefined,
      url: form.url || undefined,
      imageUrl: form.imageUrl || undefined,
      marketPriceText: !isOwned
        ? normalizeMarketPrice(form.priceText) || undefined
        : undefined,
      paidPriceText: isOwned
        ? normalizePaidPrice(form.priceText) || undefined
        : undefined,
      purchaseMonth: isOwned ? form.purchaseMonth || currentMonthKey() : undefined,
      rarity: form.rarity || undefined,
      chaseLevel: !isOwned && form.chaseLevel ? Number(form.chaseLevel) : null,
      status: form.status,
      notes: form.notes || undefined,
    });
  }

  function deleteCardById(card: Card) {
    setDeleteTarget(card);
  }

  function clearFilters() {
    setRarityFilters([]);
    setPriceSignalFilters([]);
    setPriceMin("");
    setPriceMax("");
    setChaseFilters([]);
    setTypeFilters([]);
    setPage(1);
  }

  function openCardEditor(event: MouseEvent<HTMLElement>, card: Card) {
    const target = event.target as HTMLElement;

    if (target.closest("a,button,input,select,textarea")) {
      return;
    }

    setEditForm(editFormFromCard(card));
  }

  function saveEdit() {
    if (!editForm) {
      return;
    }

    updateCard.mutate({
      id: editForm.id,
      name: editForm.name,
      url: editForm.url || undefined,
      imageUrl: editForm.imageUrl || undefined,
      priceText: editForm.priceText || undefined,
      marketPriceText: normalizeMarketPrice(editForm.marketPriceText) || undefined,
      paidPriceText: normalizePaidPrice(editForm.paidPriceText) || undefined,
      purchaseMonth:
        editForm.status === "owned" ? editForm.purchaseMonth || undefined : undefined,
      ebayListingUrl: editForm.status === "wishlist" ? editForm.ebayListingUrl : "",
      rarity: editForm.rarity || undefined,
      chaseLevel:
        editForm.status === "wishlist" && editForm.chaseLevel
          ? Number(editForm.chaseLevel)
          : null,
      status: editForm.status,
      notes: editForm.notes || undefined,
    });
  }

  return (
    <main className="min-h-screen bg-[#f6f4ef] px-4 py-5 text-zinc-950 sm:px-6">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <AppHeader
          eyebrow="Local collection tracker"
          title="Yu-Gi-Oh! Wishlist"
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
                {values.paid ? <span>Paid {formatCurrency(values.paid)}</span> : null}
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
                Track wishlist targets, owned cards, prices, and chase priority.
              </p>
            </div>
            <button
              className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-[#8a1f2d] px-4 text-sm font-semibold text-white transition hover:bg-[#711826]"
              onClick={() => setAddFormOpen(true)}
              type="button"
            >
              <Plus className="size-4" />
              Add card
            </button>
          </div>

          <section className="flex min-w-0 flex-col gap-4">
            <div className="flex flex-col gap-3 rounded-lg border border-zinc-300 bg-white p-3 shadow-sm">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="flex rounded-md border border-zinc-300 bg-zinc-100 p-1">
                  {filters.map((item) => (
                    <button
                      key={item.value}
                      onClick={() => {
                        setFilter(item.value);
                        setPage(1);
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
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setPage(1);
                    }}
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
                    setSort(event.target.value as SortOption);
                    setPage(1);
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

            {list.isLoading ? (
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
                <div className="grid gap-3">
                  {paginatedCards.map((card: Card) => (
                    <article
                      key={card.id}
                      className="group grid min-h-[164px] cursor-pointer grid-cols-[104px_minmax(0,1fr)] overflow-visible rounded-lg border border-zinc-300 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-zinc-400 hover:shadow-md sm:grid-cols-[116px_minmax(0,1fr)]"
                      onClick={(event) => openCardEditor(event, card)}
                    >
                      <div className="grid place-items-center rounded-l-lg border-r border-zinc-200 bg-[#f7f6f2] p-2">
                        {card.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            alt={card.name}
                            className="aspect-[59/86] h-[140px] max-h-full w-auto max-w-full rounded-sm object-contain shadow-sm sm:h-[148px]"
                            loading="lazy"
                            src={card.imageUrl}
                          />
                        ) : (
                          <div className="grid aspect-[59/86] h-[140px] place-items-center rounded border border-dashed border-zinc-300 px-3 text-center text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500 sm:h-[148px]">
                            No image
                          </div>
                        )}
                      </div>

                      <div className="flex min-w-0 flex-col gap-3 p-3 sm:p-4">
                        <div className="flex min-w-0 items-start gap-3">
                          <div className="min-w-0 flex-1">
                            <h3
                              className="line-clamp-2 text-[17px] font-bold leading-[1.2] text-zinc-950 sm:text-lg"
                              title={card.name}
                            >
                              {card.name}
                            </h3>
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
                            {card.rarity ? (
                              <span className="max-w-full truncate rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs font-semibold text-zinc-700">
                                {card.rarity}
                              </span>
                            ) : null}
                            {card.status === "wishlist" && card.chaseLevel ? (
                              <span className="rounded-md border border-rose-100 bg-rose-50 px-2 py-1 text-xs font-bold text-rose-700">
                                Chase {card.chaseLevel}
                              </span>
                            ) : null}
                            {card.status === "owned" && card.paidPriceText ? (
                              <span className="rounded-md border border-emerald-100 bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-700">
                                {paidDisplay(card.paidPriceText)}
                              </span>
                            ) : null}
                            {card.status === "owned" && card.purchaseMonth ? (
                              <span className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs font-semibold text-zinc-600">
                                Bought {monthLabel(card.purchaseMonth)}
                              </span>
                            ) : null}
                            <CardNoteIndicator
                              align="right"
                              label={`View note for ${card.name}`}
                              note={card.notes}
                            />
                          </div>
                        </div>

                        <div className="mt-auto flex flex-col gap-2 border-t border-zinc-100 pt-3 sm:flex-row sm:items-center sm:justify-between">
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
                            {card.status === "wishlist" ? (
                              card.ebayListingUrl ? (
                                <a
                                  aria-label={`Open saved eBay listing for ${card.name}`}
                                  className="inline-flex size-8 items-center justify-center rounded-md border border-zinc-300 bg-white text-zinc-600 transition hover:border-[#8a1f2d] hover:bg-rose-50 hover:text-[#8a1f2d]"
                                  href={card.ebayListingUrl}
                                  rel="noreferrer"
                                  target="_blank"
                                  title="Saved eBay listing"
                                >
                                  <ShoppingBag className="size-4" />
                                </a>
                              ) : (
                                <button
                                  aria-label={`Add saved eBay listing for ${card.name}`}
                                  className="inline-flex size-8 items-center justify-center rounded-md border border-dashed border-zinc-300 bg-white text-zinc-400 transition hover:border-[#8a1f2d] hover:bg-rose-50 hover:text-[#8a1f2d]"
                                  onClick={() => setEditForm(editFormFromCard(card))}
                                  title="Add saved eBay listing"
                                  type="button"
                                >
                                  <ShoppingBag className="size-4" />
                                </button>
                              )
                            ) : null}
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

                          <div className="flex items-center gap-1.5 sm:justify-end">
                            <button
                              aria-label={`Refresh pricing for ${card.name}`}
                              className="grid size-8 place-items-center rounded-md border border-zinc-300 bg-white text-zinc-500 transition hover:border-[#8a1f2d] hover:bg-rose-50 hover:text-[#8a1f2d] disabled:cursor-wait disabled:opacity-50"
                              disabled={refreshPricing.isPending}
                              onClick={() => refreshPricing.mutate({ id: card.id })}
                              title="Refresh pricing"
                              type="button"
                            >
                              <RefreshCw
                                className={`size-4 ${
                                  refreshPricing.isPending ? "animate-spin" : ""
                                }`}
                              />
                            </button>
                            <button
                              aria-label={`Edit ${card.name}`}
                              className="grid size-8 place-items-center rounded-md border border-zinc-300 bg-white text-zinc-500 transition hover:border-zinc-950 hover:bg-zinc-50 hover:text-zinc-950"
                              onClick={() => setEditForm(editFormFromCard(card))}
                              title="Edit card"
                              type="button"
                            >
                              <Pencil className="size-4" />
                            </button>
                            <button
                              aria-label={`Delete ${card.name}`}
                              className="grid size-8 place-items-center rounded-md border border-zinc-300 bg-white text-zinc-500 transition hover:border-rose-700 hover:bg-rose-50 hover:text-rose-700 disabled:cursor-wait disabled:opacity-50"
                              disabled={deleteCard.isPending}
                              onClick={() => deleteCardById(card)}
                              title="Delete card"
                              type="button"
                            >
                              <Trash2 className="size-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setStatus.mutate({
                                  id: card.id,
                                  status:
                                    card.status === "owned" ? "wishlist" : "owned",
                                })
                              }
                              className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-bold transition disabled:opacity-50 ${
                                card.status === "owned"
                                  ? "border border-zinc-300 bg-white text-zinc-800 hover:border-zinc-950"
                                  : "bg-zinc-950 text-white hover:bg-zinc-800"
                              }`}
                              disabled={setStatus.isPending}
                            >
                              <Check className="size-3.5" />
                              {card.status === "owned" ? "Want" : "Own"}
                            </button>
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
                      {cards.length}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        aria-label="Previous page"
                        className="grid size-9 place-items-center rounded-md border border-zinc-300 text-zinc-600 transition hover:border-zinc-950 hover:text-zinc-950 disabled:cursor-not-allowed disabled:opacity-40"
                        disabled={currentPage === 1}
                        onClick={() =>
                          setPage((current) => Math.max(1, current - 1))
                        }
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
                          setPage((current) => Math.min(totalPages, current + 1))
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
      {deleteTarget ? (
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
              {deleteTarget.name} will be removed from the tracker and any binder
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
      {editForm ? (
        <EditCardModal
          form={editForm}
          onClose={() => setEditForm(null)}
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
          chaseFilters={chaseFilters}
          onClear={clearFilters}
          onClose={() => setFilterModalOpen(false)}
          priceMax={priceMax}
          priceMin={priceMin}
          priceSignalFilters={priceSignalFilters}
          rarityFilters={rarityFilters}
          rarityOptions={rarityOptions}
          setChaseFilters={(value) => {
            setChaseFilters(value);
            setPage(1);
          }}
          setPriceMax={(value) => {
            setPriceMax(value);
            setPage(1);
          }}
          setPriceMin={(value) => {
            setPriceMin(value);
            setPage(1);
          }}
          setPriceSignalFilters={(value) => {
            setPriceSignalFilters(value);
            setPage(1);
          }}
          setRarityFilters={(value) => {
            setRarityFilters(value);
            setPage(1);
          }}
          setTypeFilters={(value) => {
            setTypeFilters(value);
            setPage(1);
          }}
          typeFilters={typeFilters}
        />
      ) : null}
    </main>
  );
}

"use client";

import type { inferRouterOutputs } from "@trpc/server";
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  ImageOff,
  Search,
  Star,
  TrendingUp,
  Wallet,
} from "lucide-react";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { AppHeader } from "@/components/app-header";
import { CardNoteIndicator } from "@/components/card-note-indicator";
import type { AppRouter } from "@/server/root";
import { trpc } from "@/trpc/client";

type Card = inferRouterOutputs<AppRouter>["cards"]["list"][number];
type MonthlyFavourite =
  inferRouterOutputs<AppRouter>["spend"]["monthlyFavourites"][number];
type Scope = "month" | "year" | "all" | "unassigned";
type SortOption = "month-desc" | "price-high" | "price-low" | "name";
type SpendCard = {
  card: Card;
  spend: number;
};
type TrendMonth = {
  count: number;
  month: string;
  topCards: SpendCard[];
  total: number;
};

const purchasePageSize = 8;

const scopeOptions: {
  description: string;
  label: string;
  value: Scope;
}[] = [
  {
    description: "Only cards bought in one selected month.",
    label: "Single month",
    value: "month",
  },
  {
    description: "Every bought card in a chosen calendar year.",
    label: "Calendar year",
    value: "year",
  },
  {
    description: "Everything with a paid price, across all months.",
    label: "All purchases",
    value: "all",
  },
  {
    description: "Paid cards where the bought month is still missing.",
    label: "Missing month",
    value: "unassigned",
  },
];

const sortOptions: { label: string; value: SortOption }[] = [
  { label: "Newest month", value: "month-desc" },
  { label: "Price: high to low", value: "price-high" },
  { label: "Price: low to high", value: "price-low" },
  { label: "Name A-Z", value: "name" },
];

function priceValue(priceText: string | null) {
  const match = priceText?.match(/\d+(?:[,.]\d{1,2})?/);
  return match ? Number(match[0].replace(",", "")) : null;
}

function formatCurrency(value: number, maximumFractionDigits?: number) {
  const precision =
    maximumFractionDigits ?? (value > 0 && Math.abs(value) < 10 ? 2 : 0);

  return new Intl.NumberFormat("en-GB", {
    currency: "GBP",
    maximumFractionDigits: precision,
    minimumFractionDigits: precision ? 2 : 0,
    style: "currency",
  }).format(value);
}

function currentMonthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(monthKey: string | null) {
  if (!monthKey) {
    return "No month";
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

function monthShortLabel(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);

  return new Intl.DateTimeFormat("en-GB", { month: "short" }).format(
    new Date(year, month - 1, 1),
  );
}

function monthsForYear(year: number) {
  return Array.from({ length: 12 }, (_, index) =>
    `${year}-${String(index + 1).padStart(2, "0")}`,
  );
}

function lastTwelveMonths(endMonth: string) {
  const [year, month] = endMonth.split("-").map(Number);

  return Array.from({ length: 12 }, (_, index) => {
    const date = new Date(year, month - 1 - (11 - index), 1);
    return currentMonthKey(date);
  });
}

function cardSearchText(card: Card) {
  return [card.name, card.rarity, card.cardType, card.notes]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function groupSpend(
  cards: SpendCard[],
  keyForCard: (card: Card) => string | null,
) {
  const groups = new Map<string, { count: number; total: number }>();

  for (const item of cards) {
    const key = keyForCard(item.card) || "Unspecified";
    const current = groups.get(key) ?? { count: 0, total: 0 };
    groups.set(key, {
      count: current.count + 1,
      total: current.total + item.spend,
    });
  }

  return Array.from(groups.entries())
    .map(([label, value]) => ({ label, ...value }))
    .sort((a, b) => b.total - a.total);
}

function uniqueSorted(values: Array<string | null>) {
  return Array.from(
    new Set(values.filter((value): value is string => Boolean(value))),
  ).sort((a, b) => a.localeCompare(b));
}

function StatCard({
  hint,
  icon,
  label,
  value,
}: {
  hint?: string;
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-zinc-300 bg-white p-4 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-zinc-500">
          {label}
        </p>
        <div className="grid size-9 place-items-center rounded-md border border-zinc-200 bg-zinc-50 text-[#8a1f2d]">
          {icon}
        </div>
      </div>
      <p className="text-3xl font-black leading-none tabular-nums text-zinc-950">
        {value}
      </p>
      {hint ? (
        <p className="mt-2 text-sm font-semibold leading-5 text-zinc-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function BreakdownList({
  emptyLabel,
  items,
  title,
}: {
  emptyLabel: string;
  items: { count: number; label: string; total: number }[];
  title: string;
}) {
  const max = Math.max(...items.map((item) => item.total), 0);

  return (
    <section className="rounded-lg border border-zinc-300 bg-white p-4 shadow-sm">
      <h2 className="text-lg font-bold">{title}</h2>
      <div className="mt-4 grid gap-3">
        {items.length ? (
          items.slice(0, 7).map((item) => (
            <div className="grid gap-1.5" key={item.label}>
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate font-semibold text-zinc-700">
                  {item.label}
                </span>
                <span className="shrink-0 font-bold tabular-nums text-zinc-950">
                  {formatCurrency(item.total)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-100">
                  <div
                    aria-label={`${item.label}: ${formatCurrency(item.total)}`}
                    className="h-full rounded-full bg-[#8a1f2d]"
                    style={{
                      width: `${max ? Math.max(4, (item.total / max) * 100) : 0}%`,
                    }}
                  />
                </div>
                <span className="w-12 text-right text-xs font-bold text-zinc-400">
                  {item.count}
                </span>
              </div>
            </div>
          ))
        ) : (
          <p className="rounded-md border border-dashed border-zinc-300 bg-zinc-50 px-3 py-4 text-sm font-semibold text-zinc-500">
            {emptyLabel}
          </p>
        )}
      </div>
    </section>
  );
}

function CardImage({ card, size = "md" }: { card: Card; size?: "md" | "sm" }) {
  return (
    <div
      className={`grid aspect-[59/86] place-items-center overflow-hidden rounded-md border border-zinc-200 bg-zinc-50 ${
        size === "sm" ? "w-9" : "w-14"
      }`}
    >
      {card.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt={card.name}
          className="h-full w-full object-contain"
          loading="lazy"
          src={card.imageUrl}
        />
      ) : (
        <ImageOff className="size-4 text-zinc-400" />
      )}
    </div>
  );
}

function MonthTrendRow({
  item,
  maxTrend,
  onSelectMonth,
}: {
  item: TrendMonth;
  maxTrend: number;
  onSelectMonth: (month: string) => void;
}) {
  const width = item.total
    ? Math.max(7, (item.total / Math.max(maxTrend, 1)) * 100)
    : 0;

  return (
    <button
      aria-label={`View purchases for ${monthLabel(item.month)}`}
      className="group relative grid grid-cols-[56px_minmax(0,1fr)_76px] items-center gap-3 rounded-md text-left outline-none transition hover:bg-zinc-50 focus-visible:ring-2 focus-visible:ring-[#8a1f2d]/40"
      onClick={() => onSelectMonth(item.month)}
      type="button"
    >
      <span className="pl-1 text-sm font-bold text-zinc-500">
        {monthShortLabel(item.month)}
      </span>
      <span className="relative block h-8 rounded-md bg-zinc-100">
        <span
          aria-label={`${monthLabel(item.month)}: ${formatCurrency(item.total)}`}
          className="flex h-full items-center justify-end rounded-md bg-[#8a1f2d] px-2 text-xs font-bold text-white transition-[width]"
          style={{ width: `${width}%` }}
        >
          {item.total ? item.count : ""}
        </span>
        {item.topCards.length ? (
          <span className="pointer-events-none absolute bottom-full left-0 z-20 mb-2 hidden w-80 rounded-lg border border-zinc-300 bg-white p-3 text-zinc-950 shadow-xl group-hover:block group-focus-visible:block">
            <span className="block text-xs font-bold uppercase tracking-[0.14em] text-[#8a1f2d]">
              Biggest in {monthLabel(item.month)}
            </span>
            <span className="mt-2 grid gap-2">
              {item.topCards.map((topCard) => (
                <span
                  className="grid grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-2"
                  key={topCard.card.id}
                >
                  <CardImage card={topCard.card} size="sm" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-bold">
                      {topCard.card.name}
                    </span>
                    <span className="block truncate text-xs font-semibold text-zinc-500">
                      {topCard.card.rarity || topCard.card.cardType || "Card"}
                    </span>
                  </span>
                  <span className="text-sm font-black tabular-nums">
                    {formatCurrency(topCard.spend, 2)}
                  </span>
                </span>
              ))}
            </span>
          </span>
        ) : null}
      </span>
      <span className="pr-1 text-right text-sm font-bold tabular-nums text-zinc-950">
        {formatCurrency(item.total)}
      </span>
    </button>
  );
}

function PeriodButton({
  active,
  description,
  label,
  onClick,
}: {
  active: boolean;
  description: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={active}
      className={`rounded-lg border p-3 text-left transition ${
        active
          ? "border-[#8a1f2d]/30 bg-rose-50 text-[#8a1f2d]"
          : "border-zinc-300 bg-white text-zinc-700 hover:border-zinc-950 hover:text-zinc-950"
      }`}
      onClick={onClick}
      type="button"
    >
      <span className="block text-sm font-black">{label}</span>
      <span className="mt-1 block text-xs font-semibold leading-5 opacity-75">
        {description}
      </span>
    </button>
  );
}

function FavouriteBuyPanel({
  favourite,
  month,
}: {
  favourite: SpendCard | null;
  month: string;
}) {
  return (
    <section className="rounded-lg border border-zinc-300 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#8a1f2d]">
            Favourite buy
          </p>
          <h2 className="mt-1 text-lg font-bold">{monthLabel(month)}</h2>
        </div>
        <div className="grid size-9 place-items-center rounded-md border border-zinc-200 bg-zinc-50 text-[#8a1f2d]">
          <Star className={favourite ? "size-4 fill-current" : "size-4"} />
        </div>
      </div>
      {favourite ? (
        <div className="mt-4 grid grid-cols-[56px_minmax(0,1fr)_auto] items-center gap-3">
          <CardImage card={favourite.card} />
          <div className="min-w-0">
            <h3 className="truncate text-base font-bold text-zinc-950">
              {favourite.card.name}
            </h3>
            <p className="mt-1 truncate text-sm font-semibold text-zinc-500">
              {favourite.card.rarity || favourite.card.cardType || "Bought card"}
            </p>
            {favourite.card.notes?.trim() ? (
              <div className="mt-1">
                <CardNoteIndicator
                  label={`View note for ${favourite.card.name}`}
                  note={favourite.card.notes}
                />
              </div>
            ) : null}
          </div>
          <p className="text-right text-lg font-black tabular-nums">
            {formatCurrency(favourite.spend, 2)}
          </p>
        </div>
      ) : (
        <p className="mt-4 rounded-md border border-dashed border-zinc-300 bg-zinc-50 px-3 py-4 text-sm font-semibold leading-6 text-zinc-500">
          Mark one purchase below as the favourite buy for this month.
        </p>
      )}
    </section>
  );
}

function PurchaseRow({
  favouriteByMonth,
  item,
  pending,
  onToggleFavourite,
}: {
  favouriteByMonth: Map<string, number>;
  item: SpendCard;
  onToggleFavourite: (month: string, cardId: number, isFavourite: boolean) => void;
  pending: boolean;
}) {
  const month = item.card.purchaseMonth;
  const isFavourite = Boolean(month && favouriteByMonth.get(month) === item.card.id);

  return (
    <div className="grid grid-cols-[56px_minmax(0,1fr)_auto_40px] items-center gap-3 p-3 sm:grid-cols-[64px_minmax(0,1fr)_auto_auto]">
      <CardImage card={item.card} />
      <div className="min-w-0">
        <h3 className="truncate text-sm font-bold text-zinc-950 sm:text-base">
          {item.card.name}
        </h3>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <span className="rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-xs font-semibold text-zinc-600">
            {monthLabel(month)}
          </span>
          {item.card.rarity ? (
            <span className="rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-xs font-semibold text-zinc-600">
              {item.card.rarity}
            </span>
          ) : null}
          {item.card.cardType ? (
            <span className="rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-xs font-semibold text-zinc-600">
              {item.card.cardType}
            </span>
          ) : null}
          {isFavourite ? (
            <span className="inline-flex items-center gap-1 rounded border border-[#8a1f2d]/20 bg-rose-50 px-1.5 py-0.5 text-xs font-bold text-[#8a1f2d]">
              <Star className="size-3 fill-current" />
              Favourite
            </span>
          ) : null}
          <CardNoteIndicator
            label={`View note for ${item.card.name}`}
            note={item.card.notes}
          />
        </div>
      </div>
      <p className="text-right text-lg font-black tabular-nums text-zinc-950">
        {formatCurrency(item.spend, 2)}
      </p>
      <button
        aria-label={
          isFavourite
            ? `Clear favourite buy for ${monthLabel(month)}`
            : `Set ${item.card.name} as favourite buy for ${monthLabel(month)}`
        }
        className={`grid size-10 place-items-center rounded-md border transition ${
          isFavourite
            ? "border-[#8a1f2d]/30 bg-rose-50 text-[#8a1f2d]"
            : "border-zinc-300 bg-white text-zinc-500 hover:border-zinc-950 hover:text-zinc-950"
        } disabled:opacity-50`}
        disabled={!month || pending}
        onClick={() => month && onToggleFavourite(month, item.card.id, isFavourite)}
        title={isFavourite ? "Favourite for month" : "Make favourite for month"}
        type="button"
      >
        <Star className={isFavourite ? "size-4 fill-current" : "size-4"} />
      </button>
    </div>
  );
}

export function SpendApp({ initialCards = [] }: { initialCards?: Card[] }) {
  const currentMonth = currentMonthKey();
  const currentYear = Number(currentMonth.slice(0, 4));
  const utils = trpc.useUtils();
  const [scope, setScope] = useState<Scope>("month");
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [purchaseQuery, setPurchaseQuery] = useState("");
  const [purchaseRarity, setPurchaseRarity] = useState("all");
  const [purchaseType, setPurchaseType] = useState("all");
  const [purchaseSort, setPurchaseSort] = useState<SortOption>("month-desc");
  const [purchasePage, setPurchasePage] = useState(1);
  const list = trpc.cards.list.useQuery(
    { status: "owned", query: "" },
    {
      initialData: initialCards,
      staleTime: 30_000,
    },
  );
  const favourites = trpc.spend.monthlyFavourites.useQuery(undefined, {
    staleTime: 30_000,
  });
  const setMonthlyFavourite = trpc.spend.setMonthlyFavourite.useMutation({
    onSuccess: () => void utils.spend.monthlyFavourites.invalidate(),
  });

  const allSpendCards = useMemo<SpendCard[]>(
    () =>
      (list.data ?? [])
        .map((card) => ({ card, spend: priceValue(card.paidPriceText) }))
        .filter(
          (item): item is SpendCard =>
            item.spend !== null && Number.isFinite(item.spend),
        ),
    [list.data],
  );

  const monthOptions = useMemo(() => {
    const months = new Set(
      allSpendCards
        .map((item) => item.card.purchaseMonth)
        .filter((month): month is string => Boolean(month)),
    );
    months.add(currentMonth);
    return Array.from(months).sort((a, b) => b.localeCompare(a));
  }, [allSpendCards, currentMonth]);

  const yearOptions = useMemo(() => {
    const years = new Set(
      allSpendCards
        .map((item) => item.card.purchaseMonth?.slice(0, 4))
        .filter((year): year is string => Boolean(year))
        .map(Number),
    );
    years.add(currentYear);
    return Array.from(years).sort((a, b) => b - a);
  }, [allSpendCards, currentYear]);

  const periodCards = useMemo(() => {
    return allSpendCards.filter((item) => {
      if (scope === "month") {
        return item.card.purchaseMonth === selectedMonth;
      }

      if (scope === "year") {
        return item.card.purchaseMonth?.slice(0, 4) === String(selectedYear);
      }

      if (scope === "unassigned") {
        return !item.card.purchaseMonth;
      }

      return true;
    });
  }, [allSpendCards, scope, selectedMonth, selectedYear]);

  const purchaseRarityOptions = useMemo(
    () => uniqueSorted(periodCards.map((item) => item.card.rarity)),
    [periodCards],
  );
  const purchaseTypeOptions = useMemo(
    () => uniqueSorted(periodCards.map((item) => item.card.cardType)),
    [periodCards],
  );

  const purchaseCards = useMemo(() => {
    const search = purchaseQuery.trim().toLowerCase();
    const filtered = periodCards.filter((item) => {
      if (purchaseRarity !== "all" && item.card.rarity !== purchaseRarity) {
        return false;
      }

      if (purchaseType !== "all" && item.card.cardType !== purchaseType) {
        return false;
      }

      if (!search) {
        return true;
      }

      return cardSearchText(item.card).includes(search);
    });

    return filtered.sort((a, b) => {
      if (purchaseSort === "name") {
        return a.card.name.localeCompare(b.card.name);
      }

      if (purchaseSort === "price-high") {
        return b.spend - a.spend;
      }

      if (purchaseSort === "price-low") {
        return a.spend - b.spend;
      }

      return (b.card.purchaseMonth ?? "").localeCompare(
        a.card.purchaseMonth ?? "",
      );
    });
  }, [periodCards, purchaseQuery, purchaseRarity, purchaseSort, purchaseType]);

  const purchaseFiltersActive =
    Boolean(purchaseQuery.trim()) ||
    purchaseRarity !== "all" ||
    purchaseType !== "all";
  const selectedTotal = periodCards.reduce((sum, item) => sum + item.spend, 0);
  const purchaseTotal = purchaseCards.reduce((sum, item) => sum + item.spend, 0);
  const allTimeTotal = allSpendCards.reduce((sum, item) => sum + item.spend, 0);
  const unassignedTotal = allSpendCards
    .filter((item) => !item.card.purchaseMonth)
    .reduce((sum, item) => sum + item.spend, 0);
  const average = periodCards.length ? selectedTotal / periodCards.length : 0;
  const biggest = periodCards.reduce<SpendCard | null>(
    (current, item) => (!current || item.spend > current.spend ? item : current),
    null,
  );
  const trendMonths =
    scope === "year"
      ? monthsForYear(selectedYear)
      : lastTwelveMonths(selectedMonth);
  const trend: TrendMonth[] = trendMonths.map((month) => {
    const entries = allSpendCards.filter(
      (item) => item.card.purchaseMonth === month,
    );
    return {
      count: entries.length,
      month,
      topCards: [...entries].sort((a, b) => b.spend - a.spend).slice(0, 3),
      total: entries.reduce((sum, item) => sum + item.spend, 0),
    };
  });
  const maxTrend = Math.max(...trend.map((item) => item.total), 0);
  const rarityBreakdown = groupSpend(periodCards, (card) => card.rarity);
  const typeBreakdown = groupSpend(periodCards, (card) => card.cardType);
  const favouriteByMonth = useMemo(() => {
    return new Map(
      ((favourites.data ?? []) as MonthlyFavourite[]).map((favourite) => [
        favourite.month,
        favourite.cardId,
      ]),
    );
  }, [favourites.data]);
  const selectedMonthFavourite =
    scope === "month"
      ? periodCards.find((item) => favouriteByMonth.get(selectedMonth) === item.card.id) ??
        null
      : null;
  const purchasePageCount = Math.max(
    1,
    Math.ceil(purchaseCards.length / purchasePageSize),
  );
  const safePurchasePage = Math.min(purchasePage, purchasePageCount);
  const pagedPurchases = purchaseCards.slice(
    (safePurchasePage - 1) * purchasePageSize,
    safePurchasePage * purchasePageSize,
  );
  const purchaseRangeStart = purchaseCards.length
    ? (safePurchasePage - 1) * purchasePageSize + 1
    : 0;
  const purchaseRangeEnd = Math.min(
    safePurchasePage * purchasePageSize,
    purchaseCards.length,
  );

  function selectTrendMonth(month: string) {
    setSelectedMonth(month);
    setSelectedYear(Number(month.slice(0, 4)));
    setScope("month");
    setPurchasePage(1);
  }

  function toggleFavourite(month: string, cardId: number, isFavourite: boolean) {
    setMonthlyFavourite.mutate({
      cardId: isFavourite ? null : cardId,
      month,
    });
  }

  function clearPurchaseFilters() {
    setPurchaseQuery("");
    setPurchaseRarity("all");
    setPurchaseType("all");
    setPurchasePage(1);
  }

  return (
    <main className="min-h-screen bg-[#f6f4ef] px-4 py-5 text-zinc-950 sm:px-6">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <AppHeader eyebrow="Spend tracker" title="Card spending" />

        <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_392px]">
          <div className="flex min-w-0 flex-col gap-5">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <StatCard
                hint={
                  scope === "month"
                    ? monthLabel(selectedMonth)
                    : `${periodCards.length} purchases in this view`
                }
                icon={<Wallet className="size-4" />}
                label="In view"
                value={formatCurrency(selectedTotal)}
              />
              <StatCard
                hint="Tracked paid prices"
                icon={<CreditCard className="size-4" />}
                label="All time"
                value={formatCurrency(allTimeTotal)}
              />
              <StatCard
                hint={periodCards.length ? "Per bought card" : "No cards in view"}
                icon={<TrendingUp className="size-4" />}
                label="Average"
                value={formatCurrency(average)}
              />
              <StatCard
                hint={biggest ? biggest.card.name : "No purchase selected"}
                icon={<CalendarDays className="size-4" />}
                label="Highest"
                value={formatCurrency(biggest?.spend ?? 0)}
              />
            </div>

            {scope === "month" ? (
              <FavouriteBuyPanel
                favourite={selectedMonthFavourite}
                month={selectedMonth}
              />
            ) : null}

            <section className="rounded-lg border border-zinc-300 bg-white p-4 shadow-sm">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#8a1f2d]">
                    Monthly trend
                  </p>
                  <h2 className="mt-1 text-xl font-bold">
                    {scope === "year"
                      ? `${selectedYear} by month`
                      : "Last 12 months"}
                  </h2>
                </div>
                <p className="text-sm font-semibold text-zinc-500">
                  Hover or focus a month to see its 3 biggest buys.
                </p>
              </div>
              <div className="mt-5 grid gap-2">
                {trend.map((item) => (
                  <MonthTrendRow
                    item={item}
                    key={item.month}
                    maxTrend={maxTrend}
                    onSelectMonth={selectTrendMonth}
                  />
                ))}
              </div>
            </section>

            <div className="grid gap-5 lg:grid-cols-2">
              <BreakdownList
                emptyLabel="No rarity spend in this view."
                items={rarityBreakdown}
                title="By rarity"
              />
              <BreakdownList
                emptyLabel="No type spend in this view."
                items={typeBreakdown}
                title="By card type"
              />
            </div>

            <section className="rounded-lg border border-zinc-300 bg-white shadow-sm">
              <div className="grid gap-4 border-b border-zinc-200 p-4">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-xl font-bold">Purchases</h2>
                    <p className="mt-1 text-sm font-semibold text-zinc-500">
                      {purchaseCards.length} of {periodCards.length} cards ·{" "}
                      {formatCurrency(purchaseTotal)}
                      {purchaseFiltersActive ? " shown" : ""}
                    </p>
                  </div>
                  {purchaseFiltersActive ? (
                    <button
                      className="h-10 rounded-md border border-zinc-300 px-3 text-sm font-semibold text-zinc-700 transition hover:border-zinc-950 hover:text-zinc-950"
                      onClick={clearPurchaseFilters}
                      type="button"
                    >
                      Clear purchase filters
                    </button>
                  ) : null}
                </div>

                <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_170px_170px_170px]">
                  <label className="block">
                    <span className="sr-only">Search purchases</span>
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
                      <input
                        className="h-11 w-full rounded-md border border-zinc-300 bg-zinc-50 pl-9 pr-3 text-sm outline-none transition focus:border-[#8a1f2d] focus:bg-white"
                        onChange={(event) => {
                          setPurchaseQuery(event.target.value);
                          setPurchasePage(1);
                        }}
                        placeholder="Search purchases"
                        value={purchaseQuery}
                      />
                    </div>
                  </label>

                  <select
                    aria-label="Filter purchases by rarity"
                    className="h-11 rounded-md border border-zinc-300 bg-zinc-50 px-3 text-sm font-semibold outline-none transition focus:border-[#8a1f2d] focus:bg-white"
                    onChange={(event) => {
                      setPurchaseRarity(event.target.value);
                      setPurchasePage(1);
                    }}
                    value={purchaseRarity}
                  >
                    <option value="all">Any rarity</option>
                    {purchaseRarityOptions.map((rarity) => (
                      <option key={rarity} value={rarity}>
                        {rarity}
                      </option>
                    ))}
                  </select>

                  <select
                    aria-label="Filter purchases by card type"
                    className="h-11 rounded-md border border-zinc-300 bg-zinc-50 px-3 text-sm font-semibold outline-none transition focus:border-[#8a1f2d] focus:bg-white"
                    onChange={(event) => {
                      setPurchaseType(event.target.value);
                      setPurchasePage(1);
                    }}
                    value={purchaseType}
                  >
                    <option value="all">Any type</option>
                    {purchaseTypeOptions.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>

                  <select
                    aria-label="Sort purchases"
                    className="h-11 rounded-md border border-zinc-300 bg-zinc-50 px-3 text-sm font-semibold outline-none transition focus:border-[#8a1f2d] focus:bg-white"
                    onChange={(event) =>
                      {
                        setPurchaseSort(event.target.value as SortOption);
                        setPurchasePage(1);
                      }
                    }
                    value={purchaseSort}
                  >
                    {sortOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {purchaseCards.length ? (
                <>
                  <div className="divide-y divide-zinc-100">
                    {pagedPurchases.map((item) => (
                      <PurchaseRow
                        favouriteByMonth={favouriteByMonth}
                        item={item}
                        key={item.card.id}
                        onToggleFavourite={toggleFavourite}
                        pending={setMonthlyFavourite.isPending}
                      />
                    ))}
                  </div>
                  <div className="flex flex-col gap-3 border-t border-zinc-200 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm font-semibold text-zinc-500">
                      Showing {purchaseRangeStart}-{purchaseRangeEnd} of{" "}
                      {purchaseCards.length}
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        aria-label="Previous purchases page"
                        className="grid size-10 place-items-center rounded-md border border-zinc-300 text-zinc-600 transition hover:border-zinc-950 hover:text-zinc-950 disabled:opacity-40"
                        disabled={safePurchasePage <= 1}
                        onClick={() =>
                          setPurchasePage((current) =>
                            Math.max(1, Math.min(current, purchasePageCount) - 1),
                          )
                        }
                        type="button"
                      >
                        <ChevronLeft className="size-4" />
                      </button>
                      <span className="min-w-20 text-center text-sm font-bold tabular-nums text-zinc-600">
                        {safePurchasePage} / {purchasePageCount}
                      </span>
                      <button
                        aria-label="Next purchases page"
                        className="grid size-10 place-items-center rounded-md border border-zinc-300 text-zinc-600 transition hover:border-zinc-950 hover:text-zinc-950 disabled:opacity-40"
                        disabled={safePurchasePage >= purchasePageCount}
                        onClick={() =>
                          setPurchasePage((current) =>
                            Math.min(purchasePageCount, current + 1),
                          )
                        }
                        type="button"
                      >
                        <ChevronRight className="size-4" />
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="grid min-h-52 place-items-center px-4 text-center">
                  <div>
                    <Wallet className="mx-auto mb-3 size-8 text-[#8a1f2d]" />
                    <h3 className="text-lg font-bold">No purchases found</h3>
                    <p className="mt-1 max-w-sm text-sm font-semibold leading-6 text-zinc-500">
                      Change the timeframe or purchase filters, or add a paid
                      price and bought month to owned cards.
                    </p>
                  </div>
                </div>
              )}
            </section>
          </div>

          <aside className="h-fit rounded-lg border border-zinc-300 bg-white p-4 shadow-sm xl:sticky xl:top-5">
            <div className="mb-4">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#8a1f2d]">
                Configure
              </p>
              <h2 className="mt-1 text-xl font-bold">Timeframe</h2>
              <p className="mt-2 text-sm font-semibold leading-6 text-zinc-500">
                Choose the spend window first. Purchase filters only change the
                purchase list, not these summary cards.
              </p>
            </div>

            <div className="grid gap-3">
              <div className="grid gap-2">
                {scopeOptions.map((option) => (
                  <PeriodButton
                    active={scope === option.value}
                    description={option.description}
                    key={option.value}
                    label={option.label}
                    onClick={() => {
                      setScope(option.value);
                      setPurchasePage(1);
                    }}
                  />
                ))}
              </div>

              {scope === "month" ? (
                <label className="block pt-1">
                  <span className="text-sm font-medium text-zinc-700">
                    Bought month
                  </span>
                  <input
                    className="mt-1 h-11 w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 text-sm font-semibold outline-none transition focus:border-[#8a1f2d] focus:bg-white"
                    onChange={(event) => {
                      setSelectedMonth(event.target.value || currentMonth);
                      setSelectedYear(
                        Number((event.target.value || currentMonth).slice(0, 4)),
                      );
                      setPurchasePage(1);
                    }}
                    type="month"
                    value={selectedMonth}
                  />
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {monthOptions.slice(0, 5).map((month) => (
                      <button
                        className="rounded border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs font-bold text-zinc-600 transition hover:border-[#8a1f2d] hover:text-[#8a1f2d]"
                        key={month}
                        onClick={() => {
                          setSelectedMonth(month);
                          setSelectedYear(Number(month.slice(0, 4)));
                          setPurchasePage(1);
                        }}
                        type="button"
                      >
                        {monthLabel(month)}
                      </button>
                    ))}
                  </div>
                </label>
              ) : null}

              {scope === "year" ? (
                <label className="block pt-1">
                  <span className="text-sm font-medium text-zinc-700">Year</span>
                  <div className="relative mt-1">
                    <select
                      className="h-11 w-full appearance-none rounded-md border border-zinc-300 bg-zinc-50 px-3 pr-9 text-sm font-semibold outline-none transition focus:border-[#8a1f2d] focus:bg-white"
                      onChange={(event) =>
                        {
                          setSelectedYear(Number(event.target.value));
                          setPurchasePage(1);
                        }
                      }
                      value={selectedYear}
                    >
                      {yearOptions.map((year) => (
                        <option key={year} value={year}>
                          {year}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
                  </div>
                </label>
              ) : null}

              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-zinc-500">
                  Missing month
                </p>
                <p className="mt-1 text-2xl font-black tabular-nums text-zinc-950">
                  {formatCurrency(unassignedTotal)}
                </p>
                <p className="mt-1 text-sm font-semibold leading-5 text-zinc-500">
                  Use the card edit modal to assign bought months to older owned
                  cards.
                </p>
              </div>
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}

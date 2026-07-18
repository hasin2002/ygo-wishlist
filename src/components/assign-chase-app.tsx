"use client";

import {
  Check,
  ExternalLink,
  Loader2,
  Sparkles,
} from "lucide-react";
import { useMemo, useState } from "react";
import { AppHeader } from "@/components/app-header";
import { DataLoadError } from "@/components/data-load-error";
import { trpc } from "@/trpc/client";

const levels = [
  { value: 5, label: "5", hint: "Want next" },
  { value: 4, label: "4", hint: "High priority" },
  { value: 3, label: "3", hint: "Good target" },
  { value: 2, label: "2", hint: "Later" },
  { value: 1, label: "1", hint: "Nice to have" },
];

function ebaySearchUrl(card: {
  ebaySearchUrl: string | null;
  name: string;
  rarity: string | null;
}) {
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

export function AssignChaseApp() {
  const [assignedIds, setAssignedIds] = useState<string[]>([]);
  const [leaving, setLeaving] = useState(false);
  const utils = trpc.useUtils();
  const list = trpc.cards.chaseQueue.useQuery(undefined, {
    staleTime: 30_000,
  });
  const setChaseLevel = trpc.cards.setChaseLevel.useMutation({
    onSuccess: () => {
      void utils.cards.binderList.invalidate();
      void utils.cards.chaseQueue.invalidate();
      void utils.cards.list.invalidate();
      void utils.cards.trackerPage.invalidate();
      void utils.cards.summary.invalidate();
      void utils.wheel.state.invalidate();
    },
  });

  const cards = useMemo(
    () =>
      (list.data ?? []).filter(
        (card) => !card.chaseLevel && !assignedIds.includes(card.id),
      ),
    [assignedIds, list.data],
  );
  const card = cards[0];
  const remainingAfterCurrent = Math.max(cards.length - 1, 0);
  const currentEbaySearchUrl = card ? ebaySearchUrl(card) : "";

  async function assign(level: number) {
    if (!card || leaving || setChaseLevel.isPending) {
      return;
    }

    setLeaving(true);
    window.setTimeout(async () => {
      try {
        await setChaseLevel.mutateAsync({ id: card.id, chaseLevel: level });
        setAssignedIds((current) => [...current, card.id]);
      } catch {
        // Keep the card in place if the update fails.
      } finally {
        setLeaving(false);
      }
    }, 180);
  }

  return (
    <main className="app-page-shell min-h-screen bg-[#f6f4ef] px-4 py-5 text-zinc-950 sm:px-6">
      <div className="mx-auto flex min-h-[calc(100vh-40px)] w-full max-w-7xl flex-col gap-5">
        <AppHeader eyebrow="Chase queue" title="Assign chase levels" />

        <div className="mx-auto flex w-full max-w-4xl flex-1">
        {list.isError ? (
          <DataLoadError
            className="flex-1"
            message={list.error.message}
            onRetry={() => void list.refetch()}
            title="Could not load wishlist cards"
          />
        ) : list.isLoading ? (
          <section className="grid flex-1 place-items-center rounded-lg border border-zinc-300 bg-white">
            <Loader2 className="size-6 animate-spin text-[#8a1f2d]" />
          </section>
        ) : !card ? (
          <section className="grid flex-1 place-items-center rounded-lg border border-dashed border-zinc-300 bg-white px-6 text-center">
            <div>
              <Check className="mx-auto mb-3 size-9 text-emerald-700" />
              <h2 className="text-2xl font-bold">All chase levels assigned</h2>
              <p className="mt-2 max-w-sm text-sm leading-6 text-zinc-500">
                Every card currently on your wishlist already has a chase level.
              </p>
            </div>
          </section>
        ) : (
          <section className="grid flex-1 gap-5 md:grid-cols-[minmax(190px,280px)_1fr] md:items-center lg:grid-cols-[minmax(260px,340px)_1fr]">
            <div
              className={`mx-auto w-full max-w-[230px] overflow-hidden rounded-lg border border-zinc-300 bg-white shadow-sm transition duration-200 sm:max-w-[260px] md:max-w-none ${
                leaving
                  ? "-translate-x-8 rotate-[-1deg] opacity-0"
                  : "translate-x-0 rotate-0 opacity-100"
              }`}
            >
              {card.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt={card.name}
                  className="aspect-[2/3] w-full object-cover"
                  src={card.imageUrl}
                />
              ) : (
                <div className="grid aspect-[2/3] place-items-center bg-zinc-100 px-4 text-center text-xs font-bold uppercase tracking-[0.16em] text-zinc-500">
                  No image
                </div>
              )}
            </div>

            <div
              className={`rounded-lg border border-zinc-300 bg-white p-4 shadow-sm transition duration-200 sm:p-5 ${
                leaving ? "translate-x-8 opacity-0" : "translate-x-0 opacity-100"
              }`}
            >
              <div className="mb-5 flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-zinc-400">
                    {remainingAfterCurrent} left after this
                  </p>
                  <h2 className="mt-2 text-3xl font-bold leading-tight">
                    {card.name}
                  </h2>
                  {card.rarity ? (
                    <p className="mt-2 text-sm font-semibold text-zinc-400">
                      {card.rarity}
                    </p>
                  ) : null}
                </div>
                <Sparkles className="mt-1 size-5 shrink-0 text-[#8a1f2d]" />
              </div>

              <div className="mb-5 flex flex-wrap items-center gap-2">
                <a
                  className="inline-flex h-10 items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-bold text-zinc-600 transition hover:border-zinc-950 hover:text-zinc-950"
                  href={currentEbaySearchUrl}
                  rel="noreferrer"
                  target="_blank"
                  title="Open eBay search"
                >
                  eBay
                  <ExternalLink className="size-3.5" />
                </a>
              </div>

              <div>
                <label
                  className="text-sm font-semibold text-zinc-700"
                  htmlFor="chase-level"
                >
                  Chase level
                </label>
                <div
                  className="mt-2 grid grid-cols-5 gap-2"
                  id="chase-level"
                  role="group"
                >
                  {levels.map((level) => (
                    <button
                      className="group flex min-h-16 flex-col items-center justify-center rounded-md border border-zinc-300 bg-zinc-50 px-1 text-center transition hover:border-[#8a1f2d] hover:bg-white disabled:cursor-wait disabled:opacity-50 sm:min-h-20 sm:px-2"
                      disabled={setChaseLevel.isPending || leaving}
                      key={level.value}
                      onClick={() => assign(level.value)}
                      type="button"
                    >
                      <span className="text-2xl font-bold text-zinc-950">
                        {level.label}
                      </span>
                      <span className="mt-1 hidden text-[11px] font-semibold leading-4 text-zinc-500 group-hover:text-[#8a1f2d] sm:block">
                        {level.hint}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>
        )}
        </div>
      </div>
    </main>
  );
}

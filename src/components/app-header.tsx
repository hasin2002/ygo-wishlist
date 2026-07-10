"use client";

import { Wallet } from "lucide-react";
import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { trpc } from "@/trpc/client";

const navItems = [
  { href: "/", label: "Tracker" },
  { href: "/assign-chase", label: "Assign chase" },
  { href: "/wheel", label: "Wheel" },
  { href: "/binder-v2", label: "Binder" },
  { href: "/spend", label: "Spend" },
];

function formatCurrency(value: number) {
  const precision = value > 0 && Math.abs(value) < 10 ? 2 : 0;

  return new Intl.NumberFormat("en-GB", {
    currency: "GBP",
    maximumFractionDigits: precision,
    minimumFractionDigits: precision ? 2 : 0,
    style: "currency",
  }).format(value);
}

function isActive(pathname: string, href: string) {
  if (href === "/") {
    return pathname === "/";
  }

  return pathname.startsWith(href);
}

function NavPendingIndicator() {
  const { pending } = useLinkStatus();

  return (
    <span
      aria-hidden
      className={`absolute right-2 top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-[#8a1f2d] transition-opacity ${
        pending ? "opacity-100" : "opacity-0"
      }`}
    />
  );
}

export function AppHeader({
  actions,
  eyebrow,
  title,
}: {
  actions?: ReactNode;
  eyebrow: string;
  title: string;
}) {
  const pathname = usePathname();
  const utils = trpc.useUtils();
  const currentMonth = trpc.spend.currentMonth.useQuery(undefined, {
    staleTime: 60_000,
  });
  const monthlyTotal = currentMonth.data?.total ?? 0;
  const monthlyLabel = currentMonth.data?.label ?? "This month";

  useEffect(() => {
    const prefetchLikelyRoutes = () => {
      void utils.cards.list.prefetch(
        { status: "owned", query: "" },
        { staleTime: 30_000 },
      );
      void utils.spend.monthlyFavourites.prefetch(undefined, {
        staleTime: 30_000,
      });

      if (pathname !== "/") {
        void utils.cards.trackerPage.prefetch(
          {
            chaseFilters: [],
            page: 1,
            pageSize: 8,
            priceMax: "",
            priceMin: "",
            priceSignalFilters: [],
            query: "",
            rarityFilters: [],
            sort: "updated",
            status: "all",
            typeFilters: [],
          },
          { staleTime: 30_000 },
        );
      }

      if (pathname !== "/assign-chase") {
        void utils.cards.chaseQueue.prefetch(undefined, { staleTime: 30_000 });
      }

      // Binder and Wheel payloads are intentionally not prefetched here; they are
      // larger planner views and can compete with the Spend data users expect fast.
    };

    const timeoutId = window.setTimeout(prefetchLikelyRoutes, 750);

    return () => window.clearTimeout(timeoutId);
  }, [pathname, utils]);

  return (
    <header className="border-b border-zinc-300/80 pb-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#8a1f2d]">
            {eyebrow}
          </p>
          <h1 className="mt-2 text-3xl font-bold leading-none tracking-normal text-zinc-950 sm:text-5xl">
            {title}
          </h1>
          <nav
            aria-label="Primary"
            className="mt-4 flex w-full max-w-[640px] flex-wrap items-center gap-2 pb-1"
          >
            {navItems.map((item) => {
              const active = isActive(pathname, item.href);

              return (
                <Link
                  aria-current={active ? "page" : undefined}
                  className={`relative inline-flex h-11 min-w-[112px] items-center justify-center rounded-md px-3 text-center text-sm font-semibold leading-none transition active:scale-[0.98] ${
                    active
                      ? "bg-white text-zinc-950 shadow-sm after:absolute after:inset-x-3 after:bottom-1 after:h-0.5 after:rounded-full after:bg-[#8a1f2d]"
                      : "text-zinc-500 hover:bg-white/60 hover:text-zinc-950"
                  }`}
                  href={item.href}
                  key={item.href}
                >
                  <span className="whitespace-nowrap">{item.label}</span>
                  <NavPendingIndicator />
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="flex w-full shrink-0 flex-col items-start gap-3 lg:w-auto lg:items-end">
          <Link
            className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-700 shadow-sm transition hover:border-[#8a1f2d] hover:bg-rose-50 hover:text-[#8a1f2d]"
            href="/spend"
            title={`Spend for ${monthlyLabel}`}
          >
            <Wallet className="size-4" />
            <span className="text-zinc-500">{monthlyLabel}</span>
            <span className="tabular-nums text-zinc-950">
              {formatCurrency(monthlyTotal)}
            </span>
          </Link>
          {actions ? <div className="w-full lg:w-auto">{actions}</div> : null}
        </div>
      </div>
    </header>
  );
}

"use client";

import { Wallet } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
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
  const currentMonth = trpc.spend.currentMonth.useQuery(undefined, {
    staleTime: 60_000,
  });
  const monthlyTotal = currentMonth.data?.total ?? 0;
  const monthlyLabel = currentMonth.data?.label ?? "This month";

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
            className="mt-4 grid w-[580px] max-w-[calc(100vw-2rem)] grid-cols-5 items-center gap-2 pb-1"
          >
            {navItems.map((item) => {
              const active = isActive(pathname, item.href);

              return (
                <Link
                  aria-current={active ? "page" : undefined}
                  className={`rounded-md border px-2 py-2 text-center text-sm font-semibold transition ${
                    active
                      ? "border-zinc-300 bg-white text-zinc-950 shadow-sm"
                      : "border-transparent text-zinc-500 hover:border-zinc-300 hover:bg-white hover:text-zinc-950"
                  }`}
                  href={item.href}
                  key={item.href}
                >
                  {item.label}
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

"use client";

import {
  BookOpen,
  CircleDot,
  FileClock,
  ListChecks,
  LockKeyhole,
  LogIn,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  PackageOpen,
  Plus,
  ReceiptText,
  ShieldCheck,
  Sparkles,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ThemeToggle } from "@/components/theme-toggle";
import { authClient, useSession } from "@/lib/auth-client";
import { clearPersistedQueryCache, trpc } from "@/trpc/client";

const navItems = [
  { href: "/", icon: ListChecks, label: "Library" },
  { href: "/records", icon: FileClock, label: "Records" },
  { href: "/assign-chase", icon: Sparkles, label: "Assign chase" },
  { href: "/wheel", icon: CircleDot, label: "Wheel" },
  { href: "/binder-v2", icon: BookOpen, label: "Binder" },
] satisfies {
  href: string;
  icon: LucideIcon;
  label: string;
}[];

const addItems = [
  {
    description: "Cards, sealed, bulk, and supplies",
    href: "/records/new/purchase",
    icon: Plus,
    label: "Purchase",
  },
  {
    description: "Open sealed product and record pulls",
    href: "/records/new/opening",
    icon: PackageOpen,
    label: "Pack opening",
  },
  {
    description: "Sell exact physical card copies",
    href: "/records/new/sale",
    icon: ReceiptText,
    label: "Sale",
  },
] as const;

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

function NavPendingIndicator({ active }: { active: boolean }) {
  const { pending } = useLinkStatus();

  return (
    <span
      aria-hidden
      className={`absolute right-2 top-1/2 size-1.5 -translate-y-1/2 rounded-full transition-opacity ${
        active ? "bg-white" : "bg-[#8a1f2d]"
      } ${
        pending ? "opacity-100" : "opacity-0"
      }`}
    />
  );
}

function PrimaryNavLink({
  active,
  expanded = true,
  item,
  mobile = false,
  onSelect,
}: {
  active: boolean;
  expanded?: boolean;
  item: (typeof navItems)[number];
  mobile?: boolean;
  onSelect?: () => void;
}) {
  const Icon = item.icon;
  const activeClass = active
    ? "bg-[#8a1f2d] text-white shadow-sm"
    : mobile
      ? "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950"
      : "text-zinc-600 hover:bg-white hover:text-zinc-950";

  return (
    <Link
      aria-current={active ? "page" : undefined}
      aria-label={expanded ? undefined : item.label}
      className={`relative flex min-h-12 items-center gap-3 rounded-lg text-sm font-semibold leading-none transition duration-200 active:scale-[0.99] ${
        expanded ? "px-3" : "justify-center px-0"
      } ${activeClass}`}
      href={item.href}
      onClick={onSelect}
      title={item.label}
    >
      <Icon className="size-4 shrink-0" />
      {expanded ? (
        <span className="min-w-0 truncate">{item.label}</span>
      ) : (
        <span className="sr-only">{item.label}</span>
      )}
      <NavPendingIndicator active={active} />
    </Link>
  );
}

function SpendSummaryLink({
  className,
  monthlyLabel,
  monthlyTotal,
}: {
  className?: string;
  monthlyLabel: string;
  monthlyTotal: number;
}) {
  return (
    <Link
      className={`inline-flex min-h-10 items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-700 shadow-sm transition duration-200 hover:border-[#8a1f2d] hover:bg-rose-50 hover:text-[#8a1f2d] ${
        className ?? ""
      }`}
      href="/records"
      title={`Actual cost for ${monthlyLabel}`}
    >
      <Wallet className="size-4 shrink-0" />
      <span className="text-zinc-500">{monthlyLabel}</span>
      <span className="tabular-nums text-zinc-950">
        {formatCurrency(monthlyTotal)}
      </span>
    </Link>
  );
}

function GlobalAddMenu() {
  const menuId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return (
    <div className="relative w-full sm:w-auto" ref={wrapperRef}>
      <button
        aria-controls={menuId}
        aria-expanded={open}
        aria-haspopup="menu"
        className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-[#8a1f2d] px-4 text-sm font-bold text-white shadow-sm transition hover:bg-[#711826] sm:w-auto"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <Plus className="size-4" />
        Add
      </button>
      {open ? (
        <div
          className="absolute right-0 z-50 mt-2 w-full min-w-72 rounded-lg border border-zinc-300 bg-white p-2 text-left shadow-xl sm:w-80"
          id={menuId}
          role="menu"
        >
          <p className="px-2 pb-2 pt-1 text-xs font-bold uppercase tracking-[0.14em] text-zinc-500">
            What happened?
          </p>
          {addItems.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                className="flex min-h-14 items-center gap-3 rounded-md px-2 py-2 transition hover:bg-rose-50"
                href={item.href}
                key={item.href}
                onClick={() => setOpen(false)}
                role="menuitem"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-md bg-rose-50 text-[#8a1f2d]">
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-bold text-zinc-950">{item.label}</span>
                  <span className="mt-0.5 block text-xs font-medium text-zinc-500">{item.description}</span>
                </span>
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
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
  const mobileNavId = useId();
  const desktopNavId = useId();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [desktopMenuOpen, setDesktopMenuOpen] = useState(true);
  const { data: session, isPending: sessionPending } = useSession();
  const localPreviewReview =
    process.env.NODE_ENV !== "production" &&
    process.env.NEXT_PUBLIC_RECORDS_UI_PREVIEW === "1";
  const hasSession = Boolean(session);
  const isAuthenticated = hasSession || localPreviewReview;
  const isAdmin = session?.user.role === "admin";
  const visibleNavItems = isAuthenticated
    ? navItems
    : navItems.filter((item) => item.href === "/" || item.href === "/binder-v2");
  const utils = trpc.useUtils();
  const currentMonth = trpc.spend.currentMonth.useQuery(undefined, {
    enabled: hasSession,
    staleTime: 60_000,
  });
  const monthlyTotal = currentMonth.data?.total ?? 0;
  const monthlyLabel = currentMonth.data?.label ?? "This month";

  useEffect(() => {
    if (!hasSession) {
      return;
    }

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
  }, [hasSession, pathname, utils]);

  async function signOut() {
    await authClient.signOut();
    clearPersistedQueryCache();
    window.location.assign("/");
  }

  useEffect(() => {
    const root = document.documentElement;

    root.style.setProperty(
      "--app-nav-width",
      desktopMenuOpen ? "256px" : "72px",
    );

    return () => {
      root.style.removeProperty("--app-nav-width");
    };
  }, [desktopMenuOpen]);

  return (
    <>
      <aside
        className={`fixed bottom-4 left-4 top-4 z-40 hidden flex-col rounded-xl border border-zinc-300 bg-[#fdfcf8] p-3 shadow-lg transition-[width] duration-200 lg:flex ${
          desktopMenuOpen ? "w-64" : "w-[72px]"
        }`}
      >
        <div
          className={`flex items-center ${
            desktopMenuOpen ? "justify-between gap-3" : "justify-center"
          }`}
        >
          <Link
            aria-label="Go to Library"
            className={`flex min-h-11 min-w-0 items-center gap-2 rounded-lg text-zinc-950 transition hover:text-[#8a1f2d] ${
              desktopMenuOpen ? "px-1" : "justify-center"
            }`}
            href="/"
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[#8a1f2d] text-sm font-black text-white">
              Y
            </span>
            {desktopMenuOpen ? (
              <span className="min-w-0">
                <span className="block truncate text-sm font-black leading-4">
                  Yu-Gi-Oh!
                </span>
                <span className="block truncate text-xs font-semibold text-zinc-500">
                  Collection hub
                </span>
              </span>
            ) : null}
          </Link>

          {desktopMenuOpen ? (
            <button
              aria-controls={desktopNavId}
              aria-expanded={desktopMenuOpen}
              aria-label="Collapse navigation"
              className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-zinc-300 bg-white text-zinc-600 shadow-sm transition hover:border-zinc-950 hover:text-zinc-950"
              onClick={() => setDesktopMenuOpen(false)}
              title="Collapse navigation"
              type="button"
            >
              <PanelLeftClose className="size-4" />
            </button>
          ) : null}
        </div>

        {!desktopMenuOpen ? (
          <button
            aria-controls={desktopNavId}
            aria-expanded={desktopMenuOpen}
            aria-label="Expand navigation"
            className="mt-4 inline-flex size-12 items-center justify-center rounded-lg border border-zinc-300 bg-white text-zinc-600 shadow-sm transition hover:border-zinc-950 hover:text-zinc-950"
            onClick={() => setDesktopMenuOpen(true)}
            title="Expand navigation"
            type="button"
          >
            <PanelLeftOpen className="size-4" />
          </button>
        ) : null}

        <nav
          aria-label="Primary"
          className="mt-5 flex flex-1 flex-col gap-1.5"
          id={desktopNavId}
        >
          {visibleNavItems.map((item) => (
            <PrimaryNavLink
              active={isActive(pathname, item.href)}
              expanded={desktopMenuOpen}
              item={item}
              key={item.href}
            />
          ))}
        </nav>

        <div className="mt-4 flex flex-col gap-2 border-t border-zinc-200 pt-3">
          <ThemeToggle expanded={desktopMenuOpen} />
          {isAuthenticated ? (
            <button
              className={`inline-flex min-h-11 items-center gap-2 rounded-lg border border-zinc-300 bg-white text-sm font-bold text-zinc-700 shadow-sm transition hover:border-zinc-950 hover:text-zinc-950 ${
                desktopMenuOpen ? "w-full px-3" : "size-12 justify-center"
              }`}
              onClick={() => void signOut()}
              title="Sign out"
              type="button"
            >
              <LogOut className="size-4 shrink-0" />
              {desktopMenuOpen ? (
                <span>Sign out</span>
              ) : (
                <span className="sr-only">Sign out</span>
              )}
            </button>
          ) : sessionPending ? null : (
            <Link
              aria-label="Owner sign in"
              className={`inline-flex min-h-11 items-center gap-2 rounded-lg border border-zinc-300 bg-white text-sm font-bold text-zinc-700 shadow-sm transition hover:border-[#8a1f2d] hover:text-[#8a1f2d] ${
                desktopMenuOpen ? "w-full px-3" : "size-12 justify-center"
              }`}
              href="/login"
              title="Owner sign in"
            >
              <LogIn className="size-4 shrink-0" />
              {desktopMenuOpen ? (
                <span>Owner sign in</span>
              ) : (
                <span className="sr-only">Owner sign in</span>
              )}
            </Link>
          )}

          {isAuthenticated ? (
            desktopMenuOpen ? (
              <SpendSummaryLink
                className="mt-3 w-full justify-between"
                monthlyLabel={monthlyLabel}
                monthlyTotal={monthlyTotal}
              />
            ) : (
              <Link
                aria-label={`Spend for ${monthlyLabel}: ${formatCurrency(
                  monthlyTotal,
                )}`}
                className="mt-3 inline-flex size-12 items-center justify-center rounded-lg border border-zinc-300 bg-white text-zinc-600 shadow-sm transition hover:border-[#8a1f2d] hover:bg-rose-50 hover:text-[#8a1f2d]"
                href="/records"
                title={`Actual cost for ${monthlyLabel}: ${formatCurrency(monthlyTotal)}`}
              >
                <Wallet className="size-4" />
              </Link>
            )
          ) : null}
        </div>
      </aside>

      <header className="border-b border-zinc-300/80 pb-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#8a1f2d]">
                    {eyebrow}
                  </p>
                  {isAdmin ? (
                    <span
                      aria-label="Signed in as administrator"
                      className="inline-flex items-center gap-1 rounded-full border border-[#8a1f2d]/30 bg-rose-50 px-2 py-0.5 text-[0.6875rem] font-bold uppercase tracking-[0.12em] text-[#8a1f2d]"
                    >
                      <ShieldCheck aria-hidden className="size-3" />
                      Admin
                    </span>
                  ) : null}
                </div>
                <h1 className="mt-2 text-3xl font-bold leading-none tracking-normal text-zinc-950 sm:text-5xl">
                  {title}
                </h1>
              </div>

              <button
                aria-controls={mobileNavId}
                aria-expanded={mobileMenuOpen}
                className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 text-sm font-bold text-zinc-700 shadow-sm transition hover:border-zinc-950 hover:text-zinc-950 lg:hidden"
                onClick={() => setMobileMenuOpen((open) => !open)}
                type="button"
              >
                {mobileMenuOpen ? (
                  <X className="size-4" />
                ) : (
                  <Menu className="size-4" />
                )}
                <span>{mobileMenuOpen ? "Close" : "Menu"}</span>
              </button>
            </div>

            <nav
              aria-label="Primary"
              className={`mt-4 w-full gap-2 rounded-lg border border-zinc-300 bg-white p-2 shadow-sm lg:hidden ${
                mobileMenuOpen ? "grid" : "hidden"
              }`}
              id={mobileNavId}
            >
              {visibleNavItems.map((item) => (
                <PrimaryNavLink
                  active={isActive(pathname, item.href)}
                  item={item}
                  key={item.href}
                  mobile
                  onSelect={() => setMobileMenuOpen(false)}
                />
              ))}
              <div className="mt-1 border-t border-zinc-200 pt-2">
                <ThemeToggle mobile />
                {isAuthenticated ? (
                  <button
                    className="mt-2 flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-sm font-semibold text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-950"
                    onClick={() => void signOut()}
                    type="button"
                  >
                    <LogOut className="size-4" />
                    Sign out
                  </button>
                ) : sessionPending ? null : (
                  <Link
                    className="mt-2 flex min-h-12 items-center gap-3 rounded-lg px-3 text-sm font-semibold text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-950"
                    href="/login"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    <LogIn className="size-4" />
                    Owner sign in
                  </Link>
                )}
              </div>
            </nav>
          </div>
          <div className="flex w-full shrink-0 flex-col items-start gap-3 lg:w-auto lg:items-end">
            {isAuthenticated ? (
              <SpendSummaryLink
                className="w-full justify-between lg:hidden"
                monthlyLabel={monthlyLabel}
                monthlyTotal={monthlyTotal}
              />
            ) : null}
            {!isAuthenticated && !sessionPending ? (
              <p className="inline-flex items-center gap-2 text-sm font-semibold text-zinc-500">
                <LockKeyhole className="size-4" />
                Public read-only view
              </p>
            ) : null}
            {isAuthenticated ? <GlobalAddMenu /> : null}
            {actions ? <div className="w-full lg:w-auto">{actions}</div> : null}
          </div>
        </div>
      </header>
    </>
  );
}

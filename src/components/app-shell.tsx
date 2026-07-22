"use client";

import {
  BookOpen,
  CircleDot,
  Store,
  FileClock,
  Lightbulb,
  ListChecks,
  LogIn,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Sparkles,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import {
  createContext,
  useContext,
  useId,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from "react";
import { useInitialAuth } from "@/app/providers";
import { ThemeToggle } from "@/components/theme-toggle";
import { authClient, useSession } from "@/lib/auth-client";
import { useClientReady } from "@/lib/use-client-ready";
import { clearPersistedQueryCache, trpc } from "@/trpc/client";

const navItems = [
  { href: "/", icon: ListChecks, label: "Library" },
  { href: "/records", icon: FileClock, label: "Records" },
  { href: "/assign-chase", icon: Sparkles, label: "Assign chase" },
  { href: "/wheel", icon: CircleDot, label: "Wheel" },
  { href: "/binder-v2", icon: BookOpen, label: "Binder" },
] satisfies Array<{ href: string; icon: LucideIcon; label: string }>;

const recordsSubNavItems = [
  { href: "/records/history", label: "History" },
  { href: "/records/inventory", label: "Inventory" },
] as const;

const adminNavItems = [
  { href: "/ebay", icon: Store, label: "eBay selling" },
  { href: "/feature-ideas", icon: Lightbulb, label: "Feature ideas" },
] satisfies Array<{ href: string; icon: LucideIcon; label: string }>;

type AppShellContextValue = {
  mobileNavId: string;
  mobileMenuOpen: boolean;
  toggleMobileMenu: () => void;
};

const AppShellContext = createContext<AppShellContextValue>({
  mobileNavId: "",
  mobileMenuOpen: false,
  toggleMobileMenu: () => undefined,
});

export function useAppShell() {
  return useContext(AppShellContext);
}

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
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

function isPlainNavigation(event: MouseEvent<HTMLAnchorElement>) {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

function NavPendingIndicator({ active }: { active: boolean }) {
  const { pending } = useLinkStatus();
  return (
    <span
      aria-hidden
      className={`absolute right-2 top-1/2 size-1.5 -translate-y-1/2 rounded-full transition-opacity ${
        active ? "bg-white" : "bg-[#8a1f2d]"
      } ${pending ? "opacity-100" : "opacity-0"}`}
    />
  );
}

function PrimaryNavLink({
  active,
  expanded = true,
  item,
  mobile = false,
  onSelect,
  parentActive = false,
}: {
  active: boolean;
  expanded?: boolean;
  item: (typeof navItems)[number] | (typeof adminNavItems)[number];
  mobile?: boolean;
  onSelect: (href: string, event: MouseEvent<HTMLAnchorElement>) => void;
  parentActive?: boolean;
}) {
  const Icon = item.icon;
  const activeClass = active
    ? "bg-[#8a1f2d] text-white shadow-sm"
    : parentActive
      ? "bg-rose-100 text-[#8a1f2d]"
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
      onClick={(event) => onSelect(item.href, event)}
      prefetch
      title={item.label}
    >
      <Icon className="size-4 shrink-0" />
      {expanded ? <span className="min-w-0 truncate">{item.label}</span> : <span className="sr-only">{item.label}</span>}
      <NavPendingIndicator active={active} />
    </Link>
  );
}

function RecordsSubNavigation({
  mobile = false,
  onSelect,
  pathname,
}: {
  mobile?: boolean;
  onSelect: (href: string, event: MouseEvent<HTMLAnchorElement>) => void;
  pathname: string;
}) {
  return (
    <div className={`ml-5 grid gap-1 border-l border-zinc-200 pl-3 ${mobile ? "mt-1" : "mt-1.5"}`}>
      {recordsSubNavItems.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            aria-current={active ? "page" : undefined}
            className={`relative flex min-h-10 items-center rounded-lg px-3 text-sm font-semibold transition duration-200 active:scale-[0.99] ${
              active
                ? "bg-[#8a1f2d] text-white shadow-sm"
                : mobile
                  ? "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950"
                  : "text-zinc-600 hover:bg-white hover:text-zinc-950"
            }`}
            href={item.href}
            key={item.href}
            onClick={(event) => onSelect(item.href, event)}
            prefetch
          >
            {item.label}
            <NavPendingIndicator active={active} />
          </Link>
        );
      })}
    </div>
  );
}

function SpendSummaryLink({
  monthlyLabel,
  monthlyTotal,
  onSelect,
}: {
  monthlyLabel: string;
  monthlyTotal: number;
  onSelect: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  return (
    <Link
      className="flex min-h-10 w-full min-w-0 items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-700 shadow-sm transition duration-200 hover:border-[#8a1f2d] hover:bg-rose-50 hover:text-[#8a1f2d]"
      href="/records"
      onClick={onSelect}
      prefetch
      title={`Actual cost for ${monthlyLabel}`}
    >
      <Wallet className="size-4 shrink-0" />
      <span className="min-w-0 truncate text-zinc-500">{monthlyLabel}</span>
      <span className="ml-auto shrink-0 tabular-nums text-zinc-950">{formatCurrency(monthlyTotal)}</span>
    </Link>
  );
}

function isAppRoute(pathname: string) {
  return pathname === "/"
    || pathname.startsWith("/records")
    || pathname === "/assign-chase"
    || pathname === "/wheel"
    || pathname === "/binder-v2"
    || pathname === "/ebay"
    || pathname === "/feature-ideas";
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [desktopMenuOpen, setDesktopMenuOpen] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [optimisticPathname, setOptimisticPathname] = useState<string | null>(null);
  const mobileNavId = useId();
  const desktopNavId = useId();
  const { data: session, isPending: sessionPending } = useSession();
  const initialAuth = useInitialAuth();
  const clientReady = useClientReady();
  const localPreviewReview = process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_RECORDS_UI_PREVIEW === "1";
  const hasSession = Boolean(session) || initialAuth.isAuthenticated;
  const isAuthenticated = hasSession || localPreviewReview;
  const isAdmin = session?.user.role === "admin" || initialAuth.role === "admin";
  const navigationVisible = isAppRoute(pathname);
  const activePathname = optimisticPathname && optimisticPathname !== pathname
    ? optimisticPathname
    : pathname;
  const visibleNavItems = isAuthenticated
    ? [...navItems, ...(isAdmin ? adminNavItems : [])]
    : navItems.filter((item) => item.href === "/" || item.href === "/binder-v2");
  const currentMonth = trpc.spend.currentMonth.useQuery(undefined, {
    enabled: clientReady && hasSession && !localPreviewReview,
    staleTime: 60_000,
  });
  const monthlyTotal = currentMonth.data?.total ?? 0;
  const monthlyLabel = currentMonth.data?.label ?? "This month";

  async function signOut() {
    await authClient.signOut();
    clearPersistedQueryCache();
    window.location.assign("/");
  }

  function selectNavigation(href: string, event: MouseEvent<HTMLAnchorElement>) {
    if (!isPlainNavigation(event)) return;
    setOptimisticPathname(href);
    setMobileMenuOpen(false);
  }

  const shellStyle = {
    "--app-nav-width": navigationVisible ? (desktopMenuOpen ? "256px" : "72px") : "0px",
  } as CSSProperties;

  return (
    <AppShellContext.Provider value={{
      mobileNavId,
      mobileMenuOpen,
      toggleMobileMenu: () => setMobileMenuOpen((open) => !open),
    }}>
      <div style={shellStyle}>
        {navigationVisible ? (
          <>
            <aside className={`fixed bottom-4 left-4 top-4 z-40 hidden flex-col rounded-xl border border-zinc-300 bg-[#fdfcf8] p-3 shadow-lg transition-[width] duration-200 lg:flex ${desktopMenuOpen ? "w-64" : "w-[72px]"}`}>
              <div className={`flex items-center ${desktopMenuOpen ? "justify-between gap-3" : "justify-center"}`}>
                <Link aria-label="Go to Library" className={`flex min-h-11 min-w-0 items-center gap-2 rounded-lg text-zinc-950 transition hover:text-[#8a1f2d] ${desktopMenuOpen ? "px-1" : "justify-center"}`} href="/" onClick={(event) => selectNavigation("/", event)} prefetch>
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[#8a1f2d] text-sm font-black text-white">Y</span>
                  {desktopMenuOpen ? <span className="min-w-0"><span className="block truncate text-sm font-black leading-4">Yu-Gi-Oh!</span><span className="block truncate text-xs font-semibold text-zinc-500">Collection hub</span></span> : null}
                </Link>
                {desktopMenuOpen ? <button aria-controls={desktopNavId} aria-expanded={desktopMenuOpen} aria-label="Collapse navigation" className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-zinc-300 bg-white text-zinc-600 shadow-sm transition hover:border-zinc-950 hover:text-zinc-950" onClick={() => setDesktopMenuOpen(false)} title="Collapse navigation" type="button"><PanelLeftClose className="size-4" /></button> : null}
              </div>
              {!desktopMenuOpen ? <button aria-controls={desktopNavId} aria-expanded={desktopMenuOpen} aria-label="Expand navigation" className="mt-4 inline-flex size-12 items-center justify-center rounded-lg border border-zinc-300 bg-white text-zinc-600 shadow-sm transition hover:border-zinc-950 hover:text-zinc-950" onClick={() => setDesktopMenuOpen(true)} title="Expand navigation" type="button"><PanelLeftOpen className="size-4" /></button> : null}
              <nav aria-label="Primary" className="mt-5 flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto" id={desktopNavId}>
                {visibleNavItems.map((item) => {
                  const recordsChildActive = item.href === "/records" && recordsSubNavItems.some((subItem) => activePathname === subItem.href);
                  const active = item.href === "/records" && recordsChildActive ? false : isActive(activePathname, item.href);
                  return <div key={item.href}><PrimaryNavLink active={active} expanded={desktopMenuOpen} item={item} onSelect={selectNavigation} parentActive={recordsChildActive} />{item.href === "/records" && desktopMenuOpen ? <RecordsSubNavigation onSelect={selectNavigation} pathname={activePathname} /> : null}</div>;
                })}
              </nav>
              <div className="mt-4 flex shrink-0 flex-col gap-2 border-t border-zinc-200 pt-3">
                <ThemeToggle expanded={desktopMenuOpen} />
                {isAuthenticated ? <button className={`inline-flex min-h-11 items-center gap-2 rounded-lg border border-zinc-300 bg-white text-sm font-bold text-zinc-700 shadow-sm transition hover:border-zinc-950 hover:text-zinc-950 ${desktopMenuOpen ? "w-full px-3" : "size-12 justify-center"}`} onClick={() => void signOut()} title="Sign out" type="button"><LogOut className="size-4 shrink-0" />{desktopMenuOpen ? <span>Sign out</span> : <span className="sr-only">Sign out</span>}</button> : sessionPending ? null : <Link aria-label="Owner sign in" className={`inline-flex min-h-11 items-center gap-2 rounded-lg border border-zinc-300 bg-white text-sm font-bold text-zinc-700 shadow-sm transition hover:border-[#8a1f2d] hover:text-[#8a1f2d] ${desktopMenuOpen ? "w-full px-3" : "size-12 justify-center"}`} href="/login" title="Owner sign in"><LogIn className="size-4 shrink-0" />{desktopMenuOpen ? <span>Owner sign in</span> : <span className="sr-only">Owner sign in</span>}</Link>}
                {isAuthenticated ? desktopMenuOpen ? <SpendSummaryLink monthlyLabel={monthlyLabel} monthlyTotal={monthlyTotal} onSelect={(event) => selectNavigation("/records", event)} /> : <Link aria-label={`Spend for ${monthlyLabel}: ${formatCurrency(monthlyTotal)}`} className="mt-3 inline-flex size-12 items-center justify-center rounded-lg border border-zinc-300 bg-white text-zinc-600 shadow-sm transition hover:border-[#8a1f2d] hover:bg-rose-50 hover:text-[#8a1f2d]" href="/records" onClick={(event) => selectNavigation("/records", event)} prefetch title={`Actual cost for ${monthlyLabel}: ${formatCurrency(monthlyTotal)}`}><Wallet className="size-4" /></Link> : null}
              </div>
            </aside>
            {mobileMenuOpen ? <div className="fixed inset-x-4 top-4 z-50 rounded-xl border border-zinc-300 bg-[#fdfcf8] p-3 shadow-xl lg:hidden" id={mobileNavId}><div className="flex items-center justify-between gap-3"><span className="font-black text-zinc-950">Yu-Gi-Oh! Collection hub</span><button aria-label="Close navigation" className="inline-flex size-10 items-center justify-center rounded-lg border border-zinc-300 bg-white text-zinc-600" onClick={() => setMobileMenuOpen(false)} type="button"><X className="size-4" /></button></div><nav aria-label="Primary" className="mt-3 grid gap-1">{visibleNavItems.map((item) => { const recordsChildActive = item.href === "/records" && recordsSubNavItems.some((subItem) => activePathname === subItem.href); const active = item.href === "/records" && recordsChildActive ? false : isActive(activePathname, item.href); return <div key={item.href}><PrimaryNavLink active={active} item={item} mobile onSelect={selectNavigation} parentActive={recordsChildActive} />{item.href === "/records" ? <RecordsSubNavigation mobile onSelect={selectNavigation} pathname={activePathname} /> : null}</div>; })}</nav><div className="mt-3 border-t border-zinc-200 pt-3">{isAuthenticated ? <SpendSummaryLink monthlyLabel={monthlyLabel} monthlyTotal={monthlyTotal} onSelect={(event) => selectNavigation("/records", event)} /> : null}<div className={isAuthenticated ? "mt-2" : ""}><ThemeToggle mobile /></div>{isAuthenticated ? <button className="mt-2 flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-sm font-semibold text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-950" onClick={() => void signOut()} type="button"><LogOut className="size-4" />Sign out</button> : sessionPending ? null : <Link className="mt-2 flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-sm font-semibold text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-950" href="/login"><LogIn className="size-4" />Owner sign in</Link>}</div></div> : null}
          </>
        ) : null}
        {children}
      </div>
    </AppShellContext.Provider>
  );
}

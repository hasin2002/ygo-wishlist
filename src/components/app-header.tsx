"use client";

import {
  Layers3,
  Menu,
  PackageOpen,
  Plus,
  ReceiptText,
  Star,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { useInitialAuth } from "@/app/providers";
import { useAppShell } from "@/components/app-shell";
import { useSession } from "@/lib/auth-client";
import { trpc } from "@/trpc/client";

const addItems = [
  { description: "Create a card target you want to collect", href: "/wishlist/new", icon: Star, label: "Add to wishlist" },
  { description: "Cards, sealed, bulk, and supplies", href: "/records/new/purchase", icon: Plus, label: "Purchase" },
  { description: "Open sealed product and record pulls", href: "/records/new/opening", icon: PackageOpen, label: "Pack opening" },
  { description: "Sell exact physical card copies", href: "/records/new/sale", icon: ReceiptText, label: "Sale" },
  { description: "Create one eBay offer containing several exact Copies", href: "/records/listings/new-lot", icon: Layers3, label: "Mixed card lot" },
] as const;

function GlobalAddMenu() {
  const menuId = useId();
  const menuItemRefs = useRef<Array<HTMLElement | null>>([]);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [activeItemIndex, setActiveItemIndex] = useState(0);
  const [retryingEbayCheck, setRetryingEbayCheck] = useState(false);
  const retryingEbayCheckRef = useRef(false);
  const { data: session } = useSession();
  const ebayStatus = trpc.ebay.status.useQuery(undefined, {
    enabled: Boolean(session),
    staleTime: 30_000,
  });
  const ebayCapability = ebayStatus.data?.capability;
  const recordsPreview = process.env.NEXT_PUBLIC_RECORDS_UI_PREVIEW === "1";
  function menuItems() {
    return menuItemRefs.current.filter((item): item is HTMLElement => item !== null && !item.matches(":disabled"));
  }

  async function retryEbayCheck() {
    if (retryingEbayCheckRef.current) return;
    retryingEbayCheckRef.current = true;
    setRetryingEbayCheck(true);
    try {
      await ebayStatus.refetch();
    } finally {
      retryingEbayCheckRef.current = false;
      setRetryingEbayCheck(false);
    }
  }

  function focusMenuItem(index: number) {
    window.requestAnimationFrame(() => {
      const items = menuItems();
      if (!items.length) return;
      const nextIndex = (index + items.length) % items.length;
      setActiveItemIndex(nextIndex);
      items[nextIndex]?.focus();
    });
  }

  function closeMenu({ restoreFocus = false }: { restoreFocus?: boolean } = {}) {
    setOpen(false);
    if (restoreFocus) window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function openMenu(focusIndex?: number) {
    setOpen(true);
    setActiveItemIndex(0);
    if (focusIndex !== undefined) focusMenuItem(focusIndex);
  }

  function onTriggerKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      openMenu(0);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      openMenu(-1);
    }
  }

  function onMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const items = menuItems();
    if (!items.length) return;
    const currentIndex = Math.max(0, items.indexOf(document.activeElement as HTMLElement));
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusMenuItem(currentIndex + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusMenuItem(currentIndex - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusMenuItem(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusMenuItem(-1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeMenu({ restoreFocus: true });
    }
  }

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) closeMenu();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && open) closeMenu({ restoreFocus: true });
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);
  return (
    <div className="relative" ref={wrapperRef}>
      <button aria-controls={menuId} aria-expanded={open} aria-haspopup="menu" className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-md bg-[#8a1f2d] px-3 text-sm font-bold text-white shadow-sm transition hover:bg-[#711826] focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-offset-2 active:scale-[0.98]" onClick={() => open ? closeMenu() : openMenu()} onKeyDown={onTriggerKeyDown} ref={triggerRef} type="button"><Plus aria-hidden className="size-4" /><span className="sr-only">Add</span><span aria-hidden className="hidden sm:inline">Add</span></button>
      {open ? <div aria-label="Add an activity" className="absolute right-0 z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-zinc-300 bg-white p-2 text-left shadow-xl" id={menuId} onKeyDown={onMenuKeyDown} role="menu">
        <p className="px-2 pb-2 pt-1 text-xs font-bold uppercase tracking-[0.14em] text-zinc-500">What happened?</p>
        {(() => {
          let menuItemIndex = 0;
          return addItems.map((item) => {
          const Icon = item.icon;
          const isMixedLot = item.href === "/records/listings/new-lot";
          const unavailable = isMixedLot && (recordsPreview || ebayStatus.isError || !ebayCapability?.ebay.allowed);
          const reason = recordsPreview
            ? "Mixed eBay lots are unavailable in preview mode."
            : ebayStatus.isError
              ? "eBay readiness could not be checked."
              : ebayStatus.isPending
                ? "Checking eBay readiness…"
                : ebayCapability
                  ? `${ebayCapability.ebay.message} ${ebayCapability.ebay.remedy}`
                  : "Seller permission is required to create an eBay mixed lot.";
          const itemIndex = menuItemIndex++;
          const retryIndex = unavailable && ebayStatus.isError ? menuItemIndex++ : null;
          return unavailable ? <div className="grid gap-1" key={item.href}><button aria-disabled="true" className="flex min-h-14 cursor-not-allowed items-center gap-3 rounded-md px-2 py-2 text-left opacity-70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8a1f2d]" onClick={(event) => event.preventDefault()} ref={(element) => { menuItemRefs.current[itemIndex] = element; }} role="menuitem" tabIndex={itemIndex === activeItemIndex ? 0 : -1} type="button"><span className="grid size-9 shrink-0 place-items-center rounded-md bg-zinc-100 text-zinc-500"><Icon className="size-4" /></span><span className="min-w-0"><span className="block text-sm font-bold text-zinc-700">{item.label}</span><span className="mt-0.5 block text-xs font-medium text-zinc-500" role={ebayStatus.isError ? "alert" : "status"}>{reason}</span></span></button>{retryIndex !== null ? <button aria-busy={retryingEbayCheck} aria-disabled={retryingEbayCheck} className="min-h-11 rounded-md border border-rose-300 bg-white px-3 text-xs font-bold text-rose-900 transition hover:border-rose-900 focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-offset-2 aria-disabled:cursor-wait aria-disabled:opacity-60" onClick={() => void retryEbayCheck()} ref={(element) => { menuItemRefs.current[retryIndex] = element; }} role="menuitem" tabIndex={retryIndex === activeItemIndex ? 0 : -1} type="button">{retryingEbayCheck ? "Checking eBay…" : "Retry eBay check"}</button> : null}</div> : <Link className="flex min-h-14 items-center gap-3 rounded-md px-2 py-2 transition hover:bg-rose-50 focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-offset-2 active:scale-[0.99]" href={item.href} key={item.href} onClick={() => closeMenu()} ref={(element) => { menuItemRefs.current[itemIndex] = element; }} role="menuitem" tabIndex={itemIndex === activeItemIndex ? 0 : -1}><span className="grid size-9 shrink-0 place-items-center rounded-md bg-rose-50 text-[#8a1f2d]"><Icon className="size-4" /></span><span className="min-w-0"><span className="block text-sm font-bold text-zinc-950">{item.label}</span><span className="mt-0.5 block text-xs font-medium text-zinc-500">{item.description}</span></span></Link>;
          });
        })()}
      </div> : null}
    </div>
  );
}

export function AppHeader({ actions, title }: { actions?: ReactNode; title: string }) {
  const { data: session } = useSession();
  const initialAuth = useInitialAuth();
  const { mobileMenuOpen, mobileNavId, toggleMobileMenu } = useAppShell();
  const localPreviewReview = process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_RECORDS_UI_PREVIEW === "1";
  const hasSession = Boolean(session) || initialAuth.isAuthenticated || localPreviewReview;

  return <header className="flex min-h-11 min-w-0 items-center justify-between gap-3"><h1 className="min-w-0 truncate text-2xl font-black leading-tight text-zinc-950 sm:text-3xl" id="page-title">{title}</h1><div className="flex shrink-0 items-center gap-2">{actions}{hasSession ? <GlobalAddMenu /> : null}<button aria-controls={mobileNavId} aria-expanded={mobileMenuOpen} aria-label={mobileMenuOpen ? "Close navigation" : "Open navigation"} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-zinc-300 bg-white text-zinc-700 shadow-sm transition hover:border-zinc-950 hover:text-zinc-950 lg:hidden" onClick={toggleMobileMenu} type="button">{mobileMenuOpen ? <X className="size-4" /> : <Menu className="size-4" />}</button></div></header>;
}

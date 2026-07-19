"use client";

import {
  LockKeyhole,
  Menu,
  PackageOpen,
  Plus,
  ReceiptText,
  ShieldCheck,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useInitialAuth } from "@/app/providers";
import { useAppShell } from "@/components/app-shell";
import { useSession } from "@/lib/auth-client";

const addItems = [
  { description: "Cards, sealed, bulk, and supplies", href: "/records/new/purchase", icon: Plus, label: "Purchase" },
  { description: "Open sealed product and record pulls", href: "/records/new/opening", icon: PackageOpen, label: "Pack opening" },
  { description: "Sell exact physical card copies", href: "/records/new/sale", icon: ReceiptText, label: "Sale" },
] as const;

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
  return <div className="relative w-full sm:w-auto" ref={wrapperRef}><button aria-controls={menuId} aria-expanded={open} aria-haspopup="menu" className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-[#8a1f2d] px-4 text-sm font-bold text-white shadow-sm transition hover:bg-[#711826] sm:w-auto" onClick={() => setOpen((current) => !current)} type="button"><Plus className="size-4" />Add</button>{open ? <div className="absolute right-0 z-50 mt-2 w-full min-w-72 rounded-lg border border-zinc-300 bg-white p-2 text-left shadow-xl sm:w-80" id={menuId} role="menu"><p className="px-2 pb-2 pt-1 text-xs font-bold uppercase tracking-[0.14em] text-zinc-500">What happened?</p>{addItems.map((item) => { const Icon = item.icon; return <Link className="flex min-h-14 items-center gap-3 rounded-md px-2 py-2 transition hover:bg-rose-50" href={item.href} key={item.href} onClick={() => setOpen(false)} role="menuitem"><span className="grid size-9 shrink-0 place-items-center rounded-md bg-rose-50 text-[#8a1f2d]"><Icon className="size-4" /></span><span className="min-w-0"><span className="block text-sm font-bold text-zinc-950">{item.label}</span><span className="mt-0.5 block text-xs font-medium text-zinc-500">{item.description}</span></span></Link>; })}</div> : null}</div>;
}

export function AppHeader({ actions, eyebrow, title }: { actions?: ReactNode; eyebrow: string; title: string }) {
  const { data: session, isPending: sessionPending } = useSession();
  const initialAuth = useInitialAuth();
  const { mobileMenuOpen, mobileNavId, toggleMobileMenu } = useAppShell();
  const hasSession = Boolean(session) || initialAuth.isAuthenticated;
  const isAdmin = session?.user.role === "admin" || initialAuth.role === "admin";

  return <header className="border-b border-zinc-300/80 pb-5"><div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div className="min-w-0"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#8a1f2d]">{eyebrow}</p>{isAdmin ? <span aria-label="Signed in as administrator" className="inline-flex items-center gap-1 rounded-full border border-[#8a1f2d]/30 bg-rose-50 px-2 py-0.5 text-[0.6875rem] font-bold uppercase tracking-[0.12em] text-[#8a1f2d]"><ShieldCheck aria-hidden className="size-3" />Admin</span> : null}</div><h1 className="mt-2 text-3xl font-bold leading-none tracking-normal text-zinc-950 sm:text-5xl">{title}</h1></div><button aria-controls={mobileNavId} aria-expanded={mobileMenuOpen} className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 text-sm font-bold text-zinc-700 shadow-sm transition hover:border-zinc-950 hover:text-zinc-950 lg:hidden" onClick={toggleMobileMenu} type="button">{mobileMenuOpen ? <X className="size-4" /> : <Menu className="size-4" />}<span>{mobileMenuOpen ? "Close" : "Menu"}</span></button></div></div><div className="flex w-full shrink-0 flex-col items-start gap-3 lg:w-auto lg:items-end">{!hasSession && !sessionPending ? <p className="inline-flex items-center gap-2 text-sm font-semibold text-zinc-500"><LockKeyhole className="size-4" />Public read-only view</p> : null}{hasSession ? <GlobalAddMenu /> : null}{actions ? <div className="w-full lg:w-auto">{actions}</div> : null}</div></div></header>;
}

"use client";

import { Suspense } from "react";
import { useParams, usePathname } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import {
  PreviewBanner,
  InventoryCardDetail,
  RecordsApp,
  type RecordsView,
} from "@/components/records/records-app";
import { RecordsContentLoading } from "@/components/records/records-loading-screen";

function viewForPathname(pathname: string): RecordsView {
  if (pathname === "/records/history") return "history";
  if (pathname === "/records/inventory" || pathname.startsWith("/records/inventory/cards/")) return "inventory";
  return "overview";
}

export function RecordsWorkspace({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const params = useParams<{ targetId?: string }>();
  const targetId = typeof params.targetId === "string" ? params.targetId : null;
  const isInventoryCardDetail = pathname.startsWith("/records/inventory/cards/") && targetId;

  return (
    <main className="app-page-shell min-h-screen bg-[#f6f4ef] px-4 py-5 text-zinc-950 sm:px-6">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
        <AppHeader eyebrow="Private collection records" title="Records" />
        <PreviewBanner />
        <Suspense fallback={<RecordsContentLoading />}>
          {isInventoryCardDetail ? <InventoryCardDetail targetId={targetId} /> : <RecordsApp view={viewForPathname(pathname)} />}
        </Suspense>
        {children}
      </div>
    </main>
  );
}

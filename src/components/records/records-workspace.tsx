"use client";

import { Suspense } from "react";
import { useParams, usePathname } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { EbayListingPage } from "@/components/records/ebay-listing-action";
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

function isInventoryCardDetailPath(pathname: string) {
  return /^\/records\/inventory\/cards\/[^/]+$/.test(pathname);
}

function isEbayListingPath(pathname: string) {
  return /^\/records\/inventory\/cards\/[^/]+\/copies\/[^/]+\/sell$/.test(pathname);
}

export function RecordsWorkspace({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const params = useParams<{ copyId?: string; targetId?: string }>();
  const copyId = typeof params.copyId === "string" ? params.copyId : null;
  const targetId = typeof params.targetId === "string" ? params.targetId : null;
  const inventoryCardDetail = isInventoryCardDetailPath(pathname) && targetId
    ? { targetId }
    : null;
  const ebayListing = isEbayListingPath(pathname) && copyId && targetId
    ? { copyId, targetId }
    : null;

  return (
    <main className="app-page-shell min-h-screen bg-[#f6f4ef] px-4 py-5 text-zinc-950 sm:px-6">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
        <AppHeader eyebrow="Private collection records" title="Records" />
        <PreviewBanner />
        <Suspense fallback={<RecordsContentLoading />}>
          {ebayListing
            ? <EbayListingPage copyId={ebayListing.copyId} key={`${ebayListing.targetId}:${ebayListing.copyId}`} targetId={ebayListing.targetId} />
            : inventoryCardDetail
              ? <InventoryCardDetail targetId={inventoryCardDetail.targetId} />
              : <RecordsApp view={viewForPathname(pathname)} />}
        </Suspense>
        {children}
      </div>
    </main>
  );
}

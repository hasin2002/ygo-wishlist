"use client";

import { Suspense } from "react";
import { usePathname } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import {
  PreviewBanner,
  RecordsApp,
  RecordsNavigation,
  type RecordsView,
} from "@/components/records/records-app";
import { RecordsContentLoading } from "@/components/records/records-loading-screen";

function viewForPathname(pathname: string): RecordsView {
  if (pathname === "/records/history") return "history";
  if (pathname === "/records/inventory") return "inventory";
  return "overview";
}

export function RecordsWorkspace({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <main className="app-page-shell min-h-screen bg-[#f6f4ef] px-4 py-5 text-zinc-950 sm:px-6">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
        <AppHeader eyebrow="Private collection records" title="Records" />
        <PreviewBanner />
        <RecordsNavigation view={viewForPathname(pathname)} />
        <Suspense fallback={<RecordsContentLoading />}>
          <RecordsApp view={viewForPathname(pathname)} />
        </Suspense>
        {children}
      </div>
    </main>
  );
}

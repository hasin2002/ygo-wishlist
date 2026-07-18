"use client";

import { TrpcProvider } from "@/trpc/client";
import type { ReactNode } from "react";
import { RecordsDataProvider } from "@/components/records/records-preview-provider";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <TrpcProvider>
      <RecordsDataProvider>{children}</RecordsDataProvider>
    </TrpcProvider>
  );
}

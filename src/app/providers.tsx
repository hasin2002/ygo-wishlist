"use client";

import { TrpcProvider } from "@/trpc/client";
import type { ReactNode } from "react";
import { RecordsPreviewProvider } from "@/components/records/records-preview-provider";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <TrpcProvider>
      <RecordsPreviewProvider>{children}</RecordsPreviewProvider>
    </TrpcProvider>
  );
}

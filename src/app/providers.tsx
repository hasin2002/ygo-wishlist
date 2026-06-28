"use client";

import { TrpcProvider } from "@/trpc/client";
import type { ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  return <TrpcProvider>{children}</TrpcProvider>;
}

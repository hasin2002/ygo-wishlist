"use client";

import { TrpcProvider } from "@/trpc/client";
import { useCollectionChangeListener } from "@/lib/use-collection-change";
import { AppShell } from "@/components/app-shell";
import {
  createContext,
  useContext,
  type ReactNode,
} from "react";

export type InitialAuthState = {
  isAuthenticated: boolean;
  role: string | null;
};

const InitialAuthContext = createContext<InitialAuthState>({
  isAuthenticated: false,
  role: null,
});

export function useInitialAuth() {
  return useContext(InitialAuthContext);
}

export function Providers({
  children,
  initialAuth,
}: {
  children: ReactNode;
  initialAuth: InitialAuthState;
}) {
  return (
    <TrpcProvider>
      <CollectionChangeListener>
        <InitialAuthContext.Provider value={initialAuth}>
          <AppShell>{children}</AppShell>
        </InitialAuthContext.Provider>
      </CollectionChangeListener>
    </TrpcProvider>
  );
}

function CollectionChangeListener({ children }: { children: ReactNode }) {
  useCollectionChangeListener();
  return children;
}

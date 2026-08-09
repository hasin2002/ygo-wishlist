"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { PriceRefreshProgress } from "@/components/price-refresh-progress";
import { DestructiveToast } from "@/components/records/entry-form-ui";
import { collectionRefreshFailureMessage, useCollectionChange } from "@/lib/use-collection-change";
import type { CardCondition } from "@/lib/records/types";
import { trpc } from "@/trpc/client";

export const pricingRefreshBatchSize = 4;

export type RecordPricingCandidate = {
  condition: CardCondition;
  printingId: string;
};

type PricingCandidate =
  | ({ kind: "record" } & RecordPricingCandidate)
  | { id: string; kind: "target" };

type PricingRefreshSource =
  | { kind: "library" }
  | { kind: "record"; recordId: string };

export type PricingRefreshRun = {
  completed: number;
  failed: number;
  noMatch: number;
  refreshed: number;
  running: boolean;
  source: PricingRefreshSource;
  total: number;
};

type PricingRefreshContextValue = {
  activeRun: PricingRefreshRun | null;
  rejectConcurrentRefresh: () => boolean;
  startLibraryRefresh: () => Promise<boolean>;
  startRecordRefresh: (input: { candidates: RecordPricingCandidate[]; recordId: string }) => Promise<boolean>;
};

const PricingRefreshContext = createContext<PricingRefreshContextValue | null>(null);

type PricingToast = {
  message: string;
  title: string;
};

export function PricingRefreshProvider({ children }: { children: ReactNode }) {
  const [activeRun, setActiveRun] = useState<PricingRefreshRun | null>(null);
  const [toast, setToast] = useState<PricingToast | null>(null);
  const activeRunRef = useRef<PricingRefreshRun | null>(null);
  const preparingRef = useRef(false);
  const utils = trpc.useUtils();
  const refreshTargetPricing = trpc.library.refreshPricing.useMutation();
  const refreshRecordPricing = trpc.library.refreshRecordPricing.useMutation();
  const recordPricingRefresh = trpc.library.recordPricingRefresh.useMutation();
  const collectionChanged = useCollectionChange();
  const dismissToast = useCallback(() => setToast(null), []);

  const publishRun = useCallback((run: PricingRefreshRun | null) => {
    activeRunRef.current = run;
    setActiveRun(run);
  }, []);

  const rejectConcurrentRefresh = useCallback(() => {
    const current = activeRunRef.current;
    if (!preparingRef.current && !current?.running) return false;

    const progress = current
      ? ` (${current.completed.toLocaleString("en-GB")} of ${current.total.toLocaleString("en-GB")} checked)`
      : "";
    setToast({
      message: `Another price refresh is already running${progress}. Use the compact progress control in the bottom-right to follow it before starting another refresh.`,
      title: "Price refresh already running",
    });
    return true;
  }, []);

  async function runCandidates(source: PricingRefreshSource, candidates: PricingCandidate[]) {
    let completed = 0;
    let failed = 0;
    let noMatch = 0;
    let refreshed = 0;
    let consecutiveFailures = 0;

    publishRun({ completed, failed, noMatch, refreshed, running: true, source, total: candidates.length });

    try {
      for (let index = 0; index < candidates.length; index += pricingRefreshBatchSize) {
        const batch = await Promise.allSettled(
          candidates.slice(index, index + pricingRefreshBatchSize).map((candidate) => (
            candidate.kind === "target"
              ? refreshTargetPricing.mutateAsync({ id: candidate.id })
              : refreshRecordPricing.mutateAsync({
                  condition: candidate.condition,
                  printingId: candidate.printingId,
                })
          )),
        );

        for (const result of batch) {
          completed += 1;
          if (result.status === "fulfilled") {
            consecutiveFailures = 0;
            if (result.value.foundNewEstimate) refreshed += 1;
            else noMatch += 1;
          } else {
            failed += 1;
            consecutiveFailures += 1;
          }
        }

        publishRun({ completed, failed, noMatch, refreshed, running: true, source, total: candidates.length });

        if (consecutiveFailures >= 6) {
          throw new Error("eBay stopped responding repeatedly, so the refresh was paused. Your completed prices were saved; try again later.");
        }
        if (index + pricingRefreshBatchSize < candidates.length) {
          await new Promise((resolve) => window.setTimeout(resolve, 150));
        }
      }

      publishRun({ completed, failed, noMatch, refreshed, running: false, source, total: candidates.length });
      if (source.kind === "library") {
        await recordPricingRefresh.mutateAsync().catch(() => undefined);
        void utils.library.lastPricingRefresh.invalidate();
      }
      try {
        await collectionChanged("target");
      } catch (error) {
        setToast({
          message: collectionRefreshFailureMessage(error),
          title: "Prices saved; refresh needed",
        });
      }
    } catch (error) {
      const current = activeRunRef.current;
      publishRun(current ? { ...current, running: false } : null);
      setToast({
        message: error instanceof Error ? error.message : "Price refresh stopped unexpectedly. Try again shortly.",
        title: "Price refresh stopped",
      });
    } finally {
      preparingRef.current = false;
    }
  }

  async function startLibraryRefresh() {
    if (rejectConcurrentRefresh()) return false;
    preparingRef.current = true;
    try {
      const [targetCandidates, recordCandidates] = await Promise.all([
        utils.library.pricingCandidates.fetch(),
        utils.library.recordPricingCandidates.fetch(),
      ]);
      const candidates: PricingCandidate[] = [
        ...targetCandidates.map((candidate) => ({ kind: "target" as const, ...candidate })),
        ...recordCandidates.map((candidate) => ({ kind: "record" as const, ...candidate })),
      ];
      await runCandidates({ kind: "library" }, candidates);
      return true;
    } catch (error) {
      preparingRef.current = false;
      setToast({
        message: error instanceof Error ? error.message : "The cards to refresh could not be loaded. Try again shortly.",
        title: "Price refresh could not start",
      });
      return false;
    }
  }

  async function startRecordRefresh({ candidates, recordId }: { candidates: RecordPricingCandidate[]; recordId: string }) {
    if (rejectConcurrentRefresh()) return false;
    preparingRef.current = true;
    await runCandidates(
      { kind: "record", recordId },
      candidates.map((candidate) => ({ kind: "record" as const, ...candidate })),
    );
    return true;
  }

  useEffect(() => {
    if (!activeRun?.running) return;
    function warnBeforeLeaving(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [activeRun?.running]);

  return (
    <PricingRefreshContext.Provider value={{ activeRun, rejectConcurrentRefresh, startLibraryRefresh, startRecordRefresh }}>
      {children}
      {activeRun ? (
        <PriceRefreshProgress
          batchSize={pricingRefreshBatchSize}
          completed={activeRun.completed}
          failed={activeRun.failed}
          noMatch={activeRun.noMatch}
          onDismiss={() => publishRun(null)}
          refreshed={activeRun.refreshed}
          running={activeRun.running}
          total={activeRun.total}
        />
      ) : null}
      <DestructiveToast message={toast?.message ?? null} onDismiss={dismissToast} title={toast?.title} />
    </PricingRefreshContext.Provider>
  );
}

export function usePricingRefresh() {
  const context = useContext(PricingRefreshContext);
  if (!context) throw new Error("usePricingRefresh must be used inside PricingRefreshProvider");
  return context;
}

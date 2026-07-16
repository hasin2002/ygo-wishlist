"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useSession } from "@/lib/auth-client";
import {
  applyAdjustment,
  applyBulkItemization,
  applyOpening,
  applyPurchase,
  applySale,
  changeRecordStatus,
  createPreviewSnapshot,
  type LegacyCard,
} from "@/lib/records/preview-data";
import {
  recordsPreviewStorageKey,
  type PreviewDrafts,
  type RecordsDataSource,
  type RecordsSnapshot,
} from "@/lib/records/types";
import { trpc } from "@/trpc/client";

const emptySnapshot: RecordsSnapshot = {
  version: 1,
  records: [],
  targets: [],
  printings: [],
  copies: [],
  sealedUnits: [],
  bulkLots: [],
  supplies: [],
  attention: [],
};

type StoredPreview = {
  version: 1;
  snapshot: RecordsSnapshot;
  drafts: PreviewDrafts;
};

function readStoredPreview(): StoredPreview | null {
  if (typeof window === "undefined") return null;

  try {
    const stored = window.sessionStorage.getItem(recordsPreviewStorageKey);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as StoredPreview;

    if (parsed.version !== 1 || parsed.snapshot?.version !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

const RecordsDataSourceContext = createContext<RecordsDataSource | null>(null);

export function RecordsPreviewProvider({ children }: { children: ReactNode }) {
  const { data: session, isPending: sessionPending } = useSession();
  const [hydrated, setHydrated] = useState(false);
  const [previewSnapshot, setSnapshot] = useState<RecordsSnapshot | null>(null);
  const [drafts, setDrafts] = useState<PreviewDrafts>({});
  const legacyCards = trpc.cards.list.useQuery(
    { query: "", status: "all" },
    {
      enabled: Boolean(session),
      staleTime: 30_000,
    },
  );

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      const stored = readStoredPreview();
      if (stored) {
        setSnapshot(stored.snapshot);
        setDrafts(stored.drafts);
      }
      setHydrated(true);
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, []);

  const seededSnapshot = useMemo(() => {
    if (!hydrated || sessionPending || (session && legacyCards.isPending)) return null;
    return createPreviewSnapshot((legacyCards.data ?? []) as LegacyCard[]);
  }, [hydrated, legacyCards.data, legacyCards.isPending, session, sessionPending]);
  const snapshot = previewSnapshot ?? seededSnapshot;

  useEffect(() => {
    if (!snapshot || typeof window === "undefined") return;

    const value: StoredPreview = { version: 1, snapshot, drafts };
    window.sessionStorage.setItem(recordsPreviewStorageKey, JSON.stringify(value));
  }, [drafts, snapshot]);

  function withSnapshot(
    action: (current: RecordsSnapshot) => {
      next: RecordsSnapshot;
      result: ReturnType<RecordsDataSource["createPurchase"]>;
    },
  ) {
    if (!snapshot) return { ok: false, message: "Preview data is still loading." } as const;
    const outcome = action(snapshot);
    if (outcome.result.ok) setSnapshot(outcome.next);
    return outcome.result;
  }

  const value: RecordsDataSource = {
    mode: "preview",
    status:
      !snapshot || sessionPending || (Boolean(session) && legacyCards.isPending)
        ? "loading"
        : legacyCards.error
          ? "error"
          : "ready",
    errorMessage: legacyCards.error
      ? "Existing Library cards could not be read. The sample preview is still available."
      : null,
    snapshot: snapshot ?? emptySnapshot,
    drafts,
    createPurchase: (input) => withSnapshot((current) => applyPurchase(current, input)),
    createOpening: (input) => withSnapshot((current) => applyOpening(current, input)),
    createSale: (input) => withSnapshot((current) => applySale(current, input)),
    createAdjustment: (input) => withSnapshot((current) => applyAdjustment(current, input)),
    itemizeBulk: (input) => withSnapshot((current) => applyBulkItemization(current, input)),
    voidRecord: (recordId) =>
      withSnapshot((current) => changeRecordStatus(current, recordId, "void")),
    restoreRecord: (recordId) =>
      withSnapshot((current) => changeRecordStatus(current, recordId, "active")),
    setDraft: (key, nextDraft) => {
      setDrafts((current) =>
        JSON.stringify(current[key]) === JSON.stringify(nextDraft)
          ? current
          : { ...current, [key]: nextDraft },
      );
    },
    clearDraft: (key) => {
      setDrafts((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    },
    resetPreview: () => {
      if (typeof window !== "undefined") {
        window.sessionStorage.removeItem(recordsPreviewStorageKey);
      }
      setDrafts({});
      setSnapshot(createPreviewSnapshot((legacyCards.data ?? []) as LegacyCard[]));
    },
  };

  return (
    <RecordsDataSourceContext.Provider value={value}>
      {children}
    </RecordsDataSourceContext.Provider>
  );
}

export function useRecordsDataSource() {
  const source = useContext(RecordsDataSourceContext);

  if (!source) {
    throw new Error("useRecordsDataSource must be used inside RecordsPreviewProvider");
  }

  return source;
}

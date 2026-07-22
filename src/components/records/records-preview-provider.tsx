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
  applyOpening,
  applyPurchase,
  applySale,
  changeRecordStatus,
  createPreviewSnapshot,
  deleteWishlistTarget,
  replaceRecordCards,
  replaceSaleCopies,
  removeCardCopy,
  resolveCardAttention,
  updateRecordLine,
  updateRecordDetails,
  updateCardCopy,
  type LegacyCard,
} from "@/lib/records/preview-data";
import {
  recordsDraftStorageKey,
  recordsPreviewStorageKey,
  type DataSourceResult,
  type CardAttentionUpdate,
  type CardCopyUpdate,
  type LibraryCardSuggestion,
  type RecordsDataSource,
  type RecordsDrafts,
  type RecordsSnapshot,
  type ResolveProductResult,
} from "@/lib/records/types";
import { trpc } from "@/trpc/client";
import { useClientReady } from "@/lib/use-client-ready";

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
  drafts: RecordsDrafts;
};

type StoredDrafts = {
  version: 1;
  drafts: RecordsDrafts;
};

function readJson<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.sessionStorage.getItem(key);
    return stored ? JSON.parse(stored) as T : null;
  } catch {
    return null;
  }
}

async function resolveTcgplayerProduct(url: string): Promise<ResolveProductResult> {
  try {
    const response = await fetch("/api/records/metadata", {
      body: JSON.stringify({ url }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const payload = await response.json() as {
      message?: string;
      metadata?: {
        title?: string;
        imageUrl?: string;
        edition?: "1st Edition" | "Unlimited Edition" | "Limited Edition";
        rarity?: string;
        setName?: string;
        setCode?: string;
        cardType?: string;
        resolution?: "page" | "fallback";
      };
    };
    if (!response.ok || !payload.metadata) {
      return { ok: false, message: payload.message || "Details could not be fetched." };
    }
    return {
      ok: true,
      metadata: {
        title: payload.metadata.title || "",
        imageUrl: payload.metadata.imageUrl || null,
        edition: payload.metadata.edition || "",
        rarity: payload.metadata.rarity || "",
        setName: payload.metadata.setName || "",
        setCode: payload.metadata.setCode || "",
        cardType: payload.metadata.cardType || "",
        resolution: payload.metadata.resolution || "fallback",
      },
    };
  } catch {
    return {
      ok: false,
      message: "Details could not be fetched. Check your connection, then retry or enter them manually.",
    };
  }
}

function errorResult(error: unknown): DataSourceResult {
  return {
    ok: false,
    message: error instanceof Error ? error.message : "The change could not be saved. Refresh and try again.",
  };
}

function searchLibraryCards(snapshot: RecordsSnapshot, query: string): LibraryCardSuggestion[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (normalizedQuery.length < 2) return [];

  const printingsByTarget = new Map<string, typeof snapshot.printings>();
  for (const printing of snapshot.printings) {
    const current = printingsByTarget.get(printing.targetId) ?? [];
    current.push(printing);
    printingsByTarget.set(printing.targetId, current);
  }

  return snapshot.targets
    .filter((target) => target.name.toLocaleLowerCase().includes(normalizedQuery))
    .flatMap((target) => {
      const printings = printingsByTarget.get(target.id) ?? [];
      const candidates = printings.length ? printings : [null];
      return candidates.map((printing) => ({
        targetId: target.id,
        printingId: printing?.id ?? null,
        name: target.name,
        rarity: target.rarity,
        edition: target.edition as LibraryCardSuggestion["edition"],
        setName: printing?.setName ?? "",
        setCode: printing?.setCode ?? "",
        tcgplayerUrl: printing?.tcgplayerUrl ?? target.tcgplayerUrl,
        imageUrl: printing?.imageUrl ?? target.imageUrl,
      }));
    })
    .sort((left, right) => left.name.localeCompare(right.name) || left.setName.localeCompare(right.setName))
    .slice(0, 6);
}

const RecordsDataSourceContext = createContext<RecordsDataSource | null>(null);

function RecordsPreviewStateProvider({ children }: { children: ReactNode }) {
  const { data: session, isPending: sessionPending } = useSession();
  const [hydrated, setHydrated] = useState(false);
  const [previewSnapshot, setSnapshot] = useState<RecordsSnapshot | null>(null);
  const [drafts, setDrafts] = useState<RecordsDrafts>({});
  const legacyCards = trpc.legacyCards.list.useQuery(
    { query: "", status: "all" },
    { enabled: Boolean(session), staleTime: 30_000 },
  );

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      const stored = readJson<StoredPreview>(recordsPreviewStorageKey);
      if (stored?.version === 1 && stored.snapshot?.version === 1) {
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

  async function withSnapshot(
    action: (current: RecordsSnapshot) => { next: RecordsSnapshot; result: DataSourceResult },
  ): Promise<DataSourceResult> {
    if (!snapshot) return { ok: false, message: "Preview data is still loading." };
    const outcome = action(snapshot);
    if (outcome.result.ok) setSnapshot(outcome.next);
    return outcome.result;
  }

  const value: RecordsDataSource = {
    mode: "preview",
    status: !snapshot || sessionPending || (Boolean(session) && legacyCards.isPending)
      ? "loading"
      : legacyCards.error ? "error" : "ready",
    errorMessage: legacyCards.error
      ? "Existing Library cards could not be read. The sample preview is still available."
      : null,
    snapshot: snapshot ?? emptySnapshot,
    drafts,
    resolveTcgplayerProduct,
    searchLibraryCards: (query) => searchLibraryCards(snapshot ?? emptySnapshot, query),
    createPurchase: (input) => withSnapshot((current) => applyPurchase(current, input)),
    createOpening: (input) => withSnapshot((current) => applyOpening(current, input)),
    createSale: (input) => withSnapshot((current) => applySale(current, input)),
    updateRecordDetails: (recordId, update) => withSnapshot((current) => updateRecordDetails(current, recordId, update)),
    resolveCardAttention: (update: CardAttentionUpdate) => withSnapshot((current) => resolveCardAttention(current, update)),
    replaceRecordCards: (recordId, cards) => withSnapshot((current) => replaceRecordCards(current, recordId, cards)),
    replaceSaleCopies: (recordId, copyIds) => withSnapshot((current) => replaceSaleCopies(current, recordId, copyIds)),
    updateCardCopy: (copyId, update: CardCopyUpdate) => withSnapshot((current) => updateCardCopy(current, copyId, update)),
    removeCardCopy: (copyId) => withSnapshot((current) => removeCardCopy(current, copyId)),
    updateRecordLine: (recordId, lineId, update) => withSnapshot((current) => updateRecordLine(current, recordId, lineId, update)),
    deleteWishlistTarget: (targetId) => withSnapshot((current) => deleteWishlistTarget(current, targetId)),
    voidRecord: (recordId) => withSnapshot((current) => changeRecordStatus(current, recordId, "void")),
    restoreRecord: (recordId) => withSnapshot((current) => changeRecordStatus(current, recordId, "active")),
    setDraft: (key, nextDraft) => {
      setDrafts((current) => JSON.stringify(current[key]) === JSON.stringify(nextDraft)
        ? current
        : { ...current, [key]: nextDraft });
    },
    clearDraft: (key) => {
      setDrafts((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    },
    resetPreview: () => {
      window.sessionStorage.removeItem(recordsPreviewStorageKey);
      setDrafts({});
      setSnapshot(createPreviewSnapshot((legacyCards.data ?? []) as LegacyCard[]));
    },
  };

  return <RecordsDataSourceContext.Provider value={value}>{children}</RecordsDataSourceContext.Provider>;
}

function RecordsLiveStateProvider({ children }: { children: ReactNode }) {
  const clientReady = useClientReady();
  const [drafts, setDrafts] = useState<RecordsDrafts>({});
  const [draftsHydrated, setDraftsHydrated] = useState(false);
  const snapshotQuery = trpc.records.snapshot.useQuery(undefined, {
    enabled: clientReady,
    staleTime: 30_000,
  });
  const utils = trpc.useUtils();
  const createPurchase = trpc.records.createPurchase.useMutation();
  const createOpening = trpc.records.createOpening.useMutation();
  const createSale = trpc.records.createSale.useMutation();
  const updateDetails = trpc.records.updateRecordDetails.useMutation();
  const resolveAttention = trpc.records.resolveCardAttention.useMutation();
  const replaceCards = trpc.records.replaceRecordCards.useMutation();
  const replaceCopies = trpc.records.replaceSaleCopies.useMutation();
  const updateCopy = trpc.records.updateCardCopy.useMutation();
  const removeCopy = trpc.records.removeCardCopy.useMutation();
  const updateLine = trpc.records.updateRecordLine.useMutation();
  const changeStatus = trpc.records.changeStatus.useMutation();
  const deleteWishlistTarget = trpc.library.delete.useMutation();

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      const stored = readJson<StoredDrafts>(recordsDraftStorageKey);
      if (stored?.version === 1) setDrafts(stored.drafts);
      setDraftsHydrated(true);
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    if (!draftsHydrated) return;
    const stored: StoredDrafts = { version: 1, drafts };
    window.sessionStorage.setItem(recordsDraftStorageKey, JSON.stringify(stored));
  }, [drafts, draftsHydrated]);

  async function finish(mutation: Promise<{ id: string }>): Promise<DataSourceResult> {
    try {
      const result = await mutation;
      await utils.records.snapshot.invalidate();
      return { ok: true, id: result.id };
    } catch (error) {
      return errorResult(error);
    }
  }

  function revisionFor(recordId: string) {
    return snapshotQuery.data?.records.find((record) => record.id === recordId)?.revision ?? null;
  }

  function withRevision(
    recordId: string,
    action: (expectedRevision: number) => Promise<{ id: string }>,
  ): Promise<DataSourceResult> {
    const expectedRevision = revisionFor(recordId);
    return expectedRevision === null
      ? Promise.resolve({ ok: false, message: "This Record is no longer in the current snapshot. Refresh and try again." })
      : finish(action(expectedRevision));
  }

  const value: RecordsDataSource = {
    mode: "live",
    status: snapshotQuery.isPending ? "loading" : snapshotQuery.error ? "error" : "ready",
    errorMessage: snapshotQuery.error?.message ?? null,
    snapshot: snapshotQuery.data ?? emptySnapshot,
    drafts,
    resolveTcgplayerProduct,
    searchLibraryCards: (query) => searchLibraryCards(snapshotQuery.data ?? emptySnapshot, query),
    createPurchase: (input) => finish(createPurchase.mutateAsync(input)),
    createOpening: (input) => finish(createOpening.mutateAsync(input)),
    createSale: (input) => finish(createSale.mutateAsync(input)),
    updateRecordDetails: (recordId, update) => withRevision(
      recordId,
      (expectedRevision) => updateDetails.mutateAsync({ recordId, expectedRevision, update }),
    ),
    resolveCardAttention: async (update) => {
      try {
        const result = await resolveAttention.mutateAsync(update);
        await utils.records.snapshot.invalidate();
        return { ok: true, id: result.id };
      } catch (error) {
        return errorResult(error);
      }
    },
    replaceRecordCards: (recordId, cards) => withRevision(
      recordId,
      (expectedRevision) => replaceCards.mutateAsync({ recordId, expectedRevision, cards }),
    ),
    replaceSaleCopies: (recordId, copyIds) => withRevision(
      recordId,
      (expectedRevision) => replaceCopies.mutateAsync({ recordId, expectedRevision, copyIds }),
    ),
    updateCardCopy: async (copyId, update) => { try { const result = await updateCopy.mutateAsync({ copyId, update }); await utils.records.snapshot.invalidate(); return { ok: true, id: result.id }; } catch (error) { return errorResult(error); } },
    removeCardCopy: async (copyId) => { try { const result = await removeCopy.mutateAsync({ copyId }); await utils.records.snapshot.invalidate(); return { ok: true, id: result.id }; } catch (error) { return errorResult(error); } },
    updateRecordLine: (recordId, lineId, update) => withRevision(
      recordId,
      (expectedRevision) => updateLine.mutateAsync({ recordId, expectedRevision, lineId, update }),
    ),
    deleteWishlistTarget: async (targetId) => {
      try {
        await deleteWishlistTarget.mutateAsync({ id: targetId });
        await utils.records.snapshot.invalidate();
        return { ok: true, id: targetId };
      } catch (error) {
        return errorResult(error);
      }
    },
    voidRecord: (recordId) => withRevision(
      recordId,
      (expectedRevision) => changeStatus.mutateAsync({ recordId, expectedRevision, status: "void" }),
    ),
    restoreRecord: (recordId) => withRevision(
      recordId,
      (expectedRevision) => changeStatus.mutateAsync({ recordId, expectedRevision, status: "active" }),
    ),
    setDraft: (key, nextDraft) => {
      setDrafts((current) => JSON.stringify(current[key]) === JSON.stringify(nextDraft)
        ? current
        : { ...current, [key]: nextDraft });
    },
    clearDraft: (key) => {
      setDrafts((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    },
  };

  return <RecordsDataSourceContext.Provider value={value}>{children}</RecordsDataSourceContext.Provider>;
}

const loadingValue: RecordsDataSource = {
  mode: "live",
  status: "loading",
  errorMessage: null,
  snapshot: emptySnapshot,
  drafts: {},
  resolveTcgplayerProduct,
  searchLibraryCards: () => [],
  createPurchase: async () => ({ ok: false, message: "Records are still loading." }),
  createOpening: async () => ({ ok: false, message: "Records are still loading." }),
  createSale: async () => ({ ok: false, message: "Records are still loading." }),
  updateRecordDetails: async () => ({ ok: false, message: "Records are still loading." }),
  resolveCardAttention: async () => ({ ok: false, message: "Records are still loading." }),
  replaceRecordCards: async () => ({ ok: false, message: "Records are still loading." }),
  replaceSaleCopies: async () => ({ ok: false, message: "Records are still loading." }),
  updateCardCopy: async () => ({ ok: false, message: "Records are still loading." }),
  removeCardCopy: async () => ({ ok: false, message: "Records are still loading." }),
  updateRecordLine: async () => ({ ok: false, message: "Records are still loading." }),
  deleteWishlistTarget: async () => ({ ok: false, message: "Records are still loading." }),
  voidRecord: async () => ({ ok: false, message: "Records are still loading." }),
  restoreRecord: async () => ({ ok: false, message: "Records are still loading." }),
  setDraft: () => undefined,
  clearDraft: () => undefined,
};

export function RecordsDataProvider({
  children,
  initiallyAuthenticated = false,
}: {
  children: ReactNode;
  initiallyAuthenticated?: boolean;
}) {
  const { data: session, isPending } = useSession();
  const previewReview = process.env.NEXT_PUBLIC_RECORDS_UI_PREVIEW === "1";
  if (previewReview) return <RecordsPreviewStateProvider>{children}</RecordsPreviewStateProvider>;
  if ((!initiallyAuthenticated && isPending) || (!initiallyAuthenticated && !session)) {
    return <RecordsDataSourceContext.Provider value={loadingValue}>{children}</RecordsDataSourceContext.Provider>;
  }
  return <RecordsLiveStateProvider>{children}</RecordsLiveStateProvider>;
}

// Kept as a compatibility export while call sites move to the source-neutral name.
export const RecordsPreviewProvider = RecordsDataProvider;

export function useRecordsDataSource() {
  const source = useContext(RecordsDataSourceContext);
  if (!source) throw new Error("useRecordsDataSource must be used inside RecordsDataProvider");
  return source;
}

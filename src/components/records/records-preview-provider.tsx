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
import { buildCopyEbayExposureStates } from "@/lib/records/copy-ebay-exposure";
import { trpc } from "@/trpc/client";
import { useClientReady } from "@/lib/use-client-ready";
import {
  collectionRefreshFailureMessage,
  useCollectionChange,
} from "@/lib/use-collection-change";
import { settleConfirmedChange } from "@/lib/collection-change";

const emptySnapshot: RecordsSnapshot = {
  version: 1,
  records: [],
  targets: [],
  printings: [],
  copies: [],
  copyEbayExposures: [],
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

function normalizePreviewSnapshot(snapshot: RecordsSnapshot): RecordsSnapshot {
  const copies = snapshot.copies.map((copy) => ({
    ...copy,
    location: copy.location ?? null,
    stickerNumber: copy.stickerNumber ?? null,
  }));
  const existingOffers = Array.isArray(snapshot.copyEbayExposures)
    ? snapshot.copyEbayExposures.flatMap((state) => Array.isArray(state.offers) ? state.offers : [])
    : [];
  return {
    ...snapshot,
    copies,
    copyEbayExposures: buildCopyEbayExposureStates(copies, snapshot.records, existingOffers),
  };
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
  const [hydrated, setHydrated] = useState(false);
  const [previewSnapshot, setSnapshot] = useState<RecordsSnapshot | null>(null);
  const [drafts, setDrafts] = useState<RecordsDrafts>({});
  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      const stored = readJson<StoredPreview>(recordsPreviewStorageKey);
      if (stored?.version === 1 && stored.snapshot?.version === 1) {
        setSnapshot(normalizePreviewSnapshot(stored.snapshot));
        setDrafts(stored.drafts);
      }
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, []);

  // Preview is intentionally self-contained: it must remain usable for UI
  // review and browser tests even when no database or authentication service is
  // available. Live Records continues to load the authenticated Library below.
  const seededSnapshot = useMemo(() => (
    hydrated ? createPreviewSnapshot([] as LegacyCard[]) : null
  ), [hydrated]);
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
    if (outcome.result.ok) setSnapshot(normalizePreviewSnapshot(outcome.next));
    return outcome.result;
  }

  const value: RecordsDataSource = {
    mode: "preview",
    status: !snapshot ? "loading" : "ready",
    errorMessage: null,
    draftOwnerScope: "preview",
    draftsHydrated: hydrated,
    draftRecoveryMessage: null,
    snapshot: snapshot ?? emptySnapshot,
    drafts,
    refresh: async () => undefined,
    resolveTcgplayerProduct,
    searchLibraryCards: (query) => searchLibraryCards(snapshot ?? emptySnapshot, query),
    createPurchase: (input) => withSnapshot((current) => applyPurchase(current, input)),
    createOpening: (input) => withSnapshot((current) => applyOpening(current, input)),
    createSale: (input) => withSnapshot((current) => applySale(current, input)),
    updateRecordDetails: (recordId, update) => withSnapshot((current) => updateRecordDetails(current, recordId, update)),
    resolveCardAttention: (update: CardAttentionUpdate) => withSnapshot((current) => resolveCardAttention(current, update)),
    resolveEbayCopyLinkAttention: async () => ({ ok: false, message: "eBay Copy-link repairs are available in your live Records." }),
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
      setSnapshot(createPreviewSnapshot([]));
    },
  };

  return <RecordsDataSourceContext.Provider value={value}>{children}</RecordsDataSourceContext.Provider>;
}

function RecordsLiveStateProvider({ children, ownerScope }: { children: ReactNode; ownerScope: string }) {
  const clientReady = useClientReady();
  const [drafts, setDrafts] = useState<RecordsDrafts>({});
  const [draftsHydrated, setDraftsHydrated] = useState(false);
  const snapshotQuery = trpc.records.snapshot.useQuery(undefined, {
    enabled: clientReady,
    staleTime: 30_000,
  });
  const collectionChanged = useCollectionChange();
  const createPurchase = trpc.records.createPurchase.useMutation();
  const createOpening = trpc.records.createOpening.useMutation();
  const createSale = trpc.records.createSale.useMutation();
  const updateDetails = trpc.records.updateRecordDetails.useMutation();
  const resolveAttention = trpc.records.resolveCardAttention.useMutation();
  const resolveEbayCopyLinkAttention = trpc.records.resolveEbayCopyLinkAttention.useMutation();
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

  async function finish(mutation: Promise<{ id: string; warning?: string }>, change: "records" | "copies" | "target" = "records"): Promise<DataSourceResult> {
    const outcome = await settleConfirmedChange(
      () => mutation,
      () => collectionChanged(change),
    );
    if (!outcome.ok) return errorResult(outcome.error);
    return {
      ok: true,
      id: outcome.value.id,
      ...(outcome.refreshError || outcome.value.warning
        ? {
            warning: [
              outcome.value.warning,
              outcome.refreshError ? collectionRefreshFailureMessage(outcome.refreshError) : null,
            ].filter(Boolean).join(" "),
          }
        : {}),
    };
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
    status: !draftsHydrated || snapshotQuery.isPending ? "loading" : snapshotQuery.error ? "error" : "ready",
    errorMessage: snapshotQuery.error?.message ?? null,
    draftOwnerScope: ownerScope,
    draftsHydrated,
    draftRecoveryMessage: null,
    snapshot: snapshotQuery.data ?? emptySnapshot,
    drafts,
    refresh: async () => { await snapshotQuery.refetch(); },
    resolveTcgplayerProduct,
    searchLibraryCards: (query) => searchLibraryCards(snapshotQuery.data ?? emptySnapshot, query),
    createPurchase: (input) => finish(createPurchase.mutateAsync(input)),
    createOpening: (input) => finish(createOpening.mutateAsync(input)),
    createSale: (input) => finish(createSale.mutateAsync(input)),
    updateRecordDetails: (recordId, update) => withRevision(
      recordId,
      (expectedRevision) => updateDetails.mutateAsync({ recordId, expectedRevision, update }),
    ),
    resolveCardAttention: (update) => finish(resolveAttention.mutateAsync(update)),
    resolveEbayCopyLinkAttention: (listingId) => finish(
      resolveEbayCopyLinkAttention.mutateAsync({ listingId }),
    ),
    replaceRecordCards: (recordId, cards) => withRevision(
      recordId,
      (expectedRevision) => replaceCards.mutateAsync({ recordId, expectedRevision, cards }),
    ),
    replaceSaleCopies: (recordId, copyIds) => withRevision(
      recordId,
      (expectedRevision) => replaceCopies.mutateAsync({ recordId, expectedRevision, copyIds }),
    ),
    updateCardCopy: (copyId, update) => finish(updateCopy.mutateAsync({ copyId, update }), "copies"),
    removeCardCopy: (copyId) => finish(removeCopy.mutateAsync({ copyId }), "copies"),
    updateRecordLine: (recordId, lineId, update) => withRevision(
      recordId,
      (expectedRevision) => updateLine.mutateAsync({ recordId, expectedRevision, lineId, update }),
    ),
    deleteWishlistTarget: (targetId) => finish(
      deleteWishlistTarget.mutateAsync({ id: targetId }).then((result) => ({
        id: targetId,
        warning: result.warning,
      })),
      "target",
    ),
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
  draftOwnerScope: "pending-session",
  draftsHydrated: false,
  draftRecoveryMessage: null,
  snapshot: emptySnapshot,
  drafts: {},
  refresh: async () => undefined,
  resolveTcgplayerProduct,
  searchLibraryCards: () => [],
  createPurchase: async () => ({ ok: false, message: "Records are still loading." }),
  createOpening: async () => ({ ok: false, message: "Records are still loading." }),
  createSale: async () => ({ ok: false, message: "Records are still loading." }),
  updateRecordDetails: async () => ({ ok: false, message: "Records are still loading." }),
  resolveCardAttention: async () => ({ ok: false, message: "Records are still loading." }),
  resolveEbayCopyLinkAttention: async () => ({ ok: false, message: "Records are still loading." }),
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

function RecordsLiveDataProvider({
  children,
}: {
  children: ReactNode;
  initiallyAuthenticated?: boolean;
}) {
  const { data: session, isPending } = useSession();
  // A server-authenticated shell may hydrate before the client session hook
  // has supplied a user. Never manufacture an owner scope or dereference that
  // absent session: wait for the authoritative client identity so drafts stay
  // account-scoped.
  if (isPending || !session) {
    return <RecordsDataSourceContext.Provider value={loadingValue}>{children}</RecordsDataSourceContext.Provider>;
  }
  return <RecordsLiveStateProvider ownerScope={session.user.id}>{children}</RecordsLiveStateProvider>;
}

export function RecordsDataProvider({
  children,
  initiallyAuthenticated = false,
}: {
  children: ReactNode;
  initiallyAuthenticated?: boolean;
}) {
  if (process.env.NEXT_PUBLIC_RECORDS_UI_PREVIEW === "1") {
    return <RecordsPreviewStateProvider>{children}</RecordsPreviewStateProvider>;
  }
  return <RecordsLiveDataProvider initiallyAuthenticated={initiallyAuthenticated}>{children}</RecordsLiveDataProvider>;
}

// Kept as a compatibility export while call sites move to the source-neutral name.
export const RecordsPreviewProvider = RecordsDataProvider;

export function useRecordsDataSource() {
  const source = useContext(RecordsDataSourceContext);
  if (!source) throw new Error("useRecordsDataSource must be used inside RecordsDataProvider");
  return source;
}

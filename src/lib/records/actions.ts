import type { RecordsSnapshot } from "./types.ts";

export const actionCatalog = {
  metadata: { category: "required", area: "inventory", severity: "warning", recovery: [] },
  unknown_cost: { category: "required", area: "records", severity: "warning", recovery: [] },
  copy_link_confirm: { category: "required", area: "listings", severity: "urgent", recovery: ["confirm_copy_link"] },
  copy_link_review: { category: "required", area: "listings", severity: "urgent", recovery: [] },
  listing_sync: { category: "required", area: "listings", severity: "urgent", recovery: ["refresh_status", "open_ebay"] },
  order_conflict: { category: "required", area: "orders", severity: "urgent", recovery: ["refresh_status", "open_ebay"] },
  proceeds_review: { category: "required", area: "sales", severity: "urgent", recovery: ["open_ebay"] },
  ebay_authorization: { category: "required", area: "ebay", severity: "urgent", recovery: ["reconnect_ebay"] },
  set_offer: { category: "suggestion", area: "listings", severity: "info", recovery: [] },
  relist: { category: "suggestion", area: "listings", severity: "info", recovery: [] },
} as const;

export type ActionKind = keyof typeof actionCatalog;
export type ActionCategory = "required" | "suggestion";
export type ActionArea = "records" | "inventory" | "listings" | "orders" | "sales" | "ebay";
export type ActionSeverity = "urgent" | "warning" | "info";
export type ActionStatus = "open" | "resolved" | "dismissed";
export type ActionRecovery = "confirm_copy_link" | "refresh_status" | "reconnect_ebay" | "open_ebay";

export type RecordsActionReferences = {
  recordId?: string;
  targetId?: string;
  printingId?: string;
  copyIds?: string[];
  listingId?: string;
  listingIds?: string[];
  orderLineIds?: string[];
  listingUrl?: string;
  familyKey?: string;
};

export type RecordsAction = {
  id: string;
  dedupeKey: string;
  kind: ActionKind;
  category: ActionCategory;
  area: ActionArea;
  severity: ActionSeverity;
  status: ActionStatus;
  title: string;
  detail: string;
  references: RecordsActionReferences;
  recovery: readonly ActionRecovery[];
  sourceFingerprint: string;
  createdAt?: Date;
  updatedAt?: Date;
  resolvedAt?: Date | null;
  dismissedAt?: Date | null;
};

export type RecordsActionFilters = {
  area: "all" | ActionArea;
  category: "all" | ActionCategory;
  search: string;
  status: "all" | ActionStatus;
};

export type ActionListingSource = {
  id: string;
  copyId: string;
  kind: "individual" | "quantity" | "bundle";
  listingUrl: string;
  status: "active" | "ended";
  listingState: "active" | "ended" | "suspended" | "unknown";
  saleState: "none" | "pending" | "paid" | "cancelled" | "needs_review";
  saleRecordId: string | null;
  lastError: string | null;
  updatedAt: Date;
};

export type ActionOrderLineSource = {
  id: string;
  listingId: string;
  paymentState: "pending" | "paid" | "cancelled" | "needs_review";
};

function fingerprint(value: unknown) {
  return JSON.stringify(value);
}

function makeAction(
  kind: ActionKind,
  dedupeKey: string,
  title: string,
  detail: string,
  references: RecordsActionReferences,
  sourceState: unknown = references,
): RecordsAction {
  const catalog = actionCatalog[kind];
  return {
    id: dedupeKey,
    dedupeKey,
    kind,
    ...catalog,
    status: "open",
    title,
    detail,
    references,
    sourceFingerprint: fingerprint({ kind, sourceState }),
  };
}

function recordIdFromAttentionId(id: string) {
  return id.startsWith("attention-cost-") ? id.slice("attention-cost-".length) : undefined;
}

function copyCanBeSuggested(snapshot: RecordsSnapshot, copyId: string) {
  const exposure = snapshot.copyEbayExposures.find((candidate) => candidate.copyId === copyId);
  return !exposure || exposure.action.disposition === "sell";
}

function suggestedCopyIds(snapshot: RecordsSnapshot, printingId: string) {
  return snapshot.copies
    .filter((copy) => (
      copy.printingId === printingId
      && copy.status === "available"
      && copyCanBeSuggested(snapshot, copy.id)
    ))
    .map((copy) => copy.id)
    .sort();
}

function exactListingCopyIds(snapshot: RecordsSnapshot, listingId: string, fallbackCopyId: string) {
  const copyIds = snapshot.copyEbayExposures
    .filter((exposure) => exposure.offers.some((offer) => offer.listingId === listingId))
    .map((exposure) => exposure.copyId)
    .sort();
  return copyIds.length ? copyIds : [fallbackCopyId];
}

function familyForListing(snapshot: RecordsSnapshot, listing: ActionListingSource) {
  const copyIds = exactListingCopyIds(snapshot, listing.id, listing.copyId);
  const printingIds = Array.from(new Set(copyIds.flatMap((copyId) => {
    const copy = snapshot.copies.find((candidate) => candidate.id === copyId);
    return copy ? [copy.printingId] : [];
  }))).sort();
  const printingId = printingIds.length === 1 ? printingIds[0] : undefined;
  return {
    copyIds,
    printingId,
    familyKey: printingId ? `printing:${printingId}` : `listing:${listing.id}`,
  };
}

function uniqueActions(actions: RecordsAction[]) {
  return [...new Map(actions.map((action) => [action.dedupeKey, action])).values()];
}

export function filterRecordsActions(actions: RecordsAction[], filters: RecordsActionFilters) {
  const search = filters.search.trim().toLocaleLowerCase("en-GB");
  return actions.filter((action) => (
    (filters.category === "all" || action.category === filters.category)
    && (filters.area === "all" || action.area === filters.area)
    && (filters.status === "all" || action.status === filters.status)
    && (!search || [
      action.title,
      action.detail,
      action.area,
      action.references.familyKey,
      ...(action.references.copyIds ?? []),
      ...(action.references.listingIds ?? []),
      ...(action.references.orderLineIds ?? []),
    ].filter(Boolean).join(" ").toLocaleLowerCase("en-GB").includes(search))
  ));
}

export function deriveSnapshotRecordsActions(snapshot: RecordsSnapshot): RecordsAction[] {
  const actions = snapshot.attention.map((item) => {
    const references: RecordsActionReferences = {
      recordId: recordIdFromAttentionId(item.id),
      targetId: item.targetId ?? undefined,
      printingId: item.printingId ?? undefined,
      copyIds: item.copyId ? [item.copyId] : undefined,
      listingId: item.listingId ?? undefined,
      listingIds: item.listingId ? [item.listingId] : undefined,
    };
    if (item.field === "cost") {
      return makeAction("unknown_cost", `required:${item.id}`, item.label, item.detail, references);
    }
    if (item.field === "ebay_copy_link") {
      const kind = item.ebayAttentionAction === "confirm_copy_link"
        ? "copy_link_confirm"
        : "copy_link_review";
      return makeAction(kind, `required:copy-link:${item.listingId ?? item.id}`, item.label, item.detail, references);
    }
    if (item.field === "ebay_status") {
      return makeAction("listing_sync", `required:listing-sync:${item.listingId ?? item.id}`, item.label, item.detail, references);
    }
    return makeAction("metadata", `required:${item.id}`, item.label, item.detail, references);
  });

  const printings = new Map(snapshot.printings.map((printing) => [printing.id, printing]));
  const targets = new Map(snapshot.targets.map((target) => [target.id, target]));
  for (const printing of snapshot.printings) {
    const exactCopyIds = suggestedCopyIds(snapshot, printing.id);
    const quantity = exactCopyIds.length >= 3 ? 3 : exactCopyIds.length >= 2 ? 2 : 0;
    if (!quantity) continue;
    const copyIds = exactCopyIds.slice(0, quantity);
    const familyKey = `printing:${printing.id}`;
    actions.push(makeAction(
      "set_offer",
      `suggestion:set-offer:${printing.id}:${quantity}`,
      `Consider a ${quantity}-card set offer`,
      `${targets.get(printings.get(printing.id)?.targetId ?? "")?.name ?? "Matching cards"} has ${quantity} suitable exact Copies available. This is an optional listing idea, not a prepared draft.`,
      { targetId: printing.targetId, printingId: printing.id, copyIds, familyKey },
      { copyIds, familyKey, quantity },
    ));
  }
  return uniqueActions(actions);
}

export function deriveEbayRecordsActions({
  authorizationProblem,
  listings,
  orderLines,
  snapshot,
}: {
  authorizationProblem: string | null;
  listings: ActionListingSource[];
  orderLines: ActionOrderLineSource[];
  snapshot: RecordsSnapshot;
}): RecordsAction[] {
  const actions: RecordsAction[] = [];
  const familyByListing = new Map(listings.map((listing) => [listing.id, familyForListing(snapshot, listing)]));
  const activeFamilies = new Set(listings
    .filter((listing) => listing.status === "active")
    .map((listing) => familyByListing.get(listing.id)?.familyKey)
    .filter((value): value is string => Boolean(value)));

  if (listings.length && authorizationProblem) {
    actions.push(makeAction(
      "ebay_authorization",
      "required:ebay-authorization",
      "Reconnect eBay",
      authorizationProblem,
      {},
      { authorizationProblem },
    ));
  }

  for (const listing of listings) {
    const family = familyByListing.get(listing.id)!;
    const references: RecordsActionReferences = {
      listingId: listing.id,
      listingIds: [listing.id],
      listingUrl: listing.listingUrl,
      copyIds: family.copyIds,
      printingId: family.printingId,
      familyKey: family.familyKey,
    };
    if (listing.lastError || listing.listingState === "unknown" || listing.listingState === "suspended") {
      actions.push(makeAction(
        "listing_sync",
        `required:listing-sync:${listing.id}`,
        "Listing status needs attention",
        listing.lastError ?? "The listing status is uncertain and should be refreshed before further selling work.",
        references,
        { lastError: listing.lastError, listingState: listing.listingState, saleState: listing.saleState },
      ));
    }
    if (listing.saleState === "paid" && !listing.saleRecordId) {
      actions.push(makeAction(
        "proceeds_review",
        `required:proceeds:${listing.id}`,
        "Review paid eBay proceeds",
        "This listing is paid but has no linked Sale record yet.",
        references,
        { saleState: listing.saleState, saleRecordId: listing.saleRecordId },
      ));
    }
  }

  for (const line of orderLines.filter((candidate) => candidate.paymentState === "needs_review")) {
    const listing = listings.find((candidate) => candidate.id === line.listingId);
    const family = listing ? familyByListing.get(listing.id) : undefined;
    actions.push(makeAction(
      "order_conflict",
      `required:order-conflict:${line.id}`,
      "Review eBay order conflict",
      "This normalized order line needs review before fulfilment can safely continue.",
      {
        listingId: listing?.id ?? line.listingId,
        listingIds: [line.listingId],
        orderLineIds: [line.id],
        listingUrl: listing?.listingUrl,
        copyIds: family?.copyIds ?? [],
        printingId: family?.printingId,
        familyKey: family?.familyKey,
      },
      { lineId: line.id, listingId: line.listingId, paymentState: line.paymentState },
    ));
  }

  const latestEndedByFamily = new Map<string, ActionListingSource>();
  for (const listing of listings) {
    if (listing.status !== "ended" || listing.kind === "bundle") continue;
    const family = familyByListing.get(listing.id)!;
    const current = latestEndedByFamily.get(family.familyKey);
    if (!current || current.updatedAt < listing.updatedAt) latestEndedByFamily.set(family.familyKey, listing);
  }
  for (const [familyKey, listing] of latestEndedByFamily) {
    const family = familyByListing.get(listing.id)!;
    if (!family.printingId || activeFamilies.has(familyKey)) continue;
    const copyIds = suggestedCopyIds(snapshot, family.printingId);
    if (!copyIds.length) continue;
    actions.push(makeAction(
      "relist",
      `suggestion:relist:${familyKey}`,
      "Consider relisting this variant",
      "New matching stock is available after this listing ended. This is an optional idea, not a prepared draft.",
      {
        listingId: listing.id,
        listingIds: [listing.id],
        listingUrl: listing.listingUrl,
        copyIds,
        printingId: family.printingId,
        familyKey,
      },
      { copyIds, familyKey, priorListingId: listing.id },
    ));
  }

  return uniqueActions(actions);
}

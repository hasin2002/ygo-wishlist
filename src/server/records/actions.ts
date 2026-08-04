import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq, notInArray } from "drizzle-orm";
import { db } from "@/db";
import {
  ebayConnections,
  ebayListings,
  ebayOrderLines,
  recordsActions,
} from "@/db/schema";
import {
  actionCatalog,
  deriveEbayRecordsActions,
  deriveSnapshotRecordsActions,
  type ActionArea,
  type ActionKind,
  type RecordsAction,
  type RecordsActionReferences,
} from "@/lib/records/actions";
import type { RecordsSnapshot } from "@/lib/records/types";
import { getEbayConnectionStatus } from "@/server/ebay-seller";

function isActionKind(value: string): value is ActionKind {
  return value in actionCatalog;
}

async function authorizationProblem(ownerId: string, trackedListingCount: number) {
  if (!trackedListingCount) return null;
  const [connection, status] = await Promise.all([
    db.select({ tradingAuthTokenStatus: ebayConnections.tradingAuthTokenStatus })
      .from(ebayConnections)
      .where(eq(ebayConnections.ownerId, ownerId))
      .limit(1),
    getEbayConnectionStatus(ownerId),
  ]);
  if (!status) {
    return "Tracked eBay work cannot be refreshed because no seller account is connected.";
  }
  if (status.health === "reconnect_required") {
    return "Tracked eBay work cannot be refreshed because the saved seller connection needs to be replaced.";
  }
  if (status.missingScopes.length) {
    return "Tracked eBay work cannot be refreshed until the seller connection is renewed with the required permissions.";
  }
  if (connection[0]?.tradingAuthTokenStatus !== "active") {
    return "Tracked eBay work cannot be refreshed until Trading authorization is renewed.";
  }
  return null;
}

async function deriveCurrentActions(ownerId: string, snapshot: RecordsSnapshot) {
  const [listings, orderLines] = await Promise.all([
    db.select().from(ebayListings).where(eq(ebayListings.ownerId, ownerId)),
    db.select().from(ebayOrderLines).where(eq(ebayOrderLines.ownerId, ownerId)),
  ]);
  const ebayActions = deriveEbayRecordsActions({
    authorizationProblem: await authorizationProblem(ownerId, listings.length),
    listings,
    orderLines,
    snapshot,
  });
  return [...new Map(
    [...deriveSnapshotRecordsActions(snapshot), ...ebayActions]
      .map((action) => [action.dedupeKey, action]),
  ).values()];
}

function rowToAction(row: typeof recordsActions.$inferSelect): RecordsAction | null {
  if (!isActionKind(row.kind)) return null;
  const catalog = actionCatalog[row.kind];
  const reason = row.reason as { title?: unknown; detail?: unknown };
  return {
    id: row.id,
    dedupeKey: row.dedupeKey,
    kind: row.kind,
    category: catalog.category,
    area: catalog.area as ActionArea,
    severity: catalog.severity,
    status: row.status,
    title: typeof reason.title === "string" ? reason.title : "Records action",
    detail: typeof reason.detail === "string" ? reason.detail : "Review the related Records item.",
    references: row.references as RecordsActionReferences,
    recovery: catalog.recovery,
    sourceFingerprint: row.sourceFingerprint,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    resolvedAt: row.resolvedAt,
    dismissedAt: row.dismissedAt,
  };
}

export async function listRecordsActions(ownerId: string, snapshot: RecordsSnapshot) {
  const derived = await deriveCurrentActions(ownerId, snapshot);
  const now = new Date();
  return db.transaction(async (tx) => {
    const existing = await tx.select().from(recordsActions)
      .where(eq(recordsActions.ownerId, ownerId));
    const existingByKey = new Map(existing.map((row) => [row.dedupeKey, row]));

    for (const action of derived) {
      const old = existingByKey.get(action.dedupeKey);
      const unchangedDismissal = action.category === "suggestion"
        && old?.status === "dismissed"
        && old.sourceFingerprint === action.sourceFingerprint;
      const values = {
        kind: action.kind,
        category: action.category,
        area: action.area,
        severity: action.severity,
        status: unchangedDismissal ? "dismissed" as const : "open" as const,
        reason: { title: action.title, detail: action.detail },
        references: action.references,
        sourceFingerprint: action.sourceFingerprint,
        updatedAt: now,
        resolvedAt: null,
        dismissedAt: unchangedDismissal ? old.dismissedAt ?? now : null,
      };
      await tx.insert(recordsActions).values({
        ...values,
        id: old?.id ?? randomUUID(),
        ownerId,
        dedupeKey: action.dedupeKey,
        createdAt: old?.createdAt ?? now,
      }).onConflictDoUpdate({
        target: [recordsActions.ownerId, recordsActions.dedupeKey],
        set: values,
      });
    }

    const currentKeys = derived.map((action) => action.dedupeKey);
    const openActions = and(
      eq(recordsActions.ownerId, ownerId),
      eq(recordsActions.status, "open"),
    );
    await tx.update(recordsActions).set({
      status: "resolved",
      resolvedAt: now,
      updatedAt: now,
    }).where(currentKeys.length
      ? and(openActions, notInArray(recordsActions.dedupeKey, currentKeys))
      : openActions);

    const rows = await tx.select().from(recordsActions)
      .where(eq(recordsActions.ownerId, ownerId));
    return rows.flatMap((row) => {
      const action = rowToAction(row);
      return action ? [action] : [];
    }).sort((left, right) => (
      Number(left.status !== "open") - Number(right.status !== "open")
      || Number(left.category !== "required") - Number(right.category !== "required")
      || (right.updatedAt?.getTime() ?? 0) - (left.updatedAt?.getTime() ?? 0)
      || left.dedupeKey.localeCompare(right.dedupeKey)
    ));
  });
}

export async function dismissRecordsSuggestion(ownerId: string, action: RecordsAction) {
  if (action.category !== "suggestion" || action.status !== "open") {
    throw new Error("Only open suggestions can be dismissed.");
  }
  const now = new Date();
  const updated = await db.update(recordsActions).set({
    status: "dismissed",
    dismissedAt: now,
    updatedAt: now,
  }).where(and(
    eq(recordsActions.ownerId, ownerId),
    eq(recordsActions.dedupeKey, action.dedupeKey),
    eq(recordsActions.category, "suggestion"),
    eq(recordsActions.status, "open"),
  )).returning({ id: recordsActions.id });
  if (!updated.length) throw new Error("That suggestion is no longer open.");
}

export async function urgentRecordsActionCount(ownerId: string, snapshot: RecordsSnapshot) {
  return (await listRecordsActions(ownerId, snapshot)).filter((action) => (
    action.status === "open" && action.category === "required"
  )).length;
}

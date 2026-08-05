import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import { recordsActions } from "../src/db/schema.ts";
import {
  actionCatalog,
  deriveEbayRecordsActions,
  deriveSnapshotRecordsActions,
  filterRecordsActions,
  type ActionListingSource,
} from "../src/lib/records/actions.ts";
import type { RecordsSnapshot } from "../src/lib/records/types.ts";

function snapshot(overrides: Partial<RecordsSnapshot> = {}): RecordsSnapshot {
  return {
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
    ...overrides,
  };
}

function copy(id: string, printingId = "printing-a") {
  return {
    id,
    printingId,
    acquiredRecordId: "record-a",
    soldRecordId: null,
    bulkLotId: null,
    allocationIndex: null,
    allocationPence: 100,
    status: "available" as const,
    condition: "Near Mint",
    location: null,
    stickerNumber: null,
    privateNote: "",
    createdAt: "2026-08-01T00:00:00.000Z",
  };
}

function exposure(copyId: string, disposition: "sell" | "review" = "sell", listingId?: string) {
  return {
    copyId,
    physical: { state: "owned" as const, code: "owned" as const, reason: "Owned" },
    offers: listingId ? [{
      copyId,
      listingId,
      memberId: `member-${copyId}`,
      fulfilmentPosition: 0,
      relationSource: "member" as const,
      kind: "quantity" as const,
      title: "Quantity listing",
      itemId: "123",
      listingUrl: "https://www.ebay.co.uk/itm/123",
      listingState: disposition === "review" ? "active" as const : "ended" as const,
      saleState: "none" as const,
      saleRecordId: null,
      quantitySold: 0,
      listingStartedAt: null,
      listingEndedAt: null,
      paymentPendingAt: null,
      paidAt: null,
      cancelledAt: null,
      lastSyncedAt: null,
      lastError: null,
      lastErrorAt: null,
      updatedAt: "2026-08-01T00:00:00.000Z",
    }] : [],
    liveOfferCount: disposition === "review" ? 1 : 0,
    endedOfferCount: disposition === "sell" && listingId ? 1 : 0,
    aggregateState: disposition === "review" ? "live" as const : "not_listed" as const,
    action: {
      disposition,
      code: disposition === "review" ? "live_offer" as const : "no_related_offers" as const,
      reason: disposition === "review" ? "Already listed" : "Available",
    },
  };
}

function cardSnapshot() {
  return snapshot({
    targets: [{ id: "target-a", name: "Dark Magician", rarity: "Ultra Rare", edition: "1st Edition", desiredQuantity: 1, imageUrl: null, tcgplayerUrl: null, marketPricePence: null }],
    printings: [{ id: "printing-a", targetId: "target-a", setName: "Legend of Blue Eyes", setCode: "LOB-005", tcgplayerUrl: null, imageUrl: null }],
    copies: [copy("copy-c"), copy("copy-a"), copy("copy-b")],
    copyEbayExposures: [exposure("copy-c"), exposure("copy-a"), exposure("copy-b")],
  });
}

test("set-offer suggestions prefer x3 and retain deterministic exact Copy and family identities", () => {
  const actions = deriveSnapshotRecordsActions(cardSnapshot());
  const suggestion = actions.find((action) => action.kind === "set_offer");
  assert.ok(suggestion);
  assert.equal(suggestion.title, "Consider a 3-card set offer");
  assert.deepEqual(suggestion.references.copyIds, ["copy-a", "copy-b", "copy-c"]);
  assert.equal(suggestion.references.familyKey, "printing:printing-a");
  assert.equal(suggestion.category, "suggestion");
  assert.deepEqual(suggestion.recovery, []);
});

test("active eBay membership is excluded and material Copy changes alter the suggestion fingerprint", () => {
  const initial = cardSnapshot();
  initial.copyEbayExposures = [exposure("copy-a", "review", "listing-live"), exposure("copy-b"), exposure("copy-c")];
  const first = deriveSnapshotRecordsActions(initial).find((action) => action.kind === "set_offer");
  assert.deepEqual(first?.references.copyIds, ["copy-b", "copy-c"]);
  assert.equal(first?.title, "Consider a 2-card set offer");

  const unchanged = deriveSnapshotRecordsActions(initial).find((action) => action.kind === "set_offer");
  assert.equal(unchanged?.sourceFingerprint, first?.sourceFingerprint);
  initial.copies.push(copy("copy-d"));
  initial.copyEbayExposures.push(exposure("copy-d"));
  const changed = deriveSnapshotRecordsActions(initial).find((action) => action.kind === "set_offer");
  assert.notEqual(changed?.sourceFingerprint, first?.sourceFingerprint);
});

test("legacy Needs attention items keep safe typed recovery and exact domain links", () => {
  const actions = deriveSnapshotRecordsActions(snapshot({ attention: [
    { id: "attention-cost-record-7", targetId: null, label: "Unknown purchase", detail: "Add its acquisition cost.", field: "cost" },
    { id: "attention-ebay-copy-link-listing-2", targetId: "target-a", copyId: "copy-a", listingId: "listing-2", label: "Dark Magician", detail: "Confirm the exact Copy.", field: "ebay_copy_link", ebayAttentionAction: "confirm_copy_link" },
  ] }));
  const cost = actions.find((action) => action.kind === "unknown_cost");
  const copyLink = actions.find((action) => action.kind === "copy_link_confirm");
  assert.equal(cost?.references.recordId, "record-7");
  assert.deepEqual(copyLink?.references.copyIds, ["copy-a"]);
  assert.equal(copyLink?.references.listingId, "listing-2");
  assert.deepEqual(copyLink?.recovery, ["confirm_copy_link"]);
});

test("eBay producers cover authorization, sync, order conflicts, proceeds, and exact grouped identities", () => {
  const source = cardSnapshot();
  source.copyEbayExposures = [
    exposure("copy-a", "review", "listing-live"),
    exposure("copy-b", "review", "listing-live"),
    exposure("copy-c"),
  ];
  const listing: ActionListingSource = {
    id: "listing-live",
    copyId: "copy-a",
    kind: "quantity",
    listingUrl: "https://www.ebay.co.uk/itm/123",
    status: "active",
    listingState: "unknown",
    saleState: "paid",
    saleRecordId: null,
    lastError: "Remote quantity could not be confirmed.",
    updatedAt: new Date("2026-08-03T00:00:00Z"),
  };
  const actions = deriveEbayRecordsActions({
    authorizationProblem: "Reconnect the seller account.",
    listings: [listing],
    orderLines: [{ id: "order-line-a", listingId: listing.id, paymentState: "needs_review" }],
    snapshot: source,
  });
  assert.deepEqual(new Set(actions.map((action) => action.kind)), new Set([
    "ebay_authorization",
    "listing_sync",
    "proceeds_review",
    "order_conflict",
  ]));
  for (const action of actions.filter((candidate) => candidate.references.listingId === listing.id)) {
    assert.deepEqual(action.references.copyIds, ["copy-a", "copy-b"]);
    assert.equal(action.references.familyKey, "printing:printing-a");
  }
  assert.equal(new Set(actions.map((action) => action.dedupeKey)).size, actions.length);
});

test("relist emits one latest-family suggestion and preserves all eligible exact Copies", () => {
  const source = cardSnapshot();
  source.copyEbayExposures = [
    exposure("copy-a", "sell", "listing-old"),
    exposure("copy-b", "sell", "listing-new"),
    exposure("copy-c"),
  ];
  const ended = (id: string, copyId: string, updatedAt: string): ActionListingSource => ({
    id,
    copyId,
    kind: "quantity",
    listingUrl: `https://www.ebay.co.uk/itm/${id}`,
    status: "ended",
    listingState: "ended",
    saleState: "cancelled",
    saleRecordId: null,
    lastError: null,
    updatedAt: new Date(updatedAt),
  });
  const actions = deriveEbayRecordsActions({
    authorizationProblem: null,
    listings: [ended("listing-old", "copy-a", "2026-08-01T00:00:00Z"), ended("listing-new", "copy-b", "2026-08-02T00:00:00Z")],
    orderLines: [],
    snapshot: source,
  });
  const relists = actions.filter((action) => action.kind === "relist");
  assert.equal(relists.length, 1);
  assert.equal(relists[0]?.references.listingId, "listing-new");
  assert.deepEqual(relists[0]?.references.copyIds, ["copy-a", "copy-b", "copy-c"]);
  assert.equal(relists[0]?.references.familyKey, "printing:printing-a");
});

test("category, area, status, and search filters compose without changing urgent totals", () => {
  const required = { ...deriveSnapshotRecordsActions(snapshot({ attention: [{ id: "attention-cost-record-1", targetId: null, label: "Unknown cost", detail: "Review purchase", field: "cost" }] }))[0]!, status: "resolved" as const };
  const suggestion = deriveSnapshotRecordsActions(cardSnapshot()).find((action) => action.kind === "set_offer")!;
  const visible = filterRecordsActions([required, suggestion], {
    area: "listings",
    category: "suggestion",
    search: "copy-a",
    status: "open",
  });
  assert.deepEqual(visible.map((action) => action.kind), ["set_offer"]);
});

test("action persistence schema and migration enforce one owner-scoped logical action", () => {
  const config = getTableConfig(recordsActions);
  const unique = config.indexes.find((index) => index.config.name === "records_actions_owner_dedupe_unique");
  assert.equal(unique?.config.unique, true);
  assert.deepEqual(unique?.config.columns.map((column) => "name" in column ? column.name : null), ["owner_id", "dedupe_key"]);
  assert.deepEqual(config.columns.map((column) => column.name).filter((name) => ["kind", "status", "resolved_at", "dismissed_at", "source_fingerprint"].includes(name)).sort(), ["dismissed_at", "kind", "resolved_at", "source_fingerprint", "status"]);
  const migration = fs.readFileSync("drizzle/0006_records_actions.sql", "utf8");
  assert.match(migration, /CREATE TABLE "records_actions"/);
  assert.match(migration, /CREATE UNIQUE INDEX "records_actions_owner_dedupe_unique"/);
});

test("durable reconciliation preserves unchanged dismissals, resolves stale rows, and reopens changed sources", () => {
  const service = fs.readFileSync("src/server/records/actions.ts", "utf8");
  assert.match(service, /old\?\.status === "dismissed"[\s\S]*old\.sourceFingerprint === action\.sourceFingerprint/);
  assert.match(service, /status: unchangedDismissal \? "dismissed" as const : "open" as const/);
  assert.match(service, /currentKeys\.length[\s\S]*notInArray\(recordsActions\.dedupeKey, currentKeys\)[\s\S]*: openActions/);
  assert.match(service, /onConflictDoUpdate/);
  assert.deepEqual(actionCatalog.order_conflict.recovery, ["refresh_status", "open_ebay"]);
});

test("Actions workspace keeps safe recovery controls and a human-facing paginated work queue", () => {
  const component = fs.readFileSync("src/components/records/records-actions-workspace.tsx", "utf8");
  const cardImageDialog = fs.readFileSync("src/components/records/card-image-preview-dialog.tsx", "utf8");
  assert.match(component, /Find an action/);
  assert.match(component, /aria-label="Filter actions by type"/);
  assert.match(component, /<option value="all">All actions \(\{actions\.length\}\)<\/option>/);
  assert.match(component, /useState<ActionView>\("all"\)/);
  assert.doesNotMatch(component, /Why this is here/);
  assert.doesNotMatch(component, /Next step/);
  assert.match(component, /aria-expanded=\{referencesOpen\}/);
  assert.match(component, /onClick=\{\(\) => setReferencesOpen/);
  assert.match(component, /sm:order-last sm:basis-full/);
  assert.match(component, /const actionsPerPage = 8/);
  assert.match(component, /aria-label="Actions pagination"/);
  assert.match(component, /Page \{currentPage\} of \{pageCount\}/);
  assert.match(component, /matchesHumanContext\(action, snapshot, search\)/);
  assert.match(component, /scrollIntoView\(\{ block: "start" \}\)/);
  assert.match(component, /refreshListingStatusById/);
  assert.match(component, /resolveEbayCopyLinkAttention/);
  assert.match(component, /Open live listing/);
  assert.match(component, /const open = action\.status === "open"/);
  assert.match(component, /cardImageUrl: target\?\.imageUrl \?\? printing\?\.imageUrl \?\? null/);
  assert.match(component, /import \{ rarityAbbreviation \} from "@\/lib\/rarity-abbreviations"/);
  assert.match(component, /rarityCode: rarityAbbreviation\(target\?\.rarity\)/);
  assert.match(component, /aria-label=\{`Rarity \$\{context\.rarity \?\? context\.rarityCode\}`\}/);
  assert.match(component, /grid-cols-1 gap-x-3 gap-y-2/);
  assert.match(component, /md:grid-cols-\[auto_minmax\(0,1fr\)\] md:items-stretch/);
  assert.match(component, /hidden aspect-\[59\/86\][\s\S]*md:row-span-2 md:block md:h-full/);
  assert.match(component, /View card image for \$\{context\.subject\}/);
  assert.match(component, /CardImagePreviewDialog/);
  assert.match(cardImageDialog, /useViewportOverlay<HTMLElement>/);
  assert.match(cardImageDialog, /createPortal\([\s\S]*document\.body/);
  assert.match(component, /grid grid-cols-1 gap-3[\s\S]*sm:grid-cols-2/);
  assert.match(component, /src=\{`\/api\/image-proxy\?url=\$\{encodeURIComponent\(context\.cardImageUrl\)\}`\}/);
  assert.match(component, /required \? "Resolve action" : "Review"/);
  assert.match(component, /dismiss\.isPending \? "Dismissing…" : "Dismiss"/);
  assert.doesNotMatch(component, /\/copies\/[^"'`]*\/sell/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("all collection loaders expose visible accessible status text", () => {
  const loaders = [
    ["src/components/assign-chase-app.tsx", /role="status"[\s\S]*Loading chase cards/],
    ["src/components/binder-v2-app.tsx", /role="status"[\s\S]*Loading Binder/],
    ["src/components/wishlist-app.tsx", /role="status"[\s\S]*Loading Library/],
    ["src/components/spend-app.tsx", /role="status"[\s\S]*Loading spending data/],
    ["src/components/wheel-app.tsx", /role="status"[\s\S]*Loading wheel cards/],
  ] as const;
  for (const [path, pattern] of loaders) assert.match(source(path), pattern, path);
});

test("Wheel, reset, and mixed-lot publish stay guarded through projection propagation", () => {
  const wheel = source("src/components/wheel-app.tsx");
  assert.match(wheel, /if \(spinActionRef\.current \|\| resetActionRef\.current \|\| busy/);
  assert.match(wheel, /spinActionRef\.current = true;[\s\S]*await collectionChanged\("wheel"\)[\s\S]*spinActionRef\.current = false/);
  assert.match(wheel, /resetActionRef\.current = true;[\s\S]*await collectionChanged\("wheel"\)[\s\S]*resetActionRef\.current = false/);
  assert.match(wheel, /await collectionChanged\("wheel"\)[\s\S]*setResetOpen\(false\)[\s\S]*setResetStatus/);
  assert.match(wheel, /setResetWarning\(collectionRefreshFailureMessage\(error\)\)/);

  const lot = source("src/components/records/ebay-lot-listing.tsx");
  assert.match(lot, /if \(!validationIsCurrent \|\| publishActionRef\.current\)/);
  assert.match(lot, /This lot changed after eBay validation[\s\S]*return/);
  assert.match(lot, /publishActionRef\.current = true;[\s\S]*await collectionChanged\("listing"\)[\s\S]*publishActionRef\.current = false/);
  assert.match(lot, /publish\.isPending \|\|[\s\S]*publishing/);
  assert.match(lot, /setPublishedUrl\(result\.listingUrl\)[\s\S]*lifecycle\.discard\(\)/);
  assert.match(lot, /The listing was published, but its local draft could not be cleared/);
});

test("Spend distinguishes pending and failed projections from empty or zero values", () => {
  const spend = source("src/components/spend-app.tsx");
  const shell = source("src/components/app-shell.tsx");
  assert.match(spend, /favourites\.isPending && !favourites\.data/);
  assert.match(spend, /favourites\.isError[\s\S]*onRetry=\{\(\) => favourites\.refetch\(\)\}/);
  assert.match(spend, /await collectionChanged\("favourite"\)/);
  assert.match(shell, /currentMonth\.isError \|\| !currentMonth\.data[\s\S]*SpendSummaryState/);
  assert.match(shell, /Spend unavailable — Retry/);
});

test("focused number fields cannot change accidentally while the page is scrolled", () => {
  const shell = source("src/components/app-shell.tsx");
  assert.match(shell, /target instanceof HTMLInputElement && target\.type === "number" && document\.activeElement === target/);
  assert.match(shell, /target\.blur\(\)/);
  assert.match(shell, /document\.addEventListener\("wheel", blurFocusedNumberInputOnWheel, \{ capture: true, passive: true \}\)/);
  assert.match(shell, /document\.removeEventListener\("wheel", blurFocusedNumberInputOnWheel, true\)/);
});

test("retry controls await caller refetch promises and reject duplicate in-flight retries", () => {
  const errorSource = source("src/components/data-load-error.tsx");
  assert.match(errorSource, /if \(retryingRef\.current\) return/);
  assert.match(errorSource, /await onRetry\(\)/);

  const callers = [
    ["src/components/assign-chase-app.tsx", /onRetry=\{\(\) => list\.refetch\(\)\}/],
    ["src/components/wishlist-app.tsx", /onRetry=\{\(\) => list\.refetch\(\)\}/],
    ["src/components/spend-app.tsx", /onRetry=\{\(\) => list\.refetch\(\)\}/],
    ["src/components/wheel-app.tsx", /onRetry=\{\(\) => wheelQuery\.refetch\(\)\}/],
    ["src/components/records/records-app.tsx", /onRetry=\{source\.refresh\}/],
  ] as const;
  for (const [path, pattern] of callers) assert.match(source(path), pattern, path);
  assert.match(
    source("src/components/binder-v2-app.tsx"),
    /onRetry=\{\(\) => Promise\.all\(\[cardsQuery\.refetch\(\), layoutQuery\.refetch\(\)\]\)\}/,
  );
});

test("Binder writes have an immediate guard and preserve exact interaction state on write failure", () => {
  const binder = source("src/components/binder-v2-app.tsx");
  assert.match(binder, /if \(binderActionRef\.current\) return false/);
  assert.match(binder, /const outcome = await settleConfirmedChange/);
  assert.match(binder, /if \(!outcome\.ok\) \{[\s\S]*exact selection is still available[\s\S]*return false/);
  assert.match(binder, /if \(confirmed\) \{[\s\S]*setSelectedCardId\(null\)[\s\S]*setDraggedCardId\(null\)/);
});

test("photo and listing mutations use their correct freshness event paths", () => {
  const photos = source("src/components/records/card-inventory-images.tsx");
  assert.match(photos, /isCollectionChangeStorageEvent\(event\.key, event\.newValue, "photos"\)\) void loadImages\(\)/);
  assert.match(photos, /await collectionChanged\("photos"\)/);
  assert.match(source("src/components/records/ebay-lot-listing.tsx"), /await collectionChanged\("listing"\)/);
  assert.match(source("src/components/records/ebay-listing-action.tsx"), /setPublishedUrl\(result\.listingUrl\)[\s\S]*await collectionChanged\("listing"\)/);
});

test("saved Records surface refresh warnings without offering a duplicate submission", () => {
  const provider = source("src/components/records/records-preview-provider.tsx");
  const entry = source("src/components/records/record-entry-app.tsx");
  assert.match(provider, /const outcome = await settleConfirmedChange/);
  assert.match(provider, /outcome\.value\.warning/);
  assert.match(provider, /outcome\.refreshError \? collectionRefreshFailureMessage\(outcome\.refreshError\) : null/);
  assert.match(entry, /The Record is saved\. Do not submit it again/);
  assert.match(entry, /role="alert">\{warning\}/);
});

test("Record edits wait for a fresh authoritative revision before restoring a draft", () => {
  const entry = source("src/components/records/record-entry-app.tsx");
  assert.match(entry, /refetchOnMount: "always"/);
  assert.match(entry, /editing && source\.mode === "live" && !editQuery\.isFetchedAfterMount/);
});

test("Purchase timeout recovery keeps one durable submission and explains ambiguous completion", () => {
  const form = source("src/components/records/purchase-opening-forms.tsx");
  const client = source("src/trpc/client.tsx");
  const router = source("src/server/routers/records.ts");
  const schema = source("src/db/schema.ts");
  const migration = source("drizzle/0009_purchase_submission_idempotency.sql");
  assert.match(form, /submissionId: formSubmissionId/);
  assert.match(form, /operationId: draft\.submissionId \?\? formSubmissionId/);
  assert.match(client, /purchaseRequestTimeoutMs = 60_000/);
  assert.match(client, /may still have been saved\. Check Records History before retrying/);
  assert.match(client, /controller\.abort\(new DOMException\(requestTimeout\.message, "TimeoutError"\)\)/);
  assert.match(router, /submissionId: operationId/);
  assert.match(router, /eq\(recordEntries\.submissionId, operationId\)/);
  assert.doesNotMatch(router, /operationId: z\.string\(\)\.uuid\(\)\.default/);
  assert.match(router, /onConflictDoNothing\(\)\.returning/);
  assert.match(router, /This Purchase was already saved\. No duplicate was created/);
  assert.match(schema, /record_entries_owner_submission_unique/);
  assert.match(migration, /UNIQUE INDEX "record_entries_owner_submission_unique"/);
});

test("the protected navigation keeps prefetching but has no global Actions badge query", () => {
  const shell = source("src/components/app-shell.tsx");
  const router = source("src/server/routers/records.ts");
  assert.match(shell, /prefetch/);
  assert.doesNotMatch(shell, /urgentActionCount|urgentCount/);
  assert.doesNotMatch(router, /urgentActionCount/);
});

test("History owns a bounded server page and workspace routes request scoped snapshots", () => {
  const app = source("src/components/records/records-app.tsx");
  const router = source("src/server/routers/records.ts");
  const provider = source("src/components/records/records-preview-provider.tsx");
  assert.match(router, /const pageSize = 15/);
  assert.match(router, /history: authenticatedProcedure\.input\(historyPageSchema\)/);
  assert.match(provider, /pathname === "\/records" \|\| pathname === "\/records\/history" \|\| pathname === "\/records\/actions"/);
  assert.match(provider, /snapshotQuery = trpc\.records\.snapshot\.useQuery\(\{ scope: snapshotScope \}/);
  assert.match(provider, /enabled: clientReady && !routeOwnsSnapshot/);
  assert.match(router, /includeRecords = scope === "full" \|\| scope === "opening-form" \|\| includeCopies/);
  assert.match(app, /saleEditorSnapshotQuery = trpc\.records\.snapshot\.useQuery\(\{ scope: "sale-form" \}/);
  assert.match(app, /\{ \.\.\.source, snapshot: editorSnapshot \}/);
});

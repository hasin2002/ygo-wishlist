import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function source(path: string) {
  return readFileSync(resolve(repositoryRoot, path), "utf8");
}

test("the retired Commerce receiver, setup client, parser, and probe are absent", () => {
  for (const path of [
    "src/app/api/ebay/notifications/route.ts",
    "src/app/api/ebay/notifications/setup/route.ts",
    "src/server/ebay-notification-api.ts",
    "src/lib/records/ebay-notification-event.ts",
    "src/lib/records/ebay-notification-status.ts",
    "scripts/check-ebay-notification-capabilities.mjs",
  ]) {
    assert.equal(existsSync(resolve(repositoryRoot, path)), false, path);
  }
});

test("OAuth, callbacks, cron, and UI expose only the Trading notification path", () => {
  const scopes = source("src/lib/records/ebay-oauth-scopes.ts");
  const callbacks = [
    source("src/app/api/ebay/callback/route.ts"),
    source("src/app/api/ebay/manual-callback/route.ts"),
  ].join("\n");
  const cron = source("src/app/api/cron/reconcile-ebay-listings/route.ts");
  const page = source("src/app/ebay/page.tsx");
  const setupCard = source("src/components/ebay-notification-setup-card.tsx");
  const seller = source("src/server/ebay-seller.ts");
  assert.doesNotMatch(scopes, /commerce\.notification\.subscription|sell\.fulfillment|sell\.listing\.read/);
  assert.doesNotMatch(callbacks, /ensureEbayNotificationSubscriptions/);
  assert.doesNotMatch(cron, /repairDueEbayNotificationSubscriptions|subscriptionRepairs/);
  assert.match(setupCard, /\/api\/ebay\/trading-notifications\/setup/);
  assert.match(setupCard, /\/api\/ebay\/trading-auth\/connect/);
  assert.doesNotMatch(setupCard, /\/api\/ebay\/notifications\/setup/);
  assert.doesNotMatch(page, /EBAY_TRADING_AUTH_TOKEN/);
  assert.match(seller, /scope: ebaySellerScopes/);
  assert.doesNotMatch(seller, /scope: connection\.scopes/);
});

test("historical inbox tables and transport-neutral retry processing remain", () => {
  const schema = source("src/db/schema.ts");
  const inbox = source("src/server/ebay-notification-service.ts");
  assert.match(schema, /ebayNotificationEvents/);
  assert.match(schema, /ebayNotificationSubscriptions/);
  assert.match(inbox, /persistEbayNotification/);
  assert.match(inbox, /processEbayNotificationEvent/);
  assert.match(inbox, /retryDueEbayNotificationEvents/);
  assert.match(inbox, /ParsedEbayTradingNotification/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { decideEbayCapability } from "../src/lib/records/ebay-capabilities.ts";
import {
  EbayImageOperationError,
  executeEbayImagePostOperation,
  parseEbayImagePostOperation,
  type EbayImageOperationServices,
} from "../src/lib/records/ebay-image-operation.ts";

const readyConnection = {
  health: "recently_verified" as const,
  missingScopes: [],
};

test("the shared capability matrix distinguishes local Copy photos from eBay mutations", () => {
  const signedOut = decideEbayCapability({ configured: true, connection: null, isSeller: false, mode: "live", signedIn: false });
  assert.equal(signedOut.canManageOwnCopyPhotos, false);
  assert.equal(signedOut.ebay.code, "signed_out");

  const owner = decideEbayCapability({ configured: true, connection: null, isSeller: false, mode: "live", signedIn: true });
  assert.equal(owner.canManageOwnCopyPhotos, true);
  assert.equal(owner.canManageListingPhotoDrafts, false);
  assert.equal(owner.ebay.code, "seller_role_required");

  const seller = decideEbayCapability({ configured: true, connection: readyConnection, isSeller: true, mode: "live", signedIn: true });
  assert.equal(seller.canManageOwnCopyPhotos, true);
  assert.equal(seller.canManageListingPhotoDrafts, true);
  assert.equal(seller.ebay.allowed, true);
});

test("preview mode is read-only even for a ready seller", () => {
  const preview = decideEbayCapability({ configured: true, connection: readyConnection, isSeller: true, mode: "preview", signedIn: true });
  assert.equal(preview.canManageOwnCopyPhotos, false);
  assert.equal(preview.canManageListingPhotoDrafts, false);
  assert.deepEqual(preview.ebay, {
    allowed: false,
    code: "preview",
    message: "eBay actions are unavailable in preview mode.",
    remedy: "Switch to live Records to work with eBay.",
  });
});

test("connection, expiry and scope failures explain the concrete recovery action", () => {
  const base = { configured: true, isSeller: true, mode: "live" as const, signedIn: true };
  assert.equal(decideEbayCapability({ ...base, connection: null }).ebay.code, "not_connected");
  assert.equal(decideEbayCapability({ ...base, connection: { health: "reconnect_required", missingScopes: [] } }).ebay.code, "reconnect_required");
  const scopes = decideEbayCapability({ ...base, connection: { health: "stored", missingScopes: ["sell.inventory"] } });
  assert.equal(scopes.ebay.code, "missing_scopes");
  assert.match(scopes.ebay.remedy, /Reconnect eBay/i);
  assert.equal(decideEbayCapability({ ...base, connection: { health: "temporarily_unavailable", missingScopes: [] } }).ebay.code, "temporarily_unavailable");
});

test("listing-photo requests reject mixed fields and invalid staging flags", () => {
  const mixed = new FormData();
  mixed.set("copyId", "copy-a");
  mixed.set("inventoryKey", "inventory-a");
  mixed.set("archiveKey", "archive-a");
  mixed.set("stageOnly", "true");
  assert.throws(() => parseEbayImagePostOperation(mixed), EbayImageOperationError);

  const invalidStage = new FormData();
  invalidStage.set("copyId", "copy-a");
  invalidStage.set("archiveKey", "archive-a");
  invalidStage.set("stageOnly", "true");
  assert.throws(() => parseEbayImagePostOperation(invalidStage), /require one saved photo/i);
});

test("a disconnected seller can stage an owned inventory photo without reaching an eBay service", async () => {
  const capability = decideEbayCapability({ configured: true, connection: null, isSeller: true, mode: "live", signedIn: true });
  assert.equal(capability.canManageListingPhotoDrafts, true);
  assert.equal(capability.ebay.allowed, false);
  const form = new FormData();
  form.set("copyId", "copy-a");
  form.set("inventoryKey", "inventory-a");
  form.set("stageOnly", "true");
  const parsed = parseEbayImagePostOperation(form);
  const calls: string[] = [];
  const unexpected = async () => { calls.push("external"); return { archiveKey: "wrong" }; };
  const services: EbayImageOperationServices<{ archiveKey: string }> = {
    importCatalogue: unexpected,
    importInventory: unexpected,
    stageInventory: async (ownerId, copyId, inventoryKey) => {
      calls.push(`stage:${ownerId}:${copyId}:${inventoryKey}`);
      return { archiveKey: "staged" };
    },
    stageListingPhoto: unexpected,
    uploadArchived: unexpected,
    uploadFile: unexpected,
  };
  assert.deepEqual(await executeEbayImagePostOperation(parsed, "owner-a", services), { archiveKey: "staged" });
  assert.deepEqual(calls, ["stage:owner-a:copy-a:inventory-a"]);
});

test("a reusable listing photo is staged locally before eBay Review", async () => {
  const form = new FormData();
  form.set("copyId", "copy-a");
  form.set("listingPhotoKey", "images/listing-photo-sets/owner-a/photo.jpg");
  form.set("stageOnly", "true");
  const parsed = parseEbayImagePostOperation(form);
  const calls: string[] = [];
  const unexpected = async () => ({ archiveKey: "wrong" });
  const services: EbayImageOperationServices<{ archiveKey: string }> = {
    importCatalogue: unexpected,
    importInventory: unexpected,
    stageInventory: unexpected,
    stageListingPhoto: async (ownerId, copyId, key) => {
      calls.push(`${ownerId}:${copyId}:${key}`);
      return { archiveKey: "staged-listing-photo" };
    },
    uploadArchived: unexpected,
    uploadFile: unexpected,
  };
  assert.deepEqual(await executeEbayImagePostOperation(parsed, "owner-a", services), { archiveKey: "staged-listing-photo" });
  assert.deepEqual(calls, ["owner-a:copy-a:images/listing-photo-sets/owner-a/photo.jpg"]);
});

test("wrong-owner inventory staging fails before the storage seam", async () => {
  const form = new FormData();
  form.set("copyId", "copy-b");
  form.set("inventoryKey", "inventory-b");
  form.set("stageOnly", "true");
  const parsed = parseEbayImagePostOperation(form);
  let storageCalls = 0;
  const unexpected = async () => ({ archiveKey: "wrong" });
  const services: EbayImageOperationServices<{ archiveKey: string }> = {
    importCatalogue: unexpected,
    importInventory: unexpected,
    stageInventory: async (ownerId, copyId) => {
      if (ownerId !== "owner-b" || copyId !== "copy-b") throw new Error("That physical Copy is not in your inventory.");
      storageCalls += 1;
      return { archiveKey: "staged" };
    },
    stageListingPhoto: unexpected,
    uploadArchived: unexpected,
    uploadFile: unexpected,
  };
  await assert.rejects(
    executeEbayImagePostOperation(parsed, "owner-a", services),
    /not in your inventory/i,
  );
  assert.equal(storageCalls, 0);
});

test("individual publishing is guarded in the browser and serialized around the remote AddItem call", () => {
  const client = readFileSync(new URL("../src/components/records/ebay-listing-action.tsx", import.meta.url), "utf8");
  const server = readFileSync(new URL("../src/server/ebay-listing.ts", import.meta.url), "utf8");
  const publishSource = server.slice(
    server.indexOf("export async function publishEbayListing"),
    server.indexOf("function assertLotCopyIds"),
  );
  assert.match(client, /const publishActionRef = useRef\(false\)/);
  assert.match(client, /if \(publishActionRef\.current\) return;[\s\S]*publishActionRef\.current = true/);
  assert.match(publishSource, /hasEbayCompositionSchema\(\)[\s\S]*getEbaySellerAccessToken[\s\S]*copyListingImageDraftsToArchive/);
  assert.match(publishSource, /getEbaySellerAccessToken[\s\S]*db\.transaction[\s\S]*for\("update"\)[\s\S]*tradingCall\(ownerId, "AddItem", itemXml, accessToken\)/);
  assert.match(publishSource, /remoteAddAttempted[\s\S]*if \(publishedItemId\)[\s\S]*may have published[\s\S]*Do not retry/);
  assert.match(publishSource, /legacySafeEbayListingSelection[\s\S]*insert into \$\{ebayListings\}[\s\S]*owner_id[\s\S]*updated_at/);
  assert.doesNotMatch(
    publishSource.match(/insert into \$\{ebayListings\} \([\s\S]*?\) values/)?.[0] ?? "",
    /\bkind\b/,
  );
});

test("tracked listing refresh follows the same eBay readiness decision as the server", () => {
  const workspace = readFileSync(new URL("../src/components/records/ebay-listings-workspace.tsx", import.meta.url), "utf8");
  assert.match(workspace, /ebayActionsAllowed = ebayStatus\.data\?\.capability\.ebay\.allowed === true/);
  assert.match(workspace, /disabled=\{!ebayActionsAllowed \|\| refresh\.isPending\}/);
  assert.match(workspace, /!ebayStatus\.data\.capability\.ebay\.allowed[\s\S]*capability\.ebay\.message[\s\S]*capability\.ebay\.remedy/);
  assert.match(workspace, /aria-describedby=\{!ebayActionsAllowed && ebayStatus\.data \? "ebay-actions-paused"/);
});

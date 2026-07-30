import assert from "node:assert/strict";
import test from "node:test";
import {
  collectionChangeStorageKey,
  collectionInvalidationMatrix,
  compareCollectionRevisions,
  collectionRevisionStorageKey,
  isCollectionChangeStorageEvent,
  nextCollectionChange,
  publishCollectionChange,
  settleConfirmedChange,
  settleCollectionPropagation,
  type CollectionStorage,
} from "../src/lib/collection-change.ts";

test("records and copy changes refresh every collection projection", () => {
  for (const change of ["records", "copies"] as const) {
    assert.deepEqual(collectionInvalidationMatrix[change], [
      "records.snapshot", "records.listEbayListings", "library.binderList", "library.chaseQueue",
      "library.list", "library.summary", "library.trackerPage", "binder.layout",
      "spend.currentMonth", "spend.monthlyFavourites", "wheel.state",
    ]);
  }
});

test("target, favourite, binder, wheel, listing, and photo changes have precise invalidations", () => {
  assert.equal(collectionInvalidationMatrix.target.includes("records.snapshot"), true);
  assert.deepEqual(collectionInvalidationMatrix.target.slice(-4), ["binder.layout", "spend.currentMonth", "spend.monthlyFavourites", "wheel.state"]);
  assert.deepEqual(collectionInvalidationMatrix.binder, ["binder.layout"]);
  assert.deepEqual(collectionInvalidationMatrix.favourite, ["spend.monthlyFavourites"]);
  assert.deepEqual(collectionInvalidationMatrix.wheel, ["wheel.state"]);
  assert.deepEqual(collectionInvalidationMatrix.listing, ["records.snapshot", "records.listEbayListings"]);
  assert.deepEqual(collectionInvalidationMatrix.photos, ["records.snapshot", "records.listEbayListings"]);
});

test("a confirmed write remains successful when projection refresh fails", async () => {
  const refreshFailure = new Error("active query failed");
  const outcome = await settleConfirmedChange(
    async () => ({ id: "saved-record" }),
    async () => { throw refreshFailure; },
  );
  assert.deepEqual(outcome, {
    ok: true,
    value: { id: "saved-record" },
    refreshError: refreshFailure,
  });
});

test("a failed write is not described as saved and does not attempt refresh", async () => {
  let refreshAttempts = 0;
  const writeFailure = new Error("server rejected write");
  const outcome = await settleConfirmedChange(
    async () => { throw writeFailure; },
    async () => { refreshAttempts += 1; },
  );
  assert.deepEqual(outcome, { ok: false, error: writeFailure });
  assert.equal(refreshAttempts, 0);
});

test("collection messages advance from storage and surface broadcast storage failures", async () => {
  const values = new Map([[collectionRevisionStorageKey, "12"]]);
  const storage: CollectionStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
  };
  const message = await nextCollectionChange("listing", storage);
  const followingMessage = await nextCollectionChange("photos", storage);
  assert.equal(compareCollectionRevisions(message.revision, "12:legacy:0") > 0, true);
  assert.equal(compareCollectionRevisions(followingMessage.revision, message.revision) > 0, true);
  // The slower earlier change can publish later without regressing the watermark.
  publishCollectionChange(message, storage);
  assert.equal(values.get(collectionRevisionStorageKey), followingMessage.revision);
  assert.equal(values.get(collectionChangeStorageKey), JSON.stringify(message));

  assert.throws(
    () => publishCollectionChange(message, {
      getItem: storage.getItem,
      setItem: () => { throw new Error("storage denied"); },
    }),
    /storage denied/,
  );
});

test("same-kind concurrent tab reservations produce ordered distinct messages", async () => {
  const values = new Map([[collectionRevisionStorageKey, "41"]]);
  const storage: CollectionStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
  };
  const [first, second] = await Promise.all([
    nextCollectionChange("copies", storage),
    nextCollectionChange("copies", storage),
  ]);

  assert.notEqual(first.revision, second.revision);
  assert.notEqual(JSON.stringify(first), JSON.stringify(second));
  assert.notEqual(compareCollectionRevisions(first.revision, second.revision), 0);
  const highest = compareCollectionRevisions(first.revision, second.revision) > 0
    ? first.revision
    : second.revision;
  assert.equal(values.get(collectionRevisionStorageKey), highest);

  const lowerMessage = first.revision === highest ? second : first;
  const higherMessage = first.revision === highest ? first : second;
  values.set(collectionRevisionStorageKey, "41");
  publishCollectionChange(higherMessage, storage);
  publishCollectionChange(lowerMessage, storage);
  assert.equal(values.get(collectionRevisionStorageKey), highest);
});

test("refresh failure still broadcasts the confirmed change and reports both outcomes", async () => {
  let broadcasts = 0;
  const refreshFailure = new Error("refetch failed");
  const broadcastFailure = new Error("storage failed");
  const outcome = await settleCollectionPropagation(
    async () => { throw refreshFailure; },
    async () => {
      broadcasts += 1;
      throw broadcastFailure;
    },
  );
  assert.equal(broadcasts, 1);
  assert.deepEqual(outcome, {
    refreshError: refreshFailure,
    broadcastError: broadcastFailure,
  });
});

test("cross-tab event matching is exact by storage key and collection change", () => {
  const photoMessage = JSON.stringify({ change: "photos", revision: 4 });
  assert.equal(isCollectionChangeStorageEvent(collectionChangeStorageKey, photoMessage, "photos"), true);
  assert.equal(isCollectionChangeStorageEvent(collectionChangeStorageKey, photoMessage, "listing"), false);
  assert.equal(isCollectionChangeStorageEvent(collectionRevisionStorageKey, photoMessage, "photos"), false);
  assert.equal(isCollectionChangeStorageEvent(collectionChangeStorageKey, "invalid", "photos"), false);
});

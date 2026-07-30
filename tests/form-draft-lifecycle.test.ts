import assert from "node:assert/strict";
import test from "node:test";
import {
  canPersistFormDraft,
  createFormDraftEnvelope,
  findLatestIdentityDraftConflict,
  formDraftIntentConflict,
  formDraftIntentMatches,
  formDraftStorageKey,
  localCalendarDate,
  parseFormDraftEnvelope,
} from "../src/lib/records/form-draft-lifecycle.ts";
import {
  isCardContentsDraft,
  isProductIdentityDraft,
} from "../src/lib/records/form-draft-validators.ts";
import { individualListingDraftResumeHref } from "../src/lib/records/individual-listing-draft.ts";

test("draft envelopes preserve workflow, owner, origin, intent, and creation time", () => {
  const original = createFormDraftEnvelope({
    data: { name: "First" },
    intent: { kind: "wishlist-target", id: "target-one", label: "Blue-Eyes" },
    now: new Date("2026-07-30T10:00:00.000Z"),
    origin: "/records/purchase?targetId=target-one",
    ownerScope: "owner-one",
    workflow: "purchase",
  });
  const updated = createFormDraftEnvelope({
    data: { name: "Updated" },
    existing: original,
    intent: original.intent,
    now: new Date("2026-07-30T11:00:00.000Z"),
    origin: "/records/purchase",
    ownerScope: "owner-one",
    workflow: "purchase",
  });

  assert.equal(updated.createdAt, "2026-07-30T10:00:00.000Z");
  assert.equal(updated.updatedAt, "2026-07-30T11:00:00.000Z");
  assert.equal(updated.origin, "/records/purchase?targetId=target-one");
  assert.equal(updated.intent.id, "target-one");
  assert.deepEqual(updated.data, { name: "Updated" });
});

test("draft parsing fails closed across accounts, workflows, old versions, and corrupt data", () => {
  const envelope = createFormDraftEnvelope({
    data: { step: 2 },
    origin: "/records/sale",
    ownerScope: "owner-one",
    workflow: "sale",
  });
  assert.deepEqual(
    parseFormDraftEnvelope(envelope, { ownerScope: "owner-one", workflow: "sale" }),
    envelope,
  );
  assert.equal(parseFormDraftEnvelope(envelope, { ownerScope: "owner-two", workflow: "sale" }), null);
  assert.equal(parseFormDraftEnvelope(envelope, { ownerScope: "owner-one", workflow: "purchase" }), null);
  assert.equal(parseFormDraftEnvelope({ ...envelope, version: 1 }, { ownerScope: "owner-one", workflow: "sale" }), null);
  assert.equal(parseFormDraftEnvelope("broken", { ownerScope: "owner-one", workflow: "sale" }), null);
});

test("explicit route intent conflicts are never treated as a matching resume", () => {
  const first = { kind: "copy" as const, id: "copy-one", label: "Copy one" };
  const same = { kind: "copy" as const, id: "copy-one", label: "Copy one again" };
  const different = { kind: "copy" as const, id: "copy-two", label: "Copy two" };
  assert.equal(formDraftIntentMatches(first, same), true);
  assert.equal(formDraftIntentConflict(first, same), false);
  assert.equal(formDraftIntentConflict(first, different), true);
  assert.equal(formDraftIntentConflict(first, { kind: "none", id: null }), false);
  assert.equal(
    formDraftIntentConflict({ kind: "none", id: null }, { kind: "wishlist-target", id: "target-two" }),
    true,
  );
});

test("session draft keys isolate workflow, owner, and exact identity", () => {
  assert.notEqual(formDraftStorageKey("sale", "owner-one"), formDraftStorageKey("sale", "owner-two"));
  assert.notEqual(
    formDraftStorageKey("ebay-listing", "owner-one", "copy-one"),
    formDraftStorageKey("ebay-listing", "owner-one", "copy-two"),
  );
  assert.notEqual(formDraftStorageKey("purchase", "owner-one"), formDraftStorageKey("pack-opening", "owner-one"));
  assert.notEqual(
    formDraftStorageKey("ebay-listing", "owner-one", "copy-one"),
    formDraftStorageKey("ebay-listing", "owner-two", "copy-one"),
  );
});

test("an owner or exact-Copy key transition cannot persist the previous scope's data", () => {
  const ownerOneCopy = formDraftStorageKey("ebay-listing", "owner-one", "copy-one");
  const ownerTwoCopy = formDraftStorageKey("ebay-listing", "owner-two", "copy-one");
  const nextCopy = formDraftStorageKey("ebay-listing", "owner-one", "copy-two");
  const previousData = { title: "Copy one listing" };
  const nextDefaults = { title: "Copy two listing" };

  assert.equal(canPersistFormDraft({
    conflict: null,
    data: previousData,
    hydratedScope: ownerOneCopy,
    initialData: nextDefaults,
    storageKey: ownerTwoCopy,
  }), false);
  assert.equal(canPersistFormDraft({
    conflict: null,
    data: previousData,
    hydratedScope: ownerOneCopy,
    initialData: nextDefaults,
    storageKey: nextCopy,
  }), false);
  assert.equal(canPersistFormDraft({
    conflict: null,
    data: previousData,
    hydratedScope: nextCopy,
    initialData: nextDefaults,
    storageKey: nextCopy,
  }), true);
});

test("an individual listing discovers another Copy draft and resumes at its original Copy route", () => {
  const copyOneKey = formDraftStorageKey("ebay-listing", "owner-one", "copy-one");
  const copyTwoKey = formDraftStorageKey("ebay-listing", "owner-one", "copy-two");
  const saved = createFormDraftEnvelope({
    data: { title: "Copy one, do not transplant" },
    intent: { kind: "copy", id: "copy-one", label: "Copy one" },
    now: new Date("2026-07-30T10:00:00.000Z"),
    origin: "/records/inventory/cards/target-one?copy=copy-one",
    ownerScope: "owner-one",
    workflow: "ebay-listing",
  });
  const values = new Map([[copyOneKey, JSON.stringify(saved)]]);
  const storage = {
    get length() { return values.size; },
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => values.delete(key),
  };
  const conflict = findLatestIdentityDraftConflict({
    incomingIntent: { kind: "copy", id: "copy-two", label: "Copy two" },
    isValidData: (value): value is { title: string } => Boolean(value && typeof value === "object" && typeof (value as { title?: unknown }).title === "string"),
    ownerScope: "owner-one",
    storage,
    storageKey: copyTwoKey,
    workflow: "ebay-listing",
  });

  assert.equal(conflict?.intent.id, "copy-one");
  assert.equal(conflict?.data.title, "Copy one, do not transplant");
  assert.equal(values.has(copyTwoKey), false);
  assert.match(individualListingDraftResumeHref({
    copies: [{ id: "copy-one", printingId: "printing-one" }, { id: "copy-two", printingId: "printing-two" }],
    listState: { card: "", copyQuantity: "all", edition: "all", kind: "cards", page: 1, rarity: [], status: "owned" },
    previousCopyId: "copy-one",
    printings: [{ id: "printing-one", targetId: "target-one" }, { id: "printing-two", targetId: "target-two" }],
    targets: [{ id: "target-one" }, { id: "target-two" }],
  }) ?? "", /\/records\/inventory\/cards\/target-one\/copies\/copy-one\/sell/);
});

test("draft payload validators reject partial nested data before a form can read it", () => {
  const identity = {
    selectedTargetId: null,
    tcgplayerUrl: "",
    name: "",
    imageUrl: null,
    edition: "",
    rarity: "",
    setName: "",
    setCode: "",
    cardType: "",
    fetchStatus: "idle",
    fetchAttempted: false,
    fetchMessage: "",
    metadataNeedsAttention: false,
    editedFields: [],
  };
  assert.equal(isProductIdentityDraft(identity), true);
  assert.equal(isProductIdentityDraft({ ...identity, fetchAttempted: "false" }), false);
  assert.equal(isProductIdentityDraft({ ...identity, editedFields: [1] }), false);
  assert.equal(isCardContentsDraft({ ...identity, id: "copy-row", quantity: 1 }), true);
  assert.equal(isCardContentsDraft({ ...identity, id: "copy-row", quantity: "1" }), false);
});

test("default form dates use the user's local calendar day in Europe/London", () => {
  const previousTimeZone = process.env.TZ;
  process.env.TZ = "Europe/London";
  try {
    assert.equal(localCalendarDate(new Date("2026-07-30T23:30:00.000Z")), "2026-07-31");
    assert.equal(localCalendarDate(new Date("2026-01-01T00:30:00.000Z")), "2026-01-01");
  } finally {
    process.env.TZ = previousTimeZone;
  }
});

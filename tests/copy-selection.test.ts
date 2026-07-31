import assert from "node:assert/strict";
import test from "node:test";
import {
  copySelectionAvailabilityReason,
  copySelectionValidationFingerprint,
  copySelectionValidationIsCurrent,
  filterCopySelectionCandidates,
  mixedLotCopyBounds,
  pageCopySelection,
  reanchorCopySelectionPhotos,
  reconcileCopySelection,
  removeDuplicateCopySelectionId,
} from "../src/lib/records/copy-selection.ts";

type Candidate = {
  copy: { condition: string; id: string };
  printing: { setCode: string; setName: string };
  target: { edition: string; name: string; rarity: string };
};

function candidate(id: string, overrides: Partial<Candidate> = {}): Candidate {
  return {
    copy: { condition: "Near Mint", id },
    printing: { setCode: "LOB", setName: "Legend of Blue Eyes" },
    target: { edition: "1st Edition", name: `Card ${id}`, rarity: "Ultra Rare" },
    ...overrides,
  };
}

test("reconciliation preserves exact requested order while making stale and duplicate IDs repairable", () => {
  const a = candidate("copy-a");
  const b = candidate("copy-b");
  const selection = reconcileCopySelection(
    ["copy-b", "copy-a", "copy-b", "deleted-copy", "blocked-copy"],
    [
      { id: a.copy.id, item: a },
      { id: b.copy.id, item: b },
      { id: "blocked-copy", item: candidate("blocked-copy"), reason: "Copy #locked is reserved by an eBay order. Remove or replace it." },
    ],
    mixedLotCopyBounds,
  );

  assert.deepEqual(selection.selectedIds, ["copy-b", "copy-a"]);
  assert.equal(selection.valid, false);
  assert.deepEqual(selection.issues.map((issue) => issue.code), ["duplicate", "missing", "blocked"]);
  assert.deepEqual(selection.requestedIds, ["copy-b", "copy-a", "copy-b", "deleted-copy", "blocked-copy"]);
});

test("mixed lots enforce 2–100 without breaking selection filtering or pagination", () => {
  const items = Array.from({ length: 101 }, (_, index) => candidate(`copy-${index}`));
  const selection = reconcileCopySelection(
    items.map((item) => item.copy.id),
    items.map((item) => ({ id: item.copy.id, item })),
    mixedLotCopyBounds,
  );
  assert.equal(selection.valid, false);
  assert.equal(selection.issues.at(-1)?.code, "too_many");

  const filtered = filterCopySelectionCandidates(items, {
    condition: "all",
    query: "Card copy-10",
    rarity: "all",
    selectedIds: selection.selectedIds,
    selectedOnly: true,
  });
  assert.deepEqual(filtered.map((item) => item.copy.id), ["copy-10", "copy-100"]);
  const page = pageCopySelection(items, 999, 20);
  assert.equal(page.currentPage, 6);
  assert.equal(page.items.length, 1);
  assert.equal(page.resultStart, 101);
});

test("mixed-lot boundaries reject 1 and 101 while accepting 2 and 100 exact Copies", () => {
  const items = Array.from({ length: 101 }, (_, index) => candidate(`copy-${index}`));
  const reconcileCount = (count: number) => reconcileCopySelection(
    items.slice(0, count).map((item) => item.copy.id),
    items.map((item) => ({ id: item.copy.id, item })),
    mixedLotCopyBounds,
  );

  assert.equal(reconcileCount(1).valid, false);
  assert.equal(reconcileCount(2).valid, true);
  assert.equal(reconcileCount(100).valid, true);
  const overLimit = reconcileCount(101);
  assert.equal(overLimit.valid, false);
  assert.equal(overLimit.issues.at(-1)?.code, "too_many");
});

test("shared filtering retains condition and eBay-status search semantics", () => {
  const nearMint = candidate("near-mint");
  const played = candidate("played", { copy: { condition: "Lightly Played", id: "played" } });
  const items = [nearMint, played];
  assert.deepEqual(filterCopySelectionCandidates(items, {
    condition: "Lightly Played",
    query: "",
    rarity: "all",
    selectedIds: [],
    selectedOnly: false,
  }).map((item) => item.copy.id), ["played"]);
  assert.deepEqual(filterCopySelectionCandidates(items, {
    condition: "all",
    query: "payment pending",
    rarity: "all",
    searchTerms: (item) => item.copy.id === "played" ? ["Payment pending"] : [],
    selectedIds: [],
    selectedOnly: false,
  }).map((item) => item.copy.id), ["played"]);
});

test("review and blocked eBay exposures are ineligible in the shared contract", () => {
  assert.equal(copySelectionAvailabilityReason({
    copyId: "copy-live",
    exposure: { action: { disposition: "review", reason: "This Copy is already in a live eBay offer." } },
    status: "available",
  }), "Copy #y-live cannot be selected: This Copy is already in a live eBay offer.");
  assert.equal(copySelectionAvailabilityReason({
    copyId: "copy-sold",
    exposure: { action: { disposition: "blocked", reason: "ignored" } },
    status: "sold",
  }), "Copy #y-sold is already sold. Remove or replace it.");
  assert.equal(copySelectionAvailabilityReason({
    copyId: "copy-clear",
    exposure: { action: { disposition: "sell", reason: "Clear" } },
    status: "available",
  }), null);
  assert.match(copySelectionAvailabilityReason({
    copyId: "copy-unknown",
    status: "available",
  }) ?? "", /eligibility could not be confirmed/i);
});

test("duplicate recovery preserves the first exact Copy selection", () => {
  assert.deepEqual(removeDuplicateCopySelectionId(["a", "b", "a"], "a"), ["a", "b"]);
});

test("photo-anchor recovery changes staged keys without corrupting exact inventory photo sources", () => {
  const photos = [{
    archiveKey: "old-a",
    previewUrl: "/old-a",
    sourceInventoryCopyId: "source-copy-a",
    sourceInventoryKey: "inventory-a",
  }, {
    archiveKey: "old-b",
    previewUrl: "/old-b",
    sourceInventoryCopyId: "source-copy-b",
    sourceInventoryKey: "inventory-b",
  }];
  const reanchored = reanchorCopySelectionPhotos(photos, [{
    archiveKey: "new-a",
    previousArchiveKey: "old-a",
    previewUrl: "/new-a",
  }, {
    archiveKey: "new-b",
    previousArchiveKey: "old-b",
    previewUrl: "/new-b",
  }]);
  assert.deepEqual(reanchored, [{
    archiveKey: "new-a",
    previewUrl: "/new-a",
    sourceInventoryCopyId: "source-copy-a",
    sourceInventoryKey: "inventory-a",
  }, {
    archiveKey: "new-b",
    previewUrl: "/new-b",
    sourceInventoryCopyId: "source-copy-b",
    sourceInventoryKey: "inventory-b",
  }]);
  assert.equal(reanchorCopySelectionPhotos(photos, [{
    archiveKey: "new-a",
    previousArchiveKey: "old-a",
    previewUrl: "/new-a",
  }]), null);
});

test("a Copy becoming stale after validation cannot authorize a reduced manifest", () => {
  const a = candidate("copy-a");
  const b = candidate("copy-b");
  const draft = {
    description: "Keep this description",
    photos: [{ archiveKey: "photo-a" }],
    price: "12.00",
    title: "Keep this title",
  };
  const ready = reconcileCopySelection(
    ["copy-a", "copy-b"],
    [
      { id: "copy-a", item: a },
      { id: "copy-b", item: b },
    ],
    mixedLotCopyBounds,
  );
  const validatedFingerprint = copySelectionValidationFingerprint(ready, {
    ...draft,
    copyIds: ready.selectedIds,
  });
  assert.equal(copySelectionValidationIsCurrent({
    currentFingerprint: validatedFingerprint,
    selection: ready,
    validatedFingerprint,
  }), true);

  const stale = reconcileCopySelection(
    ["copy-a", "copy-b"],
    [{ id: "copy-a", item: a }],
    mixedLotCopyBounds,
  );
  const reducedFingerprint = copySelectionValidationFingerprint(stale, {
    ...draft,
    copyIds: stale.selectedIds,
  });
  assert.deepEqual(stale.selectedIds, ["copy-a"]);
  assert.equal(stale.issues[0]?.copyId, "copy-b");
  assert.equal(copySelectionValidationIsCurrent({
    currentFingerprint: reducedFingerprint,
    selection: stale,
    validatedFingerprint,
  }), false);
  assert.deepEqual(draft, {
    description: "Keep this description",
    photos: [{ archiveKey: "photo-a" }],
    price: "12.00",
    title: "Keep this title",
  });
});

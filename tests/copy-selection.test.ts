import assert from "node:assert/strict";
import test from "node:test";
import {
  filterCopySelectionCandidates,
  mixedLotCopyBounds,
  pageCopySelection,
  reconcileCopySelection,
} from "../src/lib/records/copy-selection.ts";

type Candidate = {
  copy: { id: string };
  printing: { setCode: string; setName: string };
  target: { edition: string; name: string; rarity: string };
};

function candidate(id: string, overrides: Partial<Candidate> = {}): Candidate {
  return {
    copy: { id },
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

import assert from "node:assert/strict";
import test from "node:test";
import { reconcilePlan } from "../scripts/lib/card-printing-reconciliation.mjs";

const base = (id, extra = {}) => ({
  id, owner_id: "owner", target_id: "target", normalized_set_name: "lob",
  normalized_set_code: "lob-001", canonical_tcgplayer_url: "tcgplayer.com/product/1",
  updated_at: "2026-01-01T00:00:00.000Z", ...extra,
});

test("complete matching set identity is an auto-reconciliation candidate", () => {
  const plan = reconcilePlan([base("old", { canonical_tcgplayer_url: null }), base("rich")]);
  assert.deepEqual(plan, { auto: [{ survivorId: "rich", duplicateIds: ["old"] }], ambiguous: [] });
});

test("conflicting canonical product identities are held for human review", () => {
  const plan = reconcilePlan([base("one"), base("two", { canonical_tcgplayer_url: "tcgplayer.com/product/2" })]);
  assert.deepEqual(plan.auto, []);
  assert.deepEqual(plan.ambiguous, [{ leftId: "one", rightId: "two" }]);
});

test("placeholder set data never creates an automatic merge candidate", () => {
  const plan = reconcilePlan([
    base("one", { normalized_set_name: "unknown set", normalized_set_code: "unknown code", canonical_tcgplayer_url: null }),
    base("two", { normalized_set_name: "unknown set", normalized_set_code: "unknown code", canonical_tcgplayer_url: null }),
  ]);
  assert.deepEqual(plan, { auto: [], ambiguous: [] });
});

test("blank canonical URLs are treated as missing rather than a shared identity", () => {
  const plan = reconcilePlan([
    base("one", { canonical_tcgplayer_url: "", normalized_set_code: "lob-001" }),
    base("two", { canonical_tcgplayer_url: "   ", normalized_set_code: "lob-005" }),
  ]);
  assert.deepEqual(plan, { auto: [], ambiguous: [] });
});

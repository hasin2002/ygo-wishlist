const placeholders = new Set(["", "unknown", "unknown set", "unknown code"]);

export function completeSet(row) {
  return !placeholders.has(row.normalized_set_name ?? row.normalizedSetName ?? "")
    && !placeholders.has(row.normalized_set_code ?? row.normalizedSetCode ?? "");
}

function value(row, snake, camel) {
  return row[snake] ?? row[camel] ?? null;
}

function canonicalProductIdentity(row) {
  const value = row?.trim();
  return value || null;
}

export function pairDecision(left, right) {
  if (value(left, "owner_id", "ownerId") !== value(right, "owner_id", "ownerId")
    || value(left, "target_id", "targetId") !== value(right, "target_id", "targetId")) return null;
  const leftUrl = canonicalProductIdentity(value(left, "canonical_tcgplayer_url", "canonicalTcgplayerUrl"));
  const rightUrl = canonicalProductIdentity(value(right, "canonical_tcgplayer_url", "canonicalTcgplayerUrl"));
  const sameUrl = Boolean(leftUrl && rightUrl && leftUrl === rightUrl);
  const sameSet = completeSet(left) && completeSet(right)
    && value(left, "normalized_set_name", "normalizedSetName") === value(right, "normalized_set_name", "normalizedSetName")
    && value(left, "normalized_set_code", "normalizedSetCode") === value(right, "normalized_set_code", "normalizedSetCode");
  if (!sameUrl && !sameSet) return null;
  const conflictingUrl = Boolean(leftUrl && rightUrl && leftUrl !== rightUrl);
  const conflictingSet = completeSet(left) && completeSet(right) && !sameSet;
  return conflictingUrl || conflictingSet ? "ambiguous" : "auto";
}

function score(row) {
  const values = [
    value(row, "canonical_tcgplayer_url", "canonicalTcgplayerUrl"),
    value(row, "tcgplayer_url", "tcgplayerUrl"),
    value(row, "image_url", "imageUrl"),
  ];
  return values.filter(Boolean).length + (completeSet(row) ? 2 : 0);
}

export function reconcilePlan(rows) {
  const parent = new Map(rows.map((row) => [row.id, row.id]));
  const find = (id) => {
    let root = parent.get(id);
    while (root !== parent.get(root)) root = parent.get(root);
    parent.set(id, root);
    return root;
  };
  const join = (a, b) => {
    const left = find(a); const right = find(b);
    if (left !== right) parent.set(right, left);
  };
  const ambiguous = [];
  for (let index = 0; index < rows.length; index += 1) {
    for (let other = index + 1; other < rows.length; other += 1) {
      const decision = pairDecision(rows[index], rows[other]);
      if (decision === "auto") join(rows[index].id, rows[other].id);
      if (decision === "ambiguous") ambiguous.push({ leftId: rows[index].id, rightId: rows[other].id });
    }
  }
  const groups = new Map();
  for (const row of rows) groups.set(find(row.id), [...(groups.get(find(row.id)) ?? []), row]);
  const auto = [...groups.values()].filter((group) => group.length > 1).map((group) => {
    const sorted = [...group].sort((left, right) => (
      score(right) - score(left)
      || String(value(right, "updated_at", "updatedAt")).localeCompare(String(value(left, "updated_at", "updatedAt")))
      || left.id.localeCompare(right.id)
    ));
    return { survivorId: sorted[0].id, duplicateIds: sorted.slice(1).map((row) => row.id) };
  });
  return { auto, ambiguous };
}

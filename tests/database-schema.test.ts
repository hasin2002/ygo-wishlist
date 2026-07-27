import assert from "node:assert/strict";
import test from "node:test";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import {
  ebayListingMembers,
  ebayListings,
  ebayOrderLineAllocations,
  ebayOrderLines,
} from "../src/db/schema.ts";
import {
  ebayCompositionCompositeTargets,
} from "../scripts/lib/ebay-composition-schema-targets.mjs";

const ebayCompositionTables = [
  ebayListings,
  ebayListingMembers,
  ebayOrderLines,
  ebayOrderLineAllocations,
] as PgTable[];

function columnNames(columns: Array<{ name: string }>) {
  return columns.map((column) => column.name);
}

function configuredColumnNames(columns: unknown[]) {
  return columns.map((column) => {
    assert.ok(
      column
        && typeof column === "object"
        && "name" in column
        && typeof column.name === "string",
      "Composite foreign-key indexes must use named columns",
    );
    return column.name;
  });
}

test("every composite eBay foreign key has a staged unique-index target", () => {
  const compositeForeignKeys = ebayCompositionTables.flatMap((table) => (
    getTableConfig(table).foreignKeys.filter(
      (foreignKey) => foreignKey.reference().foreignColumns.length > 1,
    )
  ));

  assert.equal(compositeForeignKeys.length, 9);

  for (const foreignKey of compositeForeignKeys) {
    const reference = foreignKey.reference();
    const targetColumns = columnNames(reference.foreignColumns);
    const targetConfig = getTableConfig(reference.foreignTable);
    const repairTarget = ebayCompositionCompositeTargets.find(
      (target) => (
        target.table === targetConfig.name
        && target.columns.join("\0") === targetColumns.join("\0")
      ),
    );
    const matchingIndex = targetConfig.indexes.find(
      (index) => (
        index.config.unique === true
        && configuredColumnNames(index.config.columns).join("\0")
          === targetColumns.join("\0")
        && index.config.name === repairTarget?.name
      ),
    );

    assert.ok(
      repairTarget && matchingIndex,
      `${foreignKey.getName()} must have a staged unique index on `
        + `${targetConfig.name}(${targetColumns.join(", ")})`,
    );
  }
});

test("composite foreign-key backing indexes have safe PostgreSQL names", () => {
  assert.equal(ebayCompositionCompositeTargets.length, 6);
  assert.equal(
    new Set(
      ebayCompositionCompositeTargets.map((target) => target.backingName),
    ).size,
    ebayCompositionCompositeTargets.length,
  );

  for (const target of ebayCompositionCompositeTargets) {
    assert.match(target.backingName, /^[a-z][a-z0-9_]*$/);
    assert.ok(
      Buffer.byteLength(target.backingName, "utf8") <= 63,
      `${target.backingName} exceeds PostgreSQL's identifier limit`,
    );
  }
});

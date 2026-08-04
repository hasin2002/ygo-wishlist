import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import {
  cardPrintings,
  cardListingPhotoImages,
  ebayConnections,
  ebayListingFamilies,
  ebayListingFamilyOffers,
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
  ebayListingFamilies,
  ebayListingFamilyOffers,
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

  assert.equal(compositeForeignKeys.length, 10);

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
  assert.equal(ebayCompositionCompositeTargets.length, 7);
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

test("exact Printing identities are database-enforced while placeholders remain reviewable", () => {
  const indexes = getTableConfig(cardPrintings).indexes;
  const names = indexes.filter((index) => index.config.unique).map((index) => index.config.name);
  assert.ok(names.includes("card_printings_owner_target_set_identity_unique"));
  assert.ok(names.includes("card_printings_owner_target_tcgplayer_identity_unique"));
  assert.match(
    fs.readFileSync("drizzle/0001_enforce_card_printing_identity.sql", "utf8"),
    /nullif\(btrim\("card_printings"\."canonical_tcgplayer_url"\), ''\) is not null/,
  );
});

test("one eBay seller and complete encrypted Trading credentials are database-enforced", () => {
  const config = getTableConfig(ebayConnections);
  const index = config.indexes.find(
    (candidate) => candidate.config.name === "ebay_connections_single_deployment_unique",
  );
  assert.equal(index?.config.unique, true);
  assert.deepEqual(configuredColumnNames(index?.config.columns ?? []), ["deployment_slot"]);
  const checks = config.checks.map((candidate) => candidate.name);
  assert.ok(checks.includes("ebay_connections_deployment_slot_one"));
  assert.ok(checks.includes("ebay_connections_trading_token_complete"));
});

test("reusable listing photos are separated by exact variant and offer type", () => {
  const config = getTableConfig(cardListingPhotoImages);
  const index = config.indexes.find(
    (candidate) => candidate.config.name === "card_listing_photo_images_variant_position_unique",
  );
  assert.equal(index?.config.unique, true);
  assert.deepEqual(configuredColumnNames(index?.config.columns ?? []), [
    "owner_id",
    "printing_id",
    "edition",
    "condition",
    "kind",
    "position",
  ]);
  assert.ok(config.checks.some((candidate) => candidate.name === "card_listing_photo_images_position_nonnegative"));
});

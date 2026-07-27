import pg from "pg";
import {
  ebayCompositionCompositeTargets,
} from "./lib/ebay-composition-schema-targets.mjs";

const apply = process.argv.slice(2).includes("--apply");
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is required. It is never included in repair output.",
  );
}

function quoteIdentifier(value) {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) {
    throw new Error(`Unsafe PostgreSQL identifier: ${value}`);
  }
  return `"${value}"`;
}

function sameColumns(actual, expected) {
  return actual.length === expected.length
    && actual.every((column, index) => column === expected[index]);
}

async function relationExists(client, table) {
  const result = await client.query(
    "select to_regclass($1) is not null as present",
    [`public.${table}`],
  );
  return result.rows[0]?.present === true;
}

async function constraintMetadata(client, target) {
  const result = await client.query(
    `select constraint_row.contype,
      array(
        select attribute.attname
        from unnest(constraint_row.conkey) with ordinality
          as key_column(attnum, position)
        join pg_attribute attribute
          on attribute.attrelid = constraint_row.conrelid
          and attribute.attnum = key_column.attnum
        order by key_column.position
      )::text[] as columns
      from pg_constraint constraint_row
      where constraint_row.conrelid = $1::regclass
        and constraint_row.conname = $2`,
    [`public.${target.table}`, target.name],
  );
  return result.rows[0] ?? null;
}

async function indexMetadata(client, target, indexName) {
  const result = await client.query(
    `select index_row.indisunique, index_row.indisvalid,
      index_row.indpred is null as unqualified,
      array_agg(attribute.attname order by key_column.position)::text[] as columns,
      coalesce(
        (
          select array_agg(dependency.conname order by dependency.conname)::text[]
          from pg_constraint dependency
          where dependency.contype = 'f'
            and dependency.conindid = index_row.indexrelid
        ),
        array[]::text[]
      ) as foreign_keys
      from pg_index index_row
      join pg_class index_relation
        on index_relation.oid = index_row.indexrelid
      join lateral unnest(index_row.indkey) with ordinality
        as key_column(attnum, position) on true
      join pg_attribute attribute
        on attribute.attrelid = index_row.indrelid
        and attribute.attnum = key_column.attnum
      where index_row.indrelid = $1::regclass
        and index_relation.relname = $2
      group by index_row.indisunique, index_row.indisvalid,
        index_row.indpred, index_row.indexrelid`,
    [`public.${target.table}`, indexName],
  );
  return result.rows[0] ?? null;
}

function assertIndexMatches(target, metadata) {
  if (
    metadata.indisunique !== true
    || metadata.indisvalid !== true
    || metadata.unqualified !== true
    || !sameColumns(metadata.columns, target.columns)
  ) {
    throw new Error(
      `Existing index ${target.name} cannot back the required constraint. `
        + "No writes were made.",
    );
  }
}

async function planTarget(client, target) {
  if (!await relationExists(client, target.table)) {
    return { ...target, action: "skip_missing_table" };
  }

  const constraint = await constraintMetadata(client, target);
  if (constraint) {
    throw new Error(
      `Unexpected constraint ${target.name} exists on ${target.table}. `
        + "The repair expects the standalone unique index represented by "
        + "the Drizzle schema. No writes were made.",
    );
  }

  const visibleIndex = await indexMetadata(client, target, target.name);
  const backingIndex = await indexMetadata(
    client,
    target,
    target.backingName,
  );
  if (visibleIndex) {
    assertIndexMatches(target, visibleIndex);
  }
  if (backingIndex) {
    assertIndexMatches(target, backingIndex);
  }

  if (!backingIndex && visibleIndex) {
    return {
      ...target,
      action: "promote_visible_to_backing",
      foreignKeys: visibleIndex.foreign_keys,
    };
  }
  if (!backingIndex && !visibleIndex) {
    return { ...target, action: "add_backing_and_visible" };
  }
  if (backingIndex && !visibleIndex) {
    return {
      ...target,
      action: "add_visible",
      foreignKeys: backingIndex.foreign_keys,
    };
  }
  if (visibleIndex.foreign_keys.length) {
    throw new Error(
      `Both ${target.name} and ${target.backingName} exist, but `
        + `${target.name} still backs foreign keys. No writes were made.`,
    );
  }

  return {
    ...target,
    action: "already_ready",
    foreignKeys: backingIndex.foreign_keys,
  };
}

async function applyTarget(client, target) {
  const table = quoteIdentifier(target.table);
  const name = quoteIdentifier(target.name);
  const backingName = quoteIdentifier(target.backingName);
  const columns = target.columns.map(quoteIdentifier).join(", ");
  if (target.action === "promote_visible_to_backing") {
    await client.query(
      `alter index ${name} rename to ${backingName}`,
    );
    await client.query(
      `create unique index ${name} on ${table} (${columns})`,
    );
  } else if (target.action === "add_backing_and_visible") {
    await client.query(
      `create unique index ${backingName} on ${table} (${columns})`,
    );
    await client.query(
      `create unique index ${name} on ${table} (${columns})`,
    );
  } else if (target.action === "add_visible") {
    await client.query(
      `create unique index ${name} on ${table} (${columns})`,
    );
  }
}

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

try {
  await client.query("begin");
  const plan = [];
  for (const target of ebayCompositionCompositeTargets) {
    plan.push(await planTarget(client, target));
  }

  if (apply) {
    for (const target of plan) {
      await applyTarget(client, target);
    }
    await client.query("commit");
  } else {
    await client.query("rollback");
  }

  console.log(JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    targets: plan.map(({
      table,
      name,
      backingName,
      columns,
      action,
      foreignKeys = [],
    }) => ({
      table,
      name,
      backingName,
      columns,
      action,
      foreignKeys,
    })),
  }, null, 2));
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}

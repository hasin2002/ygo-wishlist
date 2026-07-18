import fs from "node:fs";
import pg from "pg";

function envValue(name) {
  if (process.env[name]) return process.env[name];
  if (!fs.existsSync(".env.local")) return undefined;
  const line = fs.readFileSync(".env.local", "utf8").split(/\r?\n/)
    .find((entry) => entry.startsWith(`${name}=`));
  if (!line) return undefined;
  const value = line.slice(name.length + 1).trim();
  return ((value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'")))
    ? value.slice(1, -1)
    : value;
}

function slugify(value) {
  return String(value ?? "")
    .toLocaleLowerCase("en-GB")
    .replace(/&/g, " and ")
    .replace(/@/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function articlelessSlug(value) {
  return slugify(value).split("-").filter((part) => !["a", "an", "the"].includes(part)).join("-");
}

function typeForName(index, name) {
  const exact = index.exact.get(slugify(name));
  if (exact) return exact;
  const articleless = index.articleless.get(articlelessSlug(name));
  if (articleless) return articleless;
  const nameSlug = slugify(name);
  return index.searchable.find((card) => (
    card.nameSlug.startsWith(nameSlug) || nameSlug.includes(card.nameSlug)
  ))?.type ?? null;
}

const databaseUrl = envValue("DATABASE_URL");
if (!databaseUrl) throw new Error("DATABASE_URL is required.");

const response = await fetch("https://db.ygoprodeck.com/api/v7/cardinfo.php", {
  headers: {
    accept: "application/json",
    "user-agent": "Yu-Gi-Oh Collection Hub type backfill",
  },
});
if (!response.ok) throw new Error(`Could not fetch the YGOPRODeck catalogue (${response.status}).`);
const payload = await response.json();
const cards = (payload.data ?? []).filter((card) => card.name && card.type);
const index = {
  exact: new Map(cards.map((card) => [slugify(card.name), card.type])),
  articleless: new Map(cards.map((card) => [articlelessSlug(card.name), card.type])),
  searchable: cards.map((card) => ({ nameSlug: slugify(card.name), type: card.type })).sort((a, b) => b.nameSlug.length - a.nameSlug.length),
};

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  const ownerId = process.env.OWNER_ID
    || (await client.query("select id from users order by created_at asc limit 1")).rows[0]?.id;
  if (!ownerId) throw new Error("No user exists to receive the card-type backfill.");
  const targets = (await client.query(
    "select id, name, card_type from card_targets where owner_id = $1 order by name",
    [ownerId],
  )).rows;
  let updated = 0;
  let alreadySet = 0;
  const unmatched = [];
  await client.query("begin");
  try {
    for (const target of targets) {
      if (target.card_type) {
        alreadySet += 1;
        continue;
      }
      const cardType = typeForName(index, target.name);
      if (!cardType) {
        unmatched.push(target.name);
        continue;
      }
      await client.query(
        "update card_targets set card_type = $1, updated_at = $2 where id = $3 and owner_id = $4",
        [cardType, new Date(), target.id, ownerId],
      );
      updated += 1;
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
  console.log(JSON.stringify({ ownerId, total: targets.length, updated, alreadySet, unmatched: unmatched.length, unmatchedNames: unmatched }, null, 2));
} finally {
  await client.end();
}

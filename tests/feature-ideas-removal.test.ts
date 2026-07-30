import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const projectRoot = process.cwd();

function readProjectFile(relativePath: string) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

test("Feature Ideas has no route, navigation item, or tRPC router", () => {
  assert.equal(fs.existsSync(path.join(projectRoot, "src/app/feature-ideas/page.tsx")), false);
  assert.equal(fs.existsSync(path.join(projectRoot, "src/app/feature-ideas/layout.tsx")), false);
  assert.equal(fs.existsSync(path.join(projectRoot, "src/components/feature-ideas-app.tsx")), false);
  assert.equal(fs.existsSync(path.join(projectRoot, "src/server/routers/feature-ideas.ts")), false);
  assert.doesNotMatch(readProjectFile("src/components/app-shell.tsx"), /feature-ideas|Feature ideas/);
  assert.doesNotMatch(readProjectFile("src/server/root.ts"), /featureIdeas|feature-ideas/);
  assert.doesNotMatch(readProjectFile("src/app/globals.css"), /\.idea-/);
});

test("Feature Ideas exists only in historical migration input and is dropped by 0002", () => {
  assert.match(
    readProjectFile("drizzle/0000_baseline_existing_schema.sql"),
    /CREATE TABLE "feature_idea_pages"/,
  );
  assert.match(
    readProjectFile("drizzle/0002_remove_feature_idea_pages.sql"),
    /^DROP TABLE "feature_idea_pages";\s*$/,
  );

  const journal = JSON.parse(readProjectFile("drizzle/meta/_journal.json"));
  assert.deepEqual(
    journal.entries.slice(0, 3).map((entry: { tag: string }) => entry.tag),
    [
      "0000_baseline_existing_schema",
      "0001_enforce_card_printing_identity",
      "0002_remove_feature_idea_pages",
    ],
  );

  const latestMigration = journal.entries.at(-1) as { idx: number };
  const currentSnapshot = JSON.parse(
    readProjectFile(`drizzle/meta/${String(latestMigration.idx).padStart(4, "0")}_snapshot.json`),
  );
  assert.equal(currentSnapshot.tables["public.feature_idea_pages"], undefined);
});

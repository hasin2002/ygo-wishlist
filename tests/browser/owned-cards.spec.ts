import { expect, test } from "@playwright/test";

const products = [
  { marketPricesUsdCents: { "1st Edition": 56 }, productId: 12345, name: "Blue-Eyes White Dragon", setCode: "LOB-001", setName: "Legend of Blue Eyes White Dragon", rarity: "Ultra Rare", imageUrl: null, tcgplayerUrl: "https://www.tcgplayer.com/product/12345" },
  { productId: 12346, name: "Blue-Eyes White Dragon", setCode: "RA02-EN001", setName: "Rarity Collection II", rarity: "Secret Rare", imageUrl: null, tcgplayerUrl: "https://www.tcgplayer.com/product/12346" },
];

test.beforeEach(async ({ page }) => {
  await page.route("**/api/trpc/cardCatalogue.search**", async (route) => {
    const url = new URL(route.request().url());
    const batch = route.request().postDataJSON() ?? JSON.parse(url.searchParams.get("input") || "{}");
    const input = (batch["0"]?.json ?? batch.json) as { query: string; rarity?: string };
    const detectedRarity = input.query.toLowerCase().includes("ultra rare") ? "Ultra Rare" : null;
    const searchText = input.query.toLowerCase().replace("ultra rare", "").trim();
    const parsed = { detectedRarity, searchText, tokens: searchText.split(/\s+/).filter(Boolean) };
    const rarity = input.rarity === undefined ? parsed.detectedRarity : input.rarity;
    const filtered = products.filter((product) => (!rarity || product.rarity === rarity) && parsed.tokens.every((token) => `${product.name} ${product.setCode}`.toLowerCase().includes(token)));
    await route.fulfill({ contentType: "application/json", body: JSON.stringify([{ result: { data: { json: { products: filtered, total: filtered.length, page: 1, pageCount: 1, detectedRarity: parsed.detectedRarity, searchText: parsed.searchText, rarities: ["Ultra Rare", "Secret Rare"], status: { ready: true, stale: false, syncing: false, productCount: 2, updatedAt: null } } } } }]) });
  });
});

for (const width of [1280, 843, 390]) {
  test(`search, select, collapse, recover and save owned cards at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/records/new/owned");
    await page.getByLabel("Card name or set code").fill("Blue-Eyes ultra rare");
    await expect(page.getByText("TCGplayer · US$0.56", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Remove detected rarity filter" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Choose Blue-Eyes White Dragon, LOB-001, Ultra Rare" })).toBeVisible();
    await page.getByRole("button", { name: "Choose Blue-Eyes White Dragon, LOB-001, Ultra Rare" }).click();
    const selection = page.getByRole("dialog", { name: "Selected printing" });
    await expect(selection.getByRole("combobox", { name: "Edition", exact: true })).toHaveValue("1st Edition");
    await page.screenshot({ path: `/tmp/owned-printing-dialog-${width}.png` });
    await selection.getByRole("button", { name: "Increase quantity", exact: true }).click();
    await selection.getByRole("button", { name: "Add to list" }).click();
    await page.getByRole("button", { name: "Choose Blue-Eyes White Dragon, LOB-001, Ultra Rare" }).click();
    await selection.getByRole("button", { name: "Increase quantity", exact: true }).click();
    await selection.getByRole("button", { name: "Add to list" }).click();
    const list = page.getByRole("region", { name: "Cards to add" });
    await expect(list.getByRole("button", { name: /Edit .*3 to add/ })).toBeVisible();
    await page.reload();
    await expect(list.getByRole("button", { name: /Edit .*3 to add/ })).toBeVisible();
    await page.getByLabel("Card name or set code").fill("Blue-Eyes");
    await page.getByRole("button", { name: "Choose Blue-Eyes White Dragon, RA02-EN001, Secret Rare" }).click();
    await selection.getByRole("combobox", { name: "Edition", exact: true }).click();
    await selection.getByRole("option", { name: "Unlimited Edition", exact: true }).click();
    await selection.getByRole("combobox", { name: "Condition", exact: true }).click();
    await selection.getByRole("option", { name: "Lightly Played", exact: true }).click();
    await selection.getByRole("button", { name: "Add to list" }).click();
    await expect(list.getByRole("button", { name: /^Edit / })).toHaveCount(2);
    if (width === 843) {
      const searchBox = await page.getByRole("region", { name: "Find cards" }).boundingBox();
      const listBox = await list.boundingBox();
      expect(listBox!.x).toBeGreaterThan(searchBox!.x + searchBox!.width - 2);
      expect(listBox!.height).toBeLessThan(650);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `/tmp/owned-cards-${width}.png`, fullPage: true });
    await page.getByRole("button", { name: "Add 4 cards to collection" }).click();
    await expect(page.getByRole("heading", { name: "4 cards added" })).toBeVisible();
    await page.getByRole("link", { name: "View inventory", exact: true }).click();
    await expect(page.getByText("Blue-Eyes White Dragon", { exact: true }).first()).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test("removing an inferred rarity expands results and empty searches can recover", async ({ page }) => {
  await page.goto("/records/new/owned");
  await page.getByLabel("Card name or set code").fill("Blue-Eyes ultra rare");
  await expect(page.getByRole("button", { name: "Choose Blue-Eyes White Dragon, LOB-001, Ultra Rare" })).toBeVisible();
  await page.getByRole("button", { name: "Remove detected rarity filter" }).click();
  await expect(page.getByRole("button", { name: /Choose Blue-Eyes White Dragon/ })).toHaveCount(2);
  await page.getByLabel("Card name or set code").fill("not a real printing");
  await expect(page.getByText(/0 matching printings/)).toBeVisible();
  await page.getByLabel("Card name or set code").fill("LOB-001");
  await expect(page.getByRole("button", { name: "Choose Blue-Eyes White Dragon, LOB-001, Ultra Rare" })).toBeVisible();
});


test("queue pagination, search, rarity modal and confirmed clear", async ({ page }) => {
  await page.setViewportSize({ width: 843, height: 837 });
  await page.goto("/records/new/owned");
  await page.getByLabel("Card name or set code").fill("Blue-Eyes");
  const choose = page.getByRole("button", { name: "Choose Blue-Eyes White Dragon, LOB-001, Ultra Rare" });
  const dialog = page.getByRole("dialog", { name: "Selected printing" });
  for (const condition of ["Near Mint", "Lightly Played", "Moderately Played", "Heavily Played", "Damaged"]) {
    await choose.click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("combobox", { name: "Condition", exact: true }).click();
    await dialog.getByRole("option", { name: condition, exact: true }).click();
    await dialog.getByRole("button", { name: "Add to list" }).click();
  }
  const queue = page.getByRole("region", { name: "Cards to add" });
  await expect(queue.getByRole("button", { name: /^Edit / })).toHaveCount(5);
  await expect(queue.getByRole("navigation", { name: "Your cards pages" })).toHaveCount(0);
  await page.evaluate(() => {
    const key = Object.keys(sessionStorage).find((key) => key.startsWith("ygo:owned-cards:v1:"))!;
    const draft = JSON.parse(sessionStorage.getItem(key)!);
    draft.cards = Array.from({ length: 21 }, (_, index) => ({
      ...draft.cards[0], productId: 10000 + index, name: `Queue card ${index}`,
      condition: index === 0 ? "Near Mint" : "Lightly Played", quantity: 1,
    }));
    sessionStorage.setItem(key, JSON.stringify(draft));
  });
  await page.reload();
  await expect(queue.getByRole("button", { name: /^Edit / })).toHaveCount(20);
  await queue.getByRole("button", { name: "Next cards" }).click();
  await expect(queue.getByRole("button", { name: /^Edit / })).toHaveCount(1);
  await queue.getByLabel("Search your cards").fill("Near Mint");
  await expect(queue.getByRole("button", { name: /^Edit / })).toHaveCount(1);
  await queue.getByRole("button", { name: "Clear all", exact: true }).click();
  await page.getByRole("button", { name: "Keep cards", exact: true }).click();
  await expect(queue.getByText("21 copies", { exact: true })).toBeVisible();
  await queue.getByRole("button", { name: "Clear all", exact: true }).click();
  await page.getByRole("button", { name: "Clear list", exact: true }).click();
  await expect(queue.getByText("0 copies", { exact: true })).toBeVisible();
  await page.getByLabel("Card name or set code").fill("Blue-Eyes");
  await page.getByRole("button", { name: "Filter rarity", exact: true }).click();
  await page.getByRole("dialog", { name: "Filter rarity" }).getByRole("button", { name: "Secret Rare", exact: true }).click();
  await expect(page.getByRole("button", { name: /Choose Blue-Eyes/ })).toHaveCount(1);
  await page.getByRole("button", { name: /Choose Blue-Eyes/ }).click();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("button", { name: /Choose Blue-Eyes/ })).toBeFocused();
});

test("existing owned quantity starts at current total and saves only the increase", async ({ page }) => {
  await page.goto("/records/new/owned");
  await page.getByLabel("Card name or set code").fill("LOB-001");
  const choose = page.getByRole("button", { name: "Choose Blue-Eyes White Dragon, LOB-001, Ultra Rare" });
  const dialog = page.getByRole("dialog", { name: "Selected printing" });
  await choose.click();
  await dialog.getByRole("button", { name: "Increase quantity", exact: true }).click();
  await dialog.getByRole("button", { name: "Add to list", exact: true }).click();
  await page.getByRole("button", { name: "Add 2 cards to collection", exact: true }).click();
  await page.getByRole("button", { name: "Add more cards", exact: true }).click();
  await choose.click();
  await expect(dialog.getByText("Already owned: 2", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("spinbutton", { name: "Quantity", exact: true })).toHaveValue("2");
  await dialog.getByRole("button", { name: "Increase quantity", exact: true }).click();
  await expect(dialog.getByText("Set the total you want to own. 1 new copy will be added.")).toBeVisible();
  await dialog.getByRole("button", { name: "Add to list", exact: true }).click();
  await expect(page.getByRole("button", { name: "Add 1 card to collection", exact: true })).toBeVisible();
});

test("compact queue tiles reopen the quantity editor without duplicating variants", async ({ page }) => {
  await page.setViewportSize({ width: 1117, height: 837 });
  await page.goto("/records/new/owned");
  await page.getByLabel("Card name or set code").fill("LOB-001");
  await page.getByRole("button", { name: "Choose Blue-Eyes White Dragon, LOB-001, Ultra Rare" }).click();
  const dialog = page.getByRole("dialog", { name: "Selected printing" });
  await dialog.getByRole("button", { name: "Add to list", exact: true }).click();
  const queue = page.getByRole("region", { name: "Cards to add" });
  const tile = queue.getByRole("button", { name: /^Edit / });
  await expect(tile).toHaveCount(1);
  await expect(tile.getByText("UR", { exact: true })).toBeVisible();
  await expect(tile.getByText("LOB-001", { exact: true })).toBeVisible();
  const box = await tile.boundingBox();
  expect(box!.height).toBeLessThan(160);
  await tile.click();
  await expect(dialog.getByRole("spinbutton", { name: "Quantity", exact: true })).toHaveValue("1");
  await dialog.getByRole("button", { name: "Increase quantity", exact: true }).click();
  await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(tile).toHaveCount(1);
  await expect(tile).toHaveAccessibleName(/2 to add/);
  await tile.click();
  await dialog.getByRole("button", { name: "Increase quantity", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(tile).toHaveAccessibleName(/2 to add/);
  await page.screenshot({ path: "/tmp/owned-card-grid.png", fullPage: true });
  await tile.click();
  await dialog.getByRole("button", { name: "Remove from list", exact: true }).click();
  await expect(tile).toHaveCount(0);
});

import { expect, test, type Page } from "@playwright/test";

const metadata = {
  metadata: {
    cardType: "Dark Spellcaster",
    edition: "1st Edition",
    imageUrl: null,
    rarity: "Ultra Rare",
    resolution: "page",
    setCode: "LOB-005",
    setName: "Legend of Blue Eyes White Dragon",
    title: "Dark Magician",
  },
};

async function mockMetadata(page: Page) {
  await page.route("**/api/records/metadata", async (route) => {
    await route.fulfill({ contentType: "application/json", json: metadata });
  });
}

async function chooseCardPurchase(page: Page) {
  const choice = page.getByRole("button", { name: /^Single card/ });
  await choice.getByText("Single card", { exact: true }).click();
  await expect(choice).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Purchase details" })).toBeVisible();
}

async function createCardPurchase(page: Page) {
  await mockMetadata(page);
  await page.goto("/records/new/purchase");
  await expect(page.getByRole("heading", { name: "Record purchase" })).toBeVisible();
  await chooseCardPurchase(page);
  await page.getByLabel(/Record name/).fill("Browser purchase");
  await page.getByLabel(/All-in amount paid/).fill("1.01");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel(/TCGplayer product link/).fill("https://www.tcgplayer.com/product/12345/dark-magician");
  await page.getByRole("button", { name: "Fetch details" }).click();
  await expect(page.getByRole("combobox", { name: /Card name/ })).toHaveValue("Dark Magician");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Review purchase" })).toBeVisible();
  await page.getByRole("button", { name: "Confirm preview purchase" }).click();
  await expect(page.getByRole("heading", { name: "purchase saved" })).toBeVisible();
}

test("Purchase saves and refreshes Inventory", async ({ page }) => {
  await page.goto("/records/new/purchase");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "What did you buy?" })).toBeVisible();
  await createCardPurchase(page);
  await page.getByRole("link", { name: "View inventory" }).click();
  await expect(page).toHaveURL(/\/records\/inventory/);
  await expect(page.getByText("Dark Magician", { exact: true }).first()).toBeVisible();
});

test("Purchase draft survives a reload and remains discoverable by its labelled form field", async ({ page }) => {
  await page.goto("/records/new/purchase");
  await chooseCardPurchase(page);
  await page.getByLabel(/Record name/).fill("Recover this draft");
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("ygo-library:records-preview:v1"))).toContain("Recover this draft");
  await page.reload();
  await chooseCardPurchase(page);
  await expect(page.getByLabel(/Record name/)).toHaveValue("Recover this draft");
});

test("Opening flow exposes its accessible steps and protects its required choice", async ({ page }) => {
  await page.goto("/records/new/opening");
  await expect(page.getByRole("heading", { name: "Record pack opening" })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  const untracked = page.getByRole("button", { name: /^Untracked opening/ });
  await untracked.getByText("Untracked opening", { exact: true }).click();
  await expect(untracked).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Continue" })).toBeEnabled();
});

test("Sale flow selects one exact physical Copy and reaches a reviewable confirmation", async ({ page }) => {
  await page.goto("/records/new/sale");
  const saleType = page.getByRole("button", { name: /^Single card/ });
  await saleType.getByText("Single card", { exact: true }).click();
  await expect(saleType).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel(/Marketplace or buyer/).fill("Browser buyer");
  await page.getByLabel(/Net proceeds/).fill("2.50");
  await page.getByRole("button", { name: "Continue" }).click();
  const copy = page.getByRole("radio", { name: /Select .*Copy/i }).first();
  await expect(copy).toBeVisible();
  // The radio is deliberately screen-reader-only; its labelled card is the pointer target.
  await copy.check({ force: true });
  await expect(page.getByText("Selection complete")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Review sale" })).toBeVisible();
  await page.getByRole("button", { name: "Confirm preview sale" }).click();
  await expect(page.getByRole("heading", { name: "sale saved" })).toBeVisible();
});

test("protected Records routes retain their return destination for sign-in", async ({ browser }) => {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-records-test-live": "1" } });
  const page = await context.newPage();
  await page.goto("/records/inventory");
  await expect(page).toHaveURL(/\/login\?next=\/records/);
  await expect(page.getByRole("heading", { name: "Welcome back." })).toBeVisible();
  await context.close();
});

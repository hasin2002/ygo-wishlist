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

test("Purchase type choices share one compact row on wide desktop", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/records/new/purchase");

  const options = page.locator("[data-purchase-kind-options] > button");
  await expect(options).toHaveCount(4);
  const boxes = await options.evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect();
    return { height: Math.round(rect.height), y: Math.round(rect.y) };
  }));

  expect(new Set(boxes.map(({ y }) => y)).size).toBe(1);
  expect(Math.max(...boxes.map(({ height }) => height))).toBeLessThan(128);
});

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
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("ygo-library:form-draft:v2:preview:purchase"))).toContain("Recover this draft");
  await page.reload();
  await expect(page.getByText("Draft restored in this tab.")).toBeVisible();
  await chooseCardPurchase(page);
  await expect(page.getByLabel(/Record name/)).toHaveValue("Recover this draft");
});

test("returning a Purchase to its exact initial state clears the older saved draft", async ({ page }) => {
  await page.goto("/records/new/purchase?targetId=target-one&cardName=First");
  await chooseCardPurchase(page);
  const recordName = page.getByLabel(/Record name/);
  await recordName.fill("This draft should be removed");
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("ygo-library:form-draft:v2:preview:purchase"))).toContain("This draft should be removed");
  await recordName.fill("");
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("ygo-library:form-draft:v2:preview:purchase"))).toBeNull();

  await page.reload();
  await chooseCardPurchase(page);
  await expect(recordName).toHaveValue("");
  await expect(page.getByText("Draft restored in this tab.")).toBeHidden();
});

test("an explicit Purchase target conflict asks before replacing either task", async ({ page }) => {
  await page.goto("/records/new/purchase?targetId=target-one&cardName=First");
  await chooseCardPurchase(page);
  await page.getByLabel(/Record name/).fill("First target draft");
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("ygo-library:form-draft:v2:preview:purchase"))).toContain("target-one");

  await page.goto("/records/new/purchase?targetId=target-two&cardName=Second");
  const dialog = page.getByRole("dialog", { name: "Choose which work to continue" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Resume previous draft" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Start new with this item" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Start new with this item" }).click();
  await expect(dialog).toBeHidden();
  await chooseCardPurchase(page);
  await expect(page.getByLabel(/Record name/)).toHaveValue("");
});

test("a generic Purchase draft also asks before an explicit target replaces its work", async ({ page }) => {
  await page.goto("/records/new/purchase");
  await chooseCardPurchase(page);
  await page.getByLabel(/Record name/).fill("Generic purchase draft");
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("ygo-library:form-draft:v2:preview:purchase"))).toContain("Generic purchase draft");

  await page.goto("/records/new/purchase?targetId=target-one&cardName=First");
  const dialog = page.getByRole("dialog", { name: "Choose which work to continue" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Start new with this item" }).click();
  await chooseCardPurchase(page);
  await expect(page.getByLabel(/Record name/)).toHaveValue("");
  await page.getByLabel(/Record name/).fill("New targeted purchase");
  await page.getByLabel(/All-in amount paid/).fill("1.00");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("combobox", { name: /Card name/ })).toHaveValue("First");
});

test("a corrupt Purchase payload is discarded before controls can read it", async ({ page }) => {
  await page.goto("/records/new/purchase");
  await page.evaluate(() => {
    sessionStorage.setItem("ygo-library:form-draft:v2:preview:purchase", JSON.stringify({
      version: 2,
      workflow: "purchase",
      ownerScope: "preview",
      createdAt: "2026-07-30T10:00:00.000Z",
      updatedAt: "2026-07-30T10:00:00.000Z",
      origin: "/records/new/purchase",
      intent: { kind: "none", id: null },
      data: { version: 6, card: { name: "missing every required field" } },
    }));
  });
  await page.reload();
  await expect(page.getByText(/older or damaged draft could not be restored/i)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Record purchase" })).toBeVisible();
});

test("Purchase drafts stay isolated to their browser tab", async ({ page, context }) => {
  await page.goto("/records/new/purchase");
  await chooseCardPurchase(page);
  await page.getByLabel(/Record name/).fill("Only in first tab");
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("ygo-library:form-draft:v2:preview:purchase"))).toContain("Only in first tab");

  const otherTab = await context.newPage();
  await otherTab.goto("/records/new/purchase");
  await expect(otherTab.getByText("Draft restored in this tab.")).toBeHidden();
  await chooseCardPurchase(otherTab);
  await expect(otherTab.getByLabel(/Record name/)).toHaveValue("");
  await otherTab.close();
});

test("Opening flow exposes its accessible steps and protects its required choice", async ({ page }) => {
  await page.goto("/records/new/opening");
  await expect(page.getByRole("heading", { name: "Record pack opening" })).toBeVisible();
  await expect(page.getByText("Unfinished work is kept in this browser tab.")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  const untracked = page.getByRole("button", { name: /^Untracked opening/ });
  await untracked.getByText("Untracked opening", { exact: true }).click();
  await expect(untracked).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Continue" })).toBeEnabled();
});

test("Sale flow selects one exact physical Copy and reaches a reviewable confirmation", async ({ page }) => {
  await page.goto("/records/new/sale");
  await expect(page.getByText("Unfinished work is kept in this browser tab.")).toBeVisible();
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

test("protected Records routes retain their exact return destination through an expired session cookie", async ({ browser }) => {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-records-test-live": "1" } });
  await context.addCookies([{
    name: "better-auth.session_token",
    url: "http://127.0.0.1:3105",
    value: "expired-session-shaped-cookie",
  }]);
  const page = await context.newPage();
  const destination = "/records/inventory/cards/target-preview-dark?kind=cards&rarity=Ultra+Rare&page=3&copy=copy-preview-dark-2";
  await page.goto(destination);
  await expect(page).toHaveURL(`http://127.0.0.1:3105/login?next=${encodeURIComponent(destination)}`);
  await expect(page.getByRole("heading", { name: "Welcome back." })).toBeVisible();
  await context.close();
});

test("a direct Review Sale opens a viewport dialog with an accessible focus boundary", async ({ page }) => {
  await page.goto("/records/history?record=record-preview-sale");

  const dialog = page.getByRole("dialog", { name: "Review sale" });
  const close = dialog.getByRole("button", { name: "Close Review sale" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expect(dialog).toHaveAttribute("aria-describedby", "record-editor-description");
  await expect(dialog.getByText(/Review this sale record and its exact physical Copies/i)).toBeVisible();
  expect(await dialog.evaluate((element) => element.parentElement === document.body)).toBe(true);
  await expect(close).toBeFocused();

  await page.keyboard.press("Shift+Tab");
  await expect(dialog.locator(":focus")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
});

test("Feature Ideas is absent from navigation and resolves to Not Found", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Feature ideas" })).toHaveCount(0);

  const response = await page.goto("/feature-ideas");
  expect(response?.status()).toBe(404);
  await expect(page.getByText("This page could not be found.")).toBeVisible();
});

test("preview gates mixed eBay entry points and rejects crafted listing-photo operations", async ({ page, request }) => {
  await page.goto("/records");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const mixedLot = page.getByRole("menuitem", { name: /Mixed card lot/ });
  await expect(mixedLot).toHaveAttribute("aria-disabled", "true");
  await expect(mixedLot).toContainText("unavailable in preview mode");
  await mixedLot.focus();
  await expect(mixedLot).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(mixedLot).toBeVisible();

  await page.goto("/records/listings/new-lot");
  await expect(page.getByText("Unfinished work is kept in this browser tab.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Mixed lots are unavailable in preview mode" })).toBeVisible();

  const mixedPhoto = await request.post("/api/ebay/image", {
    multipart: {
      archiveKey: "images/listing/archive.jpg",
      copyId: "copy-preview-dark-2",
      inventoryKey: "images/inventory/photo.jpg",
      stageOnly: "true",
    },
  });
  expect(mixedPhoto.status()).toBe(400);
  expect((await mixedPhoto.json()).message).toMatch(/exactly one listing-photo operation/i);

  const previewDelete = await request.delete("/api/ebay/image", {
    data: { archiveKey: "images/listing/archive.jpg", copyId: "copy-preview-dark-2" },
  });
  expect(previewDelete.ok()).toBe(false);
  expect((await previewDelete.json()).message).toMatch(/preview mode/i);
});

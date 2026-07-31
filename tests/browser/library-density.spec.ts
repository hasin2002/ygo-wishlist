import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";

const cardImage = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='590' height='860' viewBox='0 0 590 860'%3E%3Crect width='590' height='860' fill='%231b2945'/%3E%3Ccircle cx='295' cy='345' r='150' fill='%238a1f2d'/%3E%3Cpath d='M135 650h320' stroke='%23f5d47a' stroke-width='32'/%3E%3C/svg%3E";
const longCardName = "The Winged Dragon of Ra Sphere Mode Quarter Century Secret Rare First Edition";

const cards = Array.from({ length: 10 }, (_, index) => {
  const desiredQuantity = index === 0 ? 3 : index === 1 ? 2 : 1;
  const ownedQuantity = index === 0 ? 1 : index === 1 ? 4 : index % 3 === 1 ? 1 : 0;
  const unpriced = index === 6;

  return {
    chaseLevel: index % 2 ? null : 4,
    desiredQuantity,
    ebayListingUrl: null,
    ebaySearchUrl: null,
    edition: "1st Edition",
    id: `library-layout-${index + 1}`,
    imageUrl: index === 6 ? null : cardImage,
    marketPriceText: unpriced ? null : index % 3 === 0 ? `£${(index + 1).toFixed(2)}` : null,
    name: index === 0 ? longCardName : `Responsive Library Card ${index + 1}`,
    notes: index === 5 ? "A long note remains available in card details." : null,
    ownedQuantity,
    paidPriceText: index % 3 === 1 ? "£2.50" : null,
    priceText: unpriced ? null : `£${(index + 2).toFixed(2)}`,
    purchaseMonth: index % 3 === 1 ? "2026-07" : null,
    rarity: index % 2 ? "Ultra Rare" : "Secret Rare",
    status: ownedQuantity >= desiredQuantity ? "owned" : "wishlist",
    url: index === 7
      ? "https://example.com/saved-library-card"
      : "https://www.tcgplayer.com/product/12345/responsive-library-card",
  };
});

const trackerPage = {
  canEdit: false,
  counts: { owned: 3, total: 10, wishlist: 7 },
  items: cards,
  page: 1,
  pageSize: 10,
  paidCompleteness: { complete: false, knownCopyCount: 2, unknownCopyCount: 27 },
  rarityOptions: ["Secret Rare", "Ultra Rare"],
  total: 20,
  totalPages: 2,
  values: { owned: 1571, paid: 756, wishlist: 26428 },
};

async function mockLibrary(page: Page, canEdit = false) {
  await page.route("**/api/trpc/**", async (route) => {
    if (route.request().url().includes("library.trackerPage")) {
      const procedures = decodeURIComponent(
        new URL(route.request().url()).pathname.split("/api/trpc/")[1],
      )
        .split(",");
      await route.fulfill({
        contentType: "application/json",
        json: procedures.map((procedure) => ({
          result: {
            data: {
              json: procedure === "library.trackerPage"
                ? { ...trackerPage, canEdit }
                : null,
            },
          },
        })),
      });
      return;
    }
    await route.continue();
  });
}

async function screenshotLibrary(page: Page, testInfo: TestInfo, name: string) {
  await page.screenshot({ fullPage: true, path: testInfo.outputPath(`${name}.png`) });
}

test("Library cards stay dense and usable from phone through wide desktop", async ({ page }, testInfo) => {
  await mockLibrary(page, true);
  await page.setViewportSize({ width: 375, height: 844 });
  await page.goto("/");
  await expect(page.locator("[data-library-card]")).toHaveCount(10);
  const imageButton = page.getByRole("button", { name: `Open larger image of ${longCardName}` });
  await expect(imageButton).toBeVisible();
  await expect(page.getByText("No image", { exact: true })).toBeVisible();
  await expect(page.getByText("Value unknown · Unpriced", { exact: true })).toBeVisible();
  await expect(page.locator('[data-library-quantity-summary][aria-label="Wanted 3, owned 1"]')).toBeVisible();
  await expect(page.locator('[data-library-quantity-summary][aria-label="Wanted 2, owned 4"]')).toBeVisible();
  await expect(page.getByText("Deficit", { exact: true })).toHaveCount(0);
  const summary = page.locator("[data-library-summary]");
  await expect(summary.getByText("Tracked cards", { exact: true })).toBeVisible();
  await expect(summary.getByText("Wishlist value", { exact: true })).toBeVisible();
  await expect(summary.getByText("£26,428", { exact: true })).toBeVisible();
  await expect(summary.getByText("Owned value", { exact: true })).toBeVisible();
  await expect(summary.getByText("£1,571", { exact: true })).toBeVisible();
  await expect(summary.getByText("Purchase cost", { exact: true })).toBeVisible();
  await expect(summary.getByText("£756", { exact: true })).toBeVisible();
  await expect(summary.getByText("27 costs missing", { exact: true })).toBeVisible();
  const rarityGuideButton = page.getByRole("button", { name: "View rarity abbreviation guide" });
  const refreshButton = page.getByRole("button", { name: "Refresh current UK eBay estimates for all cards" });
  const [rarityGuideBox, refreshBox] = await Promise.all([
    rarityGuideButton.boundingBox(),
    refreshButton.boundingBox(),
  ]);
  expect(rarityGuideBox).not.toBeNull();
  expect(refreshBox).not.toBeNull();
  expect(rarityGuideBox!.width).toBe(refreshBox!.width);
  expect(rarityGuideBox!.height).toBe(refreshBox!.height);
  const ownedMetadataHeights = await page.locator("[data-library-card]").filter({
    hasText: "Responsive Library Card 2",
  }).locator("[data-library-metadata] > span").evaluateAll((elements) => (
    elements.map((element) => Math.round(element.getBoundingClientRect().height))
  ));
  expect(new Set(ownedMetadataHeights)).toEqual(new Set([28]));
  const mediaBoxes = await page.locator("[data-library-media]").evaluateAll((elements) => (
    elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { height: Math.round(rect.height), width: Math.round(rect.width) };
    })
  ));
  expect(new Set(mediaBoxes.map(({ height }) => height))).toEqual(new Set([144]));
  expect(mediaBoxes.every(({ width }) => width >= 127 && width <= 128)).toBe(true);
  const firstCard = page.locator("[data-library-card]").first();
  const mediaBox = await firstCard.locator("[data-library-media]").boundingBox();
  const quantityBox = await firstCard.locator("[data-library-quantity-summary]").boundingBox();
  expect(mediaBox).not.toBeNull();
  expect(quantityBox).not.toBeNull();
  expect(quantityBox!.y).toBeGreaterThanOrEqual(mediaBox!.y + mediaBox!.height - 1);
  expect(Math.round(quantityBox!.width)).toBe(Math.round(mediaBox!.width));
  await expectMinimumTargetSize(page.locator("[data-library-card] [data-library-action]"));
  await screenshotLibrary(page, testInfo, "library-density-phone-375");

  await imageButton.focus();
  await imageButton.click();
  const imageDialog = page.getByRole("dialog", { name: `Larger image of ${longCardName}` });
  const closeButton = page.getByRole("button", { name: `Close larger image of ${longCardName}` });
  await expect(imageDialog).toBeVisible();
  await expect(imageDialog.getByRole("img", { name: longCardName })).toBeVisible();
  await expect(imageDialog.getByRole("heading")).toHaveCount(0);
  await expect(imageDialog.getByRole("link")).toHaveCount(0);
  await expect(imageDialog.locator("[data-library-quantity-summary]")).toHaveCount(0);
  await screenshotLibrary(page, testInfo, "library-image-preview-phone-375");
  await expect(closeButton).toBeFocused();
  await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
  await expectMinimumTargetSize(closeButton);
  await page.keyboard.press("Shift+Tab");
  await expect(closeButton).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(closeButton).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(imageDialog).toBeHidden();
  await expect(imageButton).toBeFocused();
  await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");

  await imageButton.click();
  await expect(imageDialog).toBeVisible();
  await imageDialog.click({ position: { x: 2, y: 2 } });
  await expect(imageDialog).toBeHidden();
  await expect(imageButton).toBeFocused();
  const phoneRows = await page.locator("[data-library-card]").evaluateAll((elements) => (
    elements.map((element) => Math.round(element.getBoundingClientRect().height))
  ));
  assertPhoneDensity(phoneRows);
  const phoneStack = phoneRows.reduce((total, height) => total + height, 0);
  const legacyImageOnlyStack = 10 * Math.round(343 * 5 / 4);
  console.log(`phone card stack: ${phoneStack}px for ten results (largest row ${Math.max(...phoneRows)}px, ${Math.round((1 - phoneStack / legacyImageOnlyStack) * 100)}% shorter than the former image areas alone)`);
  await expectGridColumns(page, 1);

  await page.setViewportSize({ width: 768, height: 1024 });
  await screenshotLibrary(page, testInfo, "library-density-tablet-768");
  await expectGridColumns(page, 2);

  await page.setViewportSize({ width: 1366, height: 900 });
  await page.getByRole("button", { name: "Collapse navigation" }).click();
  await expect(page.getByRole("button", { name: "Expand navigation" })).toBeVisible();
  await screenshotLibrary(page, testInfo, "library-density-laptop-1366");
  await expectGridColumns(page, 5);
  await expectCompleteDesktopRows(page, 5, 2);

  await page.setViewportSize({ width: 1728, height: 1000 });
  await screenshotLibrary(page, testInfo, "library-density-wide-1728");
  await expectGridColumns(page, 5);
  await expectCompleteDesktopRows(page, 5, 2);
});

test("Library controls, pagination, and public commerce links remain usable", async ({ page }) => {
  await mockLibrary(page);
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto("/");

  await expect(page.getByRole("link", { name: "Add to wishlist" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Open physical cards" })).toHaveCount(0);
  await expect(page.getByText("Loading Library cards…", { exact: true })).toBeHidden({ timeout: 15_000 });
  await expect(page.locator("[data-library-card]")).toHaveCount(10);
  await page.waitForTimeout(50);
  await page.getByPlaceholder("Search cards, rarity, notes").fill("Dragon of Ra");
  await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe("Dragon of Ra");
  await page.getByRole("button", { name: "Wishlist", exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("status")).toBe("wishlist");
  await expect(page.getByText("Loading Library cards…", { exact: true })).toBeHidden({ timeout: 15_000 });

  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Refine cards" })).toBeVisible();
  await page.getByRole("button", { name: "Close filters" }).click();

  const tcgLink = page.getByRole("link", { name: `Open ${longCardName} on TCGplayer` }).first();
  const ebayLink = page.getByRole("link", { name: `Open eBay search for ${longCardName}` }).first();
  const savedLink = page.getByRole("link", { name: "Open saved link for Responsive Library Card 8" }).first();
  await expect(tcgLink).toHaveAttribute("href", /tcgplayer\.com\/product\/12345/);
  await expect(ebayLink).toHaveAttribute("href", /ebay\.co\.uk/);
  await expect(savedLink).toHaveAttribute("href", "https://example.com/saved-library-card");
  await expectMinimumTargetSize(page.locator("[data-library-card] [data-library-action]"));

  await page.getByRole("button", { name: "Next page" }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("page")).toBe("2");
});

test("global Add opens the dedicated Add to wishlist page form", async ({ page }) => {
  await mockLibrary(page, true);
  await page.setViewportSize({ width: 1024, height: 900 });
  const origin = "/?status=wishlist&page=2";
  const destination = `/wishlist/new?origin=${encodeURIComponent(origin)}`;
  await page.goto(origin);

  await page.getByRole("button", { name: "Add", exact: true }).click();
  const addWishlist = page.getByRole("menuitem", { name: /Add to wishlist/ });
  await expect(addWishlist).toHaveAttribute("href", destination);
  await addWishlist.click();

  await expect(page).toHaveURL(new URL(destination, page.url()).toString());
  await expect(page.getByRole("heading", { level: 1, name: "Add to wishlist" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add to wishlist" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const back = page.getByRole("link", { name: "Back to Library" });
  await expect(back).toHaveAttribute("href", origin);
  await back.click();
  await expect(page).toHaveURL(new URL(origin, page.url()).toString());
});

test("Global Add and the rarity guide provide complete keyboard lifecycles", async ({ page }) => {
  await mockLibrary(page, true);
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto("/");
  await expect(page.locator("[data-library-card]")).toHaveCount(10);

  const add = page.getByRole("button", { name: "Add", exact: true });
  await add.focus();
  await page.keyboard.press("ArrowDown");
  const menu = page.getByRole("menu", { name: "Add an activity" });
  const firstItem = page.getByRole("menuitem", { name: /Add to wishlist/ });
  await expect(menu).toBeVisible();
  await expect(firstItem).toBeFocused();
  await page.keyboard.press("End");
  await expect(page.getByRole("menuitem", { name: /Mixed card lot/ })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(add).toBeFocused();

  const guideTrigger = page.getByRole("button", { name: "View rarity abbreviation guide" });
  await guideTrigger.click();
  const guide = page.getByRole("dialog", { name: "Rarity guide" });
  const closeGuide = page.getByRole("button", { name: "Close rarity guide" });
  await expect(guide).toBeVisible();
  await expect(closeGuide).toBeFocused();
  await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
  await page.keyboard.press("Escape");
  await expect(guide).toBeHidden();
  await expect(guideTrigger).toBeFocused();
  await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
});

test("mobile navigation behaves as a viewport modal and preserves keyboard return", async ({ page }) => {
  await mockLibrary(page, true);
  await page.setViewportSize({ width: 375, height: 844 });
  await page.goto("/");

  const trigger = page.getByRole("button", { name: "Open navigation" });
  await trigger.click();
  const navigation = page.getByRole("dialog", { name: "Primary navigation" });
  await expect(navigation).toBeVisible();
  await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
  await expect(navigation.getByRole("button", { name: "Close navigation" })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(navigation).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");

  const skip = page.getByRole("link", { name: "Skip to main content" });
  await skip.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();
});

test("Add and edit forms remove redundant panels and explain wishlist removal", async ({ page }, testInfo) => {
  await mockLibrary(page, true);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/wishlist/new");

  await expect(page.getByText("Wishlist Target", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Adding here records what you want", { exact: false })).toHaveCount(0);
  await expect(page.getByLabel("Chase")).toBeVisible();

  await page.goto("/");
  await page.getByRole("button", { name: longCardName, exact: true }).click();
  const editDialog = page.getByRole("dialog", { name: "Edit card" });
  await expect(editDialog).toBeVisible();
  await expect(editDialog.getByText("Library state", { exact: true })).toHaveCount(0);
  await expect(editDialog.getByText("Owned from Records", { exact: true })).toHaveCount(0);
  await expect(editDialog.getByLabel("Notes")).toBeVisible();
  await editDialog.getByLabel("Notes").fill("Keep this unsaved note");
  await expect(editDialog.getByRole("button", { name: "Remove from wishlist" })).toBeVisible();
  await expect(editDialog.getByRole("button", { name: "Save changes" })).toBeVisible();
  await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
  await page.screenshot({ path: testInfo.outputPath("library-edit-card-desktop.png") });

  await editDialog.getByRole("button", { name: "Remove from wishlist" }).click();
  const removalDialog = page.getByRole("alertdialog", { name: "Remove from wishlist?" });
  await expect(removalDialog).toBeVisible();
  await expect(removalDialog.getByText(/owned Copy and all Record history will stay/)).toBeVisible();
  await expect(removalDialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await removalDialog.getByRole("button", { name: "Cancel" }).click();
  await expect(removalDialog).toBeHidden();
  await expect(editDialog).toBeVisible();
  await expect(editDialog.getByLabel("Notes")).toHaveValue("Keep this unsaved note");
  await editDialog.getByRole("button", { name: "Cancel" }).click();
  await expect(editDialog).toBeHidden();

  await page.getByRole("button", { name: "Responsive Library Card 2", exact: true }).click();
  await expect(editDialog).toBeVisible();
  await expect(editDialog.getByRole("button", { name: "Remove from wishlist" })).toBeVisible();
  await editDialog.getByRole("button", { name: "Remove from wishlist" }).click();
  await expect(removalDialog.getByText(/Wanted set to 0.*4 owned Copies.*Record history will stay/)).toBeVisible();
  await removalDialog.getByRole("button", { name: "Cancel" }).click();
  await editDialog.getByRole("button", { name: "Cancel" }).click();

  await page.setViewportSize({ width: 375, height: 844 });
  await page.getByRole("button", { name: longCardName, exact: true }).click();
  await expect(editDialog).toBeVisible();
  await expect(editDialog.getByRole("button", { name: "Remove from wishlist" })).toBeVisible();
  await expect(editDialog.getByRole("button", { name: "Save changes" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("library-edit-card-phone.png") });
  await page.keyboard.press("Escape");
  await expect(editDialog).toBeHidden();
  await expect(page.getByRole("button", { name: longCardName, exact: true })).toBeFocused();
  await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
});

async function expectGridColumns(page: Page, count: number) {
  await expect.poll(() => page.locator("[data-library-results]").evaluate((element) => (
    getComputedStyle(element).gridTemplateColumns.split(" ").length
  ))).toBe(count);
}

async function expectMinimumTargetSize(locator: Locator) {
  const boxes = await locator.evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect();
    return { height: rect.height, label: element.getAttribute("aria-label") ?? element.textContent?.trim(), width: rect.width };
  }));
  expect(boxes.length).toBeGreaterThan(0);
  for (const box of boxes) {
    expect.soft(box.height, `${box.label} height`).toBeGreaterThanOrEqual(44);
    expect.soft(box.width, `${box.label} width`).toBeGreaterThanOrEqual(44);
  }
}

function assertPhoneDensity(rows: number[]) {
  expect(rows).toHaveLength(10);
  expect(Math.max(...rows)).toBeLessThanOrEqual(260);
  const currentStack = rows.reduce((total, height) => total + height, 0);
  const legacyImageOnlyStack = 10 * Math.round(343 * 5 / 4);
  expect(currentStack).toBeLessThanOrEqual(legacyImageOnlyStack * 0.65);
}

async function expectCompleteDesktopRows(page: Page, columns: number, rows: number) {
  const cardsByRow = await page.locator("[data-library-card]").evaluateAll((elements) => {
    const rowTops: number[] = [];
    for (const element of elements) {
      const top = element.getBoundingClientRect().top;
      const rowIndex = rowTops.findIndex((rowTop) => Math.abs(rowTop - top) < 2);
      if (rowIndex === -1) rowTops.push(top);
    }
    return rowTops.map((rowTop) => (
      elements.filter((element) => Math.abs(element.getBoundingClientRect().top - rowTop) < 2).length
    ));
  });
  expect(cardsByRow).toEqual(Array.from({ length: rows }, () => columns));
}

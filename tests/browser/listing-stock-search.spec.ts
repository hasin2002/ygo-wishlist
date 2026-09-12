import { expect, test } from "@playwright/test";

test("listing stock search finds owned set codes and displays thumbnails", async ({ page }) => {
  await page.setViewportSize({ width: 843, height: 837 });
  await page.route("**/api/image-proxy?**", (route) => route.fulfill({
    contentType: "image/png",
    body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH0kAAAAASUVORK5CYII=", "base64"),
  }));
  await page.goto("/records/listings/new");
  await page.getByRole("button", { name: /^Sell cards individually/ }).click();
  const search = page.getByRole("combobox", { name: "Card target", exact: true });
  await search.fill("SDY-006");
  const option = page.getByRole("option", { name: /Dark Magician/ });
  await expect(option).toBeVisible();
  await expect(option.locator("img")).toHaveAttribute("src", /image-proxy/);
  await expect(option.locator("img")).toHaveJSProperty("naturalWidth", 1);
  await search.fill("SDY-006 Near Mint");
  await expect(option).toBeVisible();
  await option.click();
  const variant = page.getByRole("combobox", { name: "Printing and condition", exact: true });
  await variant.fill("SDY-006 Near Mint");
  const printing = page.getByRole("option", { name: /SDY-006/ });
  await expect(printing).toBeVisible();
  await expect(printing.locator("img")).toHaveAttribute("src", /image-proxy/);
  await page.screenshot({ path: "/tmp/listing-stock-search.png", fullPage: true });
});

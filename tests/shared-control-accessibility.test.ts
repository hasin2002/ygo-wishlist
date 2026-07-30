import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const rarityGuide = readFileSync(
  new URL("../src/components/rarity-guide-popover.tsx", import.meta.url),
  "utf8",
);
const dataLoadError = readFileSync(
  new URL("../src/components/data-load-error.tsx", import.meta.url),
  "utf8",
);
const appHeader = readFileSync(
  new URL("../src/components/app-header.tsx", import.meta.url),
  "utf8",
);

test("rarity guide is a portal dialog with complete keyboard and focus lifecycle", () => {
  assert.match(rarityGuide, /import \{ createPortal \} from "react-dom"/);
  assert.match(rarityGuide, /createPortal\(/);
  assert.match(rarityGuide, /document\.body/);
  assert.match(rarityGuide, /aria-modal="true"/);
  assert.match(rarityGuide, /max-h-\[min\(88dvh,34rem\)\]/);
  assert.match(rarityGuide, /document\.body\.style\.overflow = "hidden"/);
  assert.match(rarityGuide, /event\.key === "Escape"/);
  assert.match(rarityGuide, /event\.key !== "Tab"/);
  assert.match(rarityGuide, /event\.target === event\.currentTarget/);
  assert.match(rarityGuide, /trigger\?\.isConnected/);
});

test("shared recovery control meets the minimum touch target", () => {
  assert.match(dataLoadError, /className="mt-4 inline-flex min-h-11/);
});

test("Global Add uses a roving menu-button keyboard pattern", () => {
  assert.match(appHeader, /aria-haspopup="menu"/);
  assert.match(appHeader, /role="menu"/);
  assert.match(appHeader, /role="menuitem"/);
  assert.match(appHeader, /tabIndex=\{itemIndex === activeItemIndex \? 0 : -1\}/);
  assert.match(appHeader, /event\.key === "ArrowDown"/);
  assert.match(appHeader, /event\.key === "ArrowUp"/);
  assert.match(appHeader, /event\.key === "Home"/);
  assert.match(appHeader, /event\.key === "End"/);
  assert.match(appHeader, /closeMenu\(\{ restoreFocus: true \}\)/);
  assert.match(appHeader, /triggerRef\.current\?\.focus\(\)/);
});

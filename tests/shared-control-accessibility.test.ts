import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const rarityGuide = readFileSync(
  new URL("../src/components/rarity-guide-popover.tsx", import.meta.url),
  "utf8",
);
const viewportOverlay = readFileSync(
  new URL("../src/components/use-viewport-overlay.ts", import.meta.url),
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
const recordsApp = readFileSync(
  new URL("../src/components/records/records-app.tsx", import.meta.url),
  "utf8",
);
const unavailableAction = readFileSync(
  new URL("../src/components/unavailable-action.tsx", import.meta.url),
  "utf8",
);
const wheelApp = readFileSync(
  new URL("../src/components/wheel-app.tsx", import.meta.url),
  "utf8",
);
const binderApp = readFileSync(
  new URL("../src/components/binder-v2-app.tsx", import.meta.url),
  "utf8",
);

test("rarity guide is a portal dialog with complete keyboard and focus lifecycle", () => {
  assert.match(rarityGuide, /import \{ createPortal \} from "react-dom"/);
  assert.match(rarityGuide, /createPortal\(/);
  assert.match(rarityGuide, /document\.body/);
  assert.match(rarityGuide, /aria-modal="true"/);
  assert.match(rarityGuide, /max-h-\[min\(88dvh,34rem\)\]/);
  assert.match(rarityGuide, /useViewportOverlay<HTMLElement>/);
  assert.match(viewportOverlay, /document\.body\.style\.overflow = "hidden"/);
  assert.match(viewportOverlay, /event\.key === "Escape"/);
  assert.match(viewportOverlay, /event\.key !== "Tab"/);
  assert.match(rarityGuide, /event\.target === event\.currentTarget/);
  assert.match(viewportOverlay, /trigger\?\.isConnected/);
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

test("Global Add keeps its active retry item focusable while an eBay check is pending", () => {
  assert.match(appHeader, /if \(retryingEbayCheckRef\.current\) return/);
  assert.match(appHeader, /aria-busy=\{retryingEbayCheck\}/);
  assert.match(appHeader, /aria-disabled=\{retryingEbayCheck\}/);
  assert.doesNotMatch(appHeader, /\sdisabled=\{retryingEbayCheck\}/);
  assert.match(appHeader, /tabIndex=\{retryIndex === activeItemIndex \? 0 : -1\}/);
  assert.match(appHeader, /Checking eBay…/);
});

test("unavailable action explanations are touch-accessible toggles", () => {
  assert.match(unavailableAction, /useState\(false\)/);
  assert.match(unavailableAction, /aria-controls=\{reasonId\}/);
  assert.match(unavailableAction, /aria-expanded=\{reasonOpen\}/);
  assert.match(unavailableAction, /onClick=\{\(\) => setReasonOpen/);
  assert.match(unavailableAction, /hidden=\{!reasonOpen\}/);
  assert.doesNotMatch(unavailableAction, /group-hover:opacity-100/);
});

test("Records editor and attention dialogs reuse the viewport overlay lifecycle", () => {
  assert.match(recordsApp, /function RecordEditorDialog[\s\S]*?useViewportOverlay<HTMLDivElement>/);
  assert.match(recordsApp, /function CardAttentionDialog[\s\S]*?useViewportOverlay<HTMLDivElement>/);
  assert.match(recordsApp, /function EbayCopyLinkAttentionDialog[\s\S]*?useViewportOverlay<HTMLDivElement>/);
  assert.match(recordsApp, /function RecordEditorDialog[\s\S]*?createPortal\([\s\S]*?document\.body/);
  assert.match(recordsApp, /function CardAttentionDialog[\s\S]*?onMouseDown=\{\(event\) => \{ if \(event\.target === event\.currentTarget\) onClose\(\); \}\}/);
  assert.match(recordsApp, /aria-describedby="ebay-copy-link-description"/);
  assert.match(recordsApp, /max-h-\[calc\(100dvh-1\.5rem\)\][\s\S]*?overflow-y-auto/);
});

test("Wheel and Binder reset actions meet the 44px touch target", () => {
  assert.match(wheelApp, /resetOpen &&[\s\S]*?className="min-h-11[^"]*"[\s\S]*?Cancel/);
  assert.match(wheelApp, /resetOpen &&[\s\S]*?className="inline-flex min-h-11[^"]*"[\s\S]*?"Reset wheel"/);
  assert.match(binderApp, /resetModalOpen &&[\s\S]*?className="min-h-11[^"]*"[\s\S]*?Cancel/);
  assert.match(binderApp, /resetModalOpen &&[\s\S]*?className="min-h-11[^"]*"[\s\S]*?Clear binder/);
});

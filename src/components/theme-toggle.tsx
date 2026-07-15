"use client";

import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";

const darkModeClass = "dark-mode";
const themeChangeEvent = "ygo-theme-change";
const themeStorageKey = "ygo-theme";

function subscribe(onStoreChange: () => void) {
  function syncStoredTheme(event: StorageEvent) {
    if (event.key !== themeStorageKey) {
      return;
    }

    document.documentElement.classList.toggle(
      darkModeClass,
      event.newValue === "dark",
    );
    onStoreChange();
  }

  window.addEventListener("storage", syncStoredTheme);
  window.addEventListener(themeChangeEvent, onStoreChange);

  return () => {
    window.removeEventListener("storage", syncStoredTheme);
    window.removeEventListener(themeChangeEvent, onStoreChange);
  };
}

function getDarkModeSnapshot() {
  return document.documentElement.classList.contains(darkModeClass);
}

function getServerSnapshot() {
  return false;
}

export function ThemeToggle({
  expanded = true,
  mobile = false,
}: {
  expanded?: boolean;
  mobile?: boolean;
}) {
  const darkMode = useSyncExternalStore(
    subscribe,
    getDarkModeSnapshot,
    getServerSnapshot,
  );

  function toggleDarkMode() {
    const nextDarkMode = !darkMode;

    document.documentElement.classList.toggle(darkModeClass, nextDarkMode);
    try {
      window.localStorage.setItem(
        themeStorageKey,
        nextDarkMode ? "dark" : "light",
      );
    } catch {
      // The visible theme still changes when storage is unavailable.
    }
    window.dispatchEvent(new Event(themeChangeEvent));
  }

  const label = darkMode ? "Light mode" : "Dark mode";

  return (
    <button
      aria-label={`Switch to ${label.toLowerCase()}`}
      aria-pressed={darkMode}
      className={`theme-toggle inline-flex items-center gap-2 rounded-lg text-sm font-bold shadow-sm transition duration-200 ${
        mobile ? "min-h-12" : "min-h-11"
      } ${expanded ? "w-full px-3" : "size-12 justify-center"}`}
      onClick={toggleDarkMode}
      title={`Switch to ${label.toLowerCase()}`}
      type="button"
    >
      {darkMode ? (
        <Sun aria-hidden="true" className="size-4 shrink-0" />
      ) : (
        <Moon aria-hidden="true" className="size-4 shrink-0" />
      )}
      {expanded ? <span>{label}</span> : <span className="sr-only">{label}</span>}
    </button>
  );
}

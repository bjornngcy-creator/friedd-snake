"use client";

import { useSyncExternalStore } from "react";

const STORAGE_KEY = "equity-compass-theme";
const CHANGE_EVENT = "equity-compass-theme-change";

/**
 * App-wide light/dark toggle (Phase 3.1 item 15). The <html> element's
 * `dark` class is the single source of truth — set before first paint by
 * the blocking inline script in src/app/layout.tsx (no flash), and flipped
 * here on click. This component reads that class via useSyncExternalStore
 * rather than useEffect+setState: `getServerSnapshot` makes the very first
 * client render match the (always class-less) server HTML exactly, and
 * React re-syncs to the real DOM state right after hydration — the
 * documented pattern for "an external script may have already mutated the
 * DOM before React hydrates," which is exactly our case.
 */
function subscribe(callback: () => void) {
  window.addEventListener(CHANGE_EVENT, callback);
  return () => window.removeEventListener(CHANGE_EVENT, callback);
}

function getSnapshot() {
  return document.documentElement.classList.contains("dark");
}

function getServerSnapshot() {
  return false;
}

function toggleTheme() {
  const next = !document.documentElement.classList.contains("dark");
  document.documentElement.classList.toggle("dark", next);
  try {
    localStorage.setItem(STORAGE_KEY, next ? "dark" : "light");
  } catch {
    // Storage unavailable (private browsing, etc.) — the toggle still
    // works for this page load, it just won't persist.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function ThemeToggle() {
  const isDark = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/15 text-muted transition hover:border-accent hover:text-accent"
    >
      {isDark ? (
        // Sun icon — click to go light
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      ) : (
        // Moon icon — click to go dark
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
        </svg>
      )}
    </button>
  );
}

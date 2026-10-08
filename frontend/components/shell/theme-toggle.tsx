"use client";

import { useCallback, useSyncExternalStore } from "react";

export type Theme = "system" | "light" | "dark";

export const THEME_KEY = "kobi.theme";

/**
 * Light, dark, or follow the system.
 *
 * The choice lives in localStorage (per browser, not per account) and is applied as
 * `data-theme` on <html>; `app/theme-script.tsx` applies it before first paint so there is no
 * flash of the wrong theme. localStorage is an external store, so it is read through
 * `useSyncExternalStore`: that gives the server and the first client render the same answer and
 * then corrects it, instead of hydrating with a mismatch.
 */
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function readTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    // Private mode, or storage blocked: the system theme is a fine answer.
    return "system";
  }
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, readTheme, () => "system" as Theme);

  const choose = useCallback((next: Theme) => {
    const root = document.documentElement;
    try {
      if (next === "system") {
        root.removeAttribute("data-theme");
        localStorage.removeItem(THEME_KEY);
      } else {
        root.setAttribute("data-theme", next);
        localStorage.setItem(THEME_KEY, next);
      }
    } catch {
      // Storage is unavailable; the attribute still applies for this page view.
      if (next !== "system") root.setAttribute("data-theme", next);
    }
    for (const listener of listeners) listener();
  }, []);

  return (
    <div className="theme-toggle" role="group" aria-label="Colour theme">
      {(["system", "light", "dark"] as Theme[]).map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={theme === option}
          onClick={() => choose(option)}
        >
          {option === "system" ? "Auto" : option === "light" ? "Light" : "Dark"}
        </button>
      ))}
    </div>
  );
}

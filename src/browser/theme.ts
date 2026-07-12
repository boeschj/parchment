import { createContext, useContext, useState } from "react";
import { isBuiltInTheme, type BuiltInTheme } from "../shared/themes.ts";

export const Theme = {
  Light: "light",
  Dark: "dark",
} as const;

export type Theme = (typeof Theme)[keyof typeof Theme];

// This choice is separate from Theme (light/dark): it picks WHICH design
// system's tokens are loaded, while Theme still picks light vs. dark within
// whichever design is active. The built-in themes themselves (manuscript,
// terminal, slate) live in BuiltInTheme — ThemeChoice adds the two options
// that aren't a shipped design file.
export const ThemeChoice = {
  Default: "default",
  Custom: "custom",
} as const;

type NonBuiltInThemeChoice = (typeof ThemeChoice)[keyof typeof ThemeChoice];
export type ThemeChoice = NonBuiltInThemeChoice | BuiltInTheme;

const ThemeStorageKey = {
  Mode: "parchment:theme",
  Choice: "parchment:theme-choice",
} as const;

// The <link> element index.html reserves for whichever stylesheet the active
// ThemeChoice resolves to. A single element (rather than one per theme) keeps
// exactly one override stylesheet in the cascade at a time, with a
// deterministic position after the bundled theme-default.css.
const THEME_OVERRIDE_LINK_ID = "theme-override";

export function readInitialTheme(): Theme {
  const stored = localStorage.getItem(ThemeStorageKey.Mode);
  if (stored === Theme.Light || stored === Theme.Dark) return stored;
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  return prefersDark ? Theme.Dark : Theme.Light;
}

export function applyThemeClass(theme: Theme): void {
  document.documentElement.classList.toggle("dark", theme === Theme.Dark);
}

export function useThemeToggle(): { theme: Theme; toggleTheme: () => void } {
  const [theme, setTheme] = useState<Theme>(readInitialTheme);

  const toggleTheme = (): void => {
    const next = theme === Theme.Dark ? Theme.Light : Theme.Dark;
    localStorage.setItem(ThemeStorageKey.Mode, next);
    applyThemeClass(next);
    setTheme(next);
  };

  return { theme, toggleTheme };
}

const ThemeContext = createContext<Theme>(Theme.Light);

export const ThemeProvider = ThemeContext.Provider;

export function useTheme(): Theme {
  return useContext(ThemeContext);
}

// Reproduces the plugin's original zero-config behavior: a user who has
// never touched the picker but already dropped a ~/.parchment/theme.css file
// sees it applied with no extra step, because Custom is exactly "load
// /theme.css". A fresh install with no file there gets an empty response
// from the daemon, which is a no-op — the default look, untouched.
const DEFAULT_INITIAL_CHOICE: ThemeChoice = ThemeChoice.Custom;

export function readInitialThemeChoice(): ThemeChoice {
  const stored = localStorage.getItem(ThemeStorageKey.Choice);
  if (stored && isThemeChoice(stored)) return stored;
  return DEFAULT_INITIAL_CHOICE;
}

function isThemeChoice(value: string): value is ThemeChoice {
  if (isBuiltInTheme(value)) return true;
  return (Object.values(ThemeChoice) as string[]).includes(value);
}

// The stylesheet href a given choice resolves to, or null when no override
// stylesheet should load at all (the pure default look).
export function themeOverrideHref(choice: ThemeChoice): string | null {
  if (choice === ThemeChoice.Default) return null;
  if (choice === ThemeChoice.Custom) return "/theme.css";
  if (isBuiltInTheme(choice)) return `/themes/${choice}.css`;
  return null;
}

// Points the reserved <link> at whichever stylesheet the choice resolves to.
// Called synchronously before the first React render (see main.tsx) so the
// override is already loading by the time anything paints, exactly like
// applyThemeClass avoids a light/dark flash today.
export function applyThemeChoice(choice: ThemeChoice): void {
  const link = document.getElementById(THEME_OVERRIDE_LINK_ID);
  if (!(link instanceof HTMLLinkElement)) return;
  link.href = themeOverrideHref(choice) ?? "";
}

export function useThemeChoice(): { themeChoice: ThemeChoice; setThemeChoice: (next: ThemeChoice) => void } {
  const [themeChoice, setThemeChoiceState] = useState<ThemeChoice>(readInitialThemeChoice);

  const setThemeChoice = (next: ThemeChoice): void => {
    localStorage.setItem(ThemeStorageKey.Choice, next);
    applyThemeChoice(next);
    setThemeChoiceState(next);
  };

  return { themeChoice, setThemeChoice };
}

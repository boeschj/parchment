import { createContext, useContext, useState } from "react";

export const Theme = {
  Light: "light",
  Dark: "dark",
} as const;

export type Theme = (typeof Theme)[keyof typeof Theme];

const THEME_STORAGE_KEY = "clawd-canvas:theme";

export function readInitialTheme(): Theme {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
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
    localStorage.setItem(THEME_STORAGE_KEY, next);
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

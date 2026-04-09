export type ThemePreference = "light" | "dark";

const STORAGE_KEY = "supportdesk.theme";

export function applyTheme(theme: ThemePreference) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(STORAGE_KEY, theme);
}

export function getStoredTheme(): ThemePreference | null {
  const value = localStorage.getItem(STORAGE_KEY);
  return value === "light" || value === "dark" ? value : null;
}

export function initTheme() {
  // Always start in light mode on initial load.
  applyTheme("light");
}

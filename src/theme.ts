// Light or dark: follows the phone's setting until someone picks one with the button.
// The choice is kept on this device only (index.html applies it before the page shows, so there's no flash).

export type Theme = "light" | "dark";

const KEY = "theme";
const BAR = { light: "#FBF4F3", dark: "#241A1F" }; // colour of the phone's top bar, same as --paper

const systemTheme = (): Theme => (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");

/** The theme someone chose on this device, or null to follow the phone's setting. */
export function chosenTheme(): Theme | null {
  try {
    const t = localStorage.getItem(KEY);
    return t === "light" || t === "dark" ? t : null;
  } catch {
    return null;
  }
}

/** The theme that is showing now. */
export function currentTheme(): Theme {
  return chosenTheme() ?? systemTheme();
}

/** Shows `theme` and remembers it on this device. */
export function setTheme(theme: Theme) {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // Private mode: it works until the page is closed.
  }
  document.documentElement.dataset.theme = theme;
  // The phone's top bar follows the chosen theme instead of the system setting.
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) meta.content = BAR[theme];
}

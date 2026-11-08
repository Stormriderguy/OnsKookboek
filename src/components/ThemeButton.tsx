import { useEffect, useState } from "react";
import { currentTheme, setTheme, type Theme } from "../theme";
import { MoonIcon, SunIcon } from "./Icons";

/** Switches between day and night mode. Shows the moon in day mode and the sun at night. */
export function ThemeButton() {
  const [theme, setShown] = useState<Theme>(currentTheme);

  // While nobody has chosen, follow the phone when it switches by itself (for example at sunset).
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setShown(currentTheme());
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const next: Theme = theme === "dark" ? "light" : "dark";
  return (
    <button
      className="theme-btn"
      type="button"
      aria-label={next === "dark" ? "Nachtmodus aanzetten" : "Dagmodus aanzetten"}
      title={next === "dark" ? "Nachtmodus" : "Dagmodus"}
      onClick={() => {
        setTheme(next);
        setShown(next);
      }}
    >
      {theme === "dark" ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

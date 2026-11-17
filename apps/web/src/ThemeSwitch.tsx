import { useEffect, useState } from "react";
import { MoonStar, Sun } from "lucide-react";

export function ThemeSwitch() {
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === "dark");

  useEffect(() => {
    const preference = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => {
      let theme: string | null = null;
      try { theme = localStorage.getItem("haulmark-theme"); } catch { /* Storage can be disabled. */ }
      const next = theme ? theme === "dark" : preference.matches;
      document.documentElement.dataset.theme = next ? "dark" : "light";
      setDark(next);
    };
    sync();
    preference.addEventListener("change", sync);
    return () => preference.removeEventListener("change", sync);
  }, []);

  return (
    <button type="button" className="theme-switch" role="switch" aria-label="Dark mode" aria-checked={dark} onClick={() => {
      const theme = dark ? "light" : "dark";
      document.documentElement.dataset.theme = theme;
      try { localStorage.setItem("haulmark-theme", theme); } catch { /* The current page still changes theme. */ }
      setDark(!dark);
    }}>
      {dark ? <MoonStar size={16} /> : <Sun size={16} />}
      <span>{dark ? "Dark mode" : "Light mode"}</span>
      <span className="theme-track" aria-hidden="true" />
    </button>
  );
}

import { useState } from "react";
import { getTheme, setTheme } from "../utils/theme";
import { useLang } from "../i18n/LanguageContext";

// Sun / moon toggle. `variant="full"` shows a labelled row (sidebar footer);
// default is a compact icon button (top bars).
export default function ThemeToggle({ variant = "icon", className = "" }) {
  const { t } = useLang();
  const [theme, setThemeState] = useState(getTheme());
  const isLight = theme === "light";

  function toggle() {
    setThemeState(setTheme(isLight ? "dark" : "light"));
  }

  const icon = isLight ? (
    // moon (switch to dark)
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  ) : (
    // sun (switch to light)
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );

  if (variant === "full") {
    return (
      <button
        onClick={toggle}
        className={"flex w-full items-center gap-3 rounded-md px-3 py-2.5 font-mono-display text-xs text-[var(--text-muted)] transition hover:text-[var(--text)] " + className}
        title={isLight ? "Switch to dark mode" : "Switch to light mode"}
      >
        {icon}
        {isLight ? t("theme.dark") : t("theme.light")}
      </button>
    );
  }

  return (
    <button
      onClick={toggle}
      aria-label={isLight ? "Switch to dark mode" : "Switch to light mode"}
      title={isLight ? "Switch to dark mode" : "Switch to light mode"}
      className={"grid h-9 w-9 place-items-center rounded-sm border border-[var(--line)] text-[var(--text-muted)] transition hover:border-[var(--text-muted)] hover:text-[var(--text)] " + className}
    >
      {icon}
    </button>
  );
}

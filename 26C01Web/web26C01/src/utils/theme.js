// Light/dark theme, remembered per browser. Dark is the default.
const KEY = "junction_theme";

export function getTheme() {
  try {
    return localStorage.getItem(KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

// Dark = no attribute (falls back to :root defaults); light = data-theme="light".
export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === "light") root.setAttribute("data-theme", "light");
  else root.removeAttribute("data-theme");
}

export function setTheme(theme) {
  const next = theme === "light" ? "light" : "dark";
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // ignore (private mode / blocked storage)
  }
  applyTheme(next);
  return next;
}

// Call once at startup, before React renders, so there's no flash of the wrong theme.
export function initTheme() {
  applyTheme(getTheme());
}

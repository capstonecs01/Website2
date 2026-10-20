import { createContext, useContext, useState, useCallback } from "react";
import { strings } from "./strings";

const KEY = "junction_lang";
const LanguageContext = createContext(null);

function readLang() {
  try {
    return localStorage.getItem(KEY) === "ja" ? "ja" : "en";
  } catch {
    return "en";
  }
}

// Set <html lang> as early as possible (also done on every change).
export function initLang() {
  try {
    document.documentElement.setAttribute("lang", readLang());
  } catch {
    // ignore
  }
}

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(readLang);

  const setLang = useCallback((next) => {
    const value = next === "ja" ? "ja" : "en";
    try {
      localStorage.setItem(KEY, value);
    } catch {
      // ignore
    }
    try {
      document.documentElement.setAttribute("lang", value);
    } catch {
      // ignore
    }
    setLangState(value);
  }, []);

  // t("some.key", { name: "..." }) — falls back to English, then the key itself.
  const t = useCallback(
    (key, vars) => {
      let s = (strings[lang] && strings[lang][key]) ?? strings.en[key] ?? key;
      if (vars) {
        for (const k in vars) s = s.split(`{${k}}`).join(vars[k]);
      }
      return s;
    },
    [lang]
  );

  return <LanguageContext.Provider value={{ lang, setLang, t }}>{children}</LanguageContext.Provider>;
}

// Safe even if used outside a provider (returns English passthrough).
export function useLang() {
  return useContext(LanguageContext) || { lang: "en", setLang: () => {}, t: (k) => k };
}

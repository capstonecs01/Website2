import { useLang } from "../i18n/LanguageContext";

// Compact EN / 日本語 segmented switch. The active language gets the accent fill.
export default function LanguageToggle({ accent = "var(--signal)", className = "" }) {
  const { lang, setLang } = useLang();

  const opt = (value, label) => {
    const on = lang === value;
    return (
      <button
        key={value}
        onClick={() => setLang(value)}
        aria-pressed={on}
        className="px-2.5 py-1 font-mono-display text-[11px] font-semibold transition"
        style={
          on
            ? { background: accent, color: "#0E1116" }
            : { color: "var(--text-muted)", background: "transparent" }
        }
      >
        {label}
      </button>
    );
  };

  return (
    <div className={"inline-flex overflow-hidden rounded-sm border border-[var(--line)] " + className}>
      {opt("en", "EN")}
      {opt("ja", "日本語")}
    </div>
  );
}

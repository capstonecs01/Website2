import { useMemo, useState } from "react";
import { normalizeKeyword } from "../utils/keywords";

// Chip-style tag input with canonical-keyword suggestions.
// - value: array of canonical keyword strings
// - onChange(nextArray)
// - suggestions: array of catalogue keyword strings (from GET /api/keywords)
// Typing "coding" and pressing Enter adds the chip "programming" (normalised),
// so the same idea never lands as two different tags.
export default function KeywordPicker({ value = [], onChange, suggestions = [], accent = "var(--signal)", placeholder }) {
  const [text, setText] = useState("");

  function add(raw) {
    const k = normalizeKeyword(raw);
    if (!k) return;
    if (!value.includes(k)) onChange([...value, k]);
    setText("");
  }

  function remove(k) {
    onChange(value.filter((x) => x !== k));
  }

  function onKeyDown(e) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add(text);
    } else if (e.key === "Backspace" && !text && value.length) {
      remove(value[value.length - 1]);
    }
  }

  // Suggestions not already picked, filtered by what's typed.
  const filtered = useMemo(() => {
    const q = normalizeKeyword(text);
    return suggestions
      .filter((s) => !value.includes(s))
      .filter((s) => !q || s.includes(q))
      .slice(0, 8);
  }, [suggestions, value, text]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 rounded-sm border border-[var(--line)] bg-[var(--bg-panel)] px-3 py-2.5 transition focus-within:border-[var(--text-muted)]">
        {value.map((k) => (
          <span
            key={k}
            className="flex items-center gap-1.5 rounded-sm px-2 py-1 font-mono-display text-[12px]"
            style={{ background: "color-mix(in srgb, " + accent + " 16%, transparent)", color: accent }}
          >
            #{k}
            <button type="button" onClick={() => remove(k)} className="opacity-70 hover:opacity-100" aria-label={`remove ${k}`}>
              ×
            </button>
          </span>
        ))}
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={value.length ? "" : placeholder || "Type a keyword and press Enter…"}
          className="min-w-[8rem] flex-1 bg-transparent text-sm text-[var(--text)] outline-none placeholder:text-[var(--text-muted)]/50"
        />
      </div>

      {filtered.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {filtered.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => add(s)}
              className="rounded-sm border border-[var(--line)] bg-[var(--bg)] px-2 py-1 font-mono-display text-[11px] text-[var(--text-muted)] transition hover:border-[var(--text-muted)] hover:text-[var(--text)]"
            >
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

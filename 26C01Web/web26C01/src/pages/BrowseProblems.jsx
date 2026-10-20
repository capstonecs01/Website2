import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import AppShell, { StatusPill } from "../components/AppShell";
import { useAuthUser } from "../utils/useAuthUser";
import { apiFetch } from "../utils/api";
import { useLang } from "../i18n/LanguageContext";

export default function BrowseProblems() {
  const user = useAuthUser("student");
  const { t } = useLang();
  const [problems, setProblems] = useState(null);
  const [keywords, setKeywords] = useState([]);
  const [selected, setSelected] = useState([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");

  // Load the keyword catalogue once (only ones actually in use).
  useEffect(() => {
    if (!user) return;
    apiFetch("/keywords")
      .then((d) => setKeywords(d.keywords.filter((k) => k.count > 0)))
      .catch(() => {});
  }, [user]);

  // Re-query whenever the text or selected tags change (debounced).
  useEffect(() => {
    if (!user) return;
    const term = query.trim();
    const params = new URLSearchParams();
    if (term) params.set("q", term);
    if (selected.length) params.set("tags", selected.join(","));
    const qs = params.toString();
    const timer = setTimeout(() => {
      apiFetch(`/problems${qs ? `?${qs}` : ""}`)
        .then((d) => setProblems(d.problems))
        .catch((err) => setError(err.message));
    }, 200);
    return () => clearTimeout(timer);
  }, [user, query, selected]);

  function toggleTag(tag) {
    setSelected((s) => (s.includes(tag) ? s.filter((x) => x !== tag) : [...s, tag]));
  }

  if (!user) return null;

  return (
    <AppShell user={user}>
      <header>
        <h1 className="font-mono-display text-3xl font-semibold tracking-tight">{t("brw.title")}</h1>
        <p className="mt-2 text-sm text-[var(--text-muted)]">{t("brw.subtitle")}</p>
      </header>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("brw.searchPh")}
        className="mt-6 w-full max-w-md rounded-sm border border-[var(--line)] bg-[var(--bg-panel)] px-4 py-3 text-sm text-[var(--text)] outline-none transition placeholder:text-[var(--text-muted)]/50 focus:border-[var(--text-muted)]"
      />

      {/* Keyword filter chips */}
      {keywords.length > 0 && (
        <div className="mt-4">
          <div className="flex flex-wrap items-center gap-2">
            {keywords.map((k) => {
              const on = selected.includes(k.value);
              return (
                <button
                  key={k.value}
                  onClick={() => toggleTag(k.value)}
                  className="rounded-full border px-3 py-1 font-mono-display text-[12px] transition"
                  style={
                    on
                      ? { borderColor: "var(--connect)", background: "color-mix(in srgb, var(--connect) 16%, transparent)", color: "var(--connect)" }
                      : { borderColor: "var(--line)", color: "var(--text-muted)" }
                  }
                >
                  #{k.value}
                  <span className="ml-1.5 opacity-60">{k.count}</span>
                </button>
              );
            })}
            {selected.length > 0 && (
              <button
                onClick={() => setSelected([])}
                className="font-mono-display text-xs text-[var(--text-muted)] underline underline-offset-2 hover:text-[var(--text)]"
              >
                {t("brw.clear")}
              </button>
            )}
          </div>
        </div>
      )}

      {error && <p className="mt-6 text-sm text-red-400">{error}</p>}
      {problems === null && !error && <p className="mt-6 text-sm text-[var(--text-muted)]">{t("common.loading")}</p>}
      {problems && problems.length === 0 && (
        <p className="mt-6 rounded-lg border border-dashed border-[var(--line)] p-10 text-center text-sm text-[var(--text-muted)]">
          {t("brw.empty")}
        </p>
      )}

      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        {problems?.map((p) => (
          <Link
            key={p.id}
            to={`/problems/${p.id}`}
            className="flex flex-col rounded-lg border border-[var(--line)] bg-[var(--bg-panel)] p-6 transition hover:border-[var(--connect)]"
          >
            <div className="flex items-start justify-between gap-3">
              <h3 className="font-mono-display text-lg font-semibold">{p.title}</h3>
              <StatusPill status={p.status} />
            </div>
            <p className="mt-2 flex-1 text-sm leading-relaxed text-[var(--text-muted)] line-clamp-3">{p.description}</p>

            {p.tags.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {p.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-sm px-2 py-1 font-mono-display text-[11px]"
                    style={selected.includes(tag)
                      ? { background: "color-mix(in srgb, var(--connect) 16%, transparent)", color: "var(--connect)" }
                      : { background: "var(--bg)", color: "var(--connect)" }}
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            )}

            <div className="mt-4 flex items-center justify-between border-t border-[var(--line)] pt-3 font-mono-display text-xs text-[var(--text-muted)]">
              <span>{p.company.name}</span>
              {p.compensation && <span className="text-[var(--signal)]">{p.compensation}</span>}
            </div>
          </Link>
        ))}
      </div>
    </AppShell>
  );
}

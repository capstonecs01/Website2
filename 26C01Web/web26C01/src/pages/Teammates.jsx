import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import AppShell from "../components/AppShell";
import { useAuthUser } from "../utils/useAuthUser";
import { apiFetch } from "../utils/api";
import { useLang } from "../i18n/LanguageContext";

export default function Teammates() {
  const user = useAuthUser("student");
  const navigate = useNavigate();
  const { t } = useLang();
  const [query, setQuery] = useState("");
  const [students, setStudents] = useState(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    if (!user) return;
    const term = query.trim();
    const timer = setTimeout(() => {
      apiFetch(`/students${term ? `?q=${encodeURIComponent(term)}` : ""}`)
        .then((d) => setStudents(d.students))
        .catch((err) => setError(err.message));
    }, 200);
    return () => clearTimeout(timer);
  }, [user, query]);

  async function message(id) {
    setBusyId(id);
    try {
      const d = await apiFetch("/chat/dm", { method: "POST", body: { userId: id } });
      navigate(`/messages?c=${d.conversation.id}`);
    } catch (err) {
      setError(err.message);
      setBusyId(null);
    }
  }

  if (!user) return null;

  return (
    <AppShell user={user}>
      <header>
        <h1 className="font-mono-display text-3xl font-semibold tracking-tight">{t("tm.title")}</h1>
        <p className="mt-2 text-sm text-[var(--text-muted)]">{t("tm.subtitle")}</p>
      </header>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("tm.searchPh")}
        className="mt-6 w-full max-w-md rounded-sm border border-[var(--line)] bg-[var(--bg-panel)] px-4 py-3 text-sm text-[var(--text)] outline-none transition placeholder:text-[var(--text-muted)]/50 focus:border-[var(--text-muted)]"
      />

      {error && <p className="mt-6 text-sm text-red-400">{error}</p>}
      {students === null && !error && <p className="mt-6 text-sm text-[var(--text-muted)]">{t("common.loading")}</p>}
      {students && students.length === 0 && (
        <p className="mt-6 rounded-lg border border-dashed border-[var(--line)] p-10 text-center text-sm text-[var(--text-muted)]">
          {t("tm.empty")}
        </p>
      )}

      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {students?.map((s) => (
          <div key={s.id} className="flex flex-col rounded-lg border border-[var(--line)] bg-[var(--bg-panel)] p-5">
            <div className="flex items-center gap-3">
              <span
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full font-mono-display text-sm font-semibold"
                style={{ border: "1px solid var(--connect)", color: "var(--connect)" }}
              >
                {(s.name || "?").split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
              </span>
              <div className="min-w-0">
                <p className="truncate font-mono-display text-sm font-semibold">{s.name}</p>
                <p className="truncate text-xs text-[var(--text-muted)]">
                  {[s.major, s.school].filter(Boolean).join(" · ") || t("common.studentWord")}
                </p>
              </div>
            </div>

            <div className="mt-4 flex items-center gap-2 border-t border-[var(--line)] pt-4">
              <Link
                to={`/users/${s.id}`}
                className="rounded-sm border border-[var(--line)] px-3 py-1.5 font-mono-display text-xs text-[var(--text-muted)] transition hover:border-[var(--text-muted)] hover:text-[var(--text)]"
              >
                {t("tm.viewProfile")}
              </Link>
              <button
                onClick={() => message(s.id)}
                disabled={busyId === s.id}
                className="rounded-sm bg-[var(--connect)] px-3 py-1.5 font-mono-display text-xs font-semibold text-[#0E1116] transition hover:brightness-110 disabled:opacity-50"
              >
                {busyId === s.id ? t("tm.opening") : t("tm.message")}
              </button>
            </div>
          </div>
        ))}
      </div>
    </AppShell>
  );
}

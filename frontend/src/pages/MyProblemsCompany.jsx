import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import AppShell, { StatusPill } from "../components/AppShell";
import { useAuthUser } from "../utils/useAuthUser";
import { apiFetch } from "../utils/api";
import { useLang } from "../i18n/LanguageContext";

export default function MyProblemsCompany() {
  const user = useAuthUser("company");
  const { t } = useLang();
  const [problems, setProblems] = useState(null);
  const [error, setError] = useState("");
  const [confirmId, setConfirmId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  useEffect(() => {
    if (!user) return;
    apiFetch("/problems/mine")
      .then((d) => setProblems(d.problems))
      .catch((err) => setError(err.message));
  }, [user]);

  async function toggleStatus(e, p) {
    e.preventDefault();
    const next = p.status === "open" ? "closed" : "open";
    try {
      await apiFetch(`/problems/${p.id}`, { method: "PATCH", body: { status: next } });
      setProblems((list) => list.map((x) => (x.id === p.id ? { ...x, status: next } : x)));
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(p) {
    setDeletingId(p.id);
    setError("");
    try {
      await apiFetch(`/problems/${p.id}`, { method: "DELETE" });
      setProblems((list) => list.filter((x) => x.id !== p.id));
    } catch (err) {
      setError(err.message);
    } finally {
      setDeletingId(null);
      setConfirmId(null);
    }
  }

  if (!user) return null;

  return (
    <AppShell user={user}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-mono-display text-3xl font-semibold tracking-tight">{t("myp.title")}</h1>
          <p className="mt-2 text-sm text-[var(--text-muted)]">{t("myp.subtitle")}</p>
        </div>
        <Link
          to="/dashboard/company/new"
          className="rounded-sm bg-[var(--signal)] px-5 py-3 font-mono-display text-sm font-semibold text-[#0E1116] transition hover:brightness-110"
        >
          {t("dash.co.postBtn")}
        </Link>
      </div>

      {error && <p className="mt-6 text-sm text-red-400">{error}</p>}
      {problems === null && !error && <p className="mt-6 text-sm text-[var(--text-muted)]">{t("common.loading")}</p>}

      {problems && problems.length === 0 && (
        <div className="mt-6 rounded-lg border border-dashed border-[var(--line)] p-10 text-center">
          <p className="text-sm text-[var(--text-muted)]">{t("dash.co.empty")}</p>
        </div>
      )}

      <div className="mt-6 flex flex-col gap-4">
        {problems?.map((p) => (
          <div key={p.id} className="rounded-lg border border-[var(--line)] bg-[var(--bg-panel)] p-6">
            <div className="flex items-center gap-3">
              <h3 className="font-mono-display text-lg font-semibold">{p.title}</h3>
              <StatusPill status={p.status} />
            </div>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--text-muted)] line-clamp-2">
              {p.description}
            </p>

            {p.tags.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {p.tags.map((tag) => (
                  <span key={tag} className="rounded-sm bg-[var(--bg)] px-2 py-1 font-mono-display text-[11px] text-[var(--text-muted)]">
                    #{tag}
                  </span>
                ))}
              </div>
            )}

            <div className="mt-5 flex flex-wrap items-center gap-4 border-t border-[var(--line)] pt-4">
              <Link
                to={`/projects/${p.id}`}
                className="rounded-sm bg-[var(--signal)] px-4 py-2 font-mono-display text-sm font-semibold text-[#0E1116] transition hover:brightness-110"
              >
                {t("myp.openProject")}
              </Link>
              <Link
                to={`/dashboard/company/problems/${p.id}/proposals`}
                className="rounded-sm border border-[var(--signal)] px-4 py-2 font-mono-display text-sm font-semibold text-[var(--signal)] transition hover:bg-[var(--signal)] hover:text-[#0E1116]"
              >
                {t("myp.viewProposals", { n: p.proposalCount })}
              </Link>
              <button
                onClick={(e) => toggleStatus(e, p)}
                className="font-mono-display text-sm text-[var(--text-muted)] transition hover:text-[var(--text)]"
              >
                {p.status === "open" ? t("myp.close") : t("myp.reopen")}
              </button>
              <button
                onClick={() => setConfirmId(p.id)}
                className="font-mono-display text-sm text-red-400/80 transition hover:text-red-400"
              >
                {t("common.delete")}
              </button>
              <span className="ml-auto font-mono-display text-xs text-[var(--text-muted)]">
                {t("myp.posted", { date: new Date(p.createdAt + "Z").toLocaleDateString() })}
              </span>
            </div>

            {confirmId === p.id && (
              <div className="mt-3 flex flex-wrap items-center gap-3 rounded-sm border border-red-400/40 bg-red-400/5 p-3">
                <span className="text-sm text-[var(--text-muted)]">{t("myp.confirm", { title: p.title })}</span>
                <button
                  onClick={() => remove(p)}
                  disabled={deletingId === p.id}
                  className="ml-auto rounded-sm bg-red-400 px-4 py-1.5 font-mono-display text-xs font-semibold text-[#0E1116] transition hover:brightness-110 disabled:opacity-50"
                >
                  {deletingId === p.id ? t("myp.deleting") : t("myp.yesDelete")}
                </button>
                <button
                  onClick={() => setConfirmId(null)}
                  className="font-mono-display text-xs text-[var(--text-muted)] transition hover:text-[var(--text)]"
                >
                  {t("common.cancel")}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </AppShell>
  );
}

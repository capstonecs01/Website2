import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import AppShell, { StatusPill } from "../components/AppShell";
import { useAuthUser } from "../utils/useAuthUser";
import { apiFetch, API_BASE_URL } from "../utils/api";
import TranslateProposalButton from "../components/TranslateProposalButton";
import { useLang } from "../i18n/LanguageContext";

const FILTERS = ["all", "pending", "accepted", "rejected"];

export default function ProposalsCompany() {
  const user = useAuthUser("company");
  const { t } = useLang();
  const [proposals, setProposals] = useState(null);
  const [filter, setFilter] = useState("all");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) return;
    apiFetch("/proposals/received")
      .then((d) => setProposals(d.proposals))
      .catch((err) => setError(err.message));
  }, [user]);

  async function decide(id, status) {
    try {
      await apiFetch(`/proposals/${id}`, { method: "PATCH", body: { status } });
      setProposals((list) => list.map((p) => (p.id === id ? { ...p, status } : p)));
    } catch (err) {
      setError(err.message);
    }
  }

  const counts = useMemo(() => {
    const c = { all: proposals?.length ?? 0, pending: 0, accepted: 0, rejected: 0 };
    proposals?.forEach((p) => (c[p.status] = (c[p.status] || 0) + 1));
    return c;
  }, [proposals]);

  const shown = proposals?.filter((p) => filter === "all" || p.status === filter) ?? [];
  const filterLabel = (f) => (f === "all" ? t("prop.filterAll") : t("status." + f));

  if (!user) return null;

  return (
    <AppShell user={user}>
      <header className="mb-6">
        <h1 className="font-mono-display text-3xl font-semibold tracking-tight">{t("prop.title")}</h1>
        <p className="mt-2 text-sm text-[var(--text-muted)]">{t("prop.subtitle")}</p>
      </header>

      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className="rounded-sm border px-3 py-1.5 font-mono-display text-xs transition"
            style={
              filter === f
                ? { borderColor: "var(--signal)", color: "var(--signal)" }
                : { borderColor: "var(--line)", color: "var(--text-muted)" }
            }
          >
            {filterLabel(f)} ({counts[f] ?? 0})
          </button>
        ))}
      </div>

      {proposals === null && !error && <p className="mt-6 text-sm text-[var(--text-muted)]">{t("common.loading")}</p>}
      {proposals && shown.length === 0 && (
        <p className="mt-6 rounded-lg border border-dashed border-[var(--line)] p-10 text-center text-sm text-[var(--text-muted)]">
          {t("prop.empty")}
        </p>
      )}

      <div className="mt-6 flex flex-col gap-4">
        {shown.map((p) => (
          <div key={p.id} className="rounded-lg border border-[var(--line)] bg-[var(--bg-panel)] p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <Link
                  to={`/dashboard/company/problems/${p.problemId}/proposals`}
                  className="font-mono-display text-xs text-[var(--text-muted)] hover:text-[var(--text)]"
                >
                  {p.problemTitle} →
                </Link>
                <h3 className="mt-1 font-mono-display text-base font-semibold">
                  {p.student?.id ? (
                    <Link to={`/users/${p.student.id}`} className="transition hover:underline underline-offset-2">
                      {p.student.name}
                    </Link>
                  ) : (
                    p.student?.name
                  )}
                  {p.student?.major && (
                    <span className="ml-2 font-normal text-[var(--text-muted)]">
                      · {p.student.major}{p.student.school ? `, ${p.student.school}` : ""}
                    </span>
                  )}
                </h3>
              </div>
              <StatusPill status={p.status} />
            </div>

            {p.file && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <a
                  href={`${API_BASE_URL}${p.file.url}`}
                  target="_blank"
                  rel="noreferrer"
                  download={p.file.name}
                  className="inline-flex items-center gap-2 rounded-sm border border-[var(--connect)] px-3 py-1.5 font-mono-display text-xs font-semibold text-[var(--connect)] transition hover:bg-[var(--connect)] hover:text-[#0E1116]"
                >
                  ↓ {p.file.name}
                </a>
                <TranslateProposalButton proposalId={p.id} fileName={p.file.name} accent="var(--signal)" />
              </div>
            )}
            {p.approach && <p className="mt-3 text-sm leading-relaxed text-[var(--text-muted)]">{p.approach}</p>}

            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 font-mono-display text-xs text-[var(--text-muted)]">
              {p.teamMembers && <span>{t("prop.teamLabel")}: {p.teamMembers}</span>}
              {p.timeline && <span>{t("prop.timelineLabel")}: {p.timeline}</span>}
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-[var(--line)] pt-4">
              <button
                onClick={() => decide(p.id, "accepted")}
                disabled={p.status === "accepted"}
                className="rounded-sm bg-[var(--connect)] px-4 py-2 font-mono-display text-sm font-semibold text-[#0E1116] transition hover:brightness-110 disabled:opacity-40"
              >
                {t("prop.accept")}
              </button>
              <button
                onClick={() => decide(p.id, "rejected")}
                disabled={p.status === "rejected"}
                className="rounded-sm border border-[var(--line)] px-4 py-2 font-mono-display text-sm text-[var(--text-muted)] transition hover:border-red-400 hover:text-red-400 disabled:opacity-40"
              >
                {t("prop.reject")}
              </button>
              {p.status !== "pending" && (
                <button
                  onClick={() => decide(p.id, "pending")}
                  className="font-mono-display text-xs text-[var(--text-muted)] transition hover:text-[var(--text)]"
                >
                  {t("prop.reset")}
                </button>
              )}
              <a
                href={`mailto:${p.student?.email}`}
                className="ml-auto font-mono-display text-xs text-[var(--text-muted)] hover:text-[var(--text)]"
              >
                {p.student?.email}
              </a>
            </div>
          </div>
        ))}
      </div>
    </AppShell>
  );
}

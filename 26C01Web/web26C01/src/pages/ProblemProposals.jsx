import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import AppShell, { StatusPill } from "../components/AppShell";
import { useAuthUser } from "../utils/useAuthUser";
import { apiFetch, API_BASE_URL } from "../utils/api";
import TranslateProposalButton from "../components/TranslateProposalButton";
import { useLang } from "../i18n/LanguageContext";

export default function ProblemProposals() {
  const user = useAuthUser("company");
  const { id } = useParams();
  const { t } = useLang();
  const [problem, setProblem] = useState(null);
  const [proposals, setProposals] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) return;
    Promise.all([apiFetch(`/problems/${id}`), apiFetch(`/problems/${id}/proposals`)])
      .then(([p, pr]) => {
        setProblem(p.problem);
        setProposals(pr.proposals);
      })
      .catch((err) => setError(err.message));
  }, [user, id]);

  async function decide(proposalId, status) {
    try {
      await apiFetch(`/proposals/${proposalId}`, { method: "PATCH", body: { status } });
      setProposals((list) => list.map((x) => (x.id === proposalId ? { ...x, status } : x)));
    } catch (err) {
      setError(err.message);
    }
  }

  if (!user) return null;

  return (
    <AppShell user={user}>
      <Link to="/dashboard/company" className="font-mono-display text-xs text-[var(--text-muted)] hover:text-[var(--text)]">
        {t("prop.back")}
      </Link>

      {error && <p className="mt-6 text-sm text-red-400">{error}</p>}

      {problem && (
        <div className="mt-4">
          <div className="flex items-center gap-3">
            <h1 className="font-mono-display text-2xl font-semibold tracking-tight">{problem.title}</h1>
            <StatusPill status={problem.status} />
          </div>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--text-muted)]">{problem.description}</p>
        </div>
      )}

      <h2 className="mt-10 font-mono-display text-sm tracking-widest text-[var(--text-muted)]">
        {t("prop.heading")} {proposals ? `(${proposals.length})` : ""}
      </h2>

      {proposals === null && !error && <p className="mt-6 text-sm text-[var(--text-muted)]">{t("common.loading")}</p>}

      {proposals && proposals.length === 0 && (
        <p className="mt-6 rounded-sm border border-dashed border-[var(--line)] p-10 text-center text-sm text-[var(--text-muted)]">
          {t("prop.ppEmpty")}
        </p>
      )}

      <div className="mt-6 flex flex-col gap-4">
        {proposals?.map((pr) => (
          <div key={pr.id} className="rounded-sm border border-[var(--line)] bg-[var(--bg-panel)] p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-3">
                  <h3 className="font-mono-display text-base font-semibold">
                    <Link to={`/users/${pr.student.id}`} className="transition hover:underline underline-offset-2">
                      {pr.student.name}
                    </Link>
                  </h3>
                  <StatusPill status={pr.status} />
                </div>
                <p className="mt-1 font-mono-display text-xs text-[var(--text-muted)]">
                  {[pr.student.school, pr.student.major].filter(Boolean).join(" · ")}
                  {pr.student.email ? ` · ${pr.student.email}` : ""}
                </p>
              </div>
              <span className="font-mono-display text-xs text-[var(--text-muted)]">
                {new Date(pr.createdAt + "Z").toLocaleDateString()}
              </span>
            </div>

            <div className="mt-4 space-y-3 text-sm leading-relaxed">
              {pr.file && (
                <div>
                  <p className="font-mono-display text-xs text-[var(--text-muted)]">{t("prop.fileLabel")}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <a
                      href={`${API_BASE_URL}${pr.file.url}`}
                      target="_blank"
                      rel="noreferrer"
                      download={pr.file.name}
                      className="inline-flex items-center gap-2 rounded-sm border border-[var(--connect)] px-3 py-1.5 font-mono-display text-xs font-semibold text-[var(--connect)] transition hover:bg-[var(--connect)] hover:text-[#0E1116]"
                    >
                      ↓ {pr.file.name}
                    </a>
                    <TranslateProposalButton proposalId={pr.id} fileName={pr.file.name} accent="var(--signal)" />
                  </div>
                </div>
              )}
              {pr.approach && (
                <div>
                  <p className="font-mono-display text-xs text-[var(--text-muted)]">{pr.file ? t("prop.noteLabel") : t("prop.approachLabel")}</p>
                  <p className="mt-1 whitespace-pre-wrap text-[var(--text)]">{pr.approach}</p>
                </div>
              )}
              {pr.timeline && (
                <div>
                  <p className="font-mono-display text-xs text-[var(--text-muted)]">{t("prop.timelineUpper")}</p>
                  <p className="mt-1 text-[var(--text)]">{pr.timeline}</p>
                </div>
              )}
              {(pr.members?.length > 0 || pr.teamMembers) && (
                <div>
                  <p className="font-mono-display text-xs text-[var(--text-muted)]">{t("prop.teamUpper")}</p>
                  {pr.members?.length > 0 ? (
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      <Link
                        to={`/users/${pr.student.id}`}
                        className="rounded-sm bg-[var(--bg)] px-2 py-1 font-mono-display text-[11px] text-[var(--connect)] transition hover:underline underline-offset-2"
                      >
                        {pr.student.name} {t("prop.lead")}
                      </Link>
                      {pr.members.map((m) => (
                        <Link
                          key={m.id}
                          to={`/users/${m.id}`}
                          className="rounded-sm bg-[var(--bg)] px-2 py-1 font-mono-display text-[11px] text-[var(--text-muted)] transition hover:text-[var(--text)] hover:underline underline-offset-2"
                        >
                          {m.name}
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-1 text-[var(--text)]">{pr.teamMembers}</p>
                  )}
                </div>
              )}
            </div>

            <div className="mt-5 flex flex-wrap gap-3 border-t border-[var(--line)] pt-4">
              <button
                onClick={() => decide(pr.id, "accepted")}
                disabled={pr.status === "accepted"}
                className="rounded-sm bg-[var(--connect)] px-4 py-2 font-mono-display text-sm font-semibold text-[#0E1116] transition hover:brightness-110 disabled:opacity-40"
              >
                {t("prop.accept")}
              </button>
              <button
                onClick={() => decide(pr.id, "rejected")}
                disabled={pr.status === "rejected"}
                className="rounded-sm border border-[var(--line)] px-4 py-2 font-mono-display text-sm text-[var(--text-muted)] transition hover:border-[var(--text-muted)] hover:text-[var(--text)] disabled:opacity-40"
              >
                {t("prop.reject")}
              </button>
              {pr.status !== "pending" && (
                <button
                  onClick={() => decide(pr.id, "pending")}
                  className="font-mono-display text-sm text-[var(--text-muted)] transition hover:text-[var(--text)]"
                >
                  {t("prop.reset")}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </AppShell>
  );
}

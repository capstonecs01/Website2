import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import AppShell, { StatusPill } from "../components/AppShell";
import { useAuthUser } from "../utils/useAuthUser";
import { apiFetch } from "../utils/api";
import { useLang } from "../i18n/LanguageContext";

export default function StudentWork() {
  const user = useAuthUser("student");
  const { t } = useLang();
  const [proposals, setProposals] = useState(null);
  const [error, setError] = useState("");

  // A student's projects, derived from proposal status:
  //   accepted -> active project you're working on
  //   pending  -> awaiting a company decision
  //   rejected -> past / not selected
  const SECTIONS = [
    { key: "accepted", title: t("wrk.activeTitle"), blurb: t("wrk.activeBlurb"), accent: "var(--connect)" },
    { key: "pending", title: t("wrk.pendingTitle"), blurb: t("wrk.pendingBlurb"), accent: "var(--signal)" },
    { key: "rejected", title: t("wrk.pastTitle"), blurb: t("wrk.pastBlurb"), accent: "var(--text-muted)" },
  ];

  useEffect(() => {
    if (!user) return;
    apiFetch("/proposals/mine")
      .then((d) => setProposals(d.proposals))
      .catch((err) => setError(err.message));
  }, [user]);

  if (!user) return null;

  return (
    <AppShell user={user}>
      <header className="mb-8">
        <h1 className="font-mono-display text-3xl font-semibold tracking-tight">{t("wrk.title")}</h1>
        <p className="mt-2 text-sm text-[var(--text-muted)]">{t("wrk.subtitle")}</p>
      </header>

      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}
      {proposals === null && !error && <p className="text-sm text-[var(--text-muted)]">{t("common.loading")}</p>}

      {proposals && proposals.length === 0 && (
        <div className="rounded-lg border border-dashed border-[var(--line)] p-10 text-center">
          <p className="text-sm text-[var(--text-muted)]">{t("wrk.empty")}</p>
          <Link
            to="/problems"
            className="mt-4 inline-block rounded-sm bg-[var(--connect)] px-5 py-2.5 font-mono-display text-sm font-semibold text-[#0E1116] transition hover:brightness-110"
          >
            {t("dash.st.browseBtn")}
          </Link>
        </div>
      )}

      {proposals && proposals.length > 0 && (
        <div className="flex flex-col gap-10">
          {SECTIONS.map((sec) => {
            const items = proposals.filter((p) => p.status === sec.key);
            if (items.length === 0) return null;
            return (
              <section key={sec.key}>
                <div className="flex items-center gap-3">
                  <span className="h-2 w-2 rounded-full" style={{ background: sec.accent }} />
                  <h2 className="font-mono-display text-sm font-semibold tracking-widest" style={{ color: sec.accent }}>
                    {sec.title.toUpperCase()}
                  </h2>
                  <span className="font-mono-display text-xs text-[var(--text-muted)]">({items.length})</span>
                </div>
                <p className="mt-1 ml-5 text-xs text-[var(--text-muted)]">{sec.blurb}</p>

                <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                  {items.map((pr) => (
                    <Link
                      key={pr.id}
                      to={sec.key === "accepted" ? `/projects/${pr.problemId}` : `/problems/${pr.problemId}`}
                      className="flex flex-col rounded-lg border border-[var(--line)] bg-[var(--bg-panel)] p-5 transition"
                      style={{ borderLeft: `3px solid ${sec.accent}` }}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="font-mono-display text-base font-semibold">
                          {pr.problemTitle}
                          {pr.role === "member" && (
                            <span className="ml-2 rounded-sm border border-[var(--line)] px-1.5 py-0.5 align-middle text-[9px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                              {t("wrk.teammate")}
                            </span>
                          )}
                        </h3>
                        <StatusPill status={pr.status} />
                      </div>
                      <p className="mt-2 flex-1 text-sm leading-relaxed text-[var(--text-muted)] line-clamp-3">
                        {pr.approach || (pr.file ? `📎 ${pr.file.name}` : "")}
                      </p>
                      <div className="mt-4 flex items-center justify-between border-t border-[var(--line)] pt-3 font-mono-display text-xs text-[var(--text-muted)]">
                        {pr.teamMembers ? <span className="truncate">{pr.teamMembers}</span> : <span />}
                        <span>{new Date(pr.createdAt + "Z").toLocaleDateString()}</span>
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}

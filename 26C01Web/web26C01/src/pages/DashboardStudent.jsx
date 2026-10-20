import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import AppShell, { StatusPill } from "../components/AppShell";
import StatCard from "../components/StatCard";
import QuickAction from "../components/QuickAction";
import { useAuthUser } from "../utils/useAuthUser";
import { apiFetch } from "../utils/api";
import { useLang } from "../i18n/LanguageContext";

const ACCENT = "var(--connect)";

const I = {
  send: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>,
  work: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>,
  clock: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>,
  search: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
  chat: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.5 9.5 0 0 1-4-.9L3 20l1.3-3.8A8.2 8.2 0 0 1 3 11.5a8.4 8.4 0 0 1 9-8.4 8.4 8.4 0 0 1 9 8.4z"/></svg>,
};

export default function DashboardStudent() {
  const user = useAuthUser("student");
  const { t } = useLang();
  const [proposals, setProposals] = useState(null);
  const [openCount, setOpenCount] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) return;
    Promise.all([apiFetch("/proposals/mine"), apiFetch("/problems")])
      .then(([a, b]) => {
        setProposals(a.proposals);
        setOpenCount(b.problems.length);
      })
      .catch((err) => setError(err.message));
  }, [user]);

  if (!user) return null;

  const active = proposals?.filter((p) => p.status === "accepted").length ?? 0;
  const pending = proposals?.filter((p) => p.status === "pending").length ?? 0;
  const recent = proposals?.slice(0, 4) ?? [];

  return (
    <AppShell user={user}>
      <header className="mb-8">
        <h1 className="font-mono-display text-3xl font-semibold tracking-tight">
          {t("dash.st.welcome", { name: user.fullName })}
        </h1>
        <p className="mt-2 text-sm text-[var(--text-muted)]">{t("dash.st.subtitle")}</p>
      </header>

      {error && <p className="mb-6 text-sm text-red-400">{error}</p>}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label={t("dash.st.proposalsSent")} value={proposals?.length ?? "—"} accent={ACCENT} icon={I.send} />
        <StatCard label={t("dash.st.activeProjects")} value={active} accent="var(--signal)" icon={I.work} />
        <StatCard label={t("dash.st.pending")} value={pending} accent={ACCENT} icon={I.clock} />
        <StatCard label={t("dash.st.openProblems")} value={openCount ?? "—"} accent="var(--signal)" icon={I.search} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
        <QuickAction
          to="/problems"
          title={t("app.browse")}
          description={t("dash.st.browseDesc")}
          accent={ACCENT}
          icon={I.search}
          filled
        />
        <QuickAction
          to="/dashboard/student/work"
          title={t("app.myWork")}
          description={t("dash.st.workDesc")}
          badge={active ? t("dash.st.active", { n: active }) : undefined}
          accent="var(--signal)"
          icon={I.work}
        />
        <QuickAction
          to="/messages"
          title={t("app.messages")}
          description={t("dash.st.messagesDesc")}
          accent={ACCENT}
          icon={I.chat}
        />
      </div>

      <div className="mt-10 flex items-center justify-between">
        <h2 className="font-mono-display text-sm font-semibold tracking-widest text-[var(--text-muted)]">
          {t("dash.st.recent")}
        </h2>
        <Link to="/dashboard/student/work" className="font-mono-display text-sm text-[var(--connect)] hover:brightness-110">
          {t("common.viewAll")}
        </Link>
      </div>

      {proposals === null && !error && <p className="mt-6 text-sm text-[var(--text-muted)]">{t("common.loading")}</p>}
      {proposals && proposals.length === 0 && (
        <div className="mt-6 rounded-lg border border-dashed border-[var(--line)] p-10 text-center">
          <p className="text-sm text-[var(--text-muted)]">{t("dash.st.empty")}</p>
          <Link
            to="/problems"
            className="mt-4 inline-block rounded-sm bg-[var(--connect)] px-5 py-2.5 font-mono-display text-sm font-semibold text-[#0E1116] transition hover:brightness-110"
          >
            {t("dash.st.browseBtn")}
          </Link>
        </div>
      )}

      <div className="mt-4 flex flex-col gap-3">
        {recent.map((pr) => (
          <Link
            key={pr.id}
            to={`/problems/${pr.problemId}`}
            className="flex items-center justify-between gap-4 rounded-lg border border-[var(--line)] bg-[var(--bg-panel)] p-5 transition hover:border-[var(--connect)]"
          >
            <div className="min-w-0">
              <h3 className="truncate font-mono-display text-base font-semibold">{pr.problemTitle}</h3>
              <p className="mt-1 truncate text-sm text-[var(--text-muted)]">
                {pr.approach || (pr.file ? `📎 ${pr.file.name}` : "")}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-4">
              <StatusPill status={pr.status} />
              <span className="font-mono-display text-xs text-[var(--text-muted)]">
                {new Date(pr.createdAt + "Z").toLocaleDateString()}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </AppShell>
  );
}

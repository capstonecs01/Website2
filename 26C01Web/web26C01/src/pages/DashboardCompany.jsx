import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import AppShell, { StatusPill } from "../components/AppShell";
import StatCard from "../components/StatCard";
import QuickAction from "../components/QuickAction";
import { useAuthUser } from "../utils/useAuthUser";
import { apiFetch } from "../utils/api";
import { useLang } from "../i18n/LanguageContext";

const ACCENT = "var(--signal)";

// Small SVG helpers for the tiles/actions.
const I = {
  box: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>,
  inbox: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z"/></svg>,
  clock: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>,
  check: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M22 11.1V12a10 10 0 1 1-5.9-9.1"/><polyline points="22 4 12 14.01 9 11.01"/></svg>,
  plus: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
  chat: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.5 9.5 0 0 1-4-.9L3 20l1.3-3.8A8.2 8.2 0 0 1 3 11.5a8.4 8.4 0 0 1 9-8.4 8.4 8.4 0 0 1 9 8.4z"/></svg>,
};

export default function DashboardCompany() {
  const user = useAuthUser("company");
  const { t } = useLang();
  const [problems, setProblems] = useState(null);
  const [received, setReceived] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) return;
    Promise.all([apiFetch("/problems/mine"), apiFetch("/proposals/received")])
      .then(([a, b]) => {
        setProblems(a.problems);
        setReceived(b.proposals);
      })
      .catch((err) => setError(err.message));
  }, [user]);

  if (!user) return null;

  const pending = received?.filter((p) => p.status === "pending").length ?? 0;
  const accepted = received?.filter((p) => p.status === "accepted").length ?? 0;
  const recent = problems?.slice(0, 4) ?? [];

  return (
    <AppShell user={user}>
      <header className="mb-8">
        <h1 className="font-mono-display text-3xl font-semibold tracking-tight">
          {t("dash.co.title", { name: user.companyName || user.fullName })}
        </h1>
        <p className="mt-2 text-sm text-[var(--text-muted)]">{t("dash.co.subtitle")}</p>
      </header>

      {error && <p className="mb-6 text-sm text-red-400">{error}</p>}

      {/* Stat tiles */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label={t("dash.co.problemsPosted")} value={problems?.length ?? "—"} accent={ACCENT} icon={I.box} />
        <StatCard label={t("dash.co.proposalsReceived")} value={received?.length ?? "—"} accent="var(--connect)" icon={I.inbox} />
        <StatCard label={t("dash.co.underReview")} value={pending} accent={ACCENT} icon={I.clock} />
        <StatCard label={t("dash.co.accepted")} value={accepted} accent="var(--connect)" icon={I.check} />
      </div>

      {/* Quick actions */}
      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
        <QuickAction
          to="/dashboard/company/new"
          title={t("dash.co.postTitle")}
          description={t("dash.co.postDesc")}
          accent={ACCENT}
          icon={I.plus}
          filled
        />
        <QuickAction
          to="/dashboard/company/proposals"
          title={t("dash.co.reviewTitle")}
          description={t("dash.co.reviewDesc")}
          badge={pending ? t("dash.co.pending", { n: pending }) : undefined}
          accent="var(--connect)"
          icon={I.inbox}
        />
        <QuickAction
          to="/messages"
          title={t("app.messages")}
          description={t("dash.co.messagesDesc")}
          accent={ACCENT}
          icon={I.chat}
        />
      </div>

      {/* Active problems */}
      <div className="mt-10 flex items-center justify-between">
        <h2 className="font-mono-display text-sm font-semibold tracking-widest text-[var(--text-muted)]">
          {t("dash.co.activeProblems")}
        </h2>
        <Link to="/dashboard/company/problems" className="font-mono-display text-sm text-[var(--signal)] hover:brightness-110">
          {t("common.viewAll")}
        </Link>
      </div>

      {problems === null && !error && <p className="mt-6 text-sm text-[var(--text-muted)]">{t("common.loading")}</p>}
      {problems && problems.length === 0 && (
        <div className="mt-6 rounded-lg border border-dashed border-[var(--line)] p-10 text-center">
          <p className="text-sm text-[var(--text-muted)]">{t("dash.co.empty")}</p>
          <Link
            to="/dashboard/company/new"
            className="mt-4 inline-block rounded-sm bg-[var(--signal)] px-5 py-2.5 font-mono-display text-sm font-semibold text-[#0E1116] transition hover:brightness-110"
          >
            {t("dash.co.postBtn")}
          </Link>
        </div>
      )}

      <div className="mt-4 flex flex-col gap-3">
        {recent.map((p) => (
          <Link
            key={p.id}
            to={`/projects/${p.id}`}
            className="flex flex-wrap items-center gap-4 rounded-lg border border-[var(--line)] bg-[var(--bg-panel)] p-5 transition hover:border-[var(--signal)]"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                {p.tags[0] && (
                  <span className="rounded-sm bg-[var(--bg)] px-2 py-0.5 font-mono-display text-[11px] text-[var(--text-muted)]">
                    {p.tags[0]}
                  </span>
                )}
                <StatusPill status={p.status} />
              </div>
              <h3 className="mt-2 font-mono-display text-base font-semibold">{p.title}</h3>
            </div>
            <div className="flex items-center gap-6 font-mono-display text-xs text-[var(--text-muted)]">
              <span>{t("dash.nProposals", { n: p.proposalCount })}</span>
              <span>{new Date(p.createdAt + "Z").toLocaleDateString()}</span>
              <span className="text-[var(--signal)]">→</span>
            </div>
          </Link>
        ))}
      </div>
    </AppShell>
  );
}

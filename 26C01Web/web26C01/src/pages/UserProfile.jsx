import { useEffect, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import AppShell, { StatusPill } from "../components/AppShell";
import { useAuthUser } from "../utils/useAuthUser";
import { apiFetch } from "../utils/api";
import { useLang } from "../i18n/LanguageContext";

export default function UserProfile() {
  const user = useAuthUser();
  const { id } = useParams();
  const navigate = useNavigate();
  const { t } = useLang();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [messaging, setMessaging] = useState(false);

  useEffect(() => {
    if (!user) return;
    setData(null);
    setError("");
    apiFetch(`/users/${id}`)
      .then(setData)
      .catch((err) => setError(err.message));
  }, [user, id]);

  async function message() {
    setMessaging(true);
    try {
      const d = await apiFetch("/chat/dm", { method: "POST", body: { userId: Number(id) } });
      navigate(`/messages?c=${d.conversation.id}`);
    } catch (err) {
      setError(err.message);
      setMessaging(false);
    }
  }

  if (!user) return null;

  if (error) {
    return (
      <AppShell user={user}>
        <p className="text-sm text-red-400">{error}</p>
      </AppShell>
    );
  }
  if (!data) {
    return (
      <AppShell user={user}>
        <p className="text-sm text-[var(--text-muted)]">{t("common.loading")}</p>
      </AppShell>
    );
  }

  const { profile, projects, problems } = data;
  const isStudent = profile.role === "student";
  const accent = isStudent ? "var(--connect)" : "var(--signal)";
  const canMessage = user.role === "student" && isStudent && profile.id !== user.id;
  const self = profile.id === user.id;

  const active = projects?.filter((p) => p.status === "open") || [];
  const past = projects?.filter((p) => p.status !== "open") || [];

  return (
    <AppShell user={user}>
      {/* Identity header */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-[var(--line)] bg-[var(--bg-panel)] p-6">
        <div className="flex items-center gap-4">
          <span
            className="grid h-16 w-16 shrink-0 place-items-center rounded-full font-mono-display text-xl font-semibold"
            style={{ border: `1px solid ${accent}`, color: accent }}
          >
            {(profile.fullName || "?").split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
          </span>
          <div>
            <h1 className="font-mono-display text-2xl font-semibold tracking-tight">{profile.fullName}</h1>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              {isStudent
                ? [profile.major, profile.school].filter(Boolean).join(" · ") || t("common.studentWord")
                : [profile.jobTitle, profile.companyName].filter(Boolean).join(" · ") || t("common.companyWord")}
            </p>
            <div className="mt-2 flex items-center gap-2">
              <span
                className="rounded-sm px-2 py-0.5 font-mono-display text-[10px] font-semibold uppercase tracking-widest"
                style={{ color: accent, border: `1px solid ${accent}` }}
              >
                {t("app." + profile.role)}
              </span>
              <span className="font-mono-display text-[10px] text-[var(--text-muted)]">
                {t("up.joined", { date: new Date(profile.joinedAt + "Z").toLocaleDateString() })}
              </span>
            </div>
          </div>
        </div>

        {canMessage && (
          <button
            onClick={message}
            disabled={messaging}
            className="rounded-sm px-5 py-2.5 font-mono-display text-sm font-semibold text-[#0E1116] transition hover:brightness-110 disabled:opacity-50"
            style={{ background: accent }}
          >
            {messaging ? t("tm.opening") : t("up.message")}
          </button>
        )}
        {self && (
          <Link to="/profile" className="font-mono-display text-sm text-[var(--text-muted)] hover:text-[var(--text)]">
            {t("up.editProfile")}
          </Link>
        )}
      </div>

      {/* Student: projects */}
      {isStudent && (
        <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-2">
          <ProjectColumn title={t("up.activeTitle")} blurb={t("up.activeBlurb")} items={active} accent={accent} viewerRole={user.role} />
          <ProjectColumn title={t("up.pastTitle")} blurb={t("up.pastBlurb")} items={past} accent="var(--text-muted)" viewerRole={user.role} />
        </div>
      )}

      {/* Company: posted problems */}
      {!isStudent && (
        <div className="mt-8">
          <h2 className="font-mono-display text-sm font-semibold tracking-widest text-[var(--text-muted)]">
            {t("up.postedProblems")} {problems?.length > 0 && <span style={{ color: accent }}>· {problems.length}</span>}
          </h2>
          {(!problems || problems.length === 0) && (
            <p className="mt-4 rounded-lg border border-dashed border-[var(--line)] p-8 text-center text-sm text-[var(--text-muted)]">
              {t("up.noPosted")}
            </p>
          )}
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            {problems?.map((p) => {
              const inner = (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-mono-display text-base font-semibold">{p.title}</h3>
                    <StatusPill status={p.status} />
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-[var(--text-muted)] line-clamp-2">{p.description}</p>
                  <div className="mt-3 flex items-center justify-between font-mono-display text-xs text-[var(--text-muted)]">
                    <span>{p.tags.slice(0, 3).map((tag) => `#${tag}`).join(" ")}</span>
                    <span>{t("dash.nProposals", { n: p.proposalCount })}</span>
                  </div>
                </>
              );
              return user.role === "student" ? (
                <Link key={p.id} to={`/problems/${p.id}`} className="rounded-lg border border-[var(--line)] bg-[var(--bg-panel)] p-5 transition hover:border-[var(--signal)]">
                  {inner}
                </Link>
              ) : (
                <div key={p.id} className="rounded-lg border border-[var(--line)] bg-[var(--bg-panel)] p-5">{inner}</div>
              );
            })}
          </div>
        </div>
      )}
    </AppShell>
  );
}

function ProjectColumn({ title, blurb, items, accent, viewerRole }) {
  const { t } = useLang();
  const roleLabel = (r) => (r === "lead" ? t("prj.roleLead") : t("prj.roleMember"));
  return (
    <section>
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full" style={{ background: accent }} />
        <h2 className="font-mono-display text-sm font-semibold tracking-widest" style={{ color: accent }}>
          {title}
        </h2>
        <span className="font-mono-display text-xs text-[var(--text-muted)]">({items.length})</span>
      </div>
      <p className="mt-1 ml-5 text-xs text-[var(--text-muted)]">{blurb}</p>

      {items.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-[var(--line)] p-6 text-center text-xs text-[var(--text-muted)]">
          {t("up.nothing")}
        </p>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          {items.map((p) => {
            const inner = (
              <>
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-mono-display text-sm font-semibold">{p.title}</h3>
                  <span
                    className="shrink-0 rounded-sm px-1.5 py-0.5 font-mono-display text-[9px] font-semibold uppercase tracking-wider"
                    style={{ color: accent, border: `1px solid ${accent}` }}
                  >
                    {roleLabel(p.role)}
                  </span>
                </div>
                <p className="mt-1 font-mono-display text-xs text-[var(--text-muted)]">{p.company}</p>
              </>
            );
            return viewerRole === "student" ? (
              <Link key={p.problemId} to={`/problems/${p.problemId}`} className="rounded-lg border border-[var(--line)] bg-[var(--bg-panel)] p-4 transition hover:border-[var(--connect)]">
                {inner}
              </Link>
            ) : (
              <div key={p.problemId} className="rounded-lg border border-[var(--line)] bg-[var(--bg-panel)] p-4">{inner}</div>
            );
          })}
        </div>
      )}
    </section>
  );
}

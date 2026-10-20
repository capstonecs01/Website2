import { useEffect, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import AppShell, { StatusPill } from "../components/AppShell";
import { useAuthUser } from "../utils/useAuthUser";
import { apiFetch } from "../utils/api";
import { useLang } from "../i18n/LanguageContext";

export default function ProjectDetail() {
  const user = useAuthUser();
  const { id } = useParams();
  const navigate = useNavigate();
  const { t } = useLang();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) return;
    apiFetch(`/projects/${id}`)
      .then(setData)
      .catch((err) => setError(err.message));
  }, [user, id]);

  if (!user) return null;
  const accent = user.role === "company" ? "var(--signal)" : "var(--connect)";
  const backTo = user.role === "company" ? "/dashboard/company/problems" : "/dashboard/student/work";

  if (error) {
    return (
      <AppShell user={user}>
        <p className="text-sm text-red-400">{error}</p>
        <Link to={backTo} className="mt-4 inline-block font-mono-display text-sm text-[var(--text-muted)] hover:text-[var(--text)]">
          {t("prj.back")}
        </Link>
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

  const { project, team, isOwner, chat } = data;
  const hasTeam = team.length > 0;
  const roleLabel = (r) => (r === "lead" ? t("prj.roleLead") : t("prj.roleMember"));

  return (
    <AppShell user={user}>
      <Link to={backTo} className="font-mono-display text-sm text-[var(--text-muted)] transition hover:text-[var(--text)]">
        {t("prj.back")}
      </Link>

      {/* Header */}
      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono-display text-xs tracking-widest" style={{ color: accent }}>
            {t("prj.eyebrow")}
          </p>
          <h1 className="mt-2 font-mono-display text-3xl font-semibold tracking-tight">{project.title}</h1>
          <p className="mt-2 font-mono-display text-sm text-[var(--text-muted)]">
            {project.company.name} · <StatusPill status={project.status} />
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => chat.projectConversationId && navigate(`/messages?c=${chat.projectConversationId}`)}
            disabled={!chat.projectConversationId}
            className="rounded-sm px-5 py-3 font-mono-display text-sm font-semibold text-[#0E1116] transition hover:brightness-110 disabled:opacity-40"
            style={{ background: accent }}
            title={chat.projectConversationId ? "" : t("prj.chatHint")}
          >
            {t("prj.openChat")}
          </button>
          {chat.teamConversationId && (
            <button
              onClick={() => navigate(`/messages?c=${chat.teamConversationId}`)}
              className="rounded-sm border px-5 py-3 font-mono-display text-sm font-semibold transition hover:brightness-110"
              style={{ borderColor: accent, color: accent }}
            >
              {t("prj.teamChat")}
            </button>
          )}
          {isOwner && (
            <Link
              to={`/dashboard/company/problems/${project.id}/proposals`}
              className="rounded-sm border border-[var(--line)] px-5 py-3 font-mono-display text-sm text-[var(--text-muted)] transition hover:border-[var(--text-muted)] hover:text-[var(--text)]"
            >
              {t("prj.allProposals")}
            </Link>
          )}
        </div>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Details */}
        <div className="lg:col-span-2">
          <div className="rounded-lg border border-[var(--line)] bg-[var(--bg-panel)] p-6">
            <h2 className="font-mono-display text-sm font-semibold tracking-widest text-[var(--text-muted)]">
              {t("prj.overview")}
            </h2>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-[var(--text)]">
              {project.description}
            </p>

            {project.tags.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {project.tags.map((tag) => (
                  <span key={tag} className="rounded-sm bg-[var(--bg)] px-2 py-1 font-mono-display text-[11px]" style={{ color: accent }}>
                    #{tag}
                  </span>
                ))}
              </div>
            )}

            <div className="mt-6 grid grid-cols-2 gap-4 border-t border-[var(--line)] pt-5 sm:grid-cols-4">
              <Meta label={t("pd.skills")} value={project.skills} />
              <Meta label={t("pd.teamSize")} value={project.teamSize} />
              <Meta label={t("pd.timeline")} value={project.timeline} />
              <Meta label={t("pd.compensation")} value={project.compensation} accent={accent} />
            </div>
          </div>
        </div>

        {/* Team */}
        <div>
          <div className="rounded-lg border border-[var(--line)] bg-[var(--bg-panel)] p-6">
            <h2 className="font-mono-display text-sm font-semibold tracking-widest text-[var(--text-muted)]">
              {t("prj.team")} {hasTeam && <span style={{ color: accent }}>· {team.length}</span>}
            </h2>

            {!hasTeam && (
              <p className="mt-3 text-sm text-[var(--text-muted)]">
                {t("prj.noTeam")}{" "}
                {isOwner ? (
                  <Link to={`/dashboard/company/problems/${project.id}/proposals`} className="underline underline-offset-2 hover:text-[var(--text)]">
                    {t("prj.reviewProposals")}
                  </Link>
                ) : (
                  t("prj.appearOnce")
                )}
              </p>
            )}

            <div className="mt-4 flex flex-col gap-4">
              {team.map((m) => (
                <div key={m.id} className="rounded-md border border-[var(--line)] bg-[var(--bg)] p-4">
                  <div className="flex items-center gap-3">
                    <span
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-full font-mono-display text-[11px] font-semibold"
                      style={{ border: `1px solid ${accent}`, color: accent }}
                    >
                      {m.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 truncate font-mono-display text-sm font-semibold">
                        <Link to={`/users/${m.id}`} className="truncate transition hover:underline underline-offset-2">
                          {m.name}
                        </Link>
                        {m.role && (
                          <span
                            className="rounded-sm px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
                            style={
                              m.role === "lead"
                                ? { color: accent, border: `1px solid ${accent}` }
                                : { color: "var(--text-muted)", border: "1px solid var(--line)" }
                            }
                          >
                            {roleLabel(m.role)}
                          </span>
                        )}
                      </p>
                      <p className="truncate text-xs text-[var(--text-muted)]">
                        {[m.major, m.school].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                  </div>
                  {m.approach && (
                    <p className="mt-3 text-xs leading-relaxed text-[var(--text-muted)] line-clamp-3">{m.approach}</p>
                  )}
                  {isOwner && (
                    <a href={`mailto:${m.email}`} className="mt-2 inline-block font-mono-display text-[11px] text-[var(--text-muted)] hover:text-[var(--text)]">
                      {m.email}
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function Meta({ label, value, accent }) {
  return (
    <div>
      <p className="font-mono-display text-[10px] uppercase tracking-widest text-[var(--text-muted)]">{label}</p>
      <p className="mt-1 text-sm" style={accent ? { color: accent } : undefined}>
        {value || <span className="text-[var(--text-muted)]">—</span>}
      </p>
    </div>
  );
}

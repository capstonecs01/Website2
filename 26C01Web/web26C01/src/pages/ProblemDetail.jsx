import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import AppShell, { StatusPill } from "../components/AppShell";
import { useAuthUser } from "../utils/useAuthUser";
import { apiFetch, API_BASE_URL } from "../utils/api";
import { useLang } from "../i18n/LanguageContext";

export default function ProblemDetail() {
  const user = useAuthUser("student");
  const { id } = useParams();
  const { t } = useLang();
  const [problem, setProblem] = useState(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("idle"); // idle | loading | error
  const [formError, setFormError] = useState("");
  const [eligible, setEligible] = useState([]);
  const [selected, setSelected] = useState([]); // teammate ids
  const [approach, setApproach] = useState("");
  const [timeline, setTimeline] = useState("");
  const [file, setFile] = useState(null);
  const [withdrawing, setWithdrawing] = useState(false);

  function load() {
    apiFetch(`/problems/${id}`)
      .then((d) => setProblem(d.problem))
      .catch((err) => setError(err.message));
  }

  useEffect(() => {
    if (!user) return;
    load();
  }, [user, id]);

  const showForm = problem && problem.status === "open" && !problem.myProposal && !problem.memberOf;
  useEffect(() => {
    if (!showForm) return;
    apiFetch(`/problems/${id}/eligible-students`)
      .then((d) => setEligible(d.students))
      .catch(() => {});
  }, [showForm, id]);

  function toggleMember(sid) {
    setSelected((s) => (s.includes(sid) ? s.filter((x) => x !== sid) : [...s, sid]));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!file) {
      setStatus("error");
      setFormError(t("pd.fileRequired"));
      return;
    }
    setStatus("loading");
    setFormError("");
    const form = new FormData();
    form.set("file", file);
    form.set("approach", approach);
    form.set("timeline", timeline);
    form.set("memberIds", JSON.stringify(selected));
    try {
      const { proposal } = await apiFetch(`/problems/${id}/proposals`, { method: "POST", body: form });
      setProblem((p) => ({ ...p, myProposal: proposal }));
      setStatus("idle");
    } catch (err) {
      setStatus("error");
      setFormError(err.message);
    }
  }

  async function withdraw() {
    if (!problem.myProposal) return;
    if (!window.confirm(t("pd.withdrawConfirm"))) return;
    setWithdrawing(true);
    try {
      await apiFetch(`/proposals/${problem.myProposal.id}`, { method: "DELETE" });
      setSelected([]);
      setApproach("");
      setTimeline("");
      setFile(null);
      setProblem((p) => ({ ...p, myProposal: null }));
    } catch (err) {
      setError(err.message);
    } finally {
      setWithdrawing(false);
    }
  }

  if (!user) return null;

  return (
    <AppShell user={user}>
      <Link to="/problems" className="font-mono-display text-xs text-[var(--text-muted)] hover:text-[var(--text)]">
        {t("pd.back")}
      </Link>

      {error && <p className="mt-6 text-sm text-red-400">{error}</p>}
      {!problem && !error && <p className="mt-6 text-sm text-[var(--text-muted)]">{t("common.loading")}</p>}

      {problem && (
        <div className="mt-4 grid grid-cols-1 gap-10 lg:grid-cols-5">
          {/* left: problem detail */}
          <div className="lg:col-span-3">
            <div className="flex items-center gap-3">
              <h1 className="font-mono-display text-2xl font-semibold tracking-tight">{problem.title}</h1>
              <StatusPill status={problem.status} />
            </div>
            <p className="mt-1 font-mono-display text-xs text-[var(--text-muted)]">
              {t("pd.postedBy")}{" "}
              <Link to={`/users/${problem.company.id}`} className="text-[var(--text)] transition hover:underline underline-offset-2">
                {problem.company.name}
              </Link>
            </p>

            <p className="mt-6 whitespace-pre-wrap text-sm leading-relaxed text-[var(--text)]">{problem.description}</p>

            {problem.tags.length > 0 && (
              <div className="mt-6 flex flex-wrap gap-2">
                {problem.tags.map((tag) => (
                  <span key={tag} className="rounded-sm bg-[var(--bg-panel)] px-2 py-1 font-mono-display text-[11px] text-[var(--connect)]">
                    #{tag}
                  </span>
                ))}
              </div>
            )}

            <dl className="mt-8 grid grid-cols-1 gap-px overflow-hidden rounded-sm border border-[var(--line)] bg-[var(--line)] sm:grid-cols-2">
              <Detail label={t("pd.skills")} value={problem.skills} />
              <Detail label={t("pd.teamSize")} value={problem.teamSize} />
              <Detail label={t("pd.timeline")} value={problem.timeline} />
              <Detail label={t("pd.compensation")} value={problem.compensation} accent />
            </dl>

            {problem.template && (
              <div className="mt-6 flex flex-wrap items-center gap-3 rounded-sm border border-[var(--line)] bg-[var(--bg-panel)] p-4">
                <div className="min-w-0">
                  <p className="font-mono-display text-xs text-[var(--text-muted)]">{t("pd.templateLabel")}</p>
                  <p className="mt-0.5 truncate text-sm">{problem.template.name}</p>
                </div>
                <a
                  href={`${API_BASE_URL}${problem.template.url}`}
                  target="_blank"
                  rel="noreferrer"
                  download={problem.template.name}
                  className="ml-auto rounded-sm border border-[var(--connect)] px-4 py-2 font-mono-display text-sm font-semibold text-[var(--connect)] transition hover:bg-[var(--connect)] hover:text-[#0E1116]"
                >
                  {t("pd.downloadTemplate")}
                </a>
              </div>
            )}
          </div>

          {/* right: proposal state */}
          <div className="lg:col-span-2">
            <div className="sticky top-6 rounded-sm border border-[var(--line)] bg-[var(--bg-panel)] p-6">
              {problem.myProposal ? (
                <>
                  <div className="flex items-center gap-3">
                    <p className="font-mono-display text-sm tracking-widest text-[var(--connect)]">{t("pd.yourProposal")}</p>
                    <StatusPill status={problem.myProposal.status} />
                  </div>
                  <p className="mt-3 text-sm text-[var(--text-muted)]">
                    {problem.myProposal.status === "accepted" ? t("pd.acceptedMsg") : t("pd.pendingMsg")}
                  </p>

                  <div className="mt-4 space-y-3 text-sm">
                    {problem.myProposal.file && (
                      <div>
                        <p className="font-mono-display text-xs text-[var(--text-muted)]">{t("pd.fileLabel")}</p>
                        <a
                          href={`${API_BASE_URL}${problem.myProposal.file.url}`}
                          target="_blank"
                          rel="noreferrer"
                          download={problem.myProposal.file.name}
                          className="mt-1 inline-flex items-center gap-2 rounded-sm border border-[var(--line)] px-3 py-1.5 text-xs transition hover:border-[var(--connect)]"
                        >
                          📎 {problem.myProposal.file.name}
                        </a>
                      </div>
                    )}
                    {problem.myProposal.approach && (
                      <div>
                        <p className="font-mono-display text-xs text-[var(--text-muted)]">{t("pd.noteLabel")}</p>
                        <p className="mt-1 whitespace-pre-wrap">{problem.myProposal.approach}</p>
                      </div>
                    )}
                    {problem.myProposal.timeline && (
                      <div>
                        <p className="font-mono-display text-xs text-[var(--text-muted)]">{t("pd.timelineUpper")}</p>
                        <p className="mt-1">{problem.myProposal.timeline}</p>
                      </div>
                    )}
                    <div>
                      <p className="font-mono-display text-xs text-[var(--text-muted)]">{t("pd.teamLabel")}</p>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        <span className="rounded-sm bg-[var(--bg)] px-2 py-1 font-mono-display text-[11px] text-[var(--connect)]">
                          {user.fullName} {t("prop.lead")}
                        </span>
                        {problem.myProposal.members?.map((m) => (
                          <span key={m.id} className="rounded-sm bg-[var(--bg)] px-2 py-1 font-mono-display text-[11px] text-[var(--text-muted)]">
                            {m.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  {problem.myProposal.status === "accepted" ? (
                    <Link
                      to={`/projects/${problem.id}`}
                      className="mt-5 inline-block rounded-sm bg-[var(--connect)] px-4 py-2 font-mono-display text-sm font-semibold text-[#0E1116] transition hover:brightness-110"
                    >
                      {t("pd.openProject")}
                    </Link>
                  ) : (
                    <button
                      onClick={withdraw}
                      disabled={withdrawing}
                      className="mt-5 rounded-sm border border-red-400/60 px-4 py-2 font-mono-display text-sm text-red-400 transition hover:bg-red-400 hover:text-[#0E1116] disabled:opacity-50"
                    >
                      {withdrawing ? t("pd.withdrawing") : t("pd.withdraw")}
                    </button>
                  )}
                </>
              ) : problem.memberOf ? (
                <>
                  <p className="font-mono-display text-sm tracking-widest text-[var(--connect)]">{t("pd.onTeam")}</p>
                  <p className="mt-3 text-sm leading-relaxed text-[var(--text-muted)]">
                    {t("pd.onTeamMsg", { leader: problem.memberOf.leaderName, status: t("status." + problem.memberOf.status) })}
                  </p>
                </>
              ) : problem.status !== "open" ? (
                <p className="text-sm text-[var(--text-muted)]">{t("pd.closed")}</p>
              ) : (
                <>
                  <p className="font-mono-display text-sm tracking-widest text-[var(--connect)]">{t("pd.submit")}</p>
                  <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
                    <label className="flex flex-col gap-2">
                      <span className="font-mono-display text-xs text-[var(--text-muted)]">{t("pd.fileField")}</span>
                      {problem.template && (
                        <a
                          href={`${API_BASE_URL}${problem.template.url}`}
                          target="_blank"
                          rel="noreferrer"
                          download={problem.template.name}
                          className="text-[11px] text-[var(--connect)] underline underline-offset-2 hover:brightness-110"
                        >
                          {t("pd.templateHint", { name: problem.template.name })}
                        </a>
                      )}
                      <input
                        type="file"
                        accept=".doc,.docx,.pdf,.txt,.odt"
                        onChange={(e) => setFile(e.target.files[0] || null)}
                        className="rounded-sm border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text-muted)] outline-none file:mr-3 file:rounded-sm file:border-0 file:bg-[var(--connect)] file:px-3 file:py-1.5 file:font-mono-display file:text-xs file:font-semibold file:text-[#0E1116] hover:file:brightness-110"
                      />
                    </label>
                    <label className="flex flex-col gap-2">
                      <span className="font-mono-display text-xs text-[var(--text-muted)]">{t("pd.noteField")}</span>
                      <textarea
                        value={approach}
                        onChange={(e) => setApproach(e.target.value)}
                        rows={3}
                        placeholder={t("pd.notePh")}
                        className="resize-y rounded-sm border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-sm outline-none transition placeholder:text-[var(--text-muted)]/50 focus:border-[var(--text-muted)]"
                      />
                    </label>
                    <label className="flex flex-col gap-2">
                      <span className="font-mono-display text-xs text-[var(--text-muted)]">{t("pd.timelineField")}</span>
                      <input
                        value={timeline}
                        onChange={(e) => setTimeline(e.target.value)}
                        type="text"
                        placeholder={t("pd.timelinePh")}
                        className="rounded-sm border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-sm outline-none transition placeholder:text-[var(--text-muted)]/50 focus:border-[var(--text-muted)]"
                      />
                    </label>

                    <div className="flex flex-col gap-2">
                      <span className="font-mono-display text-xs text-[var(--text-muted)]">
                        {t("pd.addTeammates")} {selected.length > 0 && <span className="text-[var(--connect)]">· {t("pd.selected", { n: selected.length })}</span>}
                      </span>
                      <p className="text-[11px] leading-relaxed text-[var(--text-muted)]/80">{t("pd.teammateHint")}</p>
                      {eligible.length === 0 ? (
                        <p className="rounded-sm border border-dashed border-[var(--line)] px-3 py-2 text-[11px] text-[var(--text-muted)]">
                          {t("pd.noEligible")}
                        </p>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {eligible.map((s) => {
                            const on = selected.includes(s.id);
                            return (
                              <button
                                key={s.id}
                                type="button"
                                onClick={() => toggleMember(s.id)}
                                title={[s.major, s.school].filter(Boolean).join(" · ")}
                                className="rounded-full border px-2.5 py-1 font-mono-display text-[11px] transition"
                                style={
                                  on
                                    ? { borderColor: "var(--connect)", background: "color-mix(in srgb, var(--connect) 16%, transparent)", color: "var(--connect)" }
                                    : { borderColor: "var(--line)", color: "var(--text-muted)" }
                                }
                              >
                                {on ? "✓ " : "+ "}
                                {s.name}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {status === "error" && <p className="text-sm text-red-400">{formError}</p>}

                    <button
                      type="submit"
                      disabled={status === "loading"}
                      className="rounded-sm bg-[var(--connect)] px-5 py-3 font-mono-display text-sm font-semibold text-[#0E1116] transition hover:brightness-110 disabled:opacity-60"
                    >
                      {status === "loading" ? t("pd.submitting") : t("pd.submitBtn")}
                    </button>
                  </form>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

function Detail({ label, value, accent }) {
  return (
    <div className="bg-[var(--bg-panel)] p-4">
      <dt className="font-mono-display text-[11px] uppercase tracking-widest text-[var(--text-muted)]">{label}</dt>
      <dd className="mt-1 text-sm" style={accent ? { color: "var(--signal)" } : undefined}>
        {value || <span className="text-[var(--text-muted)]">—</span>}
      </dd>
    </div>
  );
}

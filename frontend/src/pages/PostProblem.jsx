import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import AppShell from "../components/AppShell";
import KeywordPicker from "../components/KeywordPicker";
import { useAuthUser } from "../utils/useAuthUser";
import { apiFetch } from "../utils/api";
import { useLang } from "../i18n/LanguageContext";

export default function PostProblem() {
  const user = useAuthUser("company");
  const navigate = useNavigate();
  const { t } = useLang();
  const [status, setStatus] = useState("idle"); // idle | loading | error
  const [errorMessage, setErrorMessage] = useState("");
  const [tags, setTags] = useState([]);
  const [suggestions, setSuggestions] = useState([]);

  useEffect(() => {
    if (!user) return;
    apiFetch("/keywords")
      .then((d) => setSuggestions(d.keywords.map((k) => k.value)))
      .catch(() => {});
  }, [user]);

  if (!user) return null;

  async function handleSubmit(e) {
    e.preventDefault();
    setStatus("loading");
    setErrorMessage("");

    const f = new FormData(e.target);
    f.set("tags", tags.join(","));

    try {
      await apiFetch("/problems", { method: "POST", body: f });
      navigate("/dashboard/company");
    } catch (err) {
      setStatus("error");
      setErrorMessage(err.message);
    }
  }

  return (
    <AppShell user={user}>
      <div className="mb-8">
        <p className="font-mono-display text-sm tracking-widest text-[var(--signal)]">{t("post.eyebrow")}</p>
        <h1 className="mt-2 font-mono-display text-3xl font-semibold tracking-tight">{t("post.title")}</h1>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-[var(--text-muted)]">{t("post.subtitle")}</p>
      </div>

      <form onSubmit={handleSubmit} className="grid max-w-2xl grid-cols-1 gap-5">
        <Field id="title" label={t("post.fTitle")} required placeholder={t("post.fTitlePh")} />
        <Field id="description" label={t("post.fDesc")} required textarea placeholder={t("post.fDescPh")} />
        <label className="flex flex-col gap-2">
          <span className="font-mono-display text-xs text-[var(--text-muted)]">
            {t("post.fKeywords")}
            <span className="ml-2 normal-case opacity-70">({t("post.fKeywordsHint")})</span>
          </span>
          <KeywordPicker
            value={tags}
            onChange={setTags}
            suggestions={suggestions}
            accent="var(--signal)"
            placeholder={t("post.fKeywordsPh")}
          />
        </label>
        <Field id="skills" label={t("post.fSkills")} placeholder={t("post.fSkillsPh")} />

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Field id="teamSize" label={t("post.fTeam")} placeholder={t("post.fTeamPh")} />
          <Field id="timeline" label={t("post.fTimeline")} placeholder={t("post.fTimelinePh")} />
        </div>

        <Field id="compensation" label={t("post.fComp")} placeholder={t("post.fCompPh")} />

        <label className="flex flex-col gap-2">
          <span className="font-mono-display text-xs text-[var(--text-muted)]">
            {t("post.fTemplate")}
            <span className="ml-2 normal-case opacity-70">({t("post.fTemplateHint")})</span>
          </span>
          <input
            type="file"
            name="template"
            accept=".doc,.docx,.pdf,.txt,.odt"
            className="rounded-sm border border-[var(--line)] bg-[var(--bg-panel)] px-4 py-2.5 text-sm text-[var(--text-muted)] outline-none transition file:mr-3 file:rounded-sm file:border-0 file:bg-[var(--signal)] file:px-3 file:py-1.5 file:font-mono-display file:text-xs file:font-semibold file:text-[#0E1116] hover:file:brightness-110"
          />
        </label>

        {status === "error" && <p className="text-sm text-red-400">{errorMessage}</p>}

        <div className="mt-2 flex items-center gap-4">
          <button
            type="submit"
            disabled={status === "loading"}
            className="rounded-sm bg-[var(--signal)] px-6 py-3 font-mono-display text-sm font-semibold text-[#0E1116] transition hover:brightness-110 disabled:opacity-60"
          >
            {status === "loading" ? t("post.posting") : t("post.submit")}
          </button>
          <Link to="/dashboard/company" className="font-mono-display text-sm text-[var(--text-muted)] hover:text-[var(--text)]">
            {t("common.cancel")}
          </Link>
        </div>
      </form>
    </AppShell>
  );
}

function Field({ id, label, hint, required, textarea, placeholder }) {
  return (
    <label htmlFor={id} className="flex flex-col gap-2">
      <span className="font-mono-display text-xs text-[var(--text-muted)]">
        {label}
        {hint && <span className="ml-2 normal-case text-[var(--text-muted)] opacity-70">({hint})</span>}
      </span>
      {textarea ? (
        <textarea
          id={id}
          name={id}
          required={required}
          rows={5}
          placeholder={placeholder}
          className="resize-y rounded-sm border border-[var(--line)] bg-[var(--bg-panel)] px-4 py-3 text-sm text-[var(--text)] outline-none transition placeholder:text-[var(--text-muted)]/50 focus:border-[var(--text-muted)]"
        />
      ) : (
        <input
          id={id}
          name={id}
          type="text"
          required={required}
          placeholder={placeholder}
          className="rounded-sm border border-[var(--line)] bg-[var(--bg-panel)] px-4 py-3 text-sm text-[var(--text)] outline-none transition placeholder:text-[var(--text-muted)]/50 focus:border-[var(--text-muted)]"
        />
      )}
    </label>
  );
}

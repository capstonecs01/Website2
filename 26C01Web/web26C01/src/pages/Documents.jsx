import { useCallback, useEffect, useRef, useState } from "react";
import AppShell from "../components/AppShell";
import { useAuthUser } from "../utils/useAuthUser";
import { apiFetch, API_BASE_URL } from "../utils/api";
import { useLang } from "../i18n/LanguageContext";

// Documents: keep PDFs here and translate one whenever you ask for it.

const POLL_MS = 2500;
const KNOWN_STAGES = ["queued", "reading", "analyzing", "translating", "rendering", "reviewing", "done"];
const isActive = (t) => t && (t.status === "queued" || t.status === "running");

// Rough overall progress (0–1) from the translator's stage and page counts.
function progressShare(t) {
  const part = t.total > 0 ? Math.min(1, t.done / t.total) : 0;
  switch (t.stage) {
    case "reading": return 0.06;
    case "analyzing": return 0.14;
    case "translating": return 0.2 + 0.6 * part;
    case "rendering": return 0.82;
    case "reviewing": return 0.85 + 0.13 * part;
    case "done": return 0.98;
    default: return 0.03;
  }
}

function formatSize(bytes) {
  if (!bytes && bytes !== 0) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(sqlDate) {
  return new Date(sqlDate + "Z").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function Documents() {
  const user = useAuthUser();
  const { t: tr } = useLang();
  const [docs, setDocs] = useState(null);
  const [translator, setTranslator] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [d, status] = await Promise.all([apiFetch("/documents"), apiFetch("/documents/translator")]);
      setDocs(d.documents);
      setTranslator(status);
      setError("");
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  const anyActive = !!docs?.some((d) => isActive(d.translation));
  useEffect(() => {
    if (!anyActive) return undefined;
    const timer = setTimeout(load, POLL_MS);
    return () => clearTimeout(timer);
  }, [anyActive, docs, load]);

  if (!user) return null;
  const accent = user.role === "company" ? "var(--signal)" : "var(--connect)";

  function replaceDoc(doc) {
    setDocs((list) => list.map((d) => (d.id === doc.id ? doc : d)));
  }

  return (
    <AppShell user={user}>
      <header className="mb-8">
        <p className="font-mono-display text-sm tracking-widest" style={{ color: accent }}>
          {tr("doc.eyebrow")}
        </p>
        <h1 className="mt-2 font-mono-display text-3xl font-semibold tracking-tight">{tr("doc.title")}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--text-muted)]">{tr("doc.subtitle")}</p>
      </header>

      <TranslatorStatus info={translator} />

      <UploadBox
        accent={accent}
        maxUploadMb={translator?.maxUploadMb}
        onUploaded={(doc) => setDocs((list) => [doc, ...(list || [])])}
      />

      {error && <p className="mt-6 text-sm text-red-400">{error}</p>}
      {docs === null && !error && <p className="mt-8 text-sm text-[var(--text-muted)]">{tr("common.loading")}</p>}

      {docs && docs.length === 0 && (
        <div className="mt-8 rounded-lg border border-dashed border-[var(--line)] p-10 text-center">
          <p className="text-sm text-[var(--text-muted)]">{tr("doc.empty")}</p>
        </div>
      )}

      {docs && docs.length > 0 && (
        <div className="mt-8 flex max-w-3xl flex-col gap-4">
          {docs.map((doc) => (
            <DocumentCard
              key={doc.id}
              doc={doc}
              accent={accent}
              translator={translator}
              onChange={(updated) => {
                replaceDoc(updated);
                load();
              }}
              onDeleted={() => setDocs((list) => list.filter((d) => d.id !== doc.id))}
            />
          ))}
        </div>
      )}
    </AppShell>
  );
}

function TranslatorStatus({ info }) {
  const { t: tr } = useLang();
  if (!info) return null;
  if (!info.available) {
    return (
      <div className="mb-6 max-w-3xl rounded-lg border border-[var(--signal)]/40 bg-[var(--signal)]/5 p-4">
        <p className="text-sm text-[var(--text)]">{tr("doc.notRunning")}</p>
        {info.problem && !info.problem.startsWith("The translator is not running") && (
          <p className="mt-1 text-xs text-[var(--text-muted)]">{info.problem}</p>
        )}
      </div>
    );
  }
  const left = Math.max(0, info.dailyLimit - info.usedToday);
  return (
    <div className="mb-6 flex max-w-3xl flex-wrap items-center gap-x-4 gap-y-2 font-mono-display text-xs text-[var(--text-muted)]">
      <span className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-[var(--connect)]" />
        {tr("doc.ready")}
      </span>
      <span>{tr("doc.maxPages", { n: info.maxPages })}</span>
      <span>{tr("doc.left", { left, total: info.dailyLimit })}</span>
      {info.testMode && (
        <span className="rounded-sm border border-[var(--signal)] px-2 py-0.5 font-semibold text-[var(--signal)]">
          {tr("doc.testMode")}
        </span>
      )}
    </div>
  );
}

function UploadBox({ accent, maxUploadMb, onUploaded }) {
  const { t: tr } = useLang();
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function upload(e) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const data = await apiFetch("/documents", { method: "POST", body: form });
      onUploaded(data.document);
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={upload} className="max-w-3xl rounded-lg border border-[var(--line)] bg-[var(--bg-panel)] p-5">
      <label className="flex flex-col gap-2">
        <span className="font-mono-display text-xs text-[var(--text-muted)]">
          {tr("doc.uploadLabel")}
          <span className="ml-2 opacity-70">
            ({maxUploadMb ? tr("doc.uploadMax", { mb: maxUploadMb }) : ""}{tr("doc.storedOnly")})
          </span>
        </span>
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="min-w-0 flex-1 rounded-sm border border-[var(--line)] bg-[var(--bg)] px-4 py-2.5 text-sm text-[var(--text-muted)] outline-none transition file:mr-3 file:rounded-sm file:border-0 file:bg-[var(--line)] file:px-3 file:py-1.5 file:font-mono-display file:text-xs file:font-semibold file:text-[var(--text)]"
          />
          <button
            type="submit"
            disabled={!file || busy}
            className="rounded-sm px-5 py-2.5 font-mono-display text-sm font-semibold text-[#0E1116] transition hover:brightness-110 disabled:opacity-50"
            style={{ background: accent }}
          >
            {busy ? tr("doc.uploading") : tr("doc.upload")}
          </button>
        </div>
      </label>
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
    </form>
  );
}

function DocumentCard({ doc, accent, translator, onChange, onDeleted }) {
  const { t: tr } = useLang();
  const t = doc.translation;
  const [showOptions, setShowOptions] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function startTranslation(options) {
    setBusy(true);
    setError("");
    try {
      const data = await apiFetch(`/documents/${doc.id}/translate`, { method: "POST", body: options });
      setShowOptions(false);
      onChange(data.document);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError("");
    try {
      await apiFetch(`/documents/${doc.id}`, { method: "DELETE" });
      onDeleted();
    } catch (err) {
      setError(err.message);
      setConfirmDelete(false);
    } finally {
      setBusy(false);
    }
  }

  const canTranslate = translator?.available && !isActive(t);

  return (
    <article className="rounded-lg border border-[var(--line)] bg-[var(--bg-panel)] p-5">
      {/* file */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 grid h-10 w-9 shrink-0 place-items-center rounded-sm border border-[var(--line)] font-mono-display text-[10px] font-semibold text-[var(--text-muted)]">
            PDF
          </span>
          <div className="min-w-0">
            <h3 className="truncate font-mono-display text-base font-semibold" title={doc.name}>
              {doc.name}
            </h3>
            <p className="mt-1 font-mono-display text-xs text-[var(--text-muted)]">
              {formatSize(doc.size)} · {tr("doc.uploaded", { date: formatDate(doc.createdAt) })}
              {t?.pages ? tr("doc.pages", { n: t.pages }) : ""}
            </p>
            <a
              href={`${API_BASE_URL}${doc.url}`}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block font-mono-display text-xs text-[var(--text-muted)] underline-offset-4 hover:text-[var(--text)] hover:underline"
            >
              {tr("doc.openOriginal")}
            </a>
          </div>
        </div>

        <div className="shrink-0">
          {!confirmDelete ? (
            <button
              onClick={() => setConfirmDelete(true)}
              disabled={busy || isActive(t)}
              className="font-mono-display text-xs text-[var(--text-muted)] transition hover:text-red-400 disabled:opacity-40"
              title={isActive(t) ? tr("doc.deleteWait") : tr("doc.deleteTitle")}
            >
              {tr("doc.delete")}
            </button>
          ) : (
            <span className="flex items-center gap-3 font-mono-display text-xs">
              <span className="text-[var(--text-muted)]">{tr("doc.deleteQ")}</span>
              <button onClick={remove} disabled={busy} className="font-semibold text-red-400 hover:brightness-110">
                {tr("doc.yes")}
              </button>
              <button onClick={() => setConfirmDelete(false)} className="text-[var(--text-muted)] hover:text-[var(--text)]">
                {tr("doc.no")}
              </button>
            </span>
          )}
        </div>
      </div>

      {/* translation */}
      <div className="mt-4 border-t border-[var(--line)] pt-4">
        {isActive(t) && <TranslationProgress t={t} accent={accent} />}

        {t?.status === "done" && <TranslationDone t={t} accent={accent} />}

        {t?.status === "failed" && (
          <p className="text-sm text-red-400">
            {tr("doc.failed")} <span className="text-[var(--text-muted)]">{t.error}</span>
          </p>
        )}

        {!isActive(t) && !showOptions && (
          <div className={t ? "mt-3" : ""}>
            <button
              onClick={() => setShowOptions(true)}
              disabled={!canTranslate}
              className="rounded-sm border px-4 py-2 font-mono-display text-xs font-semibold transition hover:brightness-110 disabled:opacity-40"
              style={{ borderColor: accent, color: accent }}
              title={translator?.available ? "" : tr("doc.notRunningTitle")}
            >
              {!t ? tr("doc.translate") : t.status === "failed" ? tr("doc.tryAgain") : tr("doc.translateAgain")}
            </button>
          </div>
        )}

        {showOptions && (
          <TranslateOptions
            accent={accent}
            busy={busy}
            onCancel={() => {
              setShowOptions(false);
              setError("");
            }}
            onStart={startTranslation}
          />
        )}

        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      </div>
    </article>
  );
}

function TranslateOptions({ accent, busy, onStart, onCancel }) {
  const { t: tr } = useLang();
  const [direction, setDirection] = useState("auto");
  const [review, setReview] = useState(false);
  const [instructions, setInstructions] = useState("");

  const DIRECTIONS = [
    { value: "auto", label: tr("doc.dirAuto"), source: "auto", target: "auto" },
    { value: "ja-en", label: tr("doc.dirJaEn"), source: "Japanese", target: "English" },
    { value: "en-ja", label: tr("doc.dirEnJa"), source: "English", target: "Japanese" },
  ];

  function submit(e) {
    e.preventDefault();
    const d = DIRECTIONS.find((x) => x.value === direction);
    onStart({ source: d.source, target: d.target, review, instructions: instructions.trim() });
  }

  const fieldClass =
    "rounded-sm border border-[var(--line)] bg-[var(--bg)] px-3 py-2.5 text-sm text-[var(--text)] outline-none transition focus:border-[var(--text-muted)]";

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-2">
        <span className="font-mono-display text-xs text-[var(--text-muted)]">{tr("doc.languages")}</span>
        <select value={direction} onChange={(e) => setDirection(e.target.value)} className={fieldClass}>
          {DIRECTIONS.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-2">
        <span className="font-mono-display text-xs text-[var(--text-muted)]">
          {tr("doc.notesLabel")}
          <span className="ml-2 opacity-70">({tr("doc.notesHint")})</span>
        </span>
        <textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          rows={2}
          maxLength={1000}
          className={`resize-y ${fieldClass}`}
        />
      </label>

      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={review}
          onChange={(e) => setReview(e.target.checked)}
          className="mt-0.5 h-4 w-4"
          style={{ accentColor: accent }}
        />
        <span className="text-sm">
          {tr("doc.review")}
          <span className="block text-xs text-[var(--text-muted)]">{tr("doc.reviewDesc")}</span>
        </span>
      </label>

      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={busy}
          className="rounded-sm px-5 py-2.5 font-mono-display text-sm font-semibold text-[#0E1116] transition hover:brightness-110 disabled:opacity-60"
          style={{ background: accent }}
        >
          {busy ? tr("doc.starting") : tr("doc.startTranslation")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="font-mono-display text-sm text-[var(--text-muted)] hover:text-[var(--text)]"
        >
          {tr("common.cancel")}
        </button>
      </div>
    </form>
  );
}

function TranslationProgress({ t, accent }) {
  const { t: tr } = useLang();
  const share = progressShare(t);
  const stageKey = KNOWN_STAGES.includes(t.stage) ? t.stage : "queued";
  const label = tr("doc.stage." + stageKey);
  const text =
    (t.stage === "translating" || t.stage === "reviewing") && t.total > 0
      ? tr("doc.pageProgress", { label, cur: Math.min(t.done + 1, t.total), total: t.total })
      : label;
  return (
    <div>
      <div className="flex items-center justify-between gap-4 font-mono-display text-xs">
        <span className="text-[var(--text)]">{text}</span>
        <span className="text-[var(--text-muted)]">
          {t.source && t.target ? `${t.source} → ${t.target}` : ""}
        </span>
      </div>
      <div
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--line)]"
        role="progressbar"
        aria-valuenow={Math.round(share * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${share * 100}%`, background: accent }} />
      </div>
      <p className="mt-2 text-xs text-[var(--text-muted)]">{tr("doc.takesTime")}</p>
    </div>
  );
}

function TranslationDone({ t, accent }) {
  const { t: tr } = useLang();
  const [showWarnings, setShowWarnings] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <a
          href={`${API_BASE_URL}${t.file.url}`}
          target="_blank"
          rel="noreferrer"
          download={t.file.name}
          className="rounded-sm px-5 py-2.5 font-mono-display text-sm font-semibold text-[#0E1116] transition hover:brightness-110"
          style={{ background: accent }}
        >
          {tr("doc.download")}
        </a>
        <span className="font-mono-display text-xs text-[var(--text-muted)]">
          ✓ {t.source} → {t.target}
          {t.review ? tr("doc.reviewed") : ""} · {formatDate(t.finishedAt || t.createdAt)}
        </span>
      </div>
      {t.warnings.length > 0 && (
        <div>
          <button
            onClick={() => setShowWarnings((v) => !v)}
            className="font-mono-display text-xs text-[var(--signal)] hover:brightness-110"
          >
            {showWarnings ? tr("doc.hideNotes", { n: t.warnings.length }) : tr("doc.showNotes", { n: t.warnings.length })}
          </button>
          {showWarnings && (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-[var(--text-muted)]">
              {t.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

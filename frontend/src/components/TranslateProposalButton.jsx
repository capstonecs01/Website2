import { useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../utils/api";
import { useLang } from "../i18n/LanguageContext";

// "Translate" action for a proposal's PDF. Sends it to the translator (via the
// caller's Documents), then links there to watch progress / download.
// Only PDFs can be translated, so it renders nothing for other file types.
// The direction is chosen explicitly (not auto) so scanned/low-text PDFs, where
// language detection fails, still translate.
export default function TranslateProposalButton({ proposalId, fileName, accent = "var(--connect)" }) {
  const { t } = useLang();
  const [state, setState] = useState("idle"); // idle | choosing | working | done | error
  const [msg, setMsg] = useState("");

  const isPdf = (fileName || "").toLowerCase().endsWith(".pdf");
  if (!isPdf) return null;

  async function translate(source, target) {
    setState("working");
    setMsg("");
    try {
      await apiFetch(`/documents/from-proposal/${proposalId}`, {
        method: "POST",
        body: { source, target },
      });
      setState("done");
    } catch (err) {
      setState("error");
      setMsg(err.message);
    }
  }

  if (state === "done") {
    return (
      <span className="font-mono-display text-xs text-[var(--text-muted)]">
        {t("tpb.translating")}{" "}
        <Link to="/documents" className="underline underline-offset-2" style={{ color: accent }}>
          {t("tpb.openDocs")}
        </Link>
      </span>
    );
  }

  if (state === "choosing" || state === "error") {
    const opt = (label, source, target) => (
      <button
        onClick={() => translate(source, target)}
        className="rounded-sm border px-2.5 py-1 font-mono-display text-xs transition hover:brightness-110"
        style={{ borderColor: accent, color: accent }}
      >
        {label}
      </button>
    );
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <span className="font-mono-display text-[11px] text-[var(--text-muted)]">{t("tpb.pick")}</span>
        {opt(t("tpb.jaEn"), "Japanese", "English")}
        {opt(t("tpb.enJa"), "English", "Japanese")}
        {opt(t("tpb.auto"), "auto", "auto")}
        {state === "error" && <span className="w-full text-xs text-red-400">{msg}</span>}
      </span>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        onClick={() => setState("choosing")}
        disabled={state === "working"}
        title={t("tpb.title")}
        className="rounded-sm border px-3 py-1.5 font-mono-display text-xs transition hover:brightness-110 disabled:opacity-50"
        style={{ borderColor: accent, color: accent }}
      >
        {state === "working" ? t("tpb.sending") : t("tpb.translate")}
      </button>
    </span>
  );
}

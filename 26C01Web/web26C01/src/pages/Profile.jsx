import { useEffect, useState } from "react";
import AppShell from "../components/AppShell";
import { useAuthUser } from "../utils/useAuthUser";
import { apiFetch } from "../utils/api";
import { getToken, saveSession } from "../utils/auth";
import { useLang } from "../i18n/LanguageContext";

export default function Profile() {
  const user = useAuthUser();
  const { t } = useLang();
  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState(null);
  const [status, setStatus] = useState("idle"); // idle | saving | saved | error
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) return;
    apiFetch("/me")
      .then((d) => {
        setProfile(d.profile);
        setForm(d.profile);
      })
      .catch((err) => setError(err.message));
  }, [user]);

  function field(key, val) {
    setForm((f) => ({ ...f, [key]: val }));
    setStatus("idle");
  }

  async function save(e) {
    e.preventDefault();
    setStatus("saving");
    setError("");
    const isCompany = profile.role === "company";
    const body = isCompany
      ? { fullName: form.fullName, companyName: form.companyName, jobTitle: form.jobTitle }
      : { fullName: form.fullName, school: form.school, major: form.major };
    try {
      const d = await apiFetch("/me", { method: "PATCH", body });
      setProfile(d.profile);
      setForm(d.profile);
      saveSession(getToken(), {
        id: d.profile.id,
        email: d.profile.email,
        fullName: d.profile.fullName,
        role: d.profile.role,
      });
      setStatus("saved");
    } catch (err) {
      setStatus("error");
      setError(err.message);
    }
  }

  if (!user) return null;
  const accent = user.role === "company" ? "var(--signal)" : "var(--connect)";

  return (
    <AppShell user={user}>
      <header className="mb-8">
        <h1 className="font-mono-display text-3xl font-semibold tracking-tight">{t("pf.title")}</h1>
        <p className="mt-2 text-sm text-[var(--text-muted)]">{t("pf.subtitle")}</p>
      </header>

      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}
      {!profile && !error && <p className="text-sm text-[var(--text-muted)]">{t("common.loading")}</p>}

      {profile && form && (
        <div className="max-w-2xl">
          {/* Identity header */}
          <div className="mb-8 flex items-center gap-4 rounded-lg border border-[var(--line)] bg-[var(--bg-panel)] p-6">
            <span
              className="grid h-14 w-14 place-items-center rounded-full font-mono-display text-lg font-semibold"
              style={{ border: `1px solid ${accent}`, color: accent }}
            >
              {(profile.fullName || "?").split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
            </span>
            <div>
              <p className="font-mono-display text-lg font-semibold">{profile.fullName}</p>
              <p className="text-sm text-[var(--text-muted)]">{profile.email}</p>
              <div className="mt-1 flex items-center gap-2">
                <span
                  className="rounded-sm px-2 py-0.5 font-mono-display text-[10px] font-semibold uppercase tracking-widest"
                  style={{ color: accent, border: `1px solid ${accent}` }}
                >
                  {t("app." + profile.role)}
                </span>
                <span className="font-mono-display text-[10px] text-[var(--text-muted)]">
                  {profile.emailVerified ? t("pf.verified") : t("pf.unverified")} ·{" "}
                  {t("up.joined", { date: new Date(profile.createdAt + "Z").toLocaleDateString() })}
                </span>
              </div>
            </div>
          </div>

          <form onSubmit={save} className="grid grid-cols-1 gap-5">
            <Row label={t("pf.fullName")}>
              <input className={inputCls} value={form.fullName || ""} onChange={(e) => field("fullName", e.target.value)} />
            </Row>
            <Row label={t("pf.email")} hint={t("pf.emailHint")}>
              <input className={inputCls + " opacity-60"} value={form.email} disabled />
            </Row>

            {profile.role === "company" ? (
              <>
                <Row label={t("pf.companyName")}>
                  <input className={inputCls} value={form.companyName || ""} onChange={(e) => field("companyName", e.target.value)} />
                </Row>
                <Row label={t("pf.jobTitle")}>
                  <input className={inputCls} value={form.jobTitle || ""} onChange={(e) => field("jobTitle", e.target.value)} />
                </Row>
              </>
            ) : (
              <>
                <Row label={t("pf.school")}>
                  <input className={inputCls} value={form.school || ""} onChange={(e) => field("school", e.target.value)} />
                </Row>
                <Row label={t("pf.major")}>
                  <input className={inputCls} value={form.major || ""} onChange={(e) => field("major", e.target.value)} />
                </Row>
              </>
            )}

            <div className="mt-2 flex items-center gap-4">
              <button
                type="submit"
                disabled={status === "saving"}
                className="rounded-sm px-6 py-3 font-mono-display text-sm font-semibold text-[#0E1116] transition hover:brightness-110 disabled:opacity-60"
                style={{ background: accent }}
              >
                {status === "saving" ? t("pf.saving") : t("common.save")}
              </button>
              {status === "saved" && <span className="font-mono-display text-sm text-[var(--connect)]">{t("pf.saved")}</span>}
            </div>
          </form>
        </div>
      )}
    </AppShell>
  );
}

const inputCls =
  "rounded-sm border border-[var(--line)] bg-[var(--bg-panel)] px-4 py-3 text-sm text-[var(--text)] outline-none transition focus:border-[var(--text-muted)]";

function Row({ label, hint, children }) {
  return (
    <label className="flex flex-col gap-2">
      <span className="font-mono-display text-xs text-[var(--text-muted)]">
        {label}
        {hint && <span className="ml-2 opacity-70">({hint})</span>}
      </span>
      {children}
    </label>
  );
}

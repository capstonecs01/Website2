import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { saveSession } from "../utils/auth";
import ResendVerification from "../components/ResendVerification";
import ThemeToggle from "../components/ThemeToggle";
import LanguageToggle from "../components/LanguageToggle";
import { useLang } from "../i18n/LanguageContext";
import { API_BASE_URL } from "../utils/api";

export default function Login() {
  const navigate = useNavigate();
  const { t } = useLang();
  const [status, setStatus] = useState("idle"); // idle | loading | error
  const [errorMessage, setErrorMessage] = useState("");
  const [email, setEmail] = useState("");
  const [needsVerify, setNeedsVerify] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setStatus("loading");
    setErrorMessage("");
    setNeedsVerify(false);

    const formData = new FormData(e.target);
    const enteredEmail = formData.get("email");
    setEmail(enteredEmail);
    const payload = { email: enteredEmail, password: formData.get("password") };

    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (!res.ok) {
        // 403 here means the account exists but the email isn't verified yet —
        // offer a resend rather than a dead end.
        if (res.status === 403) setNeedsVerify(true);
        throw new Error(data.error || "Login failed. Please try again.");
      }

      saveSession(data.token, data.user);
      navigate(data.user.role === "company" ? "/dashboard/company" : "/dashboard/student");
    } catch (err) {
      setStatus("error");
      setErrorMessage(err.message);
    }
  }

  // Jump straight into a pre-verified demo account — lets you explore both
  // sides of the product without signing up two emails.
  async function exploreAs(role) {
    setStatus("loading");
    setErrorMessage("");
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/demo-login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not open the demo.");
      saveSession(data.token, data.user);
      navigate(role === "company" ? "/dashboard/company" : "/dashboard/student");
    } catch (err) {
      setStatus("error");
      setErrorMessage(err.message);
    }
  }

  return (
    <section className="relative mx-auto flex min-h-[calc(100vh-73px)] max-w-md flex-col justify-center px-6 py-16">
      <div className="absolute right-6 top-6 flex items-center gap-2">
        <LanguageToggle accent="var(--connect)" />
        <ThemeToggle />
      </div>
      <p className="font-mono-display text-sm tracking-widest text-[var(--connect)]">
        {t("login.eyebrow")}
      </p>
      <h1 className="mt-3 font-mono-display text-3xl font-semibold tracking-tight">
        {t("login.title")}
      </h1>

      <form onSubmit={handleSubmit} className="mt-10 flex flex-col gap-5">
        <label htmlFor="email" className="flex flex-col gap-2">
          <span className="font-mono-display text-xs text-[var(--text-muted)]">{t("login.email")}</span>
          <input
            id="email"
            name="email"
            type="email"
            required
            className="rounded-sm border border-[var(--line)] bg-[var(--bg-panel)] px-4 py-3 text-sm text-[var(--text)] outline-none transition focus:border-[var(--text-muted)]"
          />
        </label>

        <label htmlFor="password" className="flex flex-col gap-2">
          <span className="font-mono-display text-xs text-[var(--text-muted)]">{t("login.password")}</span>
          <input
            id="password"
            name="password"
            type="password"
            required
            className="rounded-sm border border-[var(--line)] bg-[var(--bg-panel)] px-4 py-3 text-sm text-[var(--text)] outline-none transition focus:border-[var(--text-muted)]"
          />
        </label>

        {status === "error" && (
          <div>
            <p className="text-sm text-red-400">{errorMessage}</p>
            {needsVerify && <ResendVerification email={email} accent="var(--connect)" />}
          </div>
        )}

        <button
          type="submit"
          disabled={status === "loading"}
          className="mt-2 rounded-sm bg-[var(--connect)] px-6 py-3 font-mono-display text-sm font-semibold text-[#0E1116] transition hover:brightness-110 disabled:opacity-60"
        >
          {status === "loading" ? t("login.loggingIn") : t("login.submit")}
        </button>
      </form>

      {/* Demo quick-access — inspect both perspectives instantly */}
      <div className="mt-8">
        <div className="flex items-center gap-3">
          <span className="h-px flex-1 bg-[var(--line)]" />
          <span className="font-mono-display text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
            {t("login.orExplore")}
          </span>
          <span className="h-px flex-1 bg-[var(--line)]" />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => exploreAs("company")}
            className="rounded-sm border border-[var(--signal)] px-4 py-2.5 font-mono-display text-sm font-semibold text-[var(--signal)] transition hover:bg-[var(--signal)] hover:text-[#0E1116]"
          >
            {t("login.exploreCompany")}
          </button>
          <button
            type="button"
            onClick={() => exploreAs("student")}
            className="rounded-sm border border-[var(--connect)] px-4 py-2.5 font-mono-display text-sm font-semibold text-[var(--connect)] transition hover:bg-[var(--connect)] hover:text-[#0E1116]"
          >
            {t("login.exploreStudent")}
          </button>
        </div>
      </div>

      <p className="mt-6 text-sm text-[var(--text-muted)]">
        {t("login.noAccount")}{" "}
        <Link to="/" className="underline underline-offset-2 hover:text-[var(--text)]">
          {t("login.signupFromHome")}
        </Link>
      </p>

      <Link to="/" className="mt-10 font-mono-display text-xs text-[var(--text-muted)] hover:text-[var(--text)]">
        {t("login.backHome")}
      </Link>
    </section>
  );
}

import { useState } from "react";
import { Link } from "react-router-dom";
import ResendVerification from "./ResendVerification";
import { useLang } from "../i18n/LanguageContext";
import { API_BASE_URL } from "../utils/api";

export default function SignupForm({ role }) {
  const { t } = useLang();
  const [status, setStatus] = useState("idle"); // idle | loading | success | ready | error
  const [errorMessage, setErrorMessage] = useState("");
  const [email, setEmail] = useState(""); // kept so the success screen can offer a resend

  const c =
    role === "company"
      ? {
          accent: "var(--signal)",
          eyebrow: t("su.co.eyebrow"),
          title: t("su.co.title"),
          subtitle: t("su.co.subtitle"),
          extraFields: [
            { id: "companyName", label: t("su.co.companyName"), type: "text" },
            { id: "jobTitle", label: t("su.co.jobTitle"), type: "text" },
          ],
          submitLabel: t("su.co.submit"),
          switchTo: { path: "/signup/student", label: t("su.co.switch") },
        }
      : {
          accent: "var(--connect)",
          eyebrow: t("su.st.eyebrow"),
          title: t("su.st.title"),
          subtitle: t("su.st.subtitle"),
          extraFields: [
            { id: "school", label: t("su.st.school"), type: "text" },
            { id: "major", label: t("su.st.major"), type: "text" },
          ],
          submitLabel: t("su.st.submit"),
          switchTo: { path: "/signup/company", label: t("su.st.switch") },
        };

  async function handleSubmit(e) {
    e.preventDefault();
    setStatus("loading");
    setErrorMessage("");

    const formData = new FormData(e.target);
    setEmail(formData.get("email"));
    const payload = {
      email: formData.get("email"),
      password: formData.get("password"),
      fullName: formData.get("fullName"),
      role,
      ...(role === "company"
        ? { companyName: formData.get("companyName"), jobTitle: formData.get("jobTitle") }
        : { school: formData.get("school"), major: formData.get("major") }),
    };

    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Something went wrong. Please try again.");
      setStatus(data.verified ? "ready" : "success");
    } catch (err) {
      setStatus("error");
      setErrorMessage(err.message);
    }
  }

  if (status === "ready") {
    return (
      <section className="mx-auto flex min-h-[calc(100vh-73px)] max-w-xl flex-col justify-center px-6 py-16">
        <p className="font-mono-display text-sm tracking-widest" style={{ color: c.accent }}>
          {c.eyebrow}
        </p>
        <h1 className="mt-3 font-mono-display text-3xl font-semibold tracking-tight">{t("su.ready")}</h1>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-[var(--text-muted)]">
          {t("su.readyBody", { email })}
        </p>

        <Link
          to="/login"
          className="mt-6 inline-block w-fit rounded-sm px-6 py-3 font-mono-display text-sm font-semibold text-[#0E1116] transition hover:brightness-110"
          style={{ background: c.accent }}
        >
          {t("su.readyLogin")}
        </Link>

        <Link to="/" className="mt-10 font-mono-display text-xs text-[var(--text-muted)] hover:text-[var(--text)]">
          {t("login.backHome")}
        </Link>
      </section>
    );
  }

  if (status === "success") {
    return (
      <section className="mx-auto flex min-h-[calc(100vh-73px)] max-w-xl flex-col justify-center px-6 py-16">
        <p className="font-mono-display text-sm tracking-widest" style={{ color: c.accent }}>
          {c.eyebrow}
        </p>
        <h1 className="mt-3 font-mono-display text-3xl font-semibold tracking-tight">{t("su.checkEmail")}</h1>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-[var(--text-muted)]">
          {t("su.sentLink", { email })}
        </p>

        <div className="mt-6">
          <p className="text-sm text-[var(--text-muted)]">{t("su.didntGet")}</p>
          <ResendVerification email={email} accent={c.accent} />
        </div>

        <Link to="/" className="mt-10 font-mono-display text-xs text-[var(--text-muted)] hover:text-[var(--text)]">
          {t("login.backHome")}
        </Link>
      </section>
    );
  }

  return (
    <section className="mx-auto flex min-h-[calc(100vh-73px)] max-w-xl flex-col justify-center px-6 py-16">
      <p className="font-mono-display text-sm tracking-widest" style={{ color: c.accent }}>
        {c.eyebrow}
      </p>
      <h1 className="mt-3 font-mono-display text-3xl font-semibold tracking-tight">{c.title}</h1>
      <p className="mt-3 text-sm leading-relaxed text-[var(--text-muted)]">{c.subtitle}</p>

      <form onSubmit={handleSubmit} className="mt-10 flex flex-col gap-5">
        <Field id="fullName" label={t("su.fullName")} type="text" />
        <Field id="email" label={t("su.email")} type="email" />
        {c.extraFields.map((f) => (
          <Field key={f.id} id={f.id} label={f.label} type={f.type} />
        ))}
        <Field id="password" label={t("su.password")} type="password" minLength={8} />

        {status === "error" && <p className="text-sm text-red-400">{errorMessage}</p>}

        <button
          type="submit"
          disabled={status === "loading"}
          className="mt-2 rounded-sm px-6 py-3 font-mono-display text-sm font-semibold text-[#0E1116] transition hover:brightness-110 disabled:opacity-60"
          style={{ background: c.accent }}
        >
          {status === "loading" ? t("su.creating") : c.submitLabel}
        </button>
      </form>

      <p className="mt-6 text-sm text-[var(--text-muted)]">
        {c.switchTo.label}{" "}
        <Link to={c.switchTo.path} className="underline underline-offset-2 hover:text-[var(--text)]">
          {t("su.switchHere")}
        </Link>
      </p>

      <Link to="/" className="mt-10 font-mono-display text-xs text-[var(--text-muted)] hover:text-[var(--text)]">
        {t("login.backHome")}
      </Link>
    </section>
  );
}

function Field({ id, label, type, minLength }) {
  return (
    <label htmlFor={id} className="flex flex-col gap-2">
      <span className="font-mono-display text-xs text-[var(--text-muted)]">{label}</span>
      <input
        id={id}
        name={id}
        type={type}
        minLength={minLength}
        required
        className="rounded-sm border border-[var(--line)] bg-[var(--bg-panel)] px-4 py-3 text-sm text-[var(--text)] outline-none transition focus:border-[var(--text-muted)]"
      />
    </label>
  );
}

import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useLang } from "../i18n/LanguageContext";
import { API_BASE_URL } from "../utils/api";

export default function VerifyEmail() {
  const { t } = useLang();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const [status, setStatus] = useState("loading"); // loading | success | error
  const [message, setMessage] = useState("");
  const hasRequested = useRef(false);

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setMessage(t("ve.noToken"));
      return;
    }

    // Guards against React StrictMode's dev-mode double-invoke of effects,
    // which would otherwise send this one-time-use token twice.
    if (hasRequested.current) return;
    hasRequested.current = true;

    fetch(`${API_BASE_URL}/api/auth/verify?token=${encodeURIComponent(token)}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Verification failed.");
        setStatus("success");
        setMessage(data.message);
      })
      .catch((err) => {
        setStatus("error");
        setMessage(err.message);
      });
  }, [token]);

  return (
    <section className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6 text-center">
      {status === "loading" && (
        <>
          <p className="font-mono-display text-sm tracking-widest text-[var(--text-muted)]">{t("ve.verifying")}</p>
          <h1 className="mt-3 font-mono-display text-2xl font-semibold">{t("ve.hangOn")}</h1>
        </>
      )}

      {status === "success" && (
        <>
          <p className="font-mono-display text-sm tracking-widest text-[var(--connect)]">{t("ve.verified")}</p>
          <h1 className="mt-3 font-mono-display text-2xl font-semibold">{t("ve.confirmed")}</h1>
          <p className="mt-3 text-sm text-[var(--text-muted)]">{message}</p>
        </>
      )}

      {status === "error" && (
        <>
          <p className="font-mono-display text-sm tracking-widest text-[var(--signal)]">{t("ve.wrong")}</p>
          <h1 className="mt-3 font-mono-display text-2xl font-semibold">{t("ve.couldnt")}</h1>
          <p className="mt-3 text-sm text-[var(--text-muted)]">{message}</p>
        </>
      )}

      <Link to="/" className="mt-10 font-mono-display text-xs text-[var(--text-muted)] hover:text-[var(--text)]">
        {t("login.backHome")}
      </Link>
    </section>
  );
}

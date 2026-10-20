import { useState } from "react";
import { useLang } from "../i18n/LanguageContext";
import { API_BASE_URL } from "../utils/api";

// Small inline "resend the verification email" control.
// Reused on the signup success screen and the login "please verify" state.
export default function ResendVerification({ email, accent = "var(--connect)" }) {
  const { t } = useLang();
  const [state, setState] = useState("idle"); // idle | loading | sent | error
  const [message, setMessage] = useState("");

  async function resend() {
    if (!email) return;
    setState("loading");
    setMessage("");
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/resend-verification`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't resend right now. Please try again.");
      setState("sent");
      setMessage(data.message || "If an account exists for this email, a new link is on its way.");
    } catch (err) {
      setState("error");
      setMessage(err.message);
    }
  }

  if (state === "sent") {
    return <p className="mt-2 text-sm text-[var(--text-muted)]">✓ {message}</p>;
  }

  return (
    <div className="mt-2 flex flex-col gap-1">
      <button
        type="button"
        onClick={resend}
        disabled={state === "loading" || !email}
        className="w-fit font-mono-display text-sm underline underline-offset-2 transition hover:brightness-110 disabled:opacity-50"
        style={{ color: accent }}
      >
        {state === "loading" ? t("rv.resending") : t("rv.resend")}
      </button>
      {state === "error" && <p className="text-sm text-red-400">{message}</p>}
    </div>
  );
}

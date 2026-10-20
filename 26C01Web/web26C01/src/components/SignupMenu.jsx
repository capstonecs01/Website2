import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLang } from "../i18n/LanguageContext";

export default function SignupMenu({ children, className = "" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const navigate = useNavigate();
  const { t } = useLang();

  useEffect(() => {
    function handleClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function choose(path) {
    setOpen(false);
    navigate(path);
  }

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((v) => !v)} className={className}>
        {children}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-48 overflow-hidden rounded-sm border border-[var(--line)] bg-[var(--bg-panel)] shadow-lg">
          <button
            onClick={() => choose("/signup/company")}
            className="flex w-full items-center gap-2 border-b border-[var(--line)] px-4 py-3 text-left font-mono-display text-sm transition hover:bg-[var(--bg)]"
          >
            <span className="h-2 w-2 rounded-full" style={{ background: "var(--signal)" }} />
            {t("signup.asCompany")}
          </button>
          <button
            onClick={() => choose("/signup/student")}
            className="flex w-full items-center gap-2 px-4 py-3 text-left font-mono-display text-sm transition hover:bg-[var(--bg)]"
          >
            <span className="h-2 w-2 rounded-full" style={{ background: "var(--connect)" }} />
            {t("signup.asStudent")}
          </button>
        </div>
      )}
    </div>
  );
}

import { Link } from "react-router-dom";
import SignupMenu from "./SignupMenu";
import ThemeToggle from "./ThemeToggle";
import LanguageToggle from "./LanguageToggle";
import { useLang } from "../i18n/LanguageContext";

export default function Navbar() {
  const { t } = useLang();
  return (
    <header className="sticky top-0 z-50 border-b border-[var(--line)] bg-[var(--bg)]/90 backdrop-blur">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2 font-mono-display text-lg font-semibold tracking-tight">
          <span className="text-[var(--signal)]">J</span>
          <span>unction</span>
        </div>

        <div className="hidden items-center gap-8 font-mono-display text-sm text-[var(--text-muted)] md:flex">
          <a href="#how" className="transition hover:text-[var(--text)]">{t("nav.how")}</a>
          <a href="#for-companies" className="transition hover:text-[var(--text)]">{t("nav.forCompanies")}</a>
          <a href="#for-students" className="transition hover:text-[var(--text)]">{t("nav.forStudents")}</a>
        </div>

        <div className="flex items-center gap-3">
          <LanguageToggle />
          <ThemeToggle />
          <Link
            to="/login"
            className="font-mono-display text-sm text-[var(--text-muted)] transition hover:text-[var(--text)]"
          >
            {t("nav.login")}
          </Link>
          <SignupMenu className="rounded-sm bg-[var(--signal)] px-4 py-2 font-mono-display text-sm font-semibold text-[#0E1116] transition hover:brightness-110">
            {t("nav.signup")}
          </SignupMenu>
        </div>
      </nav>
    </header>
  );
}

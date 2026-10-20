import { Link } from "react-router-dom";
import { useLang } from "../i18n/LanguageContext";

export default function ForCompanies() {
  const { t } = useLang();
  return (
    <section id="for-companies" className="border-b border-[var(--line)] py-24">
      <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 px-6 md:grid-cols-2">
        <div>
          <p className="font-mono-display text-sm tracking-widest text-[var(--signal)]">
            {t("company.eyebrow")}
          </p>
          <h2 className="mt-3 font-mono-display text-3xl font-semibold tracking-tight">
            {t("company.title")}
          </h2>
          <p className="mt-6 max-w-md text-base leading-relaxed text-[var(--text-muted)]">
            {t("company.p1")}
          </p>
          <p className="mt-4 max-w-md text-base leading-relaxed text-[var(--text-muted)]">
            {t("company.p2")}
          </p>
          <Link
            to="/signup/company"
            className="mt-8 inline-block rounded-sm bg-[var(--signal)] px-6 py-3 font-mono-display text-sm font-semibold text-[#0E1116] transition hover:brightness-110"
          >
            {t("company.cta")}
          </Link>
        </div>

        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-sm border border-[var(--line)] bg-[var(--line)] sm:grid-cols-2">
          <div className="bg-[var(--bg-panel)] p-6">
            <p className="font-mono-display text-2xl font-semibold text-[var(--signal)]">
              {t("company.stat1n")}
            </p>
            <p className="mt-2 text-sm text-[var(--text-muted)]">{t("company.stat1d")}</p>
          </div>
          <div className="bg-[var(--bg-panel)] p-6">
            <p className="font-mono-display text-2xl font-semibold text-[var(--signal)]">
              {t("company.stat2n")}
            </p>
            <p className="mt-2 text-sm text-[var(--text-muted)]">{t("company.stat2d")}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

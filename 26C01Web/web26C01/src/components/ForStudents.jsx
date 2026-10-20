import { Link } from "react-router-dom";
import { useLang } from "../i18n/LanguageContext";

export default function ForStudents() {
  const { t } = useLang();
  return (
    <section id="for-students" className="border-b border-[var(--line)] py-24">
      <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 px-6 md:grid-cols-2">
        <div className="order-2 md:order-1 grid grid-cols-1 gap-px overflow-hidden rounded-sm border border-[var(--line)] bg-[var(--line)] sm:grid-cols-2">
          <div className="bg-[var(--bg-panel)] p-6">
            <p className="font-mono-display text-2xl font-semibold text-[var(--connect)]">
              {t("student.stat1n")}
            </p>
            <p className="mt-2 text-sm text-[var(--text-muted)]">{t("student.stat1d")}</p>
          </div>
          <div className="bg-[var(--bg-panel)] p-6">
            <p className="font-mono-display text-2xl font-semibold text-[var(--connect)]">
              {t("student.stat2n")}
            </p>
            <p className="mt-2 text-sm text-[var(--text-muted)]">{t("student.stat2d")}</p>
          </div>
        </div>

        <div className="order-1 md:order-2">
          <p className="font-mono-display text-sm tracking-widest text-[var(--connect)]">
            {t("student.eyebrow")}
          </p>
          <h2 className="mt-3 font-mono-display text-3xl font-semibold tracking-tight">
            {t("student.title")}
          </h2>
          <p className="mt-6 max-w-md text-base leading-relaxed text-[var(--text-muted)]">
            {t("student.p1")}
          </p>
          <p className="mt-4 max-w-md text-base leading-relaxed text-[var(--text-muted)]">
            {t("student.p2")}
          </p>
          <Link
            to="/signup/student"
            className="mt-8 inline-block rounded-sm border border-[var(--connect)] px-6 py-3 font-mono-display text-sm font-semibold text-[var(--connect)] transition hover:bg-[var(--connect)] hover:text-[#0E1116]"
          >
            {t("student.cta")}
          </Link>
        </div>
      </div>
    </section>
  );
}

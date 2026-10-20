import { useLang } from "../i18n/LanguageContext";

export default function Footer() {
  const { t } = useLang();
  return (
    <footer className="py-10">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 font-mono-display text-xs text-[var(--text-muted)] md:flex-row">
        <span>© {new Date().getFullYear()} Junction</span>
        <span>{t("footer.tagline")}</span>
      </div>
    </footer>
  );
}

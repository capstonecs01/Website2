import SignupMenu from "./SignupMenu";
import { useLang } from "../i18n/LanguageContext";

export default function Hero() {
  const { t } = useLang();
  return (
    <section className="relative overflow-hidden border-b border-[var(--line)]">
      <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 px-6 py-20 md:grid-cols-2 md:py-28">
        <div>
          <p className="font-mono-display text-sm tracking-widest text-[var(--connect)]">
            {t("hero.eyebrow")}
          </p>
          <h1 className="mt-4 font-mono-display text-4xl font-semibold leading-tight tracking-tight md:text-5xl">
            {t("hero.title")}
          </h1>
          <p className="mt-6 max-w-md text-base leading-relaxed text-[var(--text-muted)]">
            {t("hero.lead")}
          </p>
          <div className="mt-8 flex flex-wrap gap-4">
            <SignupMenu className="rounded-sm bg-[var(--signal)] px-6 py-3 font-mono-display text-sm font-semibold text-[#0E1116] transition hover:brightness-110">
              {t("hero.getStarted")}
            </SignupMenu>
            <a
              href="#how"
              className="rounded-sm border border-[var(--line)] px-6 py-3 font-mono-display text-sm text-[var(--text)] transition hover:border-[var(--text-muted)]"
            >
              {t("hero.seeHow")}
            </a>
          </div>
        </div>

        <div className="relative flex items-center justify-center">
          <svg
            viewBox="0 0 400 300"
            className="w-full max-w-md"
            role="img"
            aria-label="Diagram showing companies and students converging at Junction"
          >
            <defs>
              <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
                <path d="M 20 0 L 0 0 0 20" fill="none" stroke="var(--line)" strokeWidth="1" />
              </pattern>
            </defs>
            <rect width="400" height="300" fill="url(#grid)" />

            <path id="companyPath" d="M 20 60 L 160 60 L 220 150" fill="none" stroke="var(--signal)" strokeWidth="2" strokeDasharray="4 4" opacity="0.8" />
            <path id="studentPath" d="M 20 240 L 160 240 L 220 150" fill="none" stroke="var(--connect)" strokeWidth="2" strokeDasharray="4 4" opacity="0.8" />
            <path d="M 220 150 L 380 150" fill="none" stroke="var(--text)" strokeWidth="2" />

            <circle cx="20" cy="60" r="5" fill="var(--signal)" />
            <text x="30" y="45" fill="var(--text-muted)" fontSize="11" fontFamily="IBM Plex Mono, monospace">
              {t("hero.diaCompany")}
            </text>

            <circle cx="20" cy="240" r="5" fill="var(--connect)" />
            <text x="30" y="260" fill="var(--text-muted)" fontSize="11" fontFamily="IBM Plex Mono, monospace">
              {t("hero.diaStudent")}
            </text>

            <circle cx="220" cy="150" r="8" fill="var(--bg)" stroke="var(--text)" strokeWidth="2" />
            <circle cx="220" cy="150" r="3" fill="var(--text)" />

            <text x="380" y="140" fill="var(--text)" fontSize="11" fontFamily="IBM Plex Mono, monospace" textAnchor="end">
              {t("hero.diaMatched")}
            </text>

            <circle r="4" fill="var(--signal)">
              <animateMotion dur="3s" repeatCount="indefinite" path="M 20 60 L 160 60 L 220 150" />
            </circle>
            <circle r="4" fill="var(--connect)">
              <animateMotion dur="3s" begin="1.5s" repeatCount="indefinite" path="M 20 240 L 160 240 L 220 150" />
            </circle>
          </svg>
        </div>
      </div>
    </section>
  );
}

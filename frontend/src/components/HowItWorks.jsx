import { useLang } from "../i18n/LanguageContext";

export default function HowItWorks() {
  const { t } = useLang();
  const steps = [
    { n: "01", title: t("how.s1t"), desc: t("how.s1d") },
    { n: "02", title: t("how.s2t"), desc: t("how.s2d") },
    { n: "03", title: t("how.s3t"), desc: t("how.s3d") },
    { n: "04", title: t("how.s4t"), desc: t("how.s4d") },
  ];

  return (
    <section id="how" className="border-b border-[var(--line)] py-24">
      <div className="mx-auto max-w-6xl px-6">
        <p className="font-mono-display text-sm tracking-widest text-[var(--connect)]">
          {t("how.eyebrow")}
        </p>
        <h2 className="mt-3 max-w-xl font-mono-display text-3xl font-semibold tracking-tight">
          {t("how.title")}
        </h2>

        <div className="mt-14 grid grid-cols-1 gap-px overflow-hidden rounded-sm border border-[var(--line)] bg-[var(--line)] md:grid-cols-4">
          {steps.map((step) => (
            <div key={step.n} className="bg-[var(--bg-panel)] p-6">
              <span className="font-mono-display text-2xl font-semibold text-[var(--signal)]">
                {step.n}
              </span>
              <h3 className="mt-4 font-mono-display text-base font-semibold">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--text-muted)]">{step.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

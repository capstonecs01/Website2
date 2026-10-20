import { Link } from "react-router-dom";

// Large call-to-action card (Post a problem, Review proposals, …).
// `to` makes it a link; `onClick` makes it a button. Pass a `badge` for the
// little pill (e.g. "4 new").
export default function QuickAction({ to, onClick, title, description, badge, accent = "var(--signal)", icon, filled }) {
  const inner = (
    <>
      <div className="mb-4" style={{ color: accent }}>{icon}</div>
      <h3 className="font-mono-display text-base font-semibold">{title}</h3>
      <p className="mt-1 text-sm leading-relaxed text-[var(--text-muted)]">{description}</p>
      {badge && (
        <span
          className="mt-3 inline-block rounded-full px-2.5 py-0.5 font-mono-display text-[11px] font-semibold text-[#0E1116]"
          style={{ background: accent }}
        >
          {badge}
        </span>
      )}
    </>
  );

  const className =
    "block rounded-lg border p-5 text-left transition hover:border-[color:var(--_a)] " +
    (filled ? "border-transparent" : "border-[var(--line)] bg-[var(--bg-panel)]");
  const style = filled
    ? { "--_a": accent, background: "color-mix(in srgb, " + accent + " 12%, var(--bg-panel))", borderColor: "color-mix(in srgb, " + accent + " 40%, transparent)" }
    : { "--_a": accent };

  if (to) {
    return <Link to={to} className={className} style={style}>{inner}</Link>;
  }
  return (
    <button type="button" onClick={onClick} className={className + " w-full"} style={style}>
      {inner}
    </button>
  );
}

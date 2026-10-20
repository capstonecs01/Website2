// Compact metric tile used across both dashboards (Problems Posted, etc.).
export default function StatCard({ label, value, accent = "var(--text-muted)", icon }) {
  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--bg-panel)] p-5">
      {icon && (
        <div
          className="mb-4 grid h-9 w-9 place-items-center rounded-md"
          style={{ background: "color-mix(in srgb, " + accent + " 14%, transparent)", color: accent }}
        >
          {icon}
        </div>
      )}
      <p className="font-mono-display text-3xl font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-sm text-[var(--text-muted)]">{label}</p>
    </div>
  );
}

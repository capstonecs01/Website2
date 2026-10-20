import { Link, useNavigate, useLocation } from "react-router-dom";
import { clearSession, saveSession } from "../utils/auth";
import { apiFetch } from "../utils/api";
import ThemeToggle from "./ThemeToggle";
import LanguageToggle from "./LanguageToggle";
import { useLang } from "../i18n/LanguageContext";

// Tiny inline icon set — keeps the sidebar self-contained (no icon dep).
function Icon({ name }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round",
    strokeLinejoin: "round",
  };
  const paths = {
    grid: <><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></>,
    plus: <><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>,
    box: <><path d="M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><polyline points="3.3 7 12 12 20.7 7" /><line x1="12" y1="22" x2="12" y2="12" /></>,
    inbox: <><polyline points="22 12 16 12 14 15 10 15 8 12 2 12" /><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z" /></>,
    chat: <><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.5 9.5 0 0 1-4-.9L3 20l1.3-3.8A8.2 8.2 0 0 1 3 11.5a8.4 8.4 0 0 1 9-8.4 8.4 8.4 0 0 1 9 8.4z" /></>,
    user: <><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>,
    users: <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>,
    search: <><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></>,
    work: <><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /></>,
    doc: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="13" y2="17" /></>,
    logout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></>,
    swap: <><polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></>,
  };
  return <svg {...common}>{paths[name]}</svg>;
}

const NAV = {
  company: [
    { to: "/dashboard/company", labelKey: "app.dashboard", icon: "grid", root: true },
    { to: "/dashboard/company/new", labelKey: "app.postProblem", icon: "plus" },
    { to: "/dashboard/company/problems", labelKey: "app.myProblems", icon: "box" },
    { to: "/dashboard/company/proposals", labelKey: "app.proposals", icon: "inbox" },
    { to: "/messages", labelKey: "app.messages", icon: "chat" },
    { to: "/documents", labelKey: "app.documents", icon: "doc" },
    { to: "/profile", labelKey: "app.profile", icon: "user" },
  ],
  student: [
    { to: "/dashboard/student", labelKey: "app.dashboard", icon: "grid", root: true },
    { to: "/problems", labelKey: "app.browse", icon: "search" },
    { to: "/teammates", labelKey: "app.findTeammates", icon: "users" },
    { to: "/dashboard/student/work", labelKey: "app.myWork", icon: "work" },
    { to: "/messages", labelKey: "app.messages", icon: "chat" },
    { to: "/documents", labelKey: "app.documents", icon: "doc" },
    { to: "/profile", labelKey: "app.profile", icon: "user" },
  ],
};

function isActive(pathname, item) {
  if (pathname === item.to) return true;
  if (!item.root && pathname.startsWith(item.to + "/")) return true;
  return false;
}

// Shared sidebar layout for all signed-in pages.
export default function AppShell({ user, children }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useLang();
  const role = user?.role || "company";
  const accent = role === "company" ? "var(--signal)" : "var(--connect)";
  const items = NAV[role] || NAV.company;
  const otherRole = role === "company" ? "student" : "company";

  function logout() {
    clearSession();
    navigate("/login");
  }

  // Jump to the opposite role's portal using a pre-verified demo account,
  // so you can inspect both sides without a second sign-up.
  async function viewAs(target) {
    try {
      const data = await apiFetch("/auth/demo-login", { method: "POST", body: { role: target } });
      saveSession(data.token, data.user);
      navigate(target === "company" ? "/dashboard/company" : "/dashboard/student");
    } catch {
      // Non-fatal — stay where we are if the demo switch fails.
    }
  }

  const initials = (user?.fullName || user?.email || "?")
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="sticky top-0 flex h-screen w-64 shrink-0 flex-col border-r border-[var(--line)] bg-[var(--bg-panel)]">
        <div className="flex items-center gap-2.5 px-6 py-5">
          <span
            className="grid h-9 w-9 place-items-center rounded-md font-mono-display text-lg font-bold text-[#0E1116]"
            style={{ background: accent }}
          >
            J
          </span>
          <div className="leading-tight">
            <p className="font-mono-display text-sm font-semibold tracking-tight">Junction</p>
            <p className="font-mono-display text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
              {t("app.portal", { role: t("app." + role) })}
            </p>
          </div>
        </div>

        <nav className="mt-2 flex flex-1 flex-col gap-1 px-3">
          {items.map((item) => {
            const active = isActive(location.pathname, item);
            return (
              <Link
                key={item.to}
                to={item.to}
                className="flex items-center gap-3 rounded-md px-3 py-2.5 font-mono-display text-sm transition"
                style={
                  active
                    ? { background: "color-mix(in srgb, " + accent + " 14%, transparent)", color: accent }
                    : { color: "var(--text-muted)" }
                }
                onMouseEnter={(e) => { if (!active) e.currentTarget.style.color = "var(--text)"; }}
                onMouseLeave={(e) => { if (!active) e.currentTarget.style.color = "var(--text-muted)"; }}
              >
                <Icon name={item.icon} />
                {t(item.labelKey)}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-[var(--line)] p-3">
          <button
            onClick={() => viewAs(otherRole)}
            className="mb-2 flex w-full items-center gap-3 rounded-md px-3 py-2.5 font-mono-display text-xs text-[var(--text-muted)] transition hover:text-[var(--text)]"
            title={t("app.viewAs", { role: t("app." + otherRole) })}
          >
            <Icon name="swap" />
            {t("app.viewAs", { role: t("app." + otherRole) })}
          </button>

          <div className="mb-2 flex items-center justify-between gap-2 px-1">
            <ThemeToggle variant="full" className="!mb-0 !px-2" />
            <LanguageToggle accent={accent} />
          </div>

          <div className="flex items-center gap-3 rounded-md px-3 py-2">
            <span
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full font-mono-display text-[11px] font-semibold"
              style={{ border: `1px solid ${accent}`, color: accent }}
            >
              {initials}
            </span>
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-xs font-semibold">{user?.fullName}</p>
              <p className="truncate font-mono-display text-[10px] text-[var(--text-muted)]">{user?.email}</p>
            </div>
            <button
              onClick={logout}
              title={t("app.logout")}
              className="text-[var(--text-muted)] transition hover:text-[var(--text)]"
            >
              <Icon name="logout" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="min-w-0 flex-1 px-8 py-8">{children}</main>
    </div>
  );
}

// Small colored status pill reused across problem/proposal cards.
export function StatusPill({ status }) {
  const { t } = useLang();
  const colors = {
    open: "var(--connect)",
    closed: "var(--text-muted)",
    pending: "var(--signal)",
    accepted: "var(--connect)",
    rejected: "#F87171",
  };
  const color = colors[status] || "var(--text-muted)";
  const label = colors[status] ? t("status." + status) : status;
  return (
    <span
      className="rounded-full px-2.5 py-0.5 font-mono-display text-[11px] font-semibold"
      style={{ color, border: `1px solid ${color}` }}
    >
      {label}
    </span>
  );
}

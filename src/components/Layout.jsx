import { useEffect, useState } from "react";
import { api, nav } from "../lib/api";
import { orgTypeFor, NAV_MODULES, NAV_GROUPS, MOBILE_PRIORITY } from "../lib/businessTypes";
import BusinessSwitcher from "./BusinessSwitcher";
import SyncStatus from "./SyncStatus.jsx";
import ThemeToggle from "./ThemeToggle.jsx";
import UsageMeter, { UpgradeNudge } from "./UsageMeter.jsx";

const ALL_LINKS = [
  { to: "/app/dashboard", label: "Dashboard", icon: "📊" },
  { to: "/app/sales", label: "Sales", icon: "🧾" },
  { to: "/app/services", label: "Services", icon: "🛠️" },
  { to: "/app/products", label: "Products", icon: "📦" },
  { to: "/app/suppliers", label: "Suppliers", icon: "🚚" },
  { to: "/app/import", label: "Import", icon: "📥" },
  { to: "/app/expenses", label: "Expenses", icon: "💸" },
  { to: "/app/customers", label: "Customers", icon: "👥" },
  { to: "/app/hotels", label: "Hotels", icon: "🏨" },
  { to: "/app/debts", label: "Debts", icon: "📒" },
  { to: "/app/messages", label: "Messages", icon: "💬" },
  { to: "/app/reports", label: "Reports", icon: "📈" },
  { to: "/app/staff", label: "Staff", icon: "🧑‍💼" },
  { to: "/app/activity", label: "Activity", icon: "🕒" },
  { to: "/app/settings", label: "Settings", icon: "⚙️" },
];

export default function Layout({ session, children }) {
  const [open, setOpen] = useState(false);
  const [billing, setBilling] = useState(null);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem("kopabook-sidebar") === "collapsed"; } catch { return false; }
  });
  const path = window.location.pathname;

  // Each organization type only sees the service modules that fit it.
  const org = orgTypeFor(session?.business?.business_type);
  const LINKS = ALL_LINKS.filter((l) => org.modules.includes(NAV_MODULES[l.to]));
  const linkByModule = Object.fromEntries(LINKS.map((l) => [NAV_MODULES[l.to], l]));

  // Sidebar groups, skipping empty ones for this org type.
  const groups = NAV_GROUPS
    .map((g) => ({ label: g.label, links: g.modules.map((m) => linkByModule[m]).filter(Boolean) }))
    .filter((g) => g.links.length > 0);

  // Mobile bottom bar: top priority modules for this org + a More drawer button.
  const mobileLinks = [...LINKS]
    .sort((a, b) => MOBILE_PRIORITY.indexOf(NAV_MODULES[a.to]) - MOBILE_PRIORITY.indexOf(NAV_MODULES[b.to]))
    .slice(0, 4);

  useEffect(() => {
    api.get("/api/billing").then(setBilling).catch(() => {});
  }, []);

  async function logout() {
    try { await api.logout(); } finally { nav("/login"); }
  }

  function toggleCollapse() {
    const next = !collapsed;
    setCollapsed(next);
    try { localStorage.setItem("kopabook-sidebar", next ? "collapsed" : "open"); } catch {}
  }

  const navCls = (to) => (path === to || path.startsWith(to + "/") ? "active" : "");

  return (
    <div className="app">
      <aside className={"sidebar" + (open ? " open" : "") + (collapsed ? " collapsed" : "")}>
        <div className="brand-row">
          <div className="brand">{collapsed ? "K" : <>Kopa<span>Book</span></>}</div>
          <button className="collapse-btn" onClick={toggleCollapse}
            aria-label={collapsed ? "Expand menu" : "Hide menu"}
            title={collapsed ? "Expand menu" : "Hide menu"}>
            {collapsed ? "»" : "«"}
          </button>
        </div>
        <BusinessSwitcher session={session} collapsed={collapsed} />
        <nav className="snav">
          {groups.map((g, gi) => (
            <div key={gi} className="nav-group">
              {g.label && <div className="nav-group-label">{g.label}</div>}
              {g.links.map((l) => (
                <a key={l.to} href={l.to} className={navCls(l.to)} title={l.label}>
                  <span className="nico">{l.icon}</span><span className="lbl">{l.label}</span>
                </a>
              ))}
            </div>
          ))}
        </nav>
        <div className="user">
          <div className="uinfo">
            <div>{session.user?.fullName}</div>
            <div style={{ color: "#9fb3a6" }}>{session.business?.role}</div>
          </div>
          <button onClick={logout}>Log out</button>
        </div>
      </aside>

      <div className="main">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 0" }}>
          <button className="menu-btn" onClick={() => setOpen(!open)}>☰ Menu</button>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <ThemeToggle />
            <SyncStatus />
          </div>
        </div>
        {billing && (
          <UpgradeNudge
            tier={billing.tier}
            salesThisWeek={billing.usage?.salesThisWeek || 0}
            salesLimit={billing.limits?.salesPerWeek}
          />
        )}
        {children}
      </div>

      <nav className="mobilebar">
        {mobileLinks.map((l) => (
          <a key={l.to} href={l.to} className={navCls(l.to)}>
            <span className="mi">{l.icon}</span>
            {l.label}
          </a>
        ))}
        <button className="more-btn" onClick={() => setOpen(true)} aria-label="More menu">
          <span className="mi">☰</span>
          More
        </button>
      </nav>
    </div>
  );
}

import { useEffect, useState } from "react";
import { api, nav } from "../lib/api";
import { orgTypeFor, NAV_MODULES, NAV_GROUPS, MOBILE_PRIORITY, modulesForRole } from "../lib/businessTypes";
import BusinessSwitcher from "./BusinessSwitcher";
import SyncStatus from "./SyncStatus.jsx";
import ThemeToggle from "./ThemeToggle.jsx";
import UsageMeter, { UpgradeNudge } from "./UsageMeter.jsx";
import Logo from "./Logo.jsx";

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
  { to: "/app/projects", label: "Projects", icon: "📁" },
  { to: "/app/messages", label: "Messages", icon: "💬" },
  { to: "/app/reports", label: "Reports", icon: "📈" },
  { to: "/app/staff", label: "Staff", icon: "🧑‍💼" },
  { to: "/app/activity", label: "Activity", icon: "🕒" },
  { to: "/app/notebook", label: "Notebook", icon: "📓" },
  { to: "/app/calculator", label: "Calculator", icon: "🧮" },
  { to: "/app/settings", label: "Settings", icon: "⚙️" },
];

export default function Layout({ session, children }) {
  const [open, setOpen] = useState(false);
  const [billing, setBilling] = useState(null);
  const [displayName, setDisplayName] = useState(session.user?.fullName || "");

  // Refresh the sidebar name when the profile is saved in Settings (no reload).
  useEffect(() => {
    const handler = (e) => { if (e.detail?.fullName) setDisplayName(e.detail.fullName); };
    window.addEventListener("kopabook:profile-updated", handler);
    return () => window.removeEventListener("kopabook:profile-updated", handler);
  }, []);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem("kopabook-sidebar") === "collapsed"; } catch { return false; }
  });
  const [promoDismissed, setPromoDismissed] = useState(() => {
    try { return !!localStorage.getItem("kb_promo_banner_dismissed_pro-free-month"); } catch { return false; }
  });

  function dismissPromo() {
    setPromoDismissed(true);
    try { localStorage.setItem("kb_promo_banner_dismissed_pro-free-month", "1"); } catch {}
  }
  const path = window.location.pathname;

  // Each organization type only sees the service modules that fit it.
  const org = orgTypeFor(session?.business?.business_type);
  const LINKS = ALL_LINKS.filter((l) => org.modules.includes(NAV_MODULES[l.to]));
  // Staff see only their role's workspace; owners and partners see everything.
  const roleModules = modulesForRole(session.business?.role);
  const VISIBLE = roleModules ? LINKS.filter((l) => roleModules.includes(NAV_MODULES[l.to])) : LINKS;
  const linkByModule = Object.fromEntries(VISIBLE.map((l) => [NAV_MODULES[l.to], l]));

  // Sidebar groups, skipping empty ones for this org type.
  const groups = NAV_GROUPS
    .map((g) => ({ label: g.label, links: g.modules.map((m) => linkByModule[m]).filter(Boolean) }))
    .filter((g) => g.links.length > 0);

  // Mobile bottom bar: top priority modules for this org + a More drawer button.
  const mobileLinks = [...VISIBLE]
    .sort((a, b) => MOBILE_PRIORITY.indexOf(NAV_MODULES[a.to]) - MOBILE_PRIORITY.indexOf(NAV_MODULES[b.to]))
    .slice(0, 4);

  useEffect(() => {
    api.get("/api/billing").then(setBilling).catch(() => {});
  }, []);

  // Marks the signed-in app so the chat widget can sit clear of the
  // mobile bottom bar.
  useEffect(() => {
    document.body.classList.add("kb-in-app");
    return () => document.body.classList.remove("kb-in-app");
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

  // Escape closes the mobile drawer.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open ]);

  return (
    <div className="app">
      <aside className={"sidebar" + (open ? " open" : "") + (collapsed ? " collapsed" : "")}>
        {open && (
          <button
            onClick={() => setOpen(false)}
            aria-label="Close menu"
            title="Close menu"
            style={{
              position: "absolute",
              top: 10,
              right: 10,
              background: "rgba(255,255,255,0.08)",
              border: "0",
              borderRadius: 8,
              width: 30,
              height: 30,
              cursor: "pointer",
              color: "#d7e3da",
              fontSize: 16,
              lineHeight: 1,
              zIndex: 101,
            }}
          >
            ✕
          </button>
        )}
        <div className="brand-row">
          <div className="brand">{collapsed ? "K" : <Logo />}</div>
          <button className="collapse-btn" onClick={toggleCollapse}
            aria-label={collapsed ? "Expand menu" : "Hide menu"}
            title={collapsed ? "Expand menu" : "Hide menu"}>
            {collapsed ? "»" : "«"}
          </button>
        </div>
        <BusinessSwitcher session={session} collapsed={collapsed} />
        <nav className="snav chat-entry-nav">
          <div className="nav-group">
            <div className="nav-group-label">Chat</div>
            <a href="/app/chat/ai" className="ask-ai-entry" title="Ask Kopa AI">
              <span className="nico">🤖</span><span className="lbl">Ask Kopa AI</span>
            </a>
            <a href="/app/chat/support" className={navCls("/app/chat/support")} title="Kopa Support">
              <span className="nico">💬</span><span className="lbl">Kopa Support</span>
            </a>
            <a href="/app/chat" className={path === "/app/chat" ? "active" : ""} title="Chat home">
              <span className="nico">🏠</span><span className="lbl">Chat home</span>
            </a>
          </div>
        </nav>
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
        {session.user?.isPlatformAdmin && (
          <nav className="snav">
            <div className="nav-group">
              <div className="nav-group-label">Platform</div>
              <a href="/app/admin" className={navCls("/app/admin")} title="Admin">
                <span className="nico">👑</span><span className="lbl">Admin</span>
              </a>
            </div>
          </nav>
        )}
        <div className="user">
          <div className="uinfo">
            <div>{displayName}</div>
            <div style={{ color: "#9fb3a6" }}>{session.business?.role}</div>
          </div>
          <button onClick={logout}>Log out</button>
        </div>
      </aside>

      {open && (
        <div
          onClick={() => setOpen(false)}
          aria-hidden="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,.4)",
            zIndex: 99,
          }}
        />
      )}

      <div className="main">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 0" }}>
          <button className="menu-btn" onClick={() => setOpen(!open)}>☰ Menu</button>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <ThemeToggle />
            <SyncStatus />
            <button
              onClick={logout}
              title="Sign out"
              aria-label="Sign out"
              style={{
                background: "transparent",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: "6px 10px",
                cursor: "pointer",
                color: "inherit",
                fontSize: 13,
              }}
            >
              ⎋ Sign out
            </button>
          </div>
        </div>
        {billing && billing.promo && billing.promo.available && !promoDismissed && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              flexWrap: "wrap",
              padding: "8px 12px",
              marginBottom: 10,
              border: "1px solid var(--brand)",
              borderRadius: 8,
              background: "var(--bg-soft, #f8fafc)",
              fontSize: 13,
            }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", minWidth: 0 }}>
              <span>Pro is free for one month. No card needed.</span>
              <a href="/app/settings" style={{ color: "var(--brand)", fontWeight: 600 }}>Claim it in Settings</a>
            </span>
            <button
              type="button"
              onClick={dismissPromo}
              aria-label="Dismiss promotion"
              title="Dismiss promotion"
              style={{
                background: "transparent",
                border: "1px solid var(--border)",
                borderRadius: 8,
                width: 28,
                height: 28,
                padding: 0,
                cursor: "pointer",
                color: "inherit",
                fontSize: 16,
                lineHeight: 1,
                flexShrink: 0,
              }}
            >
              ×
            </button>
          </div>
        )}
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

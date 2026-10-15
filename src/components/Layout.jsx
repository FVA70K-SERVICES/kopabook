import { useEffect, useState } from "react";
import { api, nav } from "../lib/api";
import { orgTypeFor, NAV_MODULES } from "../lib/businessTypes";
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
  { to: "/app/settings", label: "Settings", icon: "⚙️" },
];

export default function Layout({ session, children }) {
  const [open, setOpen] = useState(false);
  const [billing, setBilling] = useState(null);
  const path = window.location.pathname;

  // Each organization type only sees the service modules that fit it.
  const org = orgTypeFor(session?.business?.business_type);
  const LINKS = ALL_LINKS.filter((l) => org.modules.includes(NAV_MODULES[l.to]));

  useEffect(() => {
    api.get("/api/billing").then(setBilling).catch(() => {});
  }, []);

  async function logout() {
    try { await api.logout(); } finally { nav("/login"); }
  }

  const navCls = (to) => (path === to || path.startsWith(to + "/") ? "active" : "");

  return (
    <div className="app">
      <aside className={"sidebar" + (open ? " open" : "")}>
        <div className="brand">Kopa<span>Book</span></div>
        <div className="biz">{session.business?.name || "Your business"}</div>
        <nav className="snav">
          {LINKS.map((l) => (
            <a key={l.to} href={l.to} className={navCls(l.to)}>
              <span>{l.icon}</span> {l.label}
            </a>
          ))}
        </nav>
        <div className="user">
          <div>{session.user?.fullName}</div>
          <div style={{ color: "#9fb3a6" }}>{session.business?.role}</div>
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
        {LINKS.slice(0, 5).map((l) => (
          <a key={l.to} href={l.to} className={navCls(l.to)}>
            <span className="mi">{l.icon}</span>
            {l.label}
          </a>
        ))}
      </nav>
    </div>
  );
}

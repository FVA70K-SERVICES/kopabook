import { useEffect, useState } from "react";
import { api, fmt } from "../lib/api";

export default function DashboardPage() {
  const [state, setState] = useState({ loading: true, metrics: null, recentSales: [], error: "" });

  useEffect(() => {
    let active = true;
    api.get("/api/dashboard")
      .then((d) => { if (active) setState({ loading: false, metrics: d.metrics, recentSales: d.recentSales || [], error: "" }); })
      .catch((e) => { if (active) setState({ loading: false, metrics: null, recentSales: [], error: e.message }); });
    return () => { active = false; };
  }, []);

  if (state.loading) return <div className="loading">Loading your live dashboard...</div>;
  if (state.error || !state.metrics) return <div className="alert alert-error">{state.error || "Could not load dashboard."}</div>;

  const m = state.metrics;

  return (
    <>
      <div className="page-head">
        <h1>Dashboard</h1>
        <a href="/app/sales" className="btn btn-primary btn-sm">+ New sale</a>
      </div>

      <div className="metric-grid">
        <div className="metric-card"><span>Sales today</span><strong>{fmt(m.todaySalesTotal)}</strong></div>
        <div className="metric-card"><span>Expenses today</span><strong>{fmt(m.todayExpensesTotal)}</strong></div>
        <div className="metric-card bad"><span>Outstanding debt</span><strong>{fmt(m.outstandingDebtTotal)}</strong></div>
        <div className="metric-card warn"><span>Low stock items</span><strong>{m.lowStockCount}</strong></div>
      </div>

      <div className="dash-grid">
        <div className="card list-card">
          <h3>Today at a glance</h3>
          <ul>
            <li><span>Sales made</span><strong>{m.todaySalesCount}</strong></li>
            <li><span>Expenses logged</span><strong>{m.todayExpensesCount}</strong></li>
            <li><span>Customers owing</span><strong>{m.openDebtCount}</strong></li>
            <li><span>Active products</span><strong>{m.totalProducts}</strong></li>
          </ul>
        </div>

        <div className="card list-card">
          <h3>Quick actions</h3>
          <ul>
            <li><a href="/app/sales">Record a sale</a><span>🧾</span></li>
            <li><a href="/app/products">Manage products</a><span>📦</span></li>
            <li><a href="/app/expenses">Add an expense</a><span>💸</span></li>
            <li><a href="/app/debts">Review debts</a><span>📒</span></li>
          </ul>
        </div>

        <div className="card list-card">
          <h3>Recent sales</h3>
          {state.recentSales.length === 0 ? (
            <p className="empty">No sales recorded yet.</p>
          ) : (
            <ul>
              {state.recentSales.map((s) => (
                <li key={s.id}>
                  <span>{s.sale_number}<br /><small style={{ color: "var(--muted)" }}>{s.customer_name || "Walk-in"}</small></span>
                  <span className="money">{fmt(s.total_amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}

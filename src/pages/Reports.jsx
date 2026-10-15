import { useEffect, useState } from "react";
import { api, fmt, todayISO } from "../lib/api";

export default function ReportsPage() {
  const [from, setFrom] = useState(new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState(todayISO());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    try {
      const d = await api.get(`/api/reports?from=${from}&to=${to}`);
      setData(d); setError("");
    } catch (e) { setError(e.message); }
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const maxDay = data && data.daily.length ? Math.max(...data.daily.map((d) => Number(d.sales_total))) : 1;

  return (
    <>
      <div className="page-head"><h1>Reports</h1></div>

      <div className="toolbar">
        <input type="date" className="search" style={{ minWidth: 0 }} value={from} onChange={(e) => setFrom(e.target.value)} />
        <input type="date" className="search" style={{ minWidth: 0 }} value={to} onChange={(e) => setTo(e.target.value)} />
        <button className="btn btn-primary btn-sm" onClick={load}>Run report</button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {loading ? <div className="loading">Loading...</div> : data && (
        <>
          <div className="metric-grid">
            <div className="metric-card"><span>Sales</span><strong>{fmt(data.totals.salesTotal)}</strong></div>
            <div className="metric-card"><span>Transactions</span><strong>{data.totals.salesCount}</strong></div>
            <div className="metric-card"><span>Expenses</span><strong>{fmt(data.totals.expenseTotal)}</strong></div>
            {data.totals.profit !== null && data.totals.profit !== undefined && (
              <div className="metric-card"><span>Net</span><strong style={{ color: data.totals.profit >= 0 ? "var(--brand-dark)" : "var(--danger)" }}>{fmt(data.totals.profit)}</strong></div>
            )}
          </div>

          <div className="dash-grid">
            <div className="card">
              <h3>Daily sales</h3>
              {data.daily.length === 0 ? <p className="empty">No sales in this range.</p> : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
                  {data.daily.map((d) => (
                    <div key={d.day}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                        <span>{d.day}</span><span className="money">{fmt(d.sales_total)}</span>
                      </div>
                      <div style={{ height: 8, background: "var(--line)", borderRadius: 4 }}>
                        <div style={{ height: 8, width: `${Math.max(3, (Number(d.sales_total) / maxDay) * 100)}%`, background: "var(--brand)", borderRadius: 4 }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card list-card">
              <h3>Top products</h3>
              {data.topProducts.length === 0 ? <p className="empty">No product sales in this range.</p> : (
                <ul>{data.topProducts.map((p, i) => (
                  <li key={i}><span>{p.name} <small style={{ color: "var(--muted)" }}>× {p.qty}</small></span><span className="money">{fmt(p.revenue)}</span></li>
                ))}</ul>
              )}
            </div>

            <div className="card list-card">
              <h3>Expenses by category</h3>
              {data.expensesByCategory.length === 0 ? <p className="empty">No expenses in this range.</p> : (
                <ul>{data.expensesByCategory.map((c, i) => (
                  <li key={i}><span>{c.category}</span><span className="money">{fmt(c.total)}</span></li>
                ))}</ul>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}

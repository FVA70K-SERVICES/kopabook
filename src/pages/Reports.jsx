import { useEffect, useState } from "react";
import { api, fmt, todayISO } from "../lib/api";

function csvCell(value) {
  const s = String(value === null || value === undefined ? "" : value);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function buildCsv(data) {
  const lines = [];
  const row = (cells) => lines.push(cells.map(csvCell).join(","));
  row(["KopaBook report", `${data.from} to ${data.to}`]);
  row([]);

  row(["Summary"]);
  row(["Sales total", data.totals.salesTotal]);
  row(["Transactions", data.totals.salesCount]);
  row(["Expenses total", data.totals.expenseTotal]);
  if (data.totals.profit !== null && data.totals.profit !== undefined) row(["Net", data.totals.profit]);
  row([]);

  row(["Profit trend"]);
  const showCost = data.profitTrend.length > 0 && data.profitTrend[0].cost !== null;
  row(showCost ? ["Period", "Revenue", "Cost", "Profit"] : ["Period", "Revenue"]);
  for (const t of data.profitTrend) {
    row(showCost ? [t.period, t.revenue, t.cost, t.profit] : [t.period, t.revenue]);
  }
  row([]);

  row(["Top products by revenue"]);
  row(["Product", "Quantity", "Revenue"]);
  for (const p of data.bestSellers.byRevenue) row([p.name, p.qty, p.revenue]);
  row([]);

  row(["Top products by quantity"]);
  row(["Product", "Quantity", "Revenue"]);
  for (const p of data.bestSellers.byQuantity) row([p.name, p.qty, p.revenue]);
  row([]);

  row(["Expenses by category"]);
  row(["Category", "Total"]);
  for (const c of data.expensesByCategory) row([c.category, c.total]);
  row([]);

  row(["Slow movers (stock on hand, no sales in range)"]);
  row(["Product", "Stock", "Unit price"]);
  for (const p of data.slowMovers) row([p.name, p.stock, p.price]);
  row([]);

  row(["Payment method breakdown"]);
  row(["Method", "Transactions", "Total"]);
  for (const m of data.paymentBreakdown) row([m.method, m.count, m.total]);

  return lines.join("\r\n");
}

export default function ReportsPage() {
  const [from, setFrom] = useState(new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState(todayISO());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [byQty, setByQty] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const d = await api.get(`/api/reports?from=${from}&to=${to}`);
      setData(d); setError("");
    } catch (e) { setError(e.message); }
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  function downloadCsv() {
    if (!data) return;
    const csv = buildCsv(data);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `kopabook-report-${data.from}-to-${data.to}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const maxDay = data && data.daily.length ? Math.max(...data.daily.map((d) => Number(d.sales_total))) : 1;
  const maxRev = data && data.profitTrend.length ? Math.max(...data.profitTrend.map((t) => Number(t.revenue)), 1) : 1;
  const maxPay = data && data.paymentBreakdown.length ? Math.max(...data.paymentBreakdown.map((m) => Number(m.total)), 1) : 1;
  const canSeeCost = data && data.profitTrend.length > 0 && data.profitTrend[0].cost !== null;

  return (
    <>
      <div className="page-head"><h1>Reports</h1></div>

      <div className="toolbar">
        <input type="date" className="search" style={{ minWidth: 0 }} value={from} onChange={(e) => setFrom(e.target.value)} />
        <input type="date" className="search" style={{ minWidth: 0 }} value={to} onChange={(e) => setTo(e.target.value)} />
        <button className="btn btn-primary btn-sm" onClick={load}>Run report</button>
        <button className="btn btn-sm" onClick={downloadCsv} disabled={!data || loading}>Download CSV</button>
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

            <div className="card">
              <h3>Profit trend</h3>
              {data.profitTrend.length === 0 ? <p className="empty">No sales in this range.</p> : (
                <div style={{ marginTop: 12 }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {data.profitTrend.map((t) => (
                      <div key={t.period}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                          <span>{t.period}</span>
                          <span>
                            <span className="money">{fmt(t.revenue)}</span>
                            {t.profit !== null && (
                              <span style={{ marginLeft: 8, color: t.profit >= 0 ? "var(--brand-dark)" : "var(--danger)" }}>
                                {t.profit >= 0 ? "+" : ""}{fmt(t.profit)}
                              </span>
                            )}
                          </span>
                        </div>
                        <div style={{ height: 8, background: "var(--line)", borderRadius: 4, position: "relative", overflow: "hidden" }}>
                          {canSeeCost ? (
                            <>
                              <div style={{ position: "absolute", inset: 0, width: `${Math.max(0, (t.revenue / maxRev) * 100)}%`, background: "var(--brand)" }} />
                              <div style={{ position: "absolute", inset: 0, width: `${Math.max(0, (t.cost / maxRev) * 100)}%`, background: "var(--danger)", opacity: 0.55 }} />
                            </>
                          ) : (
                            <div style={{ height: 8, width: `${Math.max(3, (t.revenue / maxRev) * 100)}%`, background: "var(--brand)", borderRadius: 4 }} />
                          )}
                        </div>
                        {canSeeCost && (
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--muted)" }}>
                            <span>Cost {fmt(t.cost)}</span><span>Profit {fmt(t.profit)}</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  {canSeeCost && (
                    <div style={{ display: "flex", gap: 16, fontSize: 12, color: "var(--muted)", marginTop: 8 }}>
                      <span><span style={{ display: "inline-block", width: 10, height: 10, background: "var(--brand)", borderRadius: 2, marginRight: 4 }} />Revenue</span>
                      <span><span style={{ display: "inline-block", width: 10, height: 10, background: "var(--danger)", opacity: 0.55, borderRadius: 2, marginRight: 4 }} />Cost</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="card list-card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h3>Best sellers</h3>
                <button className="btn btn-sm" onClick={() => setByQty(!byQty)}>{byQty ? "By revenue" : "By quantity"}</button>
              </div>
              {(byQty ? data.bestSellers.byQuantity : data.bestSellers.byRevenue).length === 0 ? <p className="empty">No product sales in this range.</p> : (
                <ul>{(byQty ? data.bestSellers.byQuantity : data.bestSellers.byRevenue).map((p, i) => (
                  <li key={i}>
                    <span><strong style={{ color: "var(--muted)", marginRight: 6 }}>{i + 1}.</strong>{p.name} <small style={{ color: "var(--muted)" }}>× {p.qty}</small></span>
                    <span className="money">{fmt(p.revenue)}</span>
                  </li>
                ))}</ul>
              )}
            </div>

            <div className="card list-card">
              <h3>Slow movers</h3>
              {data.slowMovers.length === 0 ? <p className="empty">Every stocked product sold in this range.</p> : (
                <ul>{data.slowMovers.map((p, i) => (
                  <li key={i}>
                    <span>{p.name} <small style={{ color: "var(--muted)" }}>{p.stock} in stock at {fmt(p.price)}</small></span>
                    <span className="money">{fmt(Number(p.stock) * Number(p.price))}</span>
                  </li>
                ))}</ul>
              )}
            </div>

            <div className="card list-card">
              <h3>Payment methods</h3>
              {data.paymentBreakdown.length === 0 ? <p className="empty">No sales in this range.</p> : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
                  {data.paymentBreakdown.map((m, i) => (
                    <div key={i}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                        <span style={{ textTransform: "capitalize" }}>{m.method} <small style={{ color: "var(--muted)" }}>× {m.count}</small></span>
                        <span className="money">{fmt(m.total)}</span>
                      </div>
                      <div style={{ height: 8, background: "var(--line)", borderRadius: 4 }}>
                        <div style={{ height: 8, width: `${Math.max(3, (Number(m.total) / maxPay) * 100)}%`, background: "var(--brand)", borderRadius: 4 }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import { api, fmt, todayISO } from "../lib/api";
import PinInvite from "../components/PinInvite";

// WORLD-BEST (Dashboard stream): number count-up. Counts from the previous
// value (or zero) to the new value over 600ms. The full figure is always
// shown at the end, and with prefers-reduced-motion the real figure shows
// at once — the count-up never delays it.
function useCountUp(value) {
  const [shown, setShown] = useState(value);
  const prevRef = useRef(value);
  useEffect(() => {
    const from = prevRef.current;
    const to = Number(value || 0);
    prevRef.current = to;
    if (from === to) { setShown(to); return; }
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(to);
      return;
    }
    const start = performance.now();
    let raf = 0;
    function tick(now) {
      const p = Math.min(1, (now - start) / 600);
      setShown(from + (to - from) * p);
      if (p < 1) raf = requestAnimationFrame(tick);
      else setShown(to);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return shown;
}

function CountUp({ value, money }) {
  const shown = useCountUp(value);
  return <>{money ? fmt(Math.round(shown * 100) / 100) : Math.round(shown).toLocaleString("en-US")}</>;
}

function csvCell(value) {
  const s = String(value === null || value === undefined ? "" : value);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// CSV export of today's sales, reusing the Reports buildCsv pattern.
function buildTodayCsv(sales, dateLabel) {
  const lines = [];
  const row = (cells) => lines.push(cells.map(csvCell).join(","));
  row(["KopaBook sales", dateLabel]);
  row([]);
  row(["Receipt", "Date", "Customer", "Total", "Paid", "Balance due", "Method"]);
  for (const s of sales) {
    row([s.sale_number, (s.created_at || "").slice(0, 10), s.customer_name || "Walk-in", s.total_amount, s.amount_paid, s.balance_due, s.payment_method || ""]);
  }
  return lines.join("\r\n");
}

export default function DashboardPage() {
  const [state, setState] = useState({ loading: true, metrics: null, recentSales: [], error: "" });
  const [refreshing, setRefreshing] = useState(false);
  const [updatedNote, setUpdatedNote] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());
  const [historySales, setHistorySales] = useState(null);
  const [historyError, setHistoryError] = useState("");
  const [tier, setTier] = useState(null);
  const [exporting, setExporting] = useState(false);
  const touchStartY = useRef(null);
  const pullingRef = useRef(false);

  const load = useCallback(async (isRefresh) => {
    if (isRefresh) setRefreshing(true);
    try {
      const d = await api.get("/api/dashboard");
      setState({ loading: false, metrics: d.metrics, recentSales: d.recentSales || [], error: "" });
      if (isRefresh) {
        setUpdatedNote(`Updated ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`);
      }
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: e.message }));
    }
    if (isRefresh) setRefreshing(false);
  }, []);

  useEffect(() => { load(false); }, [load]);

  // Starter tier, for the CSV export gate (same gate as Reports).
  useEffect(() => {
    api.get("/api/billing").then((d) => setTier(d.tier || "free")).catch(() => setTier("free"));
  }, []);

  // Auto-refresh toggle (60s), default off. No websocket.
  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(() => load(true), 60000);
    return () => clearInterval(t);
  }, [autoRefresh, load]);

  // Pull-to-refresh: pull down from the top of the page, release to refresh.
  function onTouchStart(e) {
    touchStartY.current = e.touches[0].clientY;
    pullingRef.current = false;
  }
  function onTouchMove(e) {
    if (touchStartY.current === null) return;
    const dy = e.touches[0].clientY - touchStartY.current;
    if (window.scrollY === 0 && dy > 70) pullingRef.current = true;
  }
  function onTouchEnd() {
    if (pullingRef.current) {
      pullingRef.current = false;
      touchStartY.current = null;
      load(true);
      return;
    }
    touchStartY.current = null;
  }

  // Sales history: date range on /api/sales (as the Sales page already does).
  async function loadHistory() {
    setHistoryError("");
    try {
      const d = await api.get(`/api/sales?from=${from}&to=${to}&limit=100`);
      setHistorySales(d.sales || []);
    } catch (e) { setHistoryError(e.message); }
  }

  async function exportTodayCsv() {
    if (!canExport) return;
    setExporting(true);
    try {
      const d = await api.get(`/api/sales?from=${todayISO()}&to=${todayISO()}&limit=200`);
      const csv = buildTodayCsv(d.sales || [], todayISO());
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `kopabook-sales-${todayISO()}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setHistoryError(e.message); }
    setExporting(false);
  }

  if (state.loading) return <div className="loading">Loading your live dashboard...</div>;
  if (state.error || !state.metrics) return <div className="alert alert-error">{state.error || "Could not load dashboard."}</div>;

  const m = state.metrics;
  const canExport = tier !== null && ["pro", "solo", "starter"].includes(tier);
  const tendered = m.tenderedByMethod || m.collectedByMethod || {};
  const creditMethods = new Set(m.creditMethods || []);
  const trend = m.trend7d || [];
  const maxTrend = trend.length ? Math.max(...trend.map((t) => Number(t.revenue || 0)), 1) : 1;
  const canSeeTrendCost = trend.length > 0 && trend[0].cost !== null && trend[0].cost !== undefined;
  const hasInsights = m.bestSeller || m.busiestHour || m.topDebtor;

  // Recent sales list: the date-range history when loaded, else today.
  const listedSales = historySales === null ? state.recentSales : historySales;
  const q = search.trim().toLowerCase();
  const shownSales = q
    ? listedSales.filter((s) =>
        String(s.sale_number || "").toLowerCase().includes(q) ||
        String(s.customer_name || "").toLowerCase().includes(q))
    : listedSales;

  return (
    <div
      className="page-fade"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      <PinInvite />
      <div className="page-head">
        <h1>Dashboard</h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 14, minHeight: 44 }}>
            <input type="checkbox" checked={autoRefresh} aria-label="Auto-refresh every 60 seconds" onChange={(e) => setAutoRefresh(e.target.checked)} />
            Auto-refresh (60s)
          </label>
          <button className="btn btn-secondary btn-sm" style={{ minHeight: 44 }} onClick={() => load(true)} disabled={refreshing}>
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
          <a href="/app/sales" className="btn btn-primary btn-sm" style={{ minHeight: 44, display: "inline-flex", alignItems: "center" }}>+ New sale</a>
        </div>
      </div>
      {refreshing && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
          <span className="ptr-spinner" aria-hidden="true" />
          <span className="ptr-note">Refreshing...</span>
        </div>
      )}
      {updatedNote && !refreshing && <p className="ptr-note" style={{ marginTop: 0 }}>{updatedNote}</p>}

      <div className="metric-grid">
        <div className="metric-card dash-card-enter" style={{ animationDelay: "0ms" }}><span>Sales today</span><strong><CountUp value={m.todaySalesTotal} money /></strong></div>
        <div className="metric-card dash-card-enter" style={{ animationDelay: "40ms" }}><span>Expenses today</span><strong><CountUp value={m.todayExpensesTotal} money /></strong></div>
        {Number(m.todayChangeGiven || 0) > 0 && (
          <div className="metric-card dash-card-enter" style={{ animationDelay: "80ms" }}><span>Change given today</span><strong><CountUp value={m.todayChangeGiven} money /></strong></div>
        )}
        <div className="metric-card bad dash-card-enter" style={{ animationDelay: "120ms" }}>
          <span>Owed to you</span><strong><CountUp value={m.outstandingDebtTotal} money /></strong>
          {Number(m.overdueCount || 0) > 0 && (
            <small style={{ color: "var(--danger)" }}>{m.overdueCount} overdue {m.overdueDays ? `(over ${m.overdueDays} days)` : ""}</small>
          )}
        </div>
        <div className="metric-card warn dash-card-enter" style={{ animationDelay: "160ms" }}>
          <span>Low stock items</span><strong><CountUp value={m.lowStockCount} /></strong>
          {Number(m.lowStockCount || 0) > 0 && (
            <small>
              <a href="/app/products">See low-stock products</a>
              {Number(m.lowStockCount || 0) <= 3 && (m.lowStockNames || []).length > 0 && (
                <> — {(m.lowStockNames || []).join(", ")}</>
              )}
            </small>
          )}
        </div>
      </div>

      {Object.keys(tendered).length > 0 && (
        <div className="card dash-card-enter" style={{ marginBottom: 18, animationDelay: "200ms" }}>
          <h3 style={{ marginTop: 0 }}>Tendered by method</h3>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {Object.entries(tendered).map(([method, total]) => (
              <li key={method} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                <span style={{ textTransform: "capitalize" }}>
                  {method}{creditMethods.has(method) ? " (on credit)" : ""}
                </span>
                <strong className="money">{fmt(total)}</strong>
              </li>
            ))}
            {Number(m.todayChangeGiven || 0) > 0 && (
              <li style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                <span>Given back as change</span>
                <strong className="money" style={{ color: "var(--gold, #b45309)" }}>({fmt(m.todayChangeGiven)})</strong>
              </li>
            )}
            <li style={{ display: "flex", justifyContent: "space-between", padding: "6px 0" }}>
              <span>Actually received</span>
              <strong className="money">{fmt(m.actuallyReceived ?? m.todaySalesTotal)}</strong>
            </li>
          </ul>
          <p className="hint" style={{ marginBottom: 0 }}>
            Have: {fmt(m.todaySalesTotal)} collected · Haven't: {fmt(m.outstandingDebtTotal)} still owed by customers
          </p>
          {Number(m.creditTenderedToday || 0) > 0 && (
            <p className="hint" style={{ marginBottom: 0 }}>
              {fmt(m.creditTenderedToday)} tendered on credit is still owed, not money in.
            </p>
          )}
        </div>
      )}

      <div className="dash-grid">
        <div className="card list-card dash-card-enter" style={{ animationDelay: "240ms" }}>
          <h3>Today at a glance</h3>
          <ul>
            <li><span>Sales made</span><strong>{m.todaySalesCount}</strong></li>
            <li><span>Expenses logged</span><strong>{m.todayExpensesCount}</strong></li>
            <li><span>Customers owing</span><strong>{m.openDebtCount}</strong></li>
            <li><span>Active products</span><strong>{m.totalProducts}</strong></li>
          </ul>
        </div>

        <div className="card list-card dash-card-enter" style={{ animationDelay: "280ms" }}>
          <h3>Insights</h3>
          {!hasInsights ? (
            <p className="empty">No sales or debts today yet.</p>
          ) : (
            <ul>
              {m.bestSeller && (
                <li><span>Best seller today<br /><small style={{ color: "var(--muted)" }}>{m.bestSeller.name} × {m.bestSeller.qty}</small></span><a href="/app/reports" className="money">{fmt(m.bestSeller.revenue)}</a></li>
              )}
              {m.busiestHour && (
                <li><span>Busiest hour today</span><a href="/app/sales">{m.busiestHour.label} · {m.busiestHour.count} sale{m.busiestHour.count === 1 ? "" : "s"}</a></li>
              )}
              {m.topDebtor && (
                <li><span>Top debtor<br /><small style={{ color: "var(--muted)" }}>{m.topDebtor.name}</small></span><a href="/app/debts" className="money">{fmt(m.topDebtor.amount)}</a></li>
              )}
            </ul>
          )}
        </div>

        <div className="card dash-card-enter" style={{ animationDelay: "320ms" }}>
          <h3>Sales trend — last 7 days</h3>
          {trend.length === 0 || trend.every((t) => Number(t.revenue || 0) === 0) ? (
            <p className="empty">No sales in the last 7 days.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
              {trend.map((t) => (
                <div key={t.period}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                    <span>{t.period.slice(5)}</span>
                    <span>
                      <span className="money">{fmt(t.revenue)}</span>
                      {t.profit !== null && t.profit !== undefined && (
                        <span style={{ marginLeft: 8, color: t.profit >= 0 ? "var(--brand-dark)" : "var(--danger)" }}>
                          {t.profit >= 0 ? "+" : ""}{fmt(t.profit)}
                        </span>
                      )}
                    </span>
                  </div>
                  <div style={{ height: 8, background: "var(--line)", borderRadius: 4 }}>
                    <div style={{ height: 8, width: `${Math.max(3, (Number(t.revenue || 0) / maxTrend) * 100)}%`, background: "var(--brand)", borderRadius: 4 }} />
                  </div>
                  {canSeeTrendCost && t.cost !== null && t.cost !== undefined && (
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--muted)" }}>
                      <span>Cost {fmt(t.cost)}</span><span>Profit {fmt(t.profit)}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {!canSeeTrendCost && (
            <p className="hint" style={{ marginBottom: 0 }}>Cost and profit on the trend need Starter and profit permission. <a href="/app/reports">Reports</a></p>
          )}
        </div>

        <div className="card list-card dash-card-enter" style={{ animationDelay: "360ms" }}>
          <h3>Quick actions</h3>
          <ul>
            <li><a href="/app/sales">Record a sale</a><span>🧾</span></li>
            <li><a href="/app/products">Manage products</a><span>📦</span></li>
            <li><a href="/app/expenses">Add an expense</a><span>💸</span></li>
            <li><a href="/app/debts">Review debts</a><span>📒</span></li>
          </ul>
        </div>

        <div className="card list-card dash-card-enter" style={{ animationDelay: "400ms" }}>
          <h3>Recent sales</h3>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            <input
              className="search"
              style={{ minWidth: 0, flex: "1 1 160px", minHeight: 44 }}
              type="search"
              aria-label="Search recent sales by receipt number or customer name"
              placeholder="Search receipt or customer"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
            <input type="date" className="search" style={{ minWidth: 0, minHeight: 44 }} value={from} aria-label="Sales from date" onChange={(e) => setFrom(e.target.value)} />
            <input type="date" className="search" style={{ minWidth: 0, minHeight: 44 }} value={to} aria-label="Sales to date" onChange={(e) => setTo(e.target.value)} />
            <button className="btn btn-secondary btn-sm" style={{ minHeight: 44 }} onClick={loadHistory}>Filter</button>
            <button
              className="btn btn-secondary btn-sm"
              style={{ minHeight: 44 }}
              onClick={exportTodayCsv}
              disabled={!canExport || exporting}
              title={canExport ? "Download today's sales as CSV" : "CSV export is a Starter feature"}
            >
              {exporting ? "Exporting..." : "Export today's sales (CSV)"}
            </button>
          </div>
          {!canExport && (
            <p className="hint">CSV export is a Starter feature. <a href="/app/settings">View plans</a></p>
          )}
          {historyError && <div className="alert alert-error">{historyError}</div>}
          {shownSales.length === 0 ? (
            <p className="empty">{q || historySales !== null ? "No sales match." : "No sales recorded yet."}</p>
          ) : (
            <ul>
              {shownSales.map((s) => (
                <li key={s.id}>
                  <span>{s.sale_number}<br /><small style={{ color: "var(--muted)" }}>{s.customer_name || "Walk-in"}</small></span>
                  <span className="money">{fmt(s.total_amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

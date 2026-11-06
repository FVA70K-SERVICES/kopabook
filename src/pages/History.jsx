// History — the one place for every record in the business.
// Free for every plan: viewing and printing a statement cost nothing.
// CSV export is a Starter feature, gated exactly like Reports (the
// server returns { upgradeRequired: true } and this page shows the
// upgrade card instead of downloading).
//
// The page never deletes or edits history: there is no delete button,
// and the API has no write endpoint. History starts the day this
// upgrade lands; older records stay on their own pages (Sales, Debts,
// Expenses) — see the note under the heading.
import { useEffect, useState } from "react";
import { getCachedList, setCachedList } from "../lib/listCache";
import { ListSkeleton, UpdatedNote, LoadError } from "../components/ListState";
import { api, fmt, todayISO } from "../lib/api";
import StatementPrint from "../components/StatementPrint";
import {
  historyEventsToLines,
  historyTotals,
  requestStatementPrint,
  HISTORY_TYPE_LABELS,
  STAFF_VISIBLE_TYPES,
} from "../lib/statement";

const TYPE_OPTIONS = ["sale", "expense", "payment", "debt", "stock", "customer"];

function fmtDateTime(s) {
  const d = new Date(String(s).replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function thirtyDaysAgo() {
  return new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
}

function contactFor(biz) {
  if (!biz) return {};
  const show = (flag) => flag === undefined || flag === null || Number(flag) === 1;
  return {
    name: biz.name || "",
    address: biz.receipt_address || [biz.city, biz.state, biz.country].filter(Boolean).join(", ") || "",
    phone: show(biz.receipt_show_phone) ? biz.receipt_phone || "" : "",
    email: show(biz.receipt_show_email) ? biz.receipt_email || "" : "",
    telegram: show(biz.receipt_show_telegram) ? biz.receipt_telegram || "" : "",
  };
}

export default function HistoryPage({ session }) {
  const [events, setEvents] = useState(() => { const c = getCachedList("history:" + thirtyDaysAgo() + ":" + todayISO(), session?.business?.id); return c ? c.data.events : []; });
  const [updatedAt, setUpdatedAt] = useState(() => { const c = getCachedList("history:" + thirtyDaysAgo() + ":" + todayISO(), session?.business?.id); return c ? c.updatedAt : null; });
  const [total, setTotal] = useState(() => { const c = getCachedList("history:" + thirtyDaysAgo() + ":" + todayISO(), session?.business?.id); return c ? c.data.total : 0; });
  const [actors, setActors] = useState(() => { const c = getCachedList("history:" + thirtyDaysAgo() + ":" + todayISO(), session?.business?.id); return c ? c.data.actors : []; });
  const [startedAt, setStartedAt] = useState(() => { const c = getCachedList("history:" + thirtyDaysAgo() + ":" + todayISO(), session?.business?.id); return c ? c.data.startedAt : todayISO(); });
  const [filters, setFilters] = useState({ from: thirtyDaysAgo(), to: todayISO(), type: "", person: "", q: "" });
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(() => !getCachedList("history:" + thirtyDaysAgo() + ":" + todayISO(), session?.business?.id));
  const [error, setError] = useState("");
  const [needsUpgrade, setNeedsUpgrade] = useState(false);
  const [csvBusy, setCsvBusy] = useState(false);
  const [biz, setBiz] = useState(null);
  const limit = 50;

  const role = session?.business?.role;
  const isFull = role === "owner" || role === "partner";
  const typeOptions = isFull ? [...TYPE_OPTIONS, "staff", "settings", "receipt"] : STAFF_VISIBLE_TYPES;
  const hasFilters = !!(filters.type || filters.person || filters.q);

  async function load(off, f) {
    // Cache covers the unfiltered first page only: a filtered or paged
    // view always fetches, so a cached list can never stand in for a
    // different filter.
    const cacheKey = off === 0 && !f.type && !f.person && !f.q ? `history:${f.from}:${f.to}` : null;
    if (!cacheKey || !getCachedList(cacheKey, session?.business?.id)) setLoading(true);
    setError("");
    try {
      const q = new URLSearchParams({ limit: String(limit), offset: String(off) });
      if (f.from) q.set("from", f.from);
      if (f.to) q.set("to", f.to);
      if (f.type) q.set("type", f.type);
      if (f.person) q.set("person", f.person);
      if (f.q) q.set("q", f.q);
      const d = await api.get("/api/history?" + q.toString());
      setEvents(d.events || []); setTotal(d.total || 0);
      setActors(d.actors || []); setStartedAt(d.startedAt || todayISO());
      if (cacheKey) { setCachedList(cacheKey, session?.business?.id, { events: d.events || [], total: d.total || 0, actors: d.actors || [], startedAt: d.startedAt || todayISO() }); setUpdatedAt(Date.now()); }
    } catch (e) { setError(e.message); }
    setLoading(false);
  }

  useEffect(() => { load(0, filters); }, []);
  useEffect(() => {
    api.get("/api/business").then((d) => setBiz(d.business || {})).catch(() => {});
  }, []);

  function apply(e) {
    e.preventDefault();
    setOffset(0);
    load(0, filters);
  }

  function page(dir) {
    const off = offset + dir * limit;
    if (off < 0 || off >= total) return;
    setOffset(off);
    load(off, filters);
  }

  async function exportCsv() {
    setCsvBusy(true); setNeedsUpgrade(false); setError("");
    try {
      const q = new URLSearchParams({ csv: "1" });
      if (filters.from) q.set("from", filters.from);
      if (filters.to) q.set("to", filters.to);
      if (filters.type) q.set("type", filters.type);
      if (filters.person) q.set("person", filters.person);
      if (filters.q) q.set("q", filters.q);
      const res = await fetch("/api/history?" + q.toString(), { credentials: "same-origin" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        if (d.upgradeRequired) { setNeedsUpgrade(true); return; }
        throw new Error(d.message || `Export failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `kopabook-history-${filters.from || "all"}-to-${filters.to || "all"}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setError(e.message); }
    setCsvBusy(false);
  }

  // Statement of the filtered history, oldest first so the running
  // balance reads top to bottom. Sales add, payments and expenses
  // subtract; stock, customer, staff, settings and receipt events carry
  // no balance movement.
  const chronological = [...events].reverse();
  const statementLines = historyEventsToLines(chronological);
  const totals = historyTotals(chronological);
  const statementTotals = [
    { label: "Total sales", amount: totals.totalSales },
    { label: "Total payments", amount: totals.totalPayments },
    { label: "Total expenses", amount: totals.totalExpenses },
  ];
  const period = `${filters.from || "…"} to ${filters.to || "…"}`;

  return (
    <>
      <div className="page-head">
        <h1>History</h1>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn btn-secondary btn-sm" onClick={requestStatementPrint} disabled={loading || events.length === 0}>
            Print statement
          </button>
          <button className="btn btn-secondary btn-sm" onClick={exportCsv} disabled={csvBusy || loading || events.length === 0}>
            {csvBusy ? "Preparing..." : "Export CSV"}
          </button>
        </div>
      </div>
      <p className="hint" style={{ marginTop: 0 }}>
        Every record in {session?.business?.name || "this business"}, who did it and when. History starts from {startedAt}. Older records are on their pages.
      </p>
      {!isFull && (
        <p className="hint">You see sales, expenses, payments, debts, stock and customer events. Staff and settings changes are only visible to the owner.</p>
      )}

      {error && <LoadError message={error} onRetry={() => load(0, filters)} />}
      <UpdatedNote updatedAt={updatedAt} onRefresh={() => load(0, filters)} />
      {needsUpgrade && (
        <div className="card">
          <h2>CSV export is a Starter feature</h2>
          <p className="hint">Upgrade to Starter or higher to download history as a CSV file. Viewing and printing a statement are free.</p>
          <a className="btn btn-primary" href="/app/settings">View plans</a>
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <form onSubmit={apply}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
            <div className="field"><label htmlFor="history-from">From</label>
              <input id="history-from" type="date" value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} />
            </div>
            <div className="field"><label htmlFor="history-to">To</label>
              <input id="history-to" type="date" value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} />
            </div>
            <div className="field"><label htmlFor="history-type">Type</label>
              <select id="history-type" value={filters.type} onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value }))}>
                <option value="">All types</option>
                {typeOptions.map((t) => <option key={t} value={t}>{HISTORY_TYPE_LABELS[t]}</option>)}
              </select>
            </div>
            <div className="field"><label htmlFor="history-person">Person</label>
              <select id="history-person" value={filters.person} onChange={(e) => setFilters((f) => ({ ...f, person: e.target.value }))}>
                <option value="">Everyone</option>
                {actors.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div className="field"><label htmlFor="history-search">Search</label>
              <input id="history-search" type="search" placeholder="Search records..." value={filters.q}
                onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))} />
            </div>
          </div>
          <button className="btn btn-primary btn-sm" type="submit">Apply filters</button>
        </form>
      </div>

      {loading ? <ListSkeleton label="Loading history..." /> : (
        <>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>When</th><th>Type</th><th>Who</th><th>Record</th><th>Amount</th></tr></thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id}>
                    <td style={{ whiteSpace: "nowrap" }}>{fmtDateTime(e.created_at)}</td>
                    <td><span className="pill pill-gray">{HISTORY_TYPE_LABELS[e.type] || e.type}</span></td>
                    <td>{e.actor_name || "—"}{e.actor_role ? <small style={{ color: "var(--muted)" }}> · {e.actor_role}</small> : null}</td>
                    <td style={{ fontSize: 14 }}>{e.summary}</td>
                    <td className="money" style={{ whiteSpace: "nowrap" }}>{e.amount === null ? "—" : fmt(e.amount)}</td>
                  </tr>
                ))}
                {events.length === 0 && (
                  <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>
                    {hasFilters ? "Nothing matches these filters." : "No history yet."}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12 }}>
            <span className="hint">{total} {total === 1 ? "record" : "records"}</span>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-secondary btn-sm" disabled={offset === 0} onClick={() => page(-1)}>← Newer</button>
              <button className="btn btn-secondary btn-sm" disabled={offset + limit >= total} onClick={() => page(1)}>Older →</button>
            </div>
          </div>
        </>
      )}

      {/* Print-only statement of the filtered history. Hidden on screen
          by print.css; window.print() (via Print statement) prints only
          this. Rendered as a direct child of #main so the print rules
          can hide everything else. */}
      <div className="print-only">
        <StatementPrint
          business={contactFor(biz)}
          title="Statement"
          period={period}
          lines={statementLines}
          totals={statementTotals}
          closingBalance={totals.closingBalance}
        />
      </div>
    </>
  );
}

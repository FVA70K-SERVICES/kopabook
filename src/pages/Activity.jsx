import { useEffect, useState } from "react";
import { api, nav } from "../lib/api";

function fmtDateTime(s) {
  const d = new Date(String(s).replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function metaSummary(meta) {
  if (!meta || typeof meta !== "object") return "";
  const bits = [];
  for (const [k, v] of Object.entries(meta)) {
    if (v === null || v === undefined || v === "") continue;
    if (typeof v === "object") continue;
    const label = k.replace(/_/g, " ");
    bits.push(`${label}: ${v}`);
  }
  return bits.slice(0, 4).join(" · ");
}

export default function ActivityPage({ session }) {
  const [entries, setEntries] = useState([]);
  const [total, setTotal] = useState(0);
  const [actors, setActors] = useState([]);
  const [actions, setActions] = useState([]);
  const [filters, setFilters] = useState({ action: "", actor: "", from: "", to: "" });
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const limit = 50;

  const role = session.business?.role;
  const canView = ["owner", "partner"].includes(role);

  async function load(off, f) {
    setLoading(true); setError("");
    try {
      const q = new URLSearchParams({ limit: String(limit), offset: String(off) });
      if (f.action) q.set("action", f.action);
      if (f.actor) q.set("actor", f.actor);
      if (f.from) q.set("from", f.from);
      if (f.to) q.set("to", f.to);
      const d = await api.get("/api/activity?" + q.toString());
      setEntries(d.entries || []); setTotal(d.total || 0);
      setActors(d.actors || []); setActions(d.actions || []);
    } catch (e) { setError(e.message); }
    setLoading(false);
  }

  useEffect(() => { if (canView) load(0, filters); }, []);

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

  if (!canView) {
    return <div className="card"><h2>Activity log</h2><p className="hint">Only the owner or a partner can view the activity log.</p></div>;
  }

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0 }}>Activity log</h1>
          <p className="hint" style={{ margin: "4px 0 0" }}>Every important action in {session.business?.name || "this business"}, who did it and when.</p>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={() => nav("/app/settings")}>Back to Settings</button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="card" style={{ marginBottom: 16 }}>
        <form onSubmit={apply}>
          <div className="row2" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
            <div className="field"><label>Action</label>
              <select value={filters.action} onChange={(e) => setFilters((f) => ({ ...f, action: e.target.value }))}>
                <option value="">All actions</option>
                {actions.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
              </select>
            </div>
            <div className="field"><label>Person</label>
              <select value={filters.actor} onChange={(e) => setFilters((f) => ({ ...f, actor: e.target.value }))}>
                <option value="">Everyone</option>
                {actors.map((a) => <option key={a.id} value={a.id}>{a.full_name}</option>)}
              </select>
            </div>
            <div className="field"><label>From</label><input type="date" value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} /></div>
            <div className="field"><label>To</label><input type="date" value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} /></div>
          </div>
          <button className="btn btn-primary btn-sm" type="submit">Apply filters</button>
        </form>
      </div>

      {loading ? <div className="loading">Loading...</div> : (
        <>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>When</th><th>Action</th><th>Who</th><th>Details</th></tr></thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id}>
                    <td style={{ whiteSpace: "nowrap" }}>{fmtDateTime(e.createdAt)}</td>
                    <td><span className="pill pill-gray">{e.label}</span></td>
                    <td>{e.actorName}</td>
                    <td style={{ color: "var(--muted)", fontSize: 13 }}>{metaSummary(e.meta)}</td>
                  </tr>
                ))}
                {entries.length === 0 && (
                  <tr><td colSpan={4} style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>No activity yet for these filters.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12 }}>
            <span className="hint">{total} {total === 1 ? "entry" : "entries"}</span>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-secondary btn-sm" disabled={offset === 0} onClick={() => page(-1)}>← Newer</button>
              <button className="btn btn-secondary btn-sm" disabled={offset + limit >= total} onClick={() => page(1)}>Older →</button>
            </div>
          </div>
        </>
      )}
    </>
  );
}

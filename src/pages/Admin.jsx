import { useEffect, useState } from "react";
import { api } from "../lib/api";

function Tab({ id, label, active, set }) {
  return (
    <button
      type="button"
      className={"btn btn-sm " + (active === id ? "btn-primary" : "btn-secondary")}
      onClick={() => set(id)}
      style={{ marginRight: 8, marginBottom: 8 }}
    >
      {label}
    </button>
  );
}

function Overview() {
  const [d, setD] = useState(null);
  useEffect(() => { api.get("/api/admin/overview").then(setD).catch(() => {}); }, []);
  if (!d) return <p className="hint">Loading...</p>;
  const t = d.totals;
  return (
    <>
      <div className="metric-grid">
        <div className="metric-card"><span>Accounts</span><strong>{t.users}</strong></div>
        <div className="metric-card"><span>Paying</span><strong>{t.paying}</strong></div>
        <div className="metric-card"><span>Revenue</span><strong>NGN {Number(t.revenue).toLocaleString()}</strong></div>
        <div className="metric-card"><span>Businesses</span><strong>{t.activeBusinesses}</strong></div>
        <div className="metric-card"><span>Total sales recorded</span><strong>{t.sales}</strong></div>
        <div className="metric-card"><span>Suspended</span><strong>{t.suspended}</strong></div>
      </div>
      <div className="card" style={{ marginTop: 18 }}>
        <h3 style={{ marginTop: 0 }}>Accounts by tier</h3>
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {d.byTier.map((r) => (
            <li key={r.tier} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
              <span style={{ textTransform: "capitalize" }}>{r.tier}</span><strong>{r.n}</strong>
            </li>
          ))}
        </ul>
      </div>
      <div className="card" style={{ marginTop: 18 }}>
        <h3 style={{ marginTop: 0 }}>Newest accounts</h3>
        <table><thead><tr><th>Email</th><th>Tier</th><th>Joined</th></tr></thead>
        <tbody>{d.recentUsers.map((u) => (
          <tr key={u.id}><td><small>{u.email}</small></td><td style={{ textTransform: "capitalize" }}>{u.tier}</td><td><small>{String(u.created_at || "").slice(0, 10)}</small></td></tr>
        ))}</tbody></table>
      </div>
      <div className="card" style={{ marginTop: 18 }}>
        <h3 style={{ marginTop: 0 }}>Latest payments</h3>
        <table><thead><tr><th>Account</th><th>Plan</th><th>Amount</th><th>Status</th></tr></thead>
        <tbody>{d.recentPayments.map((p) => (
          <tr key={p.id}><td><small>{p.email}</small></td><td style={{ textTransform: "capitalize" }}>{p.tier}</td><td className="money">NGN {(Number(p.amount_kobo) / 100).toLocaleString()}</td><td>{p.status}</td></tr>
        ))}</tbody></table>
      </div>
    </>
  );
}

function Accounts() {
  const [list, setList] = useState([]);
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(null);

  async function load(query) {
    try {
      const d = await api.get("/api/admin/accounts" + (query ? "?q=" + encodeURIComponent(query) : ""));
      setList(d.accounts || []);
    } catch (e) { setMsg(e.message); }
  }
  useEffect(() => { load(""); }, []);

  async function act(userId, action, extra) {
    setBusy(userId + action);
    setMsg("");
    try {
      const d = await api.post("/api/admin/accounts", { userId, action, ...(extra || {}) });
      setMsg(d.message);
      load(q);
    } catch (e) { setMsg(e.message); }
    setBusy(null);
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Accounts</h3>
      {msg && <div className="alert alert-ok">{msg}</div>}
      <div className="field" style={{ maxWidth: 320 }}>
        <input placeholder="Search email or name" value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") load(q); }} />
      </div>
      <div style={{ overflowX: "auto" }}>
        <table>
          <thead><tr><th>Account</th><th>Tier</th><th>Paid total</th><th>Businesses</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {list.map((a) => (
              <tr key={a.id}>
                <td><small>{a.email}</small><br /><small className="hint">{a.full_name || ""}</small></td>
                <td><strong style={{ textTransform: "capitalize" }}>{a.tier}</strong><br /><small className="hint">{a.billing_cycle || ""}</small></td>
                <td className="money">NGN {(Number(a.paid_kobo) / 100).toLocaleString()}</td>
                <td>{a.businesses}</td>
                <td>{a.status}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => act(a.id, "set_tier", { tier: "starter", cycle: "manual" })}>Starter</button>{" "}
                  <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => act(a.id, "set_tier", { tier: "pro", cycle: "manual" })}>Pro</button>{" "}
                  <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => act(a.id, "set_tier", { tier: "free", cycle: "manual" })}>Free</button>{" "}
                  {a.status === "suspended"
                    ? <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => act(a.id, "unsuspend")}>Unsuspend</button>
                    : <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => act(a.id, "suspend")}>Suspend</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Businesses() {
  const [list, setList] = useState([]);
  useEffect(() => { api.get("/api/admin/businesses").then((d) => setList(d.businesses || [])).catch(() => {}); }, []);
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>All businesses</h3>
      <div style={{ overflowX: "auto" }}>
        <table>
          <thead><tr><th>Business</th><th>Owner</th><th>Owner tier</th><th>Sales</th><th>Products</th><th>Staff</th><th>Status</th></tr></thead>
          <tbody>
            {list.map((b) => (
              <tr key={b.id}>
                <td><strong>{b.name}</strong><br /><small className="hint">{b.country} · {b.currency}</small></td>
                <td><small>{b.owner_email}</small></td>
                <td style={{ textTransform: "capitalize" }}>{b.owner_tier}</td>
                <td>{b.sales}</td>
                <td>{b.products}</td>
                <td>{b.staff}</td>
                <td>{b.status || "active"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Payments() {
  const [d, setD] = useState(null);
  useEffect(() => { api.get("/api/admin/overview").then(setD).catch(() => {}); }, []);
  if (!d) return <p className="hint">Loading...</p>;
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Payments · total NGN {Number(d.totals.revenue).toLocaleString()}</h3>
      <div style={{ overflowX: "auto" }}>
        <table>
          <thead><tr><th>Account</th><th>Plan</th><th>Cycle</th><th>Amount</th><th>Status</th><th>Paid at</th></tr></thead>
          <tbody>
            {d.recentPayments.map((p) => (
              <tr key={p.id}>
                <td><small>{p.email}</small></td>
                <td style={{ textTransform: "capitalize" }}>{p.tier}</td>
                <td>{p.billing_cycle}</td>
                <td className="money">NGN {(Number(p.amount_kobo) / 100).toLocaleString()}</td>
                <td>{p.status}</td>
                <td><small>{p.paid_at ? String(p.paid_at).slice(0, 16) : "-"}</small></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function AdminPage() {
  const [tab, setTab] = useState("overview");
  const [error, setError] = useState("");

  useEffect(() => {
    api.get("/api/admin/overview").catch((e) => setError(e.message));
  }, []);

  if (error) {
    return (<><div className="page-head"><h1>Admin</h1></div><div className="alert alert-error">{error}</div></>);
  }

  return (
    <>
      <div className="page-head"><h1>Platform admin</h1></div>
      <div style={{ marginBottom: 12 }}>
        <Tab id="overview" label="Overview" active={tab} set={setTab} />
        <Tab id="accounts" label="Accounts" active={tab} set={setTab} />
        <Tab id="businesses" label="Businesses" active={tab} set={setTab} />
        <Tab id="payments" label="Payments" active={tab} set={setTab} />
      </div>
      {tab === "overview" && <Overview />}
      {tab === "accounts" && <Accounts />}
      {tab === "businesses" && <Businesses />}
      {tab === "payments" && <Payments />}
    </>
  );
}

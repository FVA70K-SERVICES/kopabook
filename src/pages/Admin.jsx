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
                  <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => act(a.id, "set_tier", { tier: "solo", cycle: "manual" })}>Solo</button>{" "}
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

function Plans() {
  const [plans, setPlans] = useState([]);
  const [msg, setMsg] = useState("");
  const [edits, setEdits] = useState({});
  const [busy, setBusy] = useState("");

  async function load() {
    try {
      const d = await api.get("/api/admin/plans");
      setPlans(d.plans || []);
      const e = {};
      for (const p of d.plans || []) e[p.tier + "|" + p.billing_cycle] = Number(p.amount_kobo) / 100;
      setEdits(e);
    } catch (e) { setMsg(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function save(tier, cycle) {
    const key = tier + "|" + cycle;
    setBusy(key);
    setMsg("");
    try {
      const d = await api.post("/api/admin/plans", { tier, cycle, amount_ngn: Number(edits[key]) });
      setMsg(d.message);
      load();
    } catch (e) { setMsg(e.message); }
    setBusy("");
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Subscription fees (Nigeria base prices)</h3>
      <p className="hint">
        Nigeria home prices in NGN. International prices are auto-calculated using fair PPP tiers
        (low: $1/2/4, lower-middle: $2/4/7, upper-middle: $4/8/12, high: $6/12/18 monthly USD
        for Starter/Pro/Solo). Changes apply immediately to new checkouts.
      </p>
      {msg && <div className="alert alert-ok">{msg}</div>}
      <table>
        <thead><tr><th>Plan</th><th>Cycle</th><th>Price (NGN)</th><th></th></tr></thead>
        <tbody>
          {plans.map((p) => {
            const key = p.tier + "|" + p.billing_cycle;
            return (
              <tr key={key}>
                <td style={{ textTransform: "capitalize" }}><strong>{p.tier}</strong></td>
                <td style={{ textTransform: "capitalize" }}>{p.billing_cycle}</td>
                <td>
                  <input
                    type="number" min="1" step="1" style={{ maxWidth: 140 }}
                    value={edits[key] ?? ""}
                    onChange={(e) => setEdits({ ...edits, [key]: e.target.value })}
                  />
                </td>
                <td>
                  <button className="btn btn-primary btn-sm" disabled={busy === key} onClick={() => save(p.tier, p.billing_cycle)}>
                    {busy === key ? "Saving..." : "Save"}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="hint">Yearly is usually set to 10x the monthly price (2 months free).</p>
    </div>
  );
}

function Payments() {
  const [d, setD] = useState(null);
  useEffect(() => { api.get("/api/admin/overview").then(setD).catch(() => {}); }, []);
  if (!d) return <p className="hint">Loading...</p>;
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Payments</h3>
      <div style={{ overflowX: "auto" }}>
        <table>
          <thead><tr><th>Account</th><th>Plan</th><th>Cycle</th><th>Amount</th><th>Method</th><th>Country</th><th>Status</th><th>Paid at</th></tr></thead>
          <tbody>
            {d.recentPayments.map((p) => (
              <tr key={p.id}>
                <td><small>{p.email}</small></td>
                <td style={{ textTransform: "capitalize" }}>{p.tier}</td>
                <td>{p.billing_cycle}</td>
                <td className="money">{p.currency || "NGN"} {(Number(p.amount_kobo) / 100).toLocaleString()}</td>
                <td>{p.payment_method || "paystack"}</td>
                <td><small>{p.country || "-"}</small></td>
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

function CryptoPayments() {
  const [list, setList] = useState([]);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(null);
  const [adminHash, setAdminHash] = useState({});

  async function load() {
    try {
      const d = await api.get("/api/crypto/admin");
      setList(d.payments || []);
    } catch (e) { setMsg(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function approve(reference) {
    const hash = (adminHash[reference] || "").trim();
    if (!confirm(`Approve payment ${reference}? The transaction will be verified on the blockchain first.`)) return;
    setBusy(reference);
    setMsg("");
    try {
      const d = await api.post("/api/crypto/admin", { reference, action: "approve", tx_hash: hash || undefined });
      setMsg(d.message);
      load();
    } catch (e) { setMsg(e.message); }
    setBusy(null);
  }

  async function reject(reference) {
    const reason = window.prompt("Rejection reason (required, the user will see this):");
    if (!reason || reason.trim().length < 3) { setMsg("A reason is required to reject."); return; }
    if (!confirm(`Reject payment ${reference}?`)) return;
    setBusy(reference);
    setMsg("");
    try {
      const d = await api.post("/api/crypto/admin", { reference, action: "reject", reason: reason.trim() });
      setMsg(d.message);
      load();
    } catch (e) { setMsg(e.message); }
    setBusy(null);
  }

  function verification(p) {
    if (!p.verification_json) return null;
    try { return JSON.parse(p.verification_json); } catch { return null; }
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Crypto payments pending</h3>
      <p className="hint">Approval verifies the transaction on the blockchain automatically (right wallet, right token, right amount, confirmed). Never approve without a passing verification.</p>
      {msg && <div className="alert alert-ok">{msg}</div>}
      {list.length === 0 ? (
        <p className="hint">No pending crypto payments.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead><tr><th>Account</th><th>Plan</th><th>Amount</th><th>TX hash</th><th>Status</th><th>Verification</th><th>Actions</th></tr></thead>
            <tbody>
              {list.map((p) => {
                const v = verification(p);
                return (
                  <tr key={p.reference}>
                    <td><small>{p.email}</small><br /><small className="hint">{p.full_name || ""} · {p.country || ""}</small></td>
                    <td><strong style={{ textTransform: "capitalize" }}>{p.tier}</strong><br /><small className="hint">{p.billing_cycle}</small></td>
                    <td className="money">${(Number(p.amount_usd_cents) / 100).toFixed(2)}<br /><small className="hint">{p.crypto_amount} {p.crypto_currency} · {p.crypto_currency === "BTC" ? "Bitcoin" : "Tron"}</small></td>
                    <td>
                      {p.tx_hash ? (
                        <a href={p.explorer_url} target="_blank" rel="noreferrer">
                          <small style={{ wordBreak: "break-all", maxWidth: 120, display: "inline-block" }}>{p.tx_hash.slice(0, 16)}...</small>
                        </a>
                      ) : (
                        <input className="input" style={{ width: 150 }} placeholder="Paste TX hash to approve"
                          value={adminHash[p.reference] || ""}
                          onChange={(e) => setAdminHash({ ...adminHash, [p.reference]: e.target.value })} />
                      )}
                      <br /><small className="hint">{String(p.created_at || "").slice(0, 16)}</small>
                    </td>
                    <td><small>{p.status}</small>{p.expires_at && <><br /><small className="hint">expires {String(p.expires_at).slice(0, 16)}</small></>}</td>
                    <td><small className="hint">{v ? (v.ok ? `Passed: ${v.detail || ""}` : `Failed: ${v.error || ""}`) : "Not checked yet"}</small></td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <button className="btn btn-primary btn-sm" disabled={busy === p.reference}
                        onClick={() => approve(p.reference)}>
                        {busy === p.reference ? "..." : "Verify and approve"}
                      </button>{" "}
                      <button className="btn btn-secondary btn-sm" disabled={busy === p.reference}
                        onClick={() => reject(p.reference)}>Reject</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
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
        <Tab id="crypto" label="Crypto" active={tab} set={setTab} />
        <Tab id="plans" label="Plans & fees" active={tab} set={setTab} />
      </div>
      {tab === "overview" && <Overview />}
      {tab === "accounts" && <Accounts />}
      {tab === "businesses" && <Businesses />}
      {tab === "payments" && <Payments />}
      {tab === "crypto" && <CryptoPayments />}
      {tab === "plans" && <Plans />}
    </>
  );
}

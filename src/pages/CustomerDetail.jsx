import { useEffect, useState } from "react";
import { api, fmt, nav, todayISO } from "../lib/api";
import StatementPrint from "../components/StatementPrint";
import { requestStatementPrint } from "../lib/statement";
import { waLink, fillReminderTemplate } from "../lib/whatsapp";
import { sendVia } from "../lib/channels";
import ChannelPicker from "../components/ChannelPicker";
import { debtCardUrl, shareCard } from "../lib/shareCards";

const TAG_SUGGESTIONS = ["VIP", "Wholesaler", "Regular", "New", "Watch"];

function daysSince(iso) {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

export default function CustomerDetailPage({ customerId, session }) {
  const canDelete = ["owner", "partner"].includes(session?.business?.role);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", notes: "", tags: "", email: "", credit_limit: "" });
  const isOwnerPartner = ["owner", "partner"].includes(session?.business?.role);
  const [saving, setSaving] = useState(false);
  const [biz, setBiz] = useState({ name: "", reminder_template: "", brand_color: "#166534", tagline: "" });
  const [channel, setChannel] = useState("whatsapp");
  const [photoFile, setPhotoFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  // WORLD-BEST: Customer statement — start
  const [stmtFrom, setStmtFrom] = useState(() => todayISO().slice(0, 8) + "01");
  const [stmtTo, setStmtTo] = useState(() => todayISO());
  const [stmt, setStmt] = useState(null);
  const [stmtLoading, setStmtLoading] = useState(false);
  const [stmtError, setStmtError] = useState("");
  // WORLD-BEST: Customer statement — end

  async function load() {
    setLoading(true);
    try {
      const d = await api.get(`/api/customer-profile?id=${customerId}`);
      setData(d);
      setForm({
        name: d.customer.name || "", phone: d.customer.phone || "", notes: d.customer.notes || "",
        tags: d.customer.tags || "", telegram: d.customer.telegram || "",
        email: d.customer.email || "",
        credit_limit: d.customer.credit_limit === null || d.customer.credit_limit === undefined ? "" : String(d.customer.credit_limit),
      });
      setError("");
    } catch (e) { setError(e.message); }
    setLoading(false);
  }

  useEffect(() => { load(); }, [customerId]);
  // WORLD-BEST: Customer statement — start
  async function loadStatement(from, to) {
    setStmtLoading(true);
    try {
      const d = await api.get(`/api/customers/${customerId}/statement?from=${from}&to=${to}`);
      setStmt(d);
      setStmtError("");
    } catch (e) { setStmtError(e.message); }
    setStmtLoading(false);
  }
  useEffect(() => { loadStatement(stmtFrom, stmtTo); }, [customerId]);
  // WORLD-BEST: Customer statement — end
  useEffect(() => {
    api.get("/api/business").then((d) => setBiz(d.business || {})).catch(() => {});
  }, []);

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.patch(`/api/customer-profile?id=${customerId}`, form);
      setEditing(false);
      load();
    } catch (err) { setError(err.message); }
    setSaving(false);
  }

  async function uploadPhoto() {
    if (!photoFile || !customer) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("folder", "customers");
      fd.append("refId", customer.id);
      fd.append("file", photoFile);
      const res = await fetch("/api/files", { method: "POST", body: fd, credentials: "same-origin" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || d.ok === false) throw new Error(d.message || "Upload failed.");
      setPhotoFile(null);
      load();
    } catch (err) { setError(err.message); }
    setUploading(false);
  }

  async function removePhoto() {
    if (!customer || !window.confirm("Remove this customer photo?")) return;
    try {
      const res = await fetch(`/api/files?folder=customers&refId=${customer.id}`, { method: "DELETE", credentials: "same-origin" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || d.ok === false) throw new Error(d.message || "Could not remove photo.");
      load();
    } catch (err) { setError(err.message); }
  }

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  function toggleTag(t) {
    const cur = form.tags.split(",").map((x) => x.trim()).filter(Boolean);
    set("tags", cur.includes(t) ? cur.filter((x) => x !== t).join(", ") : [...cur, t].join(", "));
  }

  if (loading) return <div className="loading">Loading customer...</div>;
  if (error && !data) return <><div className="alert alert-error">{error}</div><button className="btn btn-secondary" onClick={() => nav("/app/customers")}>Back to customers</button></>;
  const { customer, stats, recent } = data;
  const tags = String(customer.tags || "").split(",").map((t) => t.trim()).filter(Boolean);
  const owing = Number(stats.outstanding) > 0;
  const dLastPay = daysSince(stats.last_payment_at);
  const dLastSeen = daysSince(stats.last_activity);

  function remindText() {
    return fillReminderTemplate(biz.reminder_template, {
      debtorName: customer.name,
      amount: fmt(stats.outstanding),
      businessName: biz.name,
    });
  }

  async function remind() {
    const message = remindText();
    try {
      await api.post("/api/reminders", { kind: "debt", customerId: customer.id, phone: customer.phone, message: `[${channel}] ${message}` });
    } catch { /* never block */ }
    sendVia(channel, { phone: customer.phone, text: message, telegram: customer.telegram });
    load();
  }

  function shareDebtCard() {
    const url = debtCardUrl(
      { debtorName: customer.name, amount: fmt(stats.outstanding) },
      { name: biz.name, color: biz.brand_color || "#166534", tagline: biz.tagline || "" }
    );
    shareCard(url, { title: "Payment reminder", filename: `reminder-${customer.name}.png` });
  }

  return (
    <>
      <div className="page-head">
        <button className="btn btn-secondary btn-sm" onClick={() => nav("/app/customers")}>← Customers</button>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-secondary btn-sm" onClick={() => setEditing(!editing)}>{editing ? "Cancel" : "Edit"}</button>
          {canDelete && (
            <button
              className="btn btn-secondary btn-sm"
              style={{ color: "var(--danger, #b91c1c)" }}
              onClick={async () => {
                if (!window.confirm("Delete this customer? This is only possible if they have no sales or debt history.")) return;
                try {
                  await api.del(`/api/customer-profile?id=${customerId}`);
                  nav("/app/customers");
                } catch (e) { setError(e.message); }
              }}
            >
              Delete
            </button>
          )}
        </div>
      </div>
      {error && <div className="alert alert-error">{error}</div>}

      <div className="card" style={{ marginBottom: 16 }}>
        {editing ? (
          <form onSubmit={save}>
            <div className="field"><label>Name *</label><input value={form.name} aria-label="Customer name" onChange={(e) => set("name", e.target.value)} required /></div>
            <div className="field"><label>Phone (WhatsApp)</label><input value={form.phone} aria-label="Phone (WhatsApp)" onChange={(e) => set("phone", e.target.value)} placeholder="080..." /></div>
            <div className="field"><label>Telegram username (optional)</label><input value={form.telegram} aria-label="Telegram username (optional)" onChange={(e) => set("telegram", e.target.value)} placeholder="@username" /></div>
            <div className="field"><label>Email (optional)</label><input type="email" value={form.email} aria-label="Email (optional)" onChange={(e) => set("email", e.target.value)} placeholder="customer@example.com" inputMode="email" /></div>
            {isOwnerPartner && (
              <div className="field"><label>Credit limit (optional)</label>
                <input type="number" min="0" step="0.01" value={form.credit_limit} aria-label="Credit limit (optional)" onChange={(e) => set("credit_limit", e.target.value)} placeholder="No limit set" />
                <p className="hint" style={{ margin: "4px 0 0" }}>Blank means no limit set. 0 means no credit.</p>
              </div>
            )}
            <div className="field"><label>Photo</label>
              {customer.photo_key && (
                <div style={{ marginBottom: 8 }}>
                  <img src={`/api/files?key=${encodeURIComponent(customer.photo_key)}`} alt=""
                    style={{ width: 96, height: 96, objectFit: "cover", borderRadius: "50%" }} />
                </div>
              )}
              <input type="file" aria-label="Customer photo" accept="image/*" onChange={(e) => setPhotoFile(e.target.files[0] || null)} />
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button type="button" className="btn btn-secondary btn-sm" disabled={!photoFile || uploading} onClick={uploadPhoto}>
                  {uploading ? "Uploading..." : "Upload photo"}
                </button>
                {customer.photo_key && (
                  <button type="button" className="btn btn-secondary btn-sm" onClick={removePhoto}>Remove</button>
                )}
              </div>
            </div>
            <div className="field"><label>Tags (comma separated)</label><input value={form.tags} aria-label="Tags (comma separated)" onChange={(e) => set("tags", e.target.value)} placeholder="VIP, Wholesaler" /></div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
              {TAG_SUGGESTIONS.map((t) => (
                <button key={t} type="button" onClick={() => toggleTag(t)}
                  className={"btn btn-sm " + (form.tags.split(",").map((x) => x.trim()).includes(t) ? "btn-primary" : "btn-secondary")}>{t}</button>
              ))}
            </div>
            <div className="field"><label>Notes — remember things about this customer</label>
              <textarea rows={3} value={form.notes} onChange={(e) => set("notes", e.target.value)}
                placeholder="e.g. prefers delivery on Fridays, buys for her shop, likes the 50kg rice..." />
            </div>
            <button className="btn btn-primary btn-block" disabled={saving}>{saving ? "Saving..." : "Save changes"}</button>
          </form>
        ) : (
          <>
            <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 10 }}>
              {customer.photo_key ? (
                <img src={`/api/files?key=${encodeURIComponent(customer.photo_key)}`} alt=""
                  style={{ width: 64, height: 64, objectFit: "cover", borderRadius: "50%" }} />
              ) : (
                <div style={{ width: 64, height: 64, borderRadius: "50%", background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, fontWeight: 700, color: "var(--muted)" }}>
                  {(customer.name || "?").trim().charAt(0).toUpperCase()}
                </div>
              )}
              <div>
                <h2 style={{ margin: "0 0 4px" }}>{customer.name}</h2>
                <p style={{ color: "var(--muted)", margin: 0 }}>{customer.phone || "No phone number"}</p>
              </div>
            </div>
            {tags.length > 0 && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                {tags.map((t) => <span key={t} className="pill pill-green">{t}</span>)}
              </div>
            )}
            {customer.notes && (
              <div style={{ background: "var(--bg)", borderRadius: 10, padding: "10px 14px", marginBottom: 10 }}>
                <p style={{ fontSize: 14, margin: 0, whiteSpace: "pre-wrap" }}>📝 {customer.notes}</p>
              </div>
            )}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <ChannelPicker value={channel} onChange={setChannel} />
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
              {customer.phone && (
                <button className="btn btn-secondary btn-sm" onClick={() => sendVia(channel, { phone: customer.phone, text: `Hello ${customer.name}!`, telegram: customer.telegram })}>
                  Message via {channel === "sms" ? "SMS" : channel === "telegram" ? "Telegram" : "WhatsApp"}
                </button>
              )}
              {customer.phone && (
                <a className="btn btn-secondary btn-sm" href={`tel:${customer.phone}`}>Call</a>
              )}
            </div>
          </>
        )}
      </div>

      <div className="metric-grid">
        <div className="metric-card"><span>Lifetime value</span><strong>{fmt(stats.lifetime_sales)}</strong></div>
        <div className="metric-card"><span>Total paid</span><strong>{fmt(stats.total_paid)}</strong></div>
        <div className={"metric-card" + (owing ? " bad" : "")}><span>Owing now</span><strong>{fmt(stats.outstanding)}</strong></div>
        <div className="metric-card"><span>Purchases</span><strong>{stats.purchase_count}</strong></div>
        <div className="metric-card"><span>Last seen</span><strong>{dLastSeen == null ? "—" : dLastSeen === 0 ? "Today" : `${dLastSeen}d ago`}</strong></div>
        <div className="metric-card"><span>Customer since</span><strong>{stats.first_seen ? stats.first_seen.slice(0, 10) : "—"}</strong></div>
      </div>

      {owing && (
        <div className="card" style={{ borderLeft: "4px solid var(--danger)", marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>Debtor watch</h3>
          <p style={{ fontSize: 14, margin: "0 0 6px" }}>
            Owes <strong className="debt-amt money">{fmt(stats.outstanding)}</strong>
            {dLastPay != null && <span> · last payment {dLastPay === 0 ? "today" : `${dLastPay} days ago`}</span>}
            {dLastPay == null && <span> · no payment recorded yet</span>}
          </p>
          <p style={{ fontSize: 14, margin: "0 0 12px", color: "var(--muted)" }}>
            Reminded {stats.reminders_count} time{stats.reminders_count === 1 ? "" : "s"}
            {stats.last_reminded_at ? ` · last ${stats.last_reminded_at.slice(0, 10)}` : " · never reminded"}
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {customer.phone && <button className="btn btn-primary btn-sm" onClick={remind}>Remind on WhatsApp</button>}
            <button className="btn btn-secondary btn-sm" onClick={shareDebtCard}>Share reminder card</button>
            <button className="btn btn-secondary btn-sm" onClick={() => nav("/app/debts")}>Record payment</button>
          </div>
        </div>
      )}

      {/* WORLD-BEST: Customer statement — start */}
      <div className="card statement-card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Statement for {customer.name}</h3>
        <p className="hint" style={{ marginTop: 0 }}>A record of what happened in the period. Opening balance plus sales, less payments, is the balance.</p>
        <div className="toolbar" style={{ padding: 0 }}>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="stmt-from">From</label>
            <input id="stmt-from" type="date" value={stmtFrom} onChange={(e) => setStmtFrom(e.target.value)} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="stmt-to">To</label>
            <input id="stmt-to" type="date" value={stmtTo} onChange={(e) => setStmtTo(e.target.value)} />
          </div>
          <button className="btn btn-secondary btn-sm" onClick={() => loadStatement(stmtFrom, stmtTo)}>Update</button>
          <button className="btn btn-secondary btn-sm" onClick={() => window.print()}>Print</button>
        </div>
        {stmtError && <div className="alert alert-error">{stmtError}</div>}
        {stmtLoading ? <p className="hint">Loading statement...</p> : stmt && (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span>Opening balance</span><span className="money">{fmt(stmt.opening_balance)}</span></div>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span>Sales</span><span className="money">{fmt(stmt.sales)}</span></div>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span>Payments</span><span className="money">{fmt(stmt.payments)}</span></div>
              {Number(stmt.adjustments) !== 0 && (
                <div style={{ display: "flex", justifyContent: "space-between" }}><span>Adjustments</span><span className="money">{fmt(stmt.adjustments)}</span></div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid var(--line)", paddingTop: 8 }}>
                <strong>Balance</strong><strong className="money">{fmt(stmt.closing_balance)}</strong>
              </div>
            </div>
            {stmt.entries.length > 0 && (
              <div className="table-wrap" style={{ marginTop: 12 }}>
                <table className="data">
                  <thead><tr><th>Date</th><th>What happened</th><th>Change</th><th>Balance</th></tr></thead>
                  <tbody>
                    {stmt.entries.map((e) => (
                      <tr key={e.id}>
                        <td><small>{e.date}</small></td>
                        <td>{e.type === "payment" ? "Payment" : e.type === "debt" ? "Sale on credit" : e.type === "sale" ? "Sale" : e.type === "writeoff" ? "Written off" : e.type}{e.note ? ` — ${e.note}` : ""}</td>
                        <td className="money">{fmt(e.amount)}</td>
                        <td className="money">{fmt(e.balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {stmt.entries.length === 0 && <p className="empty">Nothing in this period.</p>}
          </>
        )}
      </div>
      {/* WORLD-BEST: Customer statement — end */}

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ marginTop: 0 }}>History</h3>
          <button className="btn btn-secondary btn-sm" onClick={requestStatementPrint} disabled={recent.length === 0}>Print statement</button>
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Date</th><th>Type</th><th>Change</th><th>Balance</th></tr></thead>
            <tbody>
              {recent.map((l) => (
                <tr key={l.id}>
                  <td><small>{l.created_at?.slice(0, 16).replace("T", " ")}</small></td>
                  <td><span className={"pill " + (l.entry_type === "payment" ? "pill-green" : l.entry_type === "debt" ? "pill-gold" : "pill-red")}>{l.entry_type}</span></td>
                  <td className="money">{fmt(l.amount_delta)}</td>
                  <td className="money">{fmt(l.balance_after)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {recent.length === 0 && <p className="empty">No history yet.</p>}
        </div>
      </div>
      <div className="print-only">
        <StatementPrint
          business={{ name: biz.name, phone: biz.receipt_phone || "", email: biz.receipt_email || "", telegram: biz.receipt_telegram || "", address: biz.receipt_address || "" }}
          title={`Customer statement — ${customer.name}`}
          period={recent.length ? `${recent[recent.length - 1].created_at?.slice(0, 10)} to ${recent[0].created_at?.slice(0, 10)}` : ""}
          lines={[...recent].reverse().map((l) => ({
            date: String(l.created_at || "").slice(0, 10),
            description: l.entry_type === "payment" ? `Payment received${l.note ? ` — ${l.note}` : ""}` : l.entry_type === "debt" ? `Debt added${l.note ? ` — ${l.note}` : ""}` : `Sale${l.note ? ` — ${l.note}` : ""}`,
            amount: Number(l.amount_delta || 0),
          }))}
          totals={[
            { label: "Total sales", amount: Number(stats.lifetime_sales || 0) },
            { label: "Total paid", amount: Number(stats.total_paid || 0) },
          ]}
          closingBalance={Number(stats.outstanding || 0)}
        />
      </div>
    </>
  );
}

import { useEffect, useState } from "react";
import { api, fmt, nav } from "../lib/api";
import { waLink, fillReminderTemplate } from "../lib/whatsapp";
import { debtCardUrl, shareCard } from "../lib/shareCards";

const TAG_SUGGESTIONS = ["VIP", "Wholesaler", "Regular", "New", "Watch"];

function daysSince(iso) {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

export default function CustomerDetailPage({ customerId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", notes: "", tags: "" });
  const [saving, setSaving] = useState(false);
  const [biz, setBiz] = useState({ name: "", reminder_template: "", brand_color: "#166534", tagline: "" });

  async function load() {
    setLoading(true);
    try {
      const d = await api.get(`/api/customer-profile?id=${customerId}`);
      setData(d);
      setForm({ name: d.customer.name || "", phone: d.customer.phone || "", notes: d.customer.notes || "", tags: d.customer.tags || "" });
      setError("");
    } catch (e) { setError(e.message); }
    setLoading(false);
  }

  useEffect(() => { load(); }, [customerId]);
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
      await api.post("/api/reminders", { kind: "debt", customerId: customer.id, phone: customer.phone, message });
    } catch { /* never block */ }
    window.open(waLink(customer.phone, message), "_blank", "noopener");
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
        <button className="btn btn-secondary btn-sm" onClick={() => setEditing(!editing)}>{editing ? "Cancel" : "Edit"}</button>
      </div>
      {error && <div className="alert alert-error">{error}</div>}

      <div className="card" style={{ marginBottom: 16 }}>
        {editing ? (
          <form onSubmit={save}>
            <div className="field"><label>Name *</label><input value={form.name} onChange={(e) => set("name", e.target.value)} required /></div>
            <div className="field"><label>Phone (WhatsApp)</label><input value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="080..." /></div>
            <div className="field"><label>Tags (comma separated)</label><input value={form.tags} onChange={(e) => set("tags", e.target.value)} placeholder="VIP, Wholesaler" /></div>
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
            <h2 style={{ margin: "0 0 4px" }}>{customer.name}</h2>
            <p style={{ color: "var(--muted)", margin: "0 0 10px" }}>{customer.phone || "No phone number"}</p>
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
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {customer.phone && (
                <a className="btn btn-secondary btn-sm" target="_blank" rel="noreferrer" href={waLink(customer.phone, `Hello ${customer.name}!`)}>WhatsApp</a>
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

      <div className="card">
        <h3 style={{ marginTop: 0 }}>History</h3>
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
    </>
  );
}

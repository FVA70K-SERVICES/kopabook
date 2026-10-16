import { useEffect, useState } from "react";
import { api, fmt, nav } from "../lib/api";
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
  const [form, setForm] = useState({ name: "", phone: "", notes: "", tags: "" });
  const [saving, setSaving] = useState(false);
  const [biz, setBiz] = useState({ name: "", reminder_template: "", brand_color: "#166534", tagline: "" });
  const [channel, setChannel] = useState("whatsapp");
  const [photoFile, setPhotoFile] = useState(null);
  const [uploading, setUploading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const d = await api.get(`/api/customer-profile?id=${customerId}`);
      setData(d);
      setForm({ name: d.customer.name || "", phone: d.customer.phone || "", notes: d.customer.notes || "", tags: d.customer.tags || "", telegram: d.customer.telegram || "" });
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
            <div className="field"><label>Name *</label><input value={form.name} onChange={(e) => set("name", e.target.value)} required /></div>
            <div className="field"><label>Phone (WhatsApp)</label><input value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="080..." /></div>
            <div className="field"><label>Telegram username (optional)</label><input value={form.telegram} onChange={(e) => set("telegram", e.target.value)} placeholder="@username" /></div>
            <div className="field"><label>Photo</label>
              {customer.photo_key && (
                <div style={{ marginBottom: 8 }}>
                  <img src={`/api/files?key=${encodeURIComponent(customer.photo_key)}`} alt=""
                    style={{ width: 96, height: 96, objectFit: "cover", borderRadius: "50%" }} />
                </div>
              )}
              <input type="file" accept="image/*" onChange={(e) => setPhotoFile(e.target.files[0] || null)} />
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button type="button" className="btn btn-secondary btn-sm" disabled={!photoFile || uploading} onClick={uploadPhoto}>
                  {uploading ? "Uploading..." : "Upload photo"}
                </button>
                {customer.photo_key && (
                  <button type="button" className="btn btn-secondary btn-sm" onClick={removePhoto}>Remove</button>
                )}
              </div>
            </div>
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

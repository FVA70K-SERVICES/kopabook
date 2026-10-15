import { useEffect, useState } from "react";
import { api, fmt, nav } from "../lib/api";
import { waLink, fillReminderTemplate } from "../lib/whatsapp";
import { sendVia } from "../lib/channels";
import ChannelPicker from "../components/ChannelPicker";

const DUE_DAYS = 7;

function isDue(lastRemindedAt) {
  if (!lastRemindedAt) return true;
  const days = (Date.now() - new Date(lastRemindedAt).getTime()) / 86400000;
  return days >= DUE_DAYS;
}

export default function DebtsPage({ session }) {
  const [data, setData] = useState({ total: 0, count: 0, debtors: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [paying, setPaying] = useState(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [biz, setBiz] = useState({ name: "", reminderTemplate: "" });
  const [askPhone, setAskPhone] = useState(null);
  const [phoneInput, setPhoneInput] = useState("");
  // Remind-all queue
  const [queue, setQueue] = useState(null); // { list, idx }
  const [channel, setChannel] = useState("whatsapp");
  const [payModes, setPayModes] = useState([]);

  useEffect(() => {
    api.get("/api/payment-modes").then((d) => {
      const modes = (d.modes || []).filter((m) => m.enabled);
      setPayModes(modes);
      if (modes.length) setMethod(modes[0].name);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    api.get("/api/business")
      .then((d) => setBiz({ name: d.business?.name || "", reminderTemplate: d.business?.reminder_template || "" }))
      .catch(() => {});
  }, []);

  function reminderText(debtor) {
    return fillReminderTemplate(biz.reminderTemplate, {
      debtorName: debtor.name,
      amount: fmt(debtor.outstanding),
      businessName: biz.name,
    });
  }

  async function logReminder(debtor, phone, message) {
    try {
      await api.post("/api/reminders", {
        kind: "debt", customerId: debtor.id, phone: phone || null, message,
      });
    } catch { /* logging must never block the reminder */ }
  }

  function openReminder(debtor, phone) {
    const message = reminderText(debtor);
    logReminder(debtor, phone, message);
    sendVia(channel, { phone, text: message });
    load();
  }

  async function load() {
    setLoading(true);
    try {
      const d = await api.get("/api/debts");
      setData(d); setError("");
    } catch (e) { setError(e.message); }
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function recordPayment() {
    const amt = Number(amount);
    if (!amt || amt <= 0) return;
    setSaving(true);
    try {
      const d = await api.post("/api/debts/payment", {
        customerId: paying.id, amount: amt, paymentMethod: method, note: note || undefined,
      });
      setPaying(null); setAmount(""); setNote("");
      if (d.change > 0) {
        setError("");
        alert(`Repayment recorded. Change to give back: ${fmt(d.change)}`);
      }
      load();
    } catch (e) { setError(e.message); }
    setSaving(false);
  }

  const dueDebtors = data.debtors.filter((d) => isDue(d.last_reminded_at));
  const current = queue ? queue.list[queue.idx] : null;

  function startQueue() {
    const list = dueDebtors.filter((d) => d.phone);
    if (!list.length) return;
    setQueue({ list, idx: 0 });
  }

  function queueSend() {
    if (!current) return;
    openReminder(current, current.phone);
    if (queue.idx + 1 < queue.list.length) setQueue({ ...queue, idx: queue.idx + 1 });
    else setQueue(null);
  }

  return (
    <>
      <div className="page-head">
        <h1>Debts</h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <ChannelPicker value={channel} onChange={setChannel} />
          {dueDebtors.length > 0 && (
            <button className="btn btn-primary btn-sm" onClick={startQueue}>
              Remind all due ({dueDebtors.filter((d) => d.phone).length})
            </button>
          )}
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      <p className="hint" style={{ marginTop: 0 }}>
        A debtor is due for a nudge when they have not been reminded in {DUE_DAYS} days.
        Reminders open WhatsApp with your template message; nothing sends automatically.
      </p>

      <div className="metric-grid">
        <div className="metric-card bad"><span>Total outstanding</span><strong>{fmt(data.total)}</strong></div>
        <div className="metric-card"><span>Customers owing</span><strong>{data.count}</strong></div>
        <div className="metric-card"><span>Due a reminder</span><strong>{dueDebtors.length}</strong></div>
      </div>

      {loading ? <div className="loading">Loading...</div> : (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Customer</th><th>Phone</th><th>Owing</th><th>Last activity</th><th>Reminder</th><th></th></tr></thead>
            <tbody>
              {data.debtors.map((d) => {
                const due = isDue(d.last_reminded_at);
                return (
                  <tr key={d.id}>
                    <td><a href={`/app/customers/${d.id}`} onClick={(e) => { e.preventDefault(); nav(`/app/customers/${d.id}`); }} style={{ fontWeight: 700 }}>{d.name}</a></td>
                    <td>{d.phone || "—"}</td>
                    <td className="money debt-amt">{fmt(d.outstanding)}</td>
                    <td><small>{d.last_activity?.slice(0, 10)}</small></td>
                    <td>
                      {due
                        ? <span className="pill pill-gold">Due</span>
                        : <small style={{ color: "var(--muted)" }}>Sent {d.last_reminded_at?.slice(0, 10)}</small>}
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button className="btn btn-primary btn-sm" onClick={() => setPaying(d)}>Record payment</button>
                        {d.phone
                          ? <button className="btn btn-secondary btn-sm" onClick={() => openReminder(d, d.phone)}>Remind via {channel === "sms" ? "SMS" : channel === "telegram" ? "Telegram" : "WhatsApp"}</button>
                          : <button className="btn btn-secondary btn-sm" onClick={() => { setAskPhone(d); setPhoneInput(""); }}>Remind via {channel === "sms" ? "SMS" : channel === "telegram" ? "Telegram" : "WhatsApp"}</button>}
                      </div>
                      {askPhone && askPhone.id === d.id && (
                        <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
                          <input
                            style={{ width: 130, padding: "8px 10px", border: "1px solid var(--line)", borderRadius: 8 }}
                            placeholder="080..."
                            value={phoneInput}
                            onChange={(e) => setPhoneInput(e.target.value)}
                            aria-label="Debtor WhatsApp number"
                          />
                          <button className="btn btn-secondary btn-sm" onClick={() => openReminder(d, phoneInput)}>Send</button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {data.debtors.length === 0 && <p className="empty">No outstanding debts. Clean book.</p>}
        </div>
      )}

      {queue && current && (
        <div className="modal-back" onClick={() => setQueue(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Remind debtors ({queue.idx + 1} of {queue.list.length})</h2>
            <p><strong>{current.name}</strong> owes <strong className="debt-amt money">{fmt(current.outstanding)}</strong></p>
            <div className="card" style={{ background: "var(--bg)", margin: "12px 0" }}>
              <p style={{ fontSize: 14, margin: 0, whiteSpace: "pre-wrap" }}>{reminderText(current)}</p>
            </div>
            <p className="hint">Tap Send to open WhatsApp for {current.name}. Press send in WhatsApp, come back, and continue.</p>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => {
                if (queue.idx + 1 < queue.list.length) setQueue({ ...queue, idx: queue.idx + 1 });
                else setQueue(null);
              }}>Skip</button>
              <button className="btn btn-primary" style={{ flex: 2 }} onClick={queueSend}>Send on WhatsApp</button>
            </div>
            <button className="btn btn-secondary btn-block" style={{ marginTop: 8 }} onClick={() => setQueue(null)}>Done</button>
          </div>
        </div>
      )}

      {paying && (
        <div className="modal-back" onClick={() => setPaying(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Record payment</h2>
            <p>{paying.name} owes <strong className="debt-amt money">{fmt(paying.outstanding)}</strong></p>
            <div className="field"><label>Amount received *</label><input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
            <div className="field"><div className="row2">
              <div><label>Method</label>
                <select value={method} onChange={(e) => setMethod(e.target.value)}>
                  {payModes.map((m) => <option key={m.id} value={m.name}>{m.name}</option>)}
                </select>
              </div>
              <div><label>Note</label><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" /></div>
            </div></div>
            <button className="btn btn-primary btn-block" disabled={saving} onClick={recordPayment}>
              {saving ? "Saving..." : "Save payment"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

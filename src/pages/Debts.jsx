import { useEffect, useState } from "react";
import { api, fmt } from "../lib/api";
import { waLink, debtReminderText } from "../lib/whatsapp";

export default function DebtsPage() {
  const [data, setData] = useState({ total: 0, count: 0, debtors: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [paying, setPaying] = useState(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [bizName, setBizName] = useState("");
  const [askPhone, setAskPhone] = useState(null);
  const [phoneInput, setPhoneInput] = useState("");

  useEffect(() => {
    api.get("/api/business").then((d) => setBizName(d.business?.name || "")).catch(() => {});
  }, []);

  function remindHref(debtor, phone) {
    return waLink(phone, debtReminderText({
      debtorName: debtor.name,
      amount: fmt(debtor.outstanding),
      businessName: bizName,
    }));
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
      await api.post("/api/debts/payment", {
        customerId: paying.id, amount: amt, paymentMethod: method, note: note || undefined,
      });
      setPaying(null); setAmount(""); setNote("");
      load();
    } catch (e) { setError(e.message); }
    setSaving(false);
  }

  return (
    <>
      <div className="page-head"><h1>Debts</h1></div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="metric-grid">
        <div className="metric-card bad"><span>Total outstanding</span><strong>{fmt(data.total)}</strong></div>
        <div className="metric-card"><span>Customers owing</span><strong>{data.count}</strong></div>
      </div>

      {loading ? <div className="loading">Loading...</div> : (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Customer</th><th>Phone</th><th>Owing</th><th>Last activity</th><th></th></tr></thead>
            <tbody>
              {data.debtors.map((d) => (
                <tr key={d.id}>
                  <td><strong>{d.name}</strong></td>
                  <td>{d.phone || "—"}</td>
                  <td className="money debt-amt">{fmt(d.outstanding)}</td>
                  <td><small>{d.last_activity?.slice(0, 10)}</small></td>
                  <td>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button className="btn btn-primary btn-sm" onClick={() => setPaying(d)}>Record payment</button>
                      {d.phone
                        ? <a className="btn btn-secondary btn-sm" target="_blank" rel="noreferrer"
                             href={remindHref(d, d.phone)}>Remind on WhatsApp</a>
                        : <button className="btn btn-secondary btn-sm"
                             onClick={() => { setAskPhone(d); setPhoneInput(""); }}>Remind on WhatsApp</button>}
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
                        <a className="btn btn-secondary btn-sm" target="_blank" rel="noreferrer"
                           href={remindHref(d, phoneInput)}>Send</a>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.debtors.length === 0 && <p className="empty">No outstanding debts. Clean book.</p>}
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
                  <option value="cash">Cash</option><option value="transfer">Transfer</option><option value="pos">POS</option>
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

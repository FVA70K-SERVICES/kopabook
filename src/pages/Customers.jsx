import { useEffect, useState } from "react";
import { api, fmt } from "../lib/api";

export default function CustomersPage() {
  const [customers, setCustomers] = useState([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState(null);
  const [ledger, setLedger] = useState(null);

  async function load(search) {
    setLoading(true);
    try {
      const d = await api.get("/api/customers" + (search ? `?q=${encodeURIComponent(search)}` : ""));
      setCustomers(d.customers); setError("");
    } catch (e) { setError(e.message); }
    setLoading(false);
  }
  useEffect(() => { load(""); }, []);

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  async function save(e) {
    e.preventDefault(); setSaving(true);
    try {
      await api.post("/api/customers", form);
      setShowForm(false); setForm({ name: "", phone: "", notes: "" });
      load(q);
    } catch (err) { setError(err.message); }
    setSaving(false);
  }

  async function openLedger(c) {
    setSelected(c);
    try {
      const d = await api.get(`/api/customers/${c.id}/ledger`);
      setLedger(d);
    } catch (e) { setError(e.message); }
  }

  return (
    <>
      <div className="page-head">
        <h1>Customers</h1>
        <button className="btn btn-primary btn-sm" onClick={() => setShowForm(true)}>+ Add customer</button>
      </div>

      <div className="toolbar">
        <input className="search" placeholder="Search customers..." value={q}
          onChange={(e) => { setQ(e.target.value); load(e.target.value); }} />
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {loading ? <div className="loading">Loading...</div> : (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Name</th><th>Phone</th><th>Outstanding</th><th></th></tr></thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.id}>
                  <td><strong>{c.name}</strong></td>
                  <td>{c.phone || "—"}</td>
                  <td className={Number(c.outstanding) > 0 ? "money debt-amt" : "money"}>{fmt(c.outstanding)}</td>
                  <td><button className="btn btn-secondary btn-sm" onClick={() => openLedger(c)}>Ledger</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {customers.length === 0 && <p className="empty">No customers yet.</p>}
        </div>
      )}

      {showForm && (
        <div className="modal-back" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Add customer</h2>
            <form onSubmit={save}>
              <div className="field"><label>Name *</label><input value={form.name} onChange={(e) => set("name", e.target.value)} required /></div>
              <div className="field"><label>Phone</label><input value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="080..." /></div>
              <div className="field"><label>Notes</label><input value={form.notes} onChange={(e) => set("notes", e.target.value)} /></div>
              <button className="btn btn-primary btn-block" disabled={saving}>{saving ? "Saving..." : "Save customer"}</button>
            </form>
          </div>
        </div>
      )}

      {selected && (
        <div className="modal-back" onClick={() => { setSelected(null); setLedger(null); }}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{selected.name}</h2>
            {!ledger ? <div className="loading">Loading ledger...</div> : (
              <>
                <p>Outstanding: <strong className={ledger.outstanding > 0 ? "debt-amt money" : "money"}>{fmt(ledger.outstanding)}</strong></p>
                <div className="table-wrap">
                  <table className="data">
                    <thead><tr><th>Date</th><th>Type</th><th>Change</th><th>Balance</th></tr></thead>
                    <tbody>
                      {ledger.ledger.map((l) => (
                        <tr key={l.id}>
                          <td><small>{l.created_at?.slice(0, 16).replace("T", " ")}</small></td>
                          <td><span className={"pill " + (l.entry_type === "payment" ? "pill-green" : "pill-red")}>{l.entry_type}</span></td>
                          <td className="money">{fmt(l.amount_delta)}</td>
                          <td className="money">{fmt(l.balance_after)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {ledger.ledger.length === 0 && <p className="empty">No ledger entries yet.</p>}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

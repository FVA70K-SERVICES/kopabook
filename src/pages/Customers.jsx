import { useEffect, useState } from "react";
import { api, fmt, nav } from "../lib/api";

export default function CustomersPage() {
  const [customers, setCustomers] = useState([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", notes: "" });
  const [saving, setSaving] = useState(false);

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

  const withPhones = customers.filter((c) => c.phone).length;
  const owing = customers.filter((c) => Number(c.outstanding) > 0).length;

  return (
    <>
      <div className="page-head">
        <h1>Customers</h1>
        <button className="btn btn-primary btn-sm" onClick={() => setShowForm(true)}>+ Add customer</button>
      </div>

      <div className="metric-grid" style={{ marginBottom: 12 }}>
        <div className="metric-card"><span>Total customers</span><strong>{customers.length}</strong></div>
        <div className="metric-card"><span>With WhatsApp</span><strong>{withPhones}</strong></div>
        <div className="metric-card"><span>Owing</span><strong>{owing}</strong></div>
      </div>

      <div className="toolbar">
        <input className="search" placeholder="Search name, phone or tag..." value={q}
          onChange={(e) => { setQ(e.target.value); load(e.target.value); }} />
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {loading ? <div className="loading">Loading...</div> : (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Name</th><th>Phone</th><th>Tags</th><th>Outstanding</th><th></th></tr></thead>
            <tbody>
              {customers.map((c) => {
                const tags = String(c.tags || "").split(",").map((t) => t.trim()).filter(Boolean);
                return (
                  <tr key={c.id}>
                    <td><strong>{c.name}</strong></td>
                    <td>{c.phone || "—"}</td>
                    <td>{tags.length ? tags.map((t) => <span key={t} className="pill pill-green" style={{ marginRight: 4 }}>{t}</span>) : <small style={{ color: "var(--muted)" }}>—</small>}</td>
                    <td className={Number(c.outstanding) > 0 ? "money debt-amt" : "money"}>{fmt(c.outstanding)}</td>
                    <td><button className="btn btn-secondary btn-sm" onClick={() => nav(`/app/customers/${c.id}`)}>View</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {customers.length === 0 && <p className="empty">No customers yet. Add your first one above.</p>}
        </div>
      )}

      {showForm && (
        <div className="modal-back" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Add customer</h2>
            <p className="hint">Just a name gets them in the book. Add the WhatsApp number when you have it.</p>
            <form onSubmit={save}>
              <div className="field"><label>Name *</label><input value={form.name} onChange={(e) => set("name", e.target.value)} required autoFocus /></div>
              <div className="field"><label>Phone (WhatsApp)</label><input value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="080..." inputMode="tel" /></div>
              <div className="field"><label>Notes</label><input value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Anything to remember..." /></div>
              <button className="btn btn-primary btn-block" disabled={saving}>{saving ? "Saving..." : "Save customer"}</button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

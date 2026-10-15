import { useEffect, useState } from "react";
import { api, fmt } from "../lib/api";

const UNITS = ["per job", "per hour", "per day", "per item"];
const emptyForm = { name: "", description: "", price: "", unit: "per job" };

export default function ServicesPage({ session }) {
  const [services, setServices] = useState([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const canManage = session.perms?.can_manage_products;

  async function load() {
    setLoading(true);
    try {
      const d = await api.get("/api/services?active=all");
      setServices(d.services);
      setError("");
    } catch (e) { setError(e.message); }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const filtered = services.filter((s) =>
    s.name.toLowerCase().includes(q.toLowerCase())
  );

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  function openAdd() { setEditing(null); setForm(emptyForm); setShowForm(true); }
  function openEdit(s) {
    setEditing(s);
    setForm({ name: s.name, description: s.description || "", price: String(s.price), unit: s.unit || "per job" });
    setShowForm(true);
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        price: Number(form.price),
        unit: form.unit,
      };
      if (editing) await api.patch(`/api/services/${editing.id}`, payload);
      else await api.post("/api/services", payload);
      setShowForm(false);
      load();
    } catch (err) { setError(err.message); }
    setSaving(false);
  }

  async function deactivate(s) {
    if (!window.confirm(`Deactivate "${s.name}"? It will stop appearing in new sales, but past sale history stays.`)) return;
    try { await api.del(`/api/services/${s.id}`); load(); }
    catch (e) { setError(e.message); }
  }

  async function reactivate(s) {
    try { await api.patch(`/api/services/${s.id}`, { isActive: true }); load(); }
    catch (e) { setError(e.message); }
  }

  return (
    <>
      <div className="page-head">
        <h1>Services</h1>
        {canManage && <button className="btn btn-primary btn-sm" onClick={openAdd}>+ Add service</button>}
      </div>

      <div className="toolbar">
        <input className="search" placeholder="Search services..." value={q}
          onChange={(e) => setQ(e.target.value)} />
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {loading ? <div className="loading">Loading services...</div> : (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Service</th><th>Price</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.id}>
                  <td>
                    <strong>{s.name}</strong>
                    {s.description && <><br /><small style={{ color: "var(--muted)" }}>{s.description}</small></>}
                  </td>
                  <td className="money">{fmt(s.price)} <small style={{ color: "var(--muted)" }}>{s.unit}</small></td>
                  <td>
                    {Number(s.is_active) === 1
                      ? <span className="pill pill-green">Active</span>
                      : <span className="pill pill-gold">Inactive</span>}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {canManage && <>
                      <button className="btn btn-secondary btn-sm" onClick={() => openEdit(s)}>Edit</button>{" "}
                      {Number(s.is_active) === 1
                        ? (session.business?.role === "owner" && (
                            <button className="btn btn-danger btn-sm" onClick={() => deactivate(s)}>Deactivate</button>
                          ))
                        : <button className="btn btn-secondary btn-sm" onClick={() => reactivate(s)}>Reactivate</button>}
                    </>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <p className="empty">No services yet. Add your first service to start selling it.</p>}
        </div>
      )}

      {showForm && (
        <div className="modal-back" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{editing ? "Edit service" : "Add service"}</h2>
            <form onSubmit={save}>
              <div className="field"><label>Name *</label><input value={form.name} onChange={(e) => set("name", e.target.value)} required /></div>
              <div className="field"><label>Description</label><input value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="What the service includes" /></div>
              <div className="field"><div className="row2">
                <div><label>Price *</label><input type="number" min="0" step="0.01" value={form.price} onChange={(e) => set("price", e.target.value)} required /></div>
                <div><label>Priced</label>
                  <select value={form.unit} onChange={(e) => set("unit", e.target.value)}>
                    {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
              </div></div>
              <button className="btn btn-primary btn-block" disabled={saving}>{saving ? "Saving..." : "Save service"}</button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

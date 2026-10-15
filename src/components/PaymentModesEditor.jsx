import { useEffect, useState } from "react";
import { api } from "../lib/api";

export default function PaymentModesEditor({ canManage }) {
  const [modes, setModes] = useState([]);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null);
  const [editName, setEditName] = useState("");

  async function load() {
    setLoading(true);
    try {
      const d = await api.get("/api/payment-modes");
      setModes(d.modes || []); setError("");
    } catch (e) { setError(e.message); }
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function add(e) {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      await api.post("/api/payment-modes", { name: name.trim() });
      setName(""); load();
    } catch (err) { setError(err.message); }
  }

  async function toggle(m) {
    try {
      await api.patch("/api/payment-modes", { id: m.id, enabled: !m.enabled });
      load();
    } catch (err) { setError(err.message); }
  }

  async function rename(m) {
    if (!editName.trim()) { setEditing(null); return; }
    try {
      await api.patch("/api/payment-modes", { id: m.id, name: editName.trim() });
      setEditing(null); load();
    } catch (err) { setError(err.message); }
  }

  async function remove(m) {
    if (!window.confirm(`Remove "${m.name}"? Past sales keep their records.`)) return;
    try {
      await api.del(`/api/payment-modes?id=${m.id}`);
      load();
    } catch (err) { setError(err.message); }
  }

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <div>
      {error && <div className="alert alert-error">{error}</div>}
      {modes.map((m) => (
        <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderBottom: "1px solid var(--line)" }}>
          {editing === m.id ? (
            <>
              <input value={editName} onChange={(e) => setEditName(e.target.value)} style={{ flex: 1 }} maxLength={40} />
              <button className="btn btn-primary btn-sm" onClick={() => rename(m)}>Save</button>
              <button className="btn btn-secondary btn-sm" onClick={() => setEditing(null)}>Cancel</button>
            </>
          ) : (
            <>
              <span style={{ flex: 1, opacity: m.enabled ? 1 : 0.45 }}>{m.name}</span>
              {!m.enabled && <span className="pill pill-gray">off</span>}
              {canManage && (
                <>
                  <button className="btn btn-secondary btn-sm" onClick={() => toggle(m)}>{m.enabled ? "Disable" : "Enable"}</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => { setEditing(m.id); setEditName(m.name); }}>Rename</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => remove(m)}>Remove</button>
                </>
              )}
            </>
          )}
        </div>
      ))}
      {canManage && (
        <form onSubmit={add} style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New mode, e.g. OPay" maxLength={40} style={{ flex: 1 }} />
          <button className="btn btn-primary btn-sm" type="submit">Add</button>
        </form>
      )}
    </div>
  );
}

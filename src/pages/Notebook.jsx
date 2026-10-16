import { useEffect, useState } from "react";
import { api } from "../lib/api";

function fmtDate(s) {
  const d = new Date(String(s).replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function NotebookPage({ session }) {
  const [tab, setTab] = useState("shared"); // shared | private
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [visibility, setVisibility] = useState("shared");
  const [saving, setSaving] = useState(false);

  const myId = session.user?.id;
  const myRole = session.business?.role;
  const canModerate = myRole === "owner" || myRole === "partner";

  async function load(t) {
    setLoading(true); setError("");
    try {
      const d = await api.get("/api/notes?visibility=" + t);
      setNotes(d.notes || []);
    } catch (e) { setError(e.message); }
    setLoading(false);
  }

  useEffect(() => { load(tab); }, [tab]);

  function openNew() {
    setEditing(null); setTitle(""); setContent(""); setVisibility(tab === "private" ? "private" : "shared");
    setShowForm(true);
  }

  function openEdit(n) {
    setEditing(n); setTitle(n.title || ""); setContent(n.content || ""); setVisibility(n.visibility);
    setShowForm(true);
  }

  async function save(e) {
    e.preventDefault();
    if (!title.trim() && !content.trim()) return;
    setSaving(true);
    try {
      if (editing) {
        await api.put("/api/notes", { id: editing.id, title: title.trim(), content: content.trim(), visibility });
      } else {
        await api.post("/api/notes", { title: title.trim(), content: content.trim(), visibility });
      }
      setShowForm(false);
      load(tab);
    } catch (err) { setError(err.message); }
    setSaving(false);
  }

  async function remove(n) {
    if (!window.confirm("Delete this note?")) return;
    try {
      await api.del("/api/notes?id=" + n.id);
      load(tab);
    } catch (e) { setError(e.message); }
  }

  function canEdit(n) {
    if (n.user_id === myId) return true;
    return n.visibility === "shared" && canModerate;
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>Notebook</h2>
        <button className="btn btn-primary btn-sm" onClick={openNew}>+ New note</button>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button className={"btn btn-sm " + (tab === "shared" ? "btn-primary" : "btn-secondary")}
          onClick={() => setTab("shared")}>Shared with everyone</button>
        <button className={"btn btn-sm " + (tab === "private" ? "btn-primary" : "btn-secondary")}
          onClick={() => setTab("private")}>My private notes</button>
      </div>
      <p className="hint" style={{ marginTop: -8, marginBottom: 16 }}>
        {tab === "shared"
          ? "Everyone in this business (owners, managers and staff) can read these."
          : "Only you can see these. Not even the owner."}
      </p>

      {error && <div className="alert alert-error">{error}</div>}
      {loading && <div className="loading">Loading notes...</div>}

      {!loading && notes.length === 0 && (
        <div className="card" style={{ textAlign: "center", color: "#666" }}>
          No {tab === "shared" ? "shared" : "private"} notes yet. Tap "+ New note" to write one.
        </div>
      )}

      <div style={{ display: "grid", gap: 12 }}>
        {notes.map((n) => (
          <div className="card" key={n.id} style={{ margin: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
              <div>
                {n.title && <h4 style={{ margin: "0 0 4px" }}>{n.title}</h4>}
                <div style={{ fontSize: 12, color: "#888", marginBottom: 8 }}>
                  {n.author_name || "Someone"} · {fmtDate(n.updated_at)}
                  {n.visibility === "private" ? " · 🔒 Only you" : " · 👥 Shared"}
                </div>
              </div>
              {canEdit(n) && (
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <button className="btn btn-secondary btn-sm" onClick={() => openEdit(n)}>Edit</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => remove(n)}>Delete</button>
                </div>
              )}
            </div>
            <div style={{ whiteSpace: "pre-wrap", fontSize: 15 }}>{n.content}</div>
          </div>
        ))}
      </div>

      {showForm && (
        <div className="modal-backdrop" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{editing ? "Edit note" : "New note"}</h3>
            <form onSubmit={save}>
              <label>Title
                <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120}
                  placeholder="Note title (optional)" />
              </label>
              <label>Note
                <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={6}
                  placeholder="Write it down..." required />
              </label>
              <label>Who can see this?
                <select value={visibility} onChange={(e) => setVisibility(e.target.value)}>
                  <option value="shared">👥 Everyone in the business</option>
                  <option value="private">🔒 Only me</option>
                </select>
              </label>
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button type="submit" className="btn btn-primary btn-block" disabled={saving}>
                  {saving ? "Saving..." : "Save note"}
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

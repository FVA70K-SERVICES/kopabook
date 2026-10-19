import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";

const COLORS = {
  default:  { paper: "#fffdf7", border: "#e5ddc8", label: "White" },
  butter:   { paper: "#fff6d9", border: "#ecd9a0", label: "Butter" },
  mint:     { paper: "#e6f5ec", border: "#b5dcc3", label: "Mint" },
  sky:      { paper: "#e5effc", border: "#b3cdec", label: "Sky" },
  blush:    { paper: "#fcebf0", border: "#eebfcd", label: "Blush" },
  lavender: { paper: "#ede8fb", border: "#c9bdf0", label: "Lavender" },
};

// Real book page look: paper grain, ruled lines, red margin line,
// dark binding spine on the left, page-edge curl shadow on the right,
// handwriting-friendly type.
const HAND = "'Segoe Print','Bradley Hand','Chalkboard SE','Comic Sans MS',cursive,system-ui,sans-serif";
const RULE = "rgba(110,150,200,0.55)";
const MARGIN = "rgba(228,120,120,0.8)";
const CARD_LINE = 30;
const EDIT_LINE = 32;

// Subtle paper grain (inline SVG turbulence, no external assets).
const GRAIN = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0.45 0 0 0 0 0.38 0 0 0 0 0.28 0 0 0 0.06 0'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)'/%3E%3C/svg%3E\")";

function paperBg(lineH) {
  return (
    GRAIN + "," +
    `repeating-linear-gradient(transparent 0, transparent ${lineH - 1}px, ${RULE} ${lineH - 1}px, ${RULE} ${lineH}px),` +
    `linear-gradient(90deg, transparent 0, transparent 47px, ${MARGIN} 47px, ${MARGIN} 49px, transparent 49px),` +
    // binding spine: darker strip hugging the left edge
    `linear-gradient(90deg, rgba(74,52,28,0.28) 0px, rgba(74,52,28,0.14) 10px, rgba(74,52,28,0.05) 20px, transparent 32px),` +
    // page edge: curl shadow on the right
    `linear-gradient(270deg, rgba(74,52,28,0.20) 0px, rgba(74,52,28,0.08) 7px, rgba(255,255,255,0.35) 13px, transparent 24px)`
  );
}

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
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [visibility, setVisibility] = useState("shared");
  const [color, setColor] = useState("default");
  const [pinned, setPinned] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

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

  useEffect(() => { load(tab); setSearch(""); }, [tab]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return notes;
    return notes.filter((n) =>
      (n.title || "").toLowerCase().includes(q) || (n.content || "").toLowerCase().includes(q)
    );
  }, [notes, search]);

  function openNew() {
    setEditing(null); setTitle(""); setContent("");
    setVisibility(tab === "private" ? "private" : "shared");
    setColor("default"); setPinned(false);
    setShowForm(true);
  }

  function openEdit(n) {
    setEditing(n); setTitle(n.title || ""); setContent(n.content || "");
    setVisibility(n.visibility); setColor(n.color || "default"); setPinned(!!n.pinned);
    setShowForm(true);
  }

  async function save(e) {
    e.preventDefault();
    if (!title.trim() && !content.trim()) return;
    setSaving(true);
    try {
      const payload = { title: title.trim(), content: content.trim(), visibility, color, pinned };
      if (editing) await api.put("/api/notes", { id: editing.id, ...payload });
      else await api.post("/api/notes", payload);
      setShowForm(false);
      load(tab);
    } catch (err) { setError(err.message); }
    setSaving(false);
  }

  async function remove(n) {
    if (confirmDeleteId !== n.id) { setConfirmDeleteId(n.id); return; }
    setConfirmDeleteId(null);
    try {
      await api.del("/api/notes?id=" + n.id);
      load(tab);
    } catch (e) { setError(e.message); }
  }

  async function togglePin(n) {
    try {
      await api.put("/api/notes", { id: n.id, pinned: !n.pinned });
      load(tab);
    } catch (e) { setError(e.message); }
  }

  function canEdit(n) {
    if (n.user_id === myId) return true;
    return n.visibility === "shared" && canModerate;
  }

  const formColor = COLORS[color] || COLORS.default;
  const ruledInput = {
    width: "100%",
    boxSizing: "border-box",
    fontFamily: HAND,
    backgroundColor: formColor.paper,
    backgroundImage: paperBg(EDIT_LINE),
    border: `1px solid ${formColor.border}`,
    borderRadius: 6,
    padding: `0 10px 0 56px`,
    color: "#333",
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Notebook</h2>
        <button className="btn btn-primary btn-sm" onClick={openNew}>+ New note</button>
      </div>

      <p style={{ margin: "0 0 10px", fontSize: 13, color: "#6b7280" }}>
        Showing notes for: <strong>{session.business?.name || "your business"}</strong>
      </p>

      <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <button className={"btn btn-sm " + (tab === "shared" ? "btn-primary" : "btn-secondary")}
          onClick={() => setTab("shared")}>Shared with everyone</button>
        <button className={"btn btn-sm " + (tab === "private" ? "btn-primary" : "btn-secondary")}
          onClick={() => setTab("private")}>My private notes</button>
      </div>
      <p className="hint" style={{ marginTop: 0, marginBottom: 12 }}>
        {tab === "shared"
          ? "Everyone in this business (owners, managers and staff) can read these."
          : "Only you can see these. Not even the owner."}
      </p>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search notes..."
        style={{
          width: "100%", padding: "10px 14px", borderRadius: 12, border: "1px solid #ddd",
          marginBottom: 14, fontSize: 15, boxSizing: "border-box",
        }}
      />

      {error && <div className="alert alert-error">{error}</div>}
      {loading && <div className="loading">Loading notes...</div>}

      {!loading && visible.length === 0 && (
        <div className="card" style={{ textAlign: "center", color: "#666", borderRadius: 14 }}>
          {search ? `No notes match "${search}".` : `No ${tab === "shared" ? "shared" : "private"} notes yet. Tap "+ New note" to write one.`}
        </div>
      )}

      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
        {visible.map((n, idx) => {
          const c = COLORS[n.color] || COLORS.default;
          return (
            <div key={n.id} style={{
              margin: 0,
              backgroundColor: c.paper,
              backgroundImage: paperBg(CARD_LINE),
              border: `1px solid ${c.border}`,
              borderRadius: 4,
              padding: "14px 14px 10px 16px",
              boxShadow: "0 8px 20px rgba(74,52,28,0.16), 0 2px 5px rgba(74,52,28,0.10)",
              display: "flex", flexDirection: "column",
            }}>
              <div style={{ paddingLeft: 44 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    {n.title && <h4 style={{
                      margin: 0, fontSize: 18, lineHeight: CARD_LINE + "px",
                      fontFamily: HAND, fontWeight: 700, color: "#2b2b2b",
                    }}>{n.title}</h4>}
                    <div style={{ fontSize: 12, color: "#7a7a7a", lineHeight: CARD_LINE + "px", fontFamily: "system-ui,sans-serif" }}>
                      {n.pinned ? "📌 " : ""}{n.author_name || "Someone"} · {fmtDate(n.updated_at)}
                    </div>
                  </div>
                  <button
                    onClick={() => togglePin(n)}
                    title={n.pinned ? "Unpin" : "Pin to top"}
                    style={{
                      border: "none", background: "transparent", cursor: "pointer", fontSize: 17,
                      opacity: n.pinned ? 1 : 0.35, padding: 2, flexShrink: 0, lineHeight: CARD_LINE + "px",
                    }}>
                    📌
                  </button>
                </div>
                <div style={{
                  whiteSpace: "pre-wrap", fontSize: 16, lineHeight: CARD_LINE + "px",
                  fontFamily: HAND, color: "#333", flex: 1, marginTop: 4,
                }}>{n.content}</div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
                  <span style={{
                    fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20,
                    background: n.visibility === "private" ? "#2d2d2d" : "#e8f5e9",
                    color: n.visibility === "private" ? "#fff" : "#1a6b3c",
                    fontFamily: "system-ui,sans-serif",
                  }}>
                    {n.visibility === "private" ? "🔒 Only you" : "👥 Shared"}
                  </span>
                  {canEdit(n) && (
                    <div style={{ display: "flex", gap: 6 }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => openEdit(n)}>Edit</button>
                      <button className="btn btn-secondary btn-sm" style={confirmDeleteId === n.id ? { color: "#b3261e", borderColor: "#b3261e", fontWeight: 700 } : undefined} onClick={() => remove(n)}>{confirmDeleteId === n.id ? "Tap again to delete" : "Delete"}</button>
                    </div>
                  )}
                </div>
                <div style={{
                  textAlign: "center", fontFamily: HAND, fontSize: 12.5, color: "#9a8a6a",
                  lineHeight: CARD_LINE + "px", marginTop: 4,
                }}>
                  - Page {idx + 1} -
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {showForm && (
        <div className="modal-backdrop" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>{editing ? "Edit note" : "New note"}</h3>
            <form onSubmit={save}>
              <label>Title
                <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120}
                  placeholder="Note title (optional)"
                  style={{ ...ruledInput, fontSize: 17, lineHeight: EDIT_LINE + "px", height: EDIT_LINE + 14 }} />
              </label>
              <label>Note
                <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={7}
                  placeholder="Write it down..." required
                  style={{ ...ruledInput, fontSize: 16, lineHeight: EDIT_LINE + "px", paddingTop: 0, paddingBottom: 8, resize: "vertical" }} />
              </label>
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Color</div>
                <div style={{ display: "flex", gap: 8 }}>
                  {Object.entries(COLORS).map(([key, c]) => (
                    <button type="button" key={key} title={c.label}
                      onClick={() => setColor(key)}
                      style={{
                        width: 34, height: 34, borderRadius: "50%", cursor: "pointer",
                        background: c.paper, border: color === key ? "3px solid #1a6b3c" : `2px solid ${c.border}`,
                      }} />
                  ))}
                </div>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)}
                  style={{ width: 18, height: 18 }} />
                <span style={{ fontSize: 14 }}>📌 Pin this note to the top</span>
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

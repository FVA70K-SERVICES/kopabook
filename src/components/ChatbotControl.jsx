import { useEffect, useState } from "react";
import { api } from "../lib/api";

function timeAgo(ts) {
  const t = Number(ts) || 0;
  if (!t) return "";
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m ago";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h ago";
  return Math.floor(h / 24) + "d ago";
}

function Switch({ on, onChange, disabled, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!!on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      style={{
        width: 46, height: 26, borderRadius: 13, border: "none", cursor: disabled ? "default" : "pointer",
        background: on ? "#166534" : "#d1d5db", position: "relative", flexShrink: 0,
        transition: "background 0.15s",
      }}
    >
      <span style={{
        position: "absolute", top: 3, left: on ? 23 : 3, width: 20, height: 20,
        borderRadius: "50%", background: "#fff", transition: "left 0.15s",
        boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
      }} />
    </button>
  );
}

export default function ChatbotControl() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [botOn, setBotOn] = useState(true);
  const [autoOn, setAutoOn] = useState(false);
  const [hours, setHours] = useState(24);
  const [siteId, setSiteId] = useState("");
  const [convos, setConvos] = useState([]);
  const [confirmClear, setConfirmClear] = useState(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const d = await api.get("/api/chat/control");
      setBotOn(!!d.settings?.bot_enabled);
      setAutoOn(!!d.settings?.auto_clear_enabled);
      setHours(Number(d.settings?.auto_clear_hours) || 24);
      setSiteId(d.settings?.site_id || "");
      setConvos(d.conversations || []);
    } catch (e) {
      setError(e.message || "Could not load chatbot controls.");
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function toggleBot() {
    const next = !botOn;
    setBusy(true);
    setError("");
    setOk("");
    try {
      await api.post("/api/chat/control", { action: "set_bot", enabled: next });
      setBotOn(next);
      setOk(next
        ? "Chatbot is on. It will answer new visitor chats."
        : "Chatbot is off. New visitor chats will wait for you in the Chat Center instead.");
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  }

  async function saveAutoClear() {
    setBusy(true);
    setError("");
    setOk("");
    try {
      const d = await api.post("/api/chat/control", { action: "set_auto_clear", enabled: autoOn, hours });
      setAutoOn(!!d.auto_clear_enabled);
      setHours(Number(d.auto_clear_hours) || 24);
      setOk(d.auto_clear_enabled
        ? `Chat history older than ${d.auto_clear_hours} hours will now be cleared automatically.`
        : "Automatic clearing is off. Your chat history will be kept.");
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  }

  async function clearChat(id) {
    if (confirmClear !== id) {
      setConfirmClear(id);
      return;
    }
    setConfirmClear(null);
    setBusy(true);
    setError("");
    setOk("");
    try {
      const d = await api.post("/api/chat/control", { action: "clear_session", session_id: id });
      setOk(`Cleared ${d.deleted || 0} messages from that conversation. The chat stays open.`);
      load();
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  }

  if (loading) return <p className="hint">Loading chatbot controls...</p>;

  return (
    <div>
      {error && <div className="alert alert-error">{error}</div>}
      {ok && <div className="alert alert-ok">{ok}</div>}

      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 6 }}>
        <Switch on={botOn} onChange={toggleBot} disabled={busy} label="Chatbot on or off" />
        <div>
          <div style={{ fontWeight: 600 }}>Chatbot {botOn ? "is on" : "is off"}</div>
          <p className="hint" style={{ margin: "4px 0 0" }}>
            {botOn
              ? "The bot answers new visitor chats on your website."
              : "The bot is quiet. New visitor chats go straight to you in the Chat Center."}
          </p>
        </div>
      </div>
      {siteId && (
        <p className="hint" style={{ marginTop: 0 }}>
          Your website widget uses site ID: <code>{siteId}</code>
        </p>
      )}

      <hr style={{ border: "none", borderTop: "1px solid var(--line, #e5e7eb)", margin: "16px 0" }} />

      <div style={{ fontWeight: 600, marginBottom: 4 }}>Live chats</div>
      <p className="hint" style={{ marginTop: 0 }}>
        Conversations on your website right now. To reply as yourself, open the Chat Center and take over.
      </p>
      {convos.length === 0 ? (
        <p className="hint">No active chats right now.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 8 }}>
          {convos.map((c) => (
            <div key={c.id} style={{
              display: "flex", gap: 10, alignItems: "center", padding: "10px 12px",
              border: "1px solid var(--line, #e5e7eb)", borderRadius: 10, background: "#fff",
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>
                  {c.visitor_name || "Visitor"}
                  {c.handled_by === "human" && (
                    <span style={{ fontWeight: 400, fontSize: 12, color: "#6b7280" }}> (with you)</span>
                  )}
                  {c.needs_human === 1 && c.handled_by !== "human" && (
                    <span style={{ fontWeight: 400, fontSize: 12, color: "#b91c1c" }}> (needs you)</span>
                  )}
                </div>
                <div style={{ fontSize: 13, color: "#6b7280", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {c.last_message || "No messages yet."}
                </div>
                <div style={{ fontSize: 12, color: "#9ca3af" }}>{timeAgo(c.last_activity)}</div>
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => clearChat(c.id)}
                style={confirmClear === c.id ? { color: "var(--danger, #b91c1c)", borderColor: "var(--danger, #b91c1c)" } : null}
              >
                {confirmClear === c.id ? "Tap again to confirm clear" : "Clear messages"}
              </button>
            </div>
          ))}
        </div>
      )}
      <a href="/chat-center.html" className="btn btn-secondary" style={{ textDecoration: "none", display: "inline-block" }}>
        Open Chat Center
      </a>

      <hr style={{ border: "none", borderTop: "1px solid var(--line, #e5e7eb)", margin: "16px 0" }} />

      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 6 }}>
        <Switch on={autoOn} onChange={(v) => { setAutoOn(v); setOk(""); }} disabled={busy} label="Auto-clear chat history" />
        <div>
          <div style={{ fontWeight: 600 }}>Auto-clear chat history</div>
          <p className="hint" style={{ margin: "4px 0 0" }}>
            When on, messages older than the hours you set are deleted automatically.
          </p>
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ fontSize: 14 }}>
          Clear messages older than{" "}
          <input
            type="number"
            min={1}
            max={720}
            value={hours}
            disabled={busy || !autoOn}
            onChange={(e) => setHours(e.target.value)}
            style={{ width: 70, padding: "6px 8px", border: "1px solid var(--line, #e5e7eb)", borderRadius: 8 }}
          />{" "}
          hours
        </label>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={saveAutoClear}>
          {busy ? "Saving..." : "Save"}
        </button>
      </div>
      {!autoOn && (
        <p className="hint">Turn it on and press Save to start automatic clearing. Default is 24 hours.</p>
      )}
    </div>
  );
}

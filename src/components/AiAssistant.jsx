import { useState, useRef, useEffect } from "react";
import { api, nav } from "../lib/api";

const GREEN = "#1a7a4a";

export default function AiAssistant() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [needsUpgrade, setNeedsUpgrade] = useState(false);
  const [usage, setUsage] = useState(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    if (bottomRef.current) bottomRef.current.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function ask() {
    const q = input.trim();
    if (!q || loading) return;
    setLoading(true);
    setNeedsUpgrade(false);
    const userMsg = { role: "user", text: q };
    const history = [...messages, userMsg]
      .slice(-6)
      .map((m) => ({ role: m.role, content: m.text }));
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    try {
      const data = await api.post("/api/ai/chat", { message: q, history });
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: data.reply || data.answer || "Kopa AI did not return an answer. Try again.",
          actions: data.actions_taken || [],
          fallback: !!data.fallback,
          waLink: data.waLink || null,
        },
      ]);
      if (data.usage) setUsage(data.usage);
      if (data.draft) setMessages((prev) => [...prev]);
    } catch (e) {
      if (e.upgradeRequired) {
        setNeedsUpgrade(true);
      } else {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", text: e.message || "Something went wrong. Try again.", fallback: true },
        ]);
      }
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          position: "fixed",
          bottom: 88,
          right: 16,
          zIndex: 40,
          background: GREEN,
          color: "#fff",
          border: "none",
          borderRadius: 9999,
          padding: "12px 20px",
          fontSize: 15,
          fontWeight: 600,
          boxShadow: "0 10px 15px -3px rgba(0,0,0,0.25)",
          cursor: "pointer",
        }}
      >
        Ask Kopa AI
      </button>
    );
  }

  return (
    <div
      style={{
        position: "fixed",
        bottom: 150,
        right: 16,
        zIndex: 40,
        width: 380,
        maxWidth: "calc(100vw - 32px)",
        maxHeight: "70vh",
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: 16,
        boxShadow: "0 25px 50px -12px rgba(0,0,0,0.25)",
        padding: 16,
        display: "flex",
        flexDirection: "column",
        boxSizing: "border-box",
      }}
    >
      <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Ask Kopa AI</h3>
      <p style={{ margin: "4px 0 0", fontSize: 12, color: "#6b7280" }}>
        Answers use only this business's data
      </p>
      {needsUpgrade ? (
        <div style={{ marginTop: 12, fontSize: 14 }}>
          <p style={{ margin: 0 }}>
            Kopa AI answers questions on every plan. Free gives 5 questions a day.
            Starter adds sale and expense actions (20 questions a day). Solo and Pro
            unlock the full AI assistant.
          </p>
          <button
            onClick={() => nav("/app/settings")}
            style={{
              marginTop: 8,
              width: "100%",
              background: GREEN,
              color: "#fff",
              border: "none",
              padding: "8px",
              borderRadius: 8,
              fontSize: 15,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            See plans
          </button>
        </div>
      ) : (
        <>
          <div style={{ marginTop: 12, overflowY: "auto", flex: 1, paddingRight: 4 }}>
            {messages.length === 0 && (
              <p style={{ margin: 0, fontSize: 12, color: "#9ca3af" }}>
                Ask anything about your business, or tell me to do something. e.g.
                "How much did I sell today?" or "Record sale of 2 Rice for Mama Ngozi".
              </p>
            )}
            {messages.map((m, i) => (
              <div
                key={i}
                style={{ textAlign: m.role === "user" ? "right" : "left", marginBottom: 8 }}
              >
                <div
                  style={{
                    display: "inline-block",
                    fontSize: 14,
                    padding: 8,
                    borderRadius: 8,
                    whiteSpace: "pre-wrap",
                    maxWidth: "90%",
                    boxSizing: "border-box",
                    background: m.role === "user" ? GREEN : "#f3f4f6",
                    color: m.role === "user" ? "#fff" : "#111827",
                    textAlign: "left",
                  }}
                >
                  {m.actions && m.actions.length > 0 && (
                    <p style={{ margin: "0 0 4px", fontSize: 12, fontWeight: 600, color: m.role === "user" ? "#d1fae5" : "#15803d" }}>
                      ✓ Done{m.actions.length > 1 ? ` (${m.actions.length} actions)` : ""}
                    </p>
                  )}
                  {m.fallback && m.role === "assistant" && (
                    <p style={{ margin: "0 0 4px", fontSize: 12, color: "#6b7280" }}>
                      AI is resting, here is what your books say.
                    </p>
                  )}
                  {m.text}
                  {m.waLink && (
                    <a
                      href={m.waLink}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        marginTop: 8,
                        display: "inline-block",
                        background: "#16a34a",
                        color: "#fff",
                        fontSize: 14,
                        fontWeight: 600,
                        padding: "8px 16px",
                        borderRadius: 8,
                        textDecoration: "none",
                      }}
                    >
                      Send on WhatsApp
                    </a>
                  )}
                </div>
              </div>
            ))}
            {loading && <p style={{ margin: 0, fontSize: 12, color: "#9ca3af" }}>Thinking...</p>}
            <div ref={bottomRef} />
          </div>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                ask();
              }
            }}
            placeholder="Ask or tell me to do something..."
            rows={2}
            style={{
              width: "100%",
              border: "1px solid #d1d5db",
              marginTop: 12,
              padding: 8,
              borderRadius: 8,
              fontSize: 14,
              boxSizing: "border-box",
              fontFamily: "inherit",
            }}
          />
          <button
            onClick={ask}
            disabled={loading}
            style={{
              marginTop: 8,
              width: "100%",
              background: GREEN,
              color: "#fff",
              border: "none",
              padding: "8px",
              borderRadius: 8,
              fontSize: 15,
              fontWeight: 600,
              cursor: loading ? "default" : "pointer",
              opacity: loading ? 0.5 : 1,
            }}
          >
            {loading ? "Thinking..." : "Ask"}
          </button>
          {usage && (
            <p style={{ margin: "4px 0 0", fontSize: 11, color: "#9ca3af", textAlign: "right" }}>
              {usage.used_today}/{usage.daily_limit} questions today
              {usage.actions_limit !== null && usage.actions_limit !== undefined
                ? ` - ${usage.actions_today || 0}/${usage.actions_limit} actions`
                : ""}
            </p>
          )}
        </>
      )}
      <button
        onClick={() => setOpen(false)}
        style={{
          marginTop: 8,
          fontSize: 12,
          color: "#6b7280",
          textDecoration: "underline",
          background: "none",
          border: "none",
          cursor: "pointer",
          alignSelf: "center",
        }}
      >
        Close
      </button>
    </div>
  );
}

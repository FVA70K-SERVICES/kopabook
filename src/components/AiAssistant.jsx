import { useState, useRef, useEffect } from "react";
import { api, nav } from "../lib/api";

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
        },
      ]);
      if (data.usage) setUsage(data.usage);
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
        className="fixed bottom-6 right-6 z-40 bg-black text-white rounded-full px-5 py-3 shadow-lg"
      >
        Ask Kopa AI
      </button>
    );
  }

  return (
    <div className="fixed bottom-24 right-6 z-40 w-96 max-w-[calc(100vw-3rem)] bg-white border rounded-2xl shadow-2xl p-4 flex flex-col max-h-[70vh]">
      <h3 className="font-semibold text-lg">Ask Kopa AI</h3>
      <p className="text-xs text-gray-500">Answers use only this business's data</p>
      {needsUpgrade ? (
        <div className="mt-3 text-sm">
          <p>Kopa AI is available on Solo and Pro plans. Upgrade to chat with your business data.</p>
          <button onClick={() => nav("/app/settings")} className="mt-2 w-full bg-black text-white py-2 rounded-lg">
            See plans
          </button>
        </div>
      ) : (
        <>
          <div className="mt-3 overflow-y-auto flex-1 space-y-2 pr-1">
            {messages.length === 0 && (
              <p className="text-xs text-gray-400">
                Ask anything about your business, or tell me to do something. e.g. "How much did I sell today?" or "Record sale of 2 Rice for Mama Ngozi".
              </p>
            )}
            {messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "text-right" : "text-left"}>
                <div
                  className={
                    "inline-block text-sm p-2 rounded-lg whitespace-pre-wrap max-w-[90%] " +
                    (m.role === "user" ? "bg-black text-white" : "bg-gray-50")
                  }
                >
                  {m.actions && m.actions.length > 0 && (
                    <p className="text-xs font-semibold text-green-700 mb-1">
                      ✓ Done{m.actions.length > 1 ? ` (${m.actions.length} actions)` : ""}
                    </p>
                  )}
                  {m.fallback && m.role === "assistant" && (
                    <p className="text-xs text-gray-500 mb-1">AI is resting, here is what your books say.</p>
                  )}
                  {m.text}
                </div>
              </div>
            ))}
            {loading && <p className="text-xs text-gray-400">Thinking...</p>}
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
            className="w-full border mt-3 p-2 rounded-lg text-sm"
          />
          <button
            onClick={ask}
            disabled={loading}
            className="mt-2 w-full bg-black text-white py-2 rounded-lg disabled:opacity-50"
          >
            {loading ? "Thinking..." : "Ask"}
          </button>
          {usage && (
            <p className="text-[11px] text-gray-400 mt-1 text-right">
              {usage.used_today}/{usage.daily_limit} used today
            </p>
          )}
        </>
      )}
      <button onClick={() => setOpen(false)} className="text-xs text-gray-500 mt-2 underline">
        Close
      </button>
    </div>
  );
}

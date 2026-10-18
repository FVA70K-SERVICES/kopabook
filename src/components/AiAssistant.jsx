import { useState } from "react";
import { api, nav } from "../lib/api";

export default function AiAssistant() {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);
  const [isFallback, setIsFallback] = useState(false);
  const [needsUpgrade, setNeedsUpgrade] = useState(false);

  async function ask() {
    const q = question.trim();
    if (!q || loading) return;
    setLoading(true);
    setAnswer("");
    setIsFallback(false);
    setNeedsUpgrade(false);
    try {
      const data = await api.post("/api/ai/chat", { question: q });
      setAnswer(data.answer || "Kopa AI did not return an answer. Try again.");
      setIsFallback(!!data.fallback);
    } catch (e) {
      if (e.upgradeRequired) {
        setNeedsUpgrade(true);
      } else {
        setAnswer(e.message || "Something went wrong. Try again.");
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
    <div className="fixed bottom-24 right-6 z-40 w-96 max-w-[calc(100vw-3rem)] bg-white border rounded-2xl shadow-2xl p-4">
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
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="e.g. What are my low stock products?"
            rows={3}
            className="w-full border mt-3 p-2 rounded-lg text-sm"
          />
          <button
            onClick={ask}
            disabled={loading}
            className="mt-2 w-full bg-black text-white py-2 rounded-lg disabled:opacity-50"
          >
            {loading ? "Thinking..." : "Ask"}
          </button>
          {answer && (
            <div className="mt-3 text-sm bg-gray-50 p-3 rounded-lg whitespace-pre-wrap">
              {isFallback && <p className="text-xs text-gray-500 mb-1">AI is resting, here is what your books say.</p>}
              {answer}
            </div>
          )}
        </>
      )}
      <button onClick={() => setOpen(false)} className="text-xs text-gray-500 mt-2 underline">
        Close
      </button>
    </div>
  );
}

import { useEffect, useState } from "react";
import AdminAiPanel from "../components/AdminAiPanel";

// The merged chat home. One chat, two clear doors for every store, plus a
// third door that only the platform owner ever sees:
// /app/chat          -> the doors
// /app/chat/ai       -> Ask Kopa AI (the shop's AI assistant)
// /app/chat/support  -> Kopa Support (the FVA70K team)
// /app/chat/admin    -> Admin AI (platform owner only; session.user
//                       .isPlatformAdmin comes from the server auth context,
//                       never from anything the client can set)
// The chat panel itself is the FVAChat widget; this page is the clean,
// linkable home for it and opens the panel on the right side.
export default function ChatPage({ side, session }) {
  const isPlatformOwner = !!(session && session.user && session.user.isPlatformAdmin);
  const active = side === "ai" ? "ai" : side === "support" ? "support" : side === "admin" && isPlatformOwner ? "admin" : null;
  // The chat panel itself lives in the FVAChat widget (owned by round 5).
  // This page only tracks whether it has opened yet, so the support side
  // shows a clear opening state and a retry instead of silence.
  const [chatReady, setChatReady] = useState(false);
  const [chatWaited, setChatWaited] = useState(false);
  const [chatError, setChatError] = useState("");
  // Bump to restart the open wait (manual Open tap, Retry tap). The
  // effect below owns every open attempt, so a tap can never leave the
  // page waiting on a dead attempt.
  const [openAttempt, setOpenAttempt] = useState(0);

  // Ask Kopa AI open hardening (Nov 2026). The live failure was the
  // page sitting on "Opening chat..." forever with no retry: the old
  // poll called window.FVAChat.open() with no try/catch, so a throw
  // inside openChat killed the effect before any interval existed, and
  // the 6s window could expire before the idle-loaded widget script
  // arrived on a slow phone. Every open attempt is now guarded, a
  // throw counts as not-ready (never as opened), the page loads the
  // widget itself when the lazy loader has not delivered it yet, the
  // wait is 15s, and a failure always ends on a visible retry.
  const CHAT_WAIT_MS = 15000;
  const CHAT_POLL_MS = 300;

  function ensureChatScript() {
    try {
      if (window.FVAChat && window.FVAChat.open) return true;
      if (document.getElementById("fva-chat-loader")) return false;
      const s = document.createElement("script");
      s.id = "fva-chat-loader";
      s.src = "/fvachat.js";
      s.setAttribute("data-site-id", "kopabook");
      s.setAttribute("data-business", "Kopa Support");
      s.setAttribute("data-bot-name", "Kopa Bot");
      s.setAttribute("data-color", "#15803d");
      s.onerror = () => {
        setChatError("Chat could not load. Check your connection and try again.");
        setChatWaited(true);
      };
      document.body.appendChild(s);
      return false;
    } catch {
      return false;
    }
  }

  function panelOpen() {
    try {
      const w = document.getElementById("fva-chat-window");
      return !!(w && w.classList.contains("open"));
    } catch {
      return false;
    }
  }

  // One guarded open attempt: a throw inside the widget is not-ready,
  // never a dead page. openChat returns false when it caught its own
  // failure; an older cached widget returns undefined, so the panel's
  // own "open" class is the proof either way.
  function tryOpen() {
    try {
      if (window.FVAChat && window.FVAChat.open) {
        const ok = window.FVAChat.open(active);
        if (ok === false) return false;
        return panelOpen();
      }
      return false;
    } catch {
      return false;
    }
  }

  useEffect(() => {
    if (!active) return;
    if (active === "admin") return;
    let stopped = false;
    let timer = null;
    const startedAt = Date.now();
    const tick = () => {
      if (stopped) return;
      ensureChatScript();
      if (tryOpen()) { setChatReady(true); return; }
      if (Date.now() - startedAt >= CHAT_WAIT_MS) {
        setChatError("Chat did not open. Check your connection and try again.");
        setChatWaited(true);
        return;
      }
      timer = setTimeout(tick, CHAT_POLL_MS);
    };
    tick();
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [active, openAttempt]);

  const openPanel = () => {
    setChatError("");
    setChatWaited(false);
    if (tryOpen()) { setChatReady(true); return; }
    // Widget not ready yet (still loading, or the last attempt threw):
    // restart the guarded wait instead of leaving the tap unanswered.
    setOpenAttempt((a) => a + 1);
  };

  return (
    <div>
      <div className="page-head">
        <h1>Chat</h1>
      </div>
      <p className="hint" style={{ maxWidth: 640 }}>
        One chat, {isPlatformOwner ? "three" : "two"} clear doors, and switching sides never loses the thread.
        Ask Kopa AI keeps the last 24 hours. Kopa Support conversations are
        kept as a record, so you and the FVA70K team can always look back at
        what was said.
      </p>

      <div className="chat-door-grid">
        <a href="/app/chat/ai" className={"card chat-door-card" + (active === "ai" ? " active" : "")}>
          <div className="icon">🤖</div>
          <h3>Ask Kopa AI</h3>
          <p>
            Your shop assistant, fully automated. It answers from your own records,
            and on paid plans it records sales and expenses for you too.
          </p>
          <div className="chat-examples">
            <span>Record a sale</span>
            <span>Record an expense</span>
            <span>Today's sales</span>
            <span>Who owes me</span>
          </div>
          <span className="btn btn-primary btn-sm" style={{ marginTop: 14 }}>Open Ask Kopa AI</span>
        </a>

        <a href="/app/chat/support" className={"card chat-door-card" + (active === "support" ? " active" : "")}>
          <div className="icon">💬</div>
          <h3>Kopa Support</h3>
          <p>
            {isPlatformOwner
              ? "Your receiving inbox for support cases from business owners. Read and reply to cases here. These are the same cases the Chat Center shows, newest and needing attention first."
              : "Chat with the FVA70K team about KopaBook itself: pricing, features and problems. Quick platform answers first, then a real person, by hand, when you need one. Kopa Support cannot see or change your shop records. Support conversations are kept as a record for both sides, and you can read them back any time under Past support chats."}
          </p>
          <span className="btn btn-secondary btn-sm" style={{ marginTop: 14 }}>{isPlatformOwner ? "Open support inbox" : "Open Kopa Support"}</span>
        </a>

        {isPlatformOwner && (
          <a href="/app/chat/admin" className={"card chat-door-card" + (active === "admin" ? " active" : "")}>
            <div className="icon">🛡️</div>
            <h3>Admin AI</h3>
            <p>
              Platform owner's desk. Briefings, platform tools and actions across KopaBook itself.
            </p>
            <span className="btn btn-primary btn-sm" style={{ marginTop: 14 }}>Open Admin AI</span>
          </a>
        )}
      </div>

      {active && active !== "admin" && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3>{active === "ai" ? "Ask Kopa AI" : "Kopa Support"} is open</h3>
          <p className="hint">
            {active === "ai"
              ? "You are on the Ask Kopa AI side. It works with your shop records only."
              : isPlatformOwner
                ? "You are on the Kopa Support side. As platform owner you see the support inbox: cases from business owners, newest and needing attention first."
                : "You are on the Kopa Support side. A person from the FVA70K team can join this same chat when you need one."}
          </p>
          {!chatReady && (
            <p className="hint" aria-live="polite">
              {chatWaited
                ? (chatError || "Chat did not open. Check your connection and try again.")
                : "Opening chat..."}
            </p>
          )}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button className="btn btn-primary btn-sm" onClick={openPanel}>
              Open {active === "ai" ? "Ask Kopa AI" : "Kopa Support"}
            </button>
            {chatWaited && (
              <button className="btn btn-secondary btn-sm" onClick={openPanel}>
                Retry opening chat
              </button>
            )}
            <a className="btn btn-secondary btn-sm" href={active === "ai" ? "/app/chat/support" : "/app/chat/ai"}>
              Switch to {active === "ai" ? "Kopa Support" : "Ask Kopa AI"}
            </a>
            <a className="btn btn-secondary btn-sm" href="/app/chat">Back to chat home</a>
          </div>
        </div>
      )}

      {active === "admin" && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3>Admin AI is open</h3>
          <p className="hint">
            You are on the Admin AI side. This is the platform owner's desk, separate from your shop assistant and from Kopa Support.
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <a className="btn btn-secondary btn-sm" href="/app/chat/ai">
              Switch to Ask Kopa AI
            </a>
            <a className="btn btn-secondary btn-sm" href="/app/chat/support">
              Switch to Kopa Support
            </a>
            <a className="btn btn-secondary btn-sm" href="/app/chat">Back to chat home</a>
          </div>
        </div>
      )}

      {active === "admin" && (
        <div id="admin-ai-root" data-platform-owner="true">
          {/* The Admin AI panel itself. This mount follows the shell
              contract: it renders only for the platform owner, and the
              panel still re-verifies with the server on mount (a 403
              shows a notice), so the client flag is never the gate. */}
          <AdminAiPanel />
        </div>
      )}
    </div>
  );
}

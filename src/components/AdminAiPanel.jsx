import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";

const QUICK_PROMPTS = [
  "Brief me",
  "Revenue this month",
  "Pending payments",
  "Expiring soon",
  "Dormant stores",
  "Support waiting",
];

const AUTO_SPEAK_KEY = "kopabook_admin_ai_auto_speak";
const VOICE_CHOICES = ["ng_female", "ng_male", "default"];
const VOICE_LABELS = {
  ng_female: "Nigerian female",
  ng_male: "Nigerian male",
  default: "Default",
};
const ASSISTANT_LANGUAGES = ["en", "pcm", "ha", "yo", "ig"];

let idCounter = 0;
function nextId(prefix) {
  idCounter += 1;
  return prefix + "-" + idCounter + "-" + Date.now();
}

function formatExpiry(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

function resolvedLabelFor(decision, status) {
  const s = String(status || "").toLowerCase();
  if (decision === "cancel" || s.indexOf("cancel") !== -1) return "Cancelled";
  return "Done";
}

// Voice resolution, mirrored from public/fvachat.js (resolveLang,
// voiceGenderMatch, resolveVoice and resolveVoiceDetailed). Voices are
// supplied by the device or browser through speechSynthesis.getVoices().
// English resolves to en-NG first, gender is matched by voice name, and
// otherwise the closest English voice is used with a per choice pitch
// and rate profile.
function resolveLang(language) {
  const map = { en: "en-NG", pcm: "en-NG", ha: "ha-NG", yo: "yo-NG", ig: "ig-NG" };
  return map[language] || "en-NG";
}

function voiceGenderMatch(voice, choice) {
  const n = String((voice && voice.name) || "").toLowerCase();
  if (choice === "ng_female") return n.indexOf("female") !== -1;
  if (choice === "ng_male") return n.indexOf("male") !== -1 && n.indexOf("female") === -1;
  return false;
}

function pickGenderedVoice(list, choice) {
  if (!list || !list.length) return null;
  for (let i = 0; i < list.length; i++) {
    if (voiceGenderMatch(list[i], choice)) return list[i];
  }
  return list[0];
}

function resolveVoice(choice, voicesList) {
  const profiles = {
    ng_female: { pitch: 1.1, rate: 1.0 },
    ng_male: { pitch: 0.85, rate: 0.98 },
    default: { pitch: 1, rate: 1 },
  };
  const profile = profiles[choice] || profiles.default;
  if (!choice || choice === "default" || !profiles[choice]) {
    return { voice: null, pitch: 1, rate: 1 };
  }
  const list = Array.isArray(voicesList) ? voicesList : [];
  const langOf = (v) => String((v && v.lang) || "").toLowerCase();
  const ng = list.filter((v) => langOf(v).indexOf("en-ng") === 0);
  if (ng.length) return { voice: pickGenderedVoice(ng, choice), pitch: profile.pitch, rate: profile.rate };
  const english = list.filter((v) => langOf(v).indexOf("en") === 0);
  if (english.length) {
    const tier = (v) => {
      const l = langOf(v);
      if (l.indexOf("en-gb") === 0) return 0;
      if (l.indexOf("en-us") === 0) return 1;
      return 2;
    };
    const sorted = english.slice().sort((a, b) => tier(a) - tier(b));
    let chosen = null;
    for (let i = 0; i < sorted.length; i++) {
      if (voiceGenderMatch(sorted[i], choice)) { chosen = sorted[i]; break; }
    }
    return { voice: chosen || sorted[0], pitch: profile.pitch, rate: profile.rate };
  }
  return { voice: null, pitch: profile.pitch, rate: profile.rate };
}

function resolveVoiceDetailed(choice, voicesList, langTag) {
  const primary = String(langTag || "en-NG").split("-")[0].toLowerCase();
  if (!choice || choice === "default") {
    return { voice: null, pitch: 1, rate: 1, matchedLang: primary === "en" };
  }
  if (primary !== "en") {
    const list = Array.isArray(voicesList) ? voicesList : [];
    const matching = list.filter((v) => String((v && v.lang) || "").toLowerCase().split("-")[0] === primary);
    if (matching.length) {
      const base = resolveVoice(choice, []);
      return { voice: pickGenderedVoice(matching, choice), pitch: base.pitch, rate: base.rate, matchedLang: true };
    }
    const fb = resolveVoice(choice, list);
    return { voice: fb.voice, pitch: fb.pitch, rate: fb.rate, matchedLang: false };
  }
  const r = resolveVoice(choice, voicesList);
  return { voice: r.voice, pitch: r.pitch, rate: r.rate, matchedLang: true };
}

function cleanTextForSpeech(text) {
  return String(text || "")
    .replace(/https?:\/\/[^\s]+/g, "")
    .replace(/www\.[^\s]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getSpeechRecognition() {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function hasSpeechSynthesis() {
  return (
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    typeof window.SpeechSynthesisUtterance === "function"
  );
}

const panelStyle = {
  boxSizing: "border-box",
  width: "100%",
  maxWidth: 780,
  margin: "0 auto",
  display: "flex",
  flexDirection: "column",
  height: "min(72vh, 720px)",
  minWidth: 0,
  background: "var(--surface)",
  color: "var(--ink)",
  border: "1px solid var(--line)",
  borderRadius: 16,
  boxShadow: "var(--shadow)",
  overflow: "hidden",
};

const headerStyle = {
  boxSizing: "border-box",
  display: "flex",
  flexDirection: "column",
  gap: 10,
  padding: "16px 18px",
  borderBottom: "1px solid var(--line)",
  background: "var(--surface)",
  flexShrink: 0,
  minWidth: 0,
};

const messagesStyle = {
  boxSizing: "border-box",
  flex: "1 1 auto",
  minHeight: 0,
  minWidth: 0,
  overflowY: "auto",
  overflowX: "hidden",
  padding: 16,
  display: "flex",
  flexDirection: "column",
  gap: 10,
  background: "var(--bg)",
};

const assistantBubbleStyle = {
  boxSizing: "border-box",
  alignSelf: "flex-start",
  maxWidth: "85%",
  minWidth: 0,
  padding: "10px 14px",
  borderRadius: 16,
  borderBottomLeftRadius: 4,
  background: "var(--surface)",
  color: "var(--ink)",
  border: "1px solid var(--line)",
  fontSize: 14,
  lineHeight: 1.45,
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
  wordWrap: "break-word",
};

const userBubbleStyle = {
  boxSizing: "border-box",
  alignSelf: "flex-end",
  maxWidth: "85%",
  minWidth: 0,
  padding: "10px 14px",
  borderRadius: 16,
  borderBottomRightRadius: 4,
  background: "var(--brand)",
  color: "#fff",
  border: "1px solid var(--brand)",
  fontSize: 14,
  lineHeight: 1.45,
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
  wordWrap: "break-word",
};

const labelStyle = {
  fontSize: 11,
  fontWeight: 700,
  color: "var(--brand-dark)",
  marginBottom: 4,
  letterSpacing: "0.02em",
};

const chipStyle = {
  boxSizing: "border-box",
  background: "var(--surface)",
  border: "1px solid var(--brand)",
  color: "var(--brand-dark)",
  borderRadius: 999,
  padding: "6px 14px",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
  maxWidth: "100%",
  overflowWrap: "anywhere",
};

const secondaryButtonStyle = {
  boxSizing: "border-box",
  background: "var(--surface)",
  color: "var(--ink)",
  border: "1px solid var(--line)",
  borderRadius: 8,
  padding: "8px 14px",
  fontSize: 13.5,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
  flexShrink: 0,
  whiteSpace: "nowrap",
};

const speakButtonStyle = {
  boxSizing: "border-box",
  background: "var(--bg)",
  color: "var(--brand-dark)",
  border: "1px solid var(--line)",
  borderRadius: 999,
  padding: "4px 12px",
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
  fontFamily: "inherit",
  lineHeight: 1.4,
};

export default function AdminAiPanel() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [briefingLoaded, setBriefingLoaded] = useState(false);
  const [denied, setDenied] = useState(false);
  const [loadingBriefing, setLoadingBriefing] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [voiceChoice, setVoiceChoice] = useState("default");
  const [assistantLanguage, setAssistantLanguage] = useState("en");
  const [autoSpeak, setAutoSpeak] = useState(() => {
    try {
      return window.localStorage.getItem(AUTO_SPEAK_KEY) === "on";
    } catch (e) {
      return false;
    }
  });
  const [speakingId, setSpeakingId] = useState(null);
  const [listening, setListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [micHint, setMicHint] = useState("");
  const scrollRef = useRef(null);
  const hasInteractedRef = useRef(false);
  const autoSpeakRef = useRef(autoSpeak);
  const voiceChoiceRef = useRef(voiceChoice);
  const assistantLanguageRef = useRef(assistantLanguage);
  const speakingIdRef = useRef(null);
  const recognitionRef = useRef(null);
  const autoSpokenIdsRef = useRef(new Set());
  const pendingAutoSpeakRef = useRef(null);
  const cachedVoicesRef = useRef([]);

  autoSpeakRef.current = autoSpeak;
  voiceChoiceRef.current = voiceChoice;
  assistantLanguageRef.current = assistantLanguage;

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy, loadingBriefing]);

  function refreshCachedVoices() {
    try {
      if (hasSpeechSynthesis()) {
        const v = window.speechSynthesis.getVoices();
        if (v && v.length) cachedVoicesRef.current = v;
      }
    } catch (e) {}
    return cachedVoicesRef.current;
  }

  function stopSpeaking() {
    try {
      if (hasSpeechSynthesis()) window.speechSynthesis.cancel();
    } catch (e) {}
    speakingIdRef.current = null;
    setSpeakingId(null);
  }

  // Speak one assistant message with the resolved device voice. If the
  // browser blocks speech, stay silent and show no error.
  function speakMessage(msg) {
    if (!msg || typeof msg.content !== "string") return false;
    const clean = cleanTextForSpeech(msg.content);
    if (!clean) return false;
    if (!hasSpeechSynthesis()) return false;
    if (speakingIdRef.current && speakingIdRef.current !== msg.id) {
      try { window.speechSynthesis.cancel(); } catch (e) {}
    }
    let utter;
    try {
      utter = new window.SpeechSynthesisUtterance(clean);
    } catch (e) {
      return false;
    }
    const langTag = resolveLang(assistantLanguageRef.current);
    utter.lang = langTag;
    const resolved = resolveVoiceDetailed(voiceChoiceRef.current, refreshCachedVoices(), langTag);
    if (resolved.voice) {
      try { utter.voice = resolved.voice; } catch (e) {}
    }
    utter.pitch = resolved.pitch;
    utter.rate = resolved.rate;
    speakingIdRef.current = msg.id;
    setSpeakingId(msg.id);
    const finish = () => {
      if (speakingIdRef.current === msg.id) {
        speakingIdRef.current = null;
        setSpeakingId(null);
      }
    };
    utter.onend = finish;
    utter.onerror = finish;
    try {
      window.speechSynthesis.speak(utter);
    } catch (e) {
      finish();
      return false;
    }
    return true;
  }

  function maybeAutoSpeak(msg) {
    if (!msg || msg.kind !== "text" || msg.role !== "assistant") return;
    if (!autoSpeakRef.current) return;
    if (autoSpokenIdsRef.current.has(msg.id)) return;
    if (!hasInteractedRef.current) {
      // Respect browser autoplay rules: hold the briefing or reply and
      // speak it on the first interaction with the page.
      pendingAutoSpeakRef.current = msg;
      return;
    }
    autoSpokenIdsRef.current.add(msg.id);
    speakMessage(msg);
  }

  function markInteracted() {
    hasInteractedRef.current = true;
    const pending = pendingAutoSpeakRef.current;
    if (pending && autoSpeakRef.current && !autoSpokenIdsRef.current.has(pending.id)) {
      pendingAutoSpeakRef.current = null;
      autoSpokenIdsRef.current.add(pending.id);
      speakMessage(pending);
    }
  }

  function toggleSpeak(msg) {
    markInteracted();
    if (speakingIdRef.current === msg.id) stopSpeaking();
    else speakMessage(msg);
  }

  function toggleAutoSpeak() {
    markInteracted();
    const next = !autoSpeak;
    setAutoSpeak(next);
    autoSpeakRef.current = next;
    try {
      window.localStorage.setItem(AUTO_SPEAK_KEY, next ? "on" : "off");
    } catch (e) {}
    if (!next) {
      pendingAutoSpeakRef.current = null;
      stopSpeaking();
      return;
    }
    // Turning it on is an interaction, so the latest assistant message,
    // usually the briefing, can be spoken straight away.
    const latest = [...messages].reverse().find((m) => m.kind === "text" && m.role === "assistant");
    if (latest && !autoSpokenIdsRef.current.has(latest.id)) {
      autoSpokenIdsRef.current.add(latest.id);
      speakMessage(latest);
    }
  }

  // Read the stored voice preference for the active business. The write
  // path stays in the Ask Kopa settings via set_assistant_voice, so this
  // panel only reads GET /api/chat/control and never writes it.
  async function loadVoicePreference() {
    try {
      const data = await api.get("/api/chat/control");
      const settings = (data && data.settings) || {};
      const voice = String(
        (data && data.assistant_voice) || settings.assistant_voice || "default"
      );
      if (VOICE_CHOICES.indexOf(voice) !== -1) {
        setVoiceChoice(voice);
        voiceChoiceRef.current = voice;
      }
      const language = String(
        (data && data.assistant_language) || settings.assistant_language || "en"
      );
      if (ASSISTANT_LANGUAGES.indexOf(language) !== -1) {
        setAssistantLanguage(language);
        assistantLanguageRef.current = language;
      }
    } catch (e) {
      // Keep the default voice if the preference cannot be read.
    }
  }

  async function fetchBriefing(isRefresh) {
    if (isRefresh) setRefreshing(true);
    else setLoadingBriefing(true);
    try {
      const data = await api.get("/api/admin/ai/briefing");
      const text =
        data && data.briefing && data.briefing.message
          ? String(data.briefing.message)
          : "Your briefing is ready.";
      const msg = {
        id: nextId("briefing"),
        kind: "text",
        role: "assistant",
        content: text,
        isBriefing: true,
      };
      if (isRefresh) {
        setMessages((prev) => [...prev, msg]);
      } else {
        setMessages([msg]);
        setBriefingLoaded(true);
      }
      setDenied(false);
      maybeAutoSpeak(msg);
      return true;
    } catch (e) {
      if (isRefresh) {
        setMessages((prev) => [
          ...prev,
          {
            id: nextId("assistant"),
            kind: "text",
            role: "assistant",
            content:
              "Sorry, I could not refresh the briefing. " +
              (e && e.message ? e.message : "Please try again."),
          },
        ]);
      } else {
        setDenied(true);
      }
      return false;
    } finally {
      if (isRefresh) setRefreshing(false);
      else setLoadingBriefing(false);
    }
  }

  useEffect(() => {
    fetchBriefing(false);
    loadVoicePreference();
    setVoiceSupported(!!getSpeechRecognition());
    refreshCachedVoices();
    // Run once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onInteract = () => markInteracted();
    window.addEventListener("pointerdown", onInteract);
    window.addEventListener("keydown", onInteract);
    window.addEventListener("click", onInteract);
    let synth = null;
    try {
      if (hasSpeechSynthesis()) synth = window.speechSynthesis;
    } catch (e) {}
    const onVoicesChanged = () => refreshCachedVoices();
    if (synth && typeof synth.addEventListener === "function") {
      try { synth.addEventListener("voiceschanged", onVoicesChanged); } catch (e) {}
    }
    return () => {
      window.removeEventListener("pointerdown", onInteract);
      window.removeEventListener("keydown", onInteract);
      window.removeEventListener("click", onInteract);
      if (synth && typeof synth.removeEventListener === "function") {
        try { synth.removeEventListener("voiceschanged", onVoicesChanged); } catch (e) {}
      }
      try {
        if (recognitionRef.current && typeof recognitionRef.current.abort === "function") recognitionRef.current.abort();
        else if (recognitionRef.current && typeof recognitionRef.current.stop === "function") recognitionRef.current.stop();
      } catch (e) {}
      recognitionRef.current = null;
      try {
        if (hasSpeechSynthesis()) window.speechSynthesis.cancel();
      } catch (e) {}
    };
    // Mount and unmount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function buildHistory(extraUserMsg) {
    const source = extraUserMsg ? [...messages, extraUserMsg] : [...messages];
    return source
      .filter((m) => m && m.kind === "text" && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .slice(-16)
      .map((m) => ({ role: m.role, content: m.content }));
  }

  async function sendMessage(rawText) {
    const text = String(rawText || "").trim();
    if (!text || busy) return;
    markInteracted();
    const userMsg = {
      id: nextId("user"),
      kind: "text",
      role: "user",
      content: text,
    };
    const history = buildHistory(userMsg);
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setBusy(true);
    try {
      const data = await api.post("/api/admin/ai/chat", { message: text, history });
      const additions = [];
      let replyMsg = null;
      if (data && data.reply) {
        replyMsg = {
          id: nextId("assistant"),
          kind: "text",
          role: "assistant",
          content: String(data.reply),
        };
        additions.push(replyMsg);
      }
      if (data && data.proposal) {
        additions.push({
          id: nextId("proposal"),
          kind: "proposal",
          proposal: data.proposal,
          confirmBusy: false,
          resolved: null,
          error: "",
        });
      }
      if (additions.length === 0) {
        replyMsg = {
          id: nextId("assistant"),
          kind: "text",
          role: "assistant",
          content: "I did not get a reply. Please try again.",
        };
        additions.push(replyMsg);
      }
      setMessages((prev) => [...prev, ...additions]);
      if (replyMsg) maybeAutoSpeak(replyMsg);
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        {
          id: nextId("assistant"),
          kind: "text",
          role: "assistant",
          content:
            "Sorry, something went wrong. " +
            (e && e.message ? e.message : "Please try again."),
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  function updateProposal(id, patch) {
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, ...patch } : m))
    );
  }

  // Confirmations happen only from the proposal card buttons below.
  // Nothing in the voice path calls this function or the confirm endpoint.
  async function decideProposal(entry, decision) {
    if (!entry || entry.confirmBusy || entry.resolved) return;
    if (!entry.proposal || !entry.proposal.id) return;
    markInteracted();
    updateProposal(entry.id, { confirmBusy: true, error: "" });
    try {
      const data = await api.post("/api/admin/ai/confirm", {
        proposal_id: entry.proposal.id,
        decision,
      });
      const label = resolvedLabelFor(decision, data ? data.status : "");
      updateProposal(entry.id, { confirmBusy: false, resolved: label, error: "" });
      if (data && data.message) {
        const resultMsg = {
          id: nextId("assistant"),
          kind: "text",
          role: "assistant",
          content: String(data.message),
        };
        setMessages((prev) => [...prev, resultMsg]);
        maybeAutoSpeak(resultMsg);
      }
    } catch (e) {
      updateProposal(entry.id, {
        confirmBusy: false,
        error: e && e.message ? e.message : "Something went wrong. Please try again.",
      });
    }
  }

  function stopListening() {
    const rec = recognitionRef.current;
    if (rec) {
      try {
        if (typeof rec.stop === "function") rec.stop();
        else if (typeof rec.abort === "function") rec.abort();
      } catch (e) {}
    }
    recognitionRef.current = null;
    setListening(false);
  }

  // Voice input only fills the composer. It never sends a message and
  // never confirms an action, even if the words sound like a command.
  // Saying confirm or yes is treated as ordinary chat text that the
  // owner can edit, send, or delete like anything typed.
  function startListening() {
    const SR = getSpeechRecognition();
    if (!SR) {
      setVoiceSupported(false);
      return;
    }
    let rec;
    try {
      rec = new SR();
    } catch (e) {
      setMicHint("Voice input did not start. Please try again, or keep typing.");
      return;
    }
    rec.lang = "en-NG";
    try { rec.interimResults = false; } catch (e) {}
    try { rec.maxAlternatives = 1; } catch (e) {}
    try { rec.continuous = false; } catch (e) {}
    rec.onresult = (event) => {
      let finalText = "";
      try {
        for (let i = 0; i < event.results.length; i++) {
          const r = event.results[i];
          if (r && r.isFinal && r[0]) finalText += r[0].transcript || "";
        }
      } catch (e) {}
      const t = finalText.trim();
      if (!t) return;
      setMicHint("");
      setInput((prev) => {
        const base = String(prev || "").trim();
        return base ? base + " " + t : t;
      });
    };
    rec.onerror = (event) => {
      const err = event && event.error;
      setListening(false);
      if (recognitionRef.current === rec) recognitionRef.current = null;
      if (err === "not-allowed" || err === "service-not-allowed") {
        setMicHint("Microphone is blocked. Allow mic access in your browser settings, or keep typing.");
      } else if (err === "language-not-supported") {
        setMicHint("Voice recognition is not available for that language on this device. Typing works everywhere.");
      } else if (err === "aborted") {
        // The owner stopped listening, so no hint is needed.
      } else if (err) {
        setMicHint("Voice input did not work. Please try again, or keep typing.");
      }
    };
    rec.onend = () => {
      setListening(false);
      if (recognitionRef.current === rec) recognitionRef.current = null;
    };
    recognitionRef.current = rec;
    try {
      rec.start();
      setListening(true);
      setMicHint("");
    } catch (e) {
      recognitionRef.current = null;
      setListening(false);
      setMicHint("Voice input did not start. Please try again, or keep typing.");
    }
  }

  function toggleMic() {
    markInteracted();
    if (listening) stopListening();
    else startListening();
  }

  function onComposerKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }

  function onComposerSubmit(e) {
    e.preventDefault();
    sendMessage(input);
  }

  if (denied) {
    return (
      <div
        style={{
          boxSizing: "border-box",
          width: "100%",
          maxWidth: 780,
          margin: "0 auto",
          background: "var(--surface)",
          color: "var(--ink)",
          border: "1px solid var(--line)",
          borderRadius: 16,
          boxShadow: "var(--shadow)",
          padding: 24,
          fontSize: 15,
          lineHeight: 1.5,
          minWidth: 0,
          overflowWrap: "anywhere",
        }}
      >
        Admin AI is for the platform owner only.
      </div>
    );
  }

  const firstBriefingIndex = messages.findIndex((m) => m.isBriefing);

  return (
    <div style={panelStyle} className="admin-ai-panel">
      <style>{`
        @keyframes admin-ai-msg-in {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes admin-ai-bounce {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.55; }
          30% { transform: translateY(-6px); opacity: 1; }
        }
        @keyframes admin-ai-mic-pulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.1); opacity: 0.8; }
        }
        .admin-ai-msg {
          animation: admin-ai-msg-in 0.22s ease-out;
        }
        .admin-ai-typing-dot {
          display: inline-block;
          flex-shrink: 0;
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--muted);
          animation: admin-ai-bounce 1.2s infinite;
        }
        .admin-ai-typing-dot:nth-child(2) { animation-delay: 0.2s; }
        .admin-ai-typing-dot:nth-child(3) { animation-delay: 0.4s; }
        .admin-ai-mic-btn.listening {
          animation: admin-ai-mic-pulse 1.4s ease-in-out infinite;
        }
        html[data-theme="dark"] .admin-ai-user-bubble {
          background: #15803d !important;
          border-color: #15803d !important;
        }
        html[data-theme="dark"] .admin-ai-send-btn {
          background: #15803d !important;
        }
        html[data-theme="dark"] .admin-ai-mic-btn.listening {
          background: #15803d !important;
          border-color: #15803d !important;
        }
        @media (prefers-reduced-motion: reduce) {
          .admin-ai-msg { animation: none !important; }
          .admin-ai-typing-dot {
            animation: none !important;
            transform: none !important;
            opacity: 1 !important;
          }
          .admin-ai-mic-btn.listening {
            animation: none !important;
            transform: none !important;
            opacity: 1 !important;
          }
        }
      `}</style>

      <div style={headerStyle}>
        <div
          style={{
            boxSizing: "border-box",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
            width: "100%",
            minWidth: 0,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: 20, lineHeight: 1.2, letterSpacing: "-0.3px" }}>Admin AI</h2>
            <p style={{ margin: "4px 0 0", fontSize: 13.5, lineHeight: 1.45, color: "var(--muted)", overflowWrap: "anywhere" }}>
              Platform control centre. Only you can use this.
            </p>
          </div>
          <button
            type="button"
            style={{ ...secondaryButtonStyle, opacity: refreshing || loadingBriefing ? 0.6 : 1 }}
            onClick={() => { markInteracted(); fetchBriefing(true); }}
            disabled={refreshing || loadingBriefing}
          >
            {refreshing ? "Refreshing..." : "Refresh briefing"}
          </button>
        </div>
        <div
          style={{
            boxSizing: "border-box",
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
            width: "100%",
            minWidth: 0,
          }}
        >
          <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--muted)", overflowWrap: "anywhere" }}>
            {"Voice: " + (VOICE_LABELS[voiceChoice] || VOICE_LABELS.default)}
          </span>
          <button
            type="button"
            style={{ ...secondaryButtonStyle, padding: "6px 12px", fontSize: 12.5, borderRadius: 999 }}
            onClick={toggleAutoSpeak}
            aria-pressed={autoSpeak}
          >
            {"Auto-speak: " + (autoSpeak ? "On" : "Off")}
          </button>
        </div>
        <p style={{ margin: 0, fontSize: 12, lineHeight: 1.45, color: "var(--muted)", overflowWrap: "anywhere" }}>
          Voices come from your phone or browser. For a full Nigerian voice, add English (Nigeria) in your device text-to-speech settings; it is free.
        </p>
      </div>

      <div ref={scrollRef} style={messagesStyle}>
        {loadingBriefing && messages.length === 0 ? (
          <div style={{ ...assistantBubbleStyle }} className="admin-ai-msg">
            <div style={labelStyle}>Admin AI</div>
            <div>Loading briefing...</div>
          </div>
        ) : null}

        {messages.map((m, idx) => {
          if (m.kind === "proposal") {
            const p = m.proposal || {};
            return (
              <div
                key={m.id}
                className="admin-ai-msg"
                style={{
                  boxSizing: "border-box",
                  alignSelf: "flex-start",
                  width: "min(85%, 420px)",
                  maxWidth: "85%",
                  minWidth: 0,
                  background: "var(--gold-soft)",
                  color: "var(--ink)",
                  border: "1px solid var(--gold)",
                  borderLeft: "4px solid var(--gold)",
                  borderRadius: 14,
                  borderBottomLeftRadius: 4,
                  padding: "12px 14px",
                  fontSize: 14,
                  lineHeight: 1.45,
                  overflowWrap: "anywhere",
                  wordWrap: "break-word",
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 800,
                    letterSpacing: "0.02em",
                    textTransform: "uppercase",
                    color: "var(--gold)",
                    marginBottom: 6,
                  }}
                >
                  Confirm this action
                </div>
                {p.summary ? (
                  <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{String(p.summary)}</div>
                ) : null}
                {p.target_label ? (
                  <div style={{ marginTop: 6, overflowWrap: "anywhere" }}>{"Target: " + String(p.target_label)}</div>
                ) : null}
                {p.expires_at ? (
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>
                    {"Expires at " + formatExpiry(p.expires_at)}
                  </div>
                ) : null}
                {m.error ? (
                  <div style={{ fontSize: 13, color: "var(--danger)", marginTop: 8, overflowWrap: "anywhere" }}>
                    {m.error}
                  </div>
                ) : null}
                {m.resolved ? (
                  <div style={{ fontSize: 13, fontWeight: 700, color: "var(--muted)", marginTop: 10 }}>
                    {m.resolved}
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      disabled={!!m.confirmBusy}
                      onClick={() => decideProposal(m, "confirm")}
                      style={{
                        boxSizing: "border-box",
                        flex: "1 1 0",
                        minWidth: 0,
                        minHeight: 44,
                        padding: "10px 12px",
                        borderRadius: 10,
                        cursor: m.confirmBusy ? "default" : "pointer",
                        fontFamily: "inherit",
                        fontSize: 14,
                        fontWeight: 700,
                        lineHeight: 1.2,
                        background: "var(--brand)",
                        border: "1px solid var(--brand)",
                        color: "#fff",
                        opacity: m.confirmBusy ? 0.55 : 1,
                      }}
                    >
                      {m.confirmBusy ? "Working..." : "Confirm"}
                    </button>
                    <button
                      type="button"
                      disabled={!!m.confirmBusy}
                      onClick={() => decideProposal(m, "cancel")}
                      style={{
                        boxSizing: "border-box",
                        flex: "1 1 0",
                        minWidth: 0,
                        minHeight: 44,
                        padding: "10px 12px",
                        borderRadius: 10,
                        cursor: m.confirmBusy ? "default" : "pointer",
                        fontFamily: "inherit",
                        fontSize: 14,
                        fontWeight: 700,
                        lineHeight: 1.2,
                        background: "var(--surface)",
                        border: "1px solid var(--line)",
                        color: "var(--ink)",
                        opacity: m.confirmBusy ? 0.55 : 1,
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            );
          }

          const isUser = m.role === "user";
          const isSpeakingThis = speakingId === m.id;
          const bubble = (
            <div
              key={m.id}
              className={"admin-ai-msg" + (isUser ? " admin-ai-user-bubble" : "")}
              style={isUser ? userBubbleStyle : assistantBubbleStyle}
            >
              {!isUser ? <div style={labelStyle}>Admin AI</div> : null}
              <div>{m.content}</div>
              {!isUser ? (
                <div style={{ marginTop: 8, whiteSpace: "normal" }}>
                  <button
                    type="button"
                    style={{
                      ...speakButtonStyle,
                      background: isSpeakingThis ? "var(--brand-soft)" : "var(--bg)",
                    }}
                    onClick={() => toggleSpeak(m)}
                    aria-label={isSpeakingThis ? "Stop speaking" : "Speak this message"}
                  >
                    {isSpeakingThis ? "Stop" : "Speak"}
                  </button>
                </div>
              ) : null}
            </div>
          );

          if (idx === firstBriefingIndex && briefingLoaded) {
            return (
              <div
                key={m.id + "-with-chips"}
                style={{
                  boxSizing: "border-box",
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                  alignSelf: "stretch",
                  minWidth: 0,
                }}
              >
                {bubble}
                <div
                  style={{
                    boxSizing: "border-box",
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 8,
                    alignSelf: "flex-start",
                    maxWidth: "100%",
                    minWidth: 0,
                  }}
                >
                  {QUICK_PROMPTS.map((label) => (
                    <button
                      key={label}
                      type="button"
                      style={{ ...chipStyle, opacity: busy ? 0.6 : 1 }}
                      disabled={busy}
                      onClick={() => sendMessage(label)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            );
          }

          return bubble;
        })}

        {busy ? (
          <div
            className="admin-ai-msg"
            style={{
              ...assistantBubbleStyle,
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "12px 16px",
              minHeight: 20,
            }}
            aria-label="Admin AI is typing"
          >
            <span className="admin-ai-typing-dot" />
            <span className="admin-ai-typing-dot" />
            <span className="admin-ai-typing-dot" />
          </div>
        ) : null}
      </div>

      <form
        onSubmit={onComposerSubmit}
        style={{
          boxSizing: "border-box",
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          padding: "12px 16px",
          borderTop: "1px solid var(--line)",
          background: "var(--surface)",
          flexShrink: 0,
          minWidth: 0,
        }}
      >
        {voiceSupported ? (
          <button
            type="button"
            onClick={toggleMic}
            disabled={busy}
            aria-label={listening ? "Stop voice input" : "Start voice input"}
            aria-pressed={listening}
            title={listening ? "Stop voice input" : "Start voice input"}
            className={"admin-ai-mic-btn" + (listening ? " listening" : "")}
            style={{
              boxSizing: "border-box",
              background: listening ? "var(--brand)" : "var(--surface)",
              color: listening ? "#fff" : "var(--ink)",
              border: listening ? "1px solid var(--brand)" : "1px solid var(--line)",
              borderRadius: "50%",
              width: 40,
              height: 40,
              minWidth: 40,
              cursor: busy ? "default" : "pointer",
              fontSize: 18,
              lineHeight: 1,
              flexShrink: 0,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              opacity: busy ? 0.55 : 1,
              padding: 0,
            }}
          >
            {listening ? "⏹" : "🎤"}
          </button>
        ) : null}
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onComposerKeyDown}
          placeholder="Ask about the platform, or tell me what to do..."
          rows={1}
          disabled={busy}
          aria-label="Message Admin AI"
          style={{
            boxSizing: "border-box",
            flex: "1 1 auto",
            minWidth: 0,
            width: "100%",
            border: "1px solid var(--line)",
            borderRadius: 24,
            padding: "10px 16px",
            fontSize: 14,
            lineHeight: 1.45,
            outline: "none",
            background: "var(--surface)",
            color: "var(--ink)",
            fontFamily: "inherit",
            resize: "none",
            overflowY: "auto",
            maxHeight: 120,
          }}
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          aria-label="Send message"
          className="admin-ai-send-btn"
          style={{
            boxSizing: "border-box",
            background: "var(--brand)",
            color: "#fff",
            border: "none",
            borderRadius: "50%",
            width: 40,
            height: 40,
            minWidth: 40,
            cursor: busy || !input.trim() ? "default" : "pointer",
            fontSize: 18,
            lineHeight: 1,
            flexShrink: 0,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            opacity: busy || !input.trim() ? 0.55 : 1,
            padding: 0,
          }}
        >
          {"↑"}
        </button>
      </form>

      <div
        style={{
          boxSizing: "border-box",
          flexShrink: 0,
          padding: "8px 16px 10px",
          background: "var(--surface)",
          borderTop: "1px solid var(--line)",
          minWidth: 0,
        }}
      >
        <div style={{ fontSize: 12, lineHeight: 1.45, color: "var(--muted)", overflowWrap: "anywhere" }}>
          Voice can ask and listen, but actions only run when you tap Confirm.
        </div>
        {micHint ? (
          <div style={{ fontSize: 12, lineHeight: 1.45, color: "var(--danger)", marginTop: 4, overflowWrap: "anywhere" }}>
            {micHint}
          </div>
        ) : null}
        {listening ? (
          <div style={{ fontSize: 12, lineHeight: 1.45, color: "var(--muted)", marginTop: 4 }}>
            Listening...
          </div>
        ) : null}
      </div>
    </div>
  );
}

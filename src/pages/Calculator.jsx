import { useEffect, useState } from "react";

const HIST_KEY = "kopabook_calc_history";
const MEM_KEY = "kopabook_calc_memory";

function calc(a, b, op) {
  const x = parseFloat(a), y = parseFloat(b);
  if (Number.isNaN(x)) return "0";
  if (op === "+") return String(x + (Number.isNaN(y) ? 0 : y));
  if (op === "−") return String(x - (Number.isNaN(y) ? 0 : y));
  if (op === "×") return String(x * (Number.isNaN(y) ? 1 : y));
  if (op === "÷") {
    if (!y) return "Error";
    return String(x / y);
  }
  return String(x);
}

function pretty(s) {
  if (s === "Error" || s === "") return s || "0";
  const n = parseFloat(s);
  if (Number.isNaN(n)) return "0";
  const r = Math.round(n * 1e10) / 1e10;
  return String(r).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function loadJson(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v === null || v === undefined ? fallback : v;
  } catch { return fallback; }
}

const KEYS = [
  "C", "⌫", "%", "÷",
  "7", "8", "9", "×",
  "4", "5", "6", "−",
  "1", "2", "3", "+",
  "±", "0", ".", "=",
];

const MEM_KEYS = ["MC", "MR", "M+", "M−"];

export default function CalculatorPage() {
  const [display, setDisplay] = useState("0");
  const [acc, setAcc] = useState(null);
  const [op, setOp] = useState(null);
  const [fresh, setFresh] = useState(true);
  const [history, setHistory] = useState(() => loadJson(HIST_KEY, []));
  const [memory, setMemory] = useState(() => loadJson(MEM_KEY, 0));
  // Change-due helper
  const [total, setTotal] = useState("");
  const [given, setGiven] = useState("");

  useEffect(() => {
    try { localStorage.setItem(HIST_KEY, JSON.stringify(history.slice(0, 30))); } catch {}
  }, [history]);

  useEffect(() => {
    try { localStorage.setItem(MEM_KEY, JSON.stringify(memory)); } catch {}
  }, [memory]);

  function pushHistory(entry) {
    setHistory((h) => [entry, ...h].slice(0, 30));
  }

  function inputDigit(d) {
    if (fresh) { setDisplay(d === "." ? "0." : d); setFresh(false); return; }
    if (d === "." && display.includes(".")) return;
    if (display.replace(/[-.]/g, "").length >= 12) return;
    setDisplay(display === "0" && d !== "." ? d : display + d);
  }

  function press(k) {
    if (k === "C") {
      setDisplay("0"); setAcc(null); setOp(null); setFresh(true); return;
    }
    if (k === "⌫") {
      if (!fresh && display.length > 1) setDisplay(display.slice(0, -1));
      else { setDisplay("0"); setFresh(true); }
      return;
    }
    if (k === "±") {
      setDisplay(display.startsWith("-") ? display.slice(1) : (display === "0" ? "0" : "-" + display));
      return;
    }
    if (k === "%") { setDisplay(String(parseFloat(display || "0") / 100)); return; }
    if (["+", "−", "×", "÷"].includes(k)) {
      if (acc !== null && op && !fresh) {
        const r = calc(acc, display, op);
        setAcc(r); setDisplay("0");
      } else {
        setAcc(display);
      }
      setOp(k); setFresh(true); return;
    }
    if (k === "=") {
      if (acc !== null && op) {
        const r = calc(acc, display, op);
        pushHistory({ text: `${pretty(acc)} ${op} ${pretty(display)} = ${pretty(r)}`, value: r });
        setDisplay(r); setAcc(null); setOp(null); setFresh(true);
      }
      return;
    }
    inputDigit(k);
  }

  function pressMem(k) {
    const v = parseFloat(display || "0") || 0;
    if (k === "MC") setMemory(0);
    else if (k === "MR") { setDisplay(String(Math.round(memory * 1e10) / 1e10)); setFresh(true); }
    else if (k === "M+") setMemory((m) => Math.round((m + v) * 1e10) / 1e10);
    else if (k === "M−") setMemory((m) => Math.round((m - v) * 1e10) / 1e10);
  }

  function reuse(h) {
    setDisplay(h.value); setAcc(null); setOp(null); setFresh(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const t = parseFloat(total), g = parseFloat(given);
  const change = !Number.isNaN(t) && !Number.isNaN(g) ? g - t : null;

  return (
    <div style={{ maxWidth: 420, margin: "0 auto" }}>
      <h2 style={{ marginTop: 0 }}>Calculator</h2>

      <div className="card">
        <div style={{
          background: "#1a2b49", color: "#fff", borderRadius: 10, padding: "18px 16px",
          fontSize: 34, textAlign: "right", fontFamily: "monospace", overflow: "hidden",
          minHeight: 70, marginBottom: 10,
        }}>
          {acc !== null && op ? <span style={{ fontSize: 15, opacity: 0.6 }}>{pretty(acc)} {op} </span> : null}
          {pretty(display)}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
          <span style={{
            fontSize: 12, fontWeight: 700, color: memory !== 0 ? "#1a6b3c" : "#bbb",
            minWidth: 86,
          }}>
            {memory !== 0 ? `M: ${pretty(String(memory))}` : "M: empty"}
          </span>
          <div style={{ display: "flex", gap: 6, flex: 1 }}>
            {MEM_KEYS.map((k) => (
              <button key={k} onClick={() => pressMem(k)}
                style={{
                  flex: 1, padding: "8px 0", fontSize: 13, fontWeight: 700, borderRadius: 8,
                  border: "1px solid #ddd", background: "#f7f7f7", color: "#1a6b3c", cursor: "pointer",
                }}>
                {k}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
          {KEYS.map((k) => {
            const isOp = ["÷", "×", "−", "+", "="].includes(k);
            const isUtil = ["C", "⌫", "%", "±"].includes(k);
            return (
              <button key={k} onClick={() => press(k)}
                style={{
                  padding: "16px 0", fontSize: 20, borderRadius: 10, border: "1px solid #ddd",
                  background: isOp ? "#1a6b3c" : isUtil ? "#f0f0f0" : "#fff",
                  color: isOp ? "#fff" : "#222", cursor: "pointer", fontWeight: 600,
                }}>
                {k}
              </button>
            );
          })}
        </div>
      </div>

      <div className="card">
        <h4 style={{ marginTop: 0 }}>Change due</h4>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <label>Total
            <input inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value.replace(/[^0-9.]/g, ""))}
              placeholder="0" />
          </label>
          <label>Given
            <input inputMode="decimal" value={given} onChange={(e) => setGiven(e.target.value.replace(/[^0-9.]/g, ""))}
              placeholder="0" />
          </label>
        </div>
        {change !== null && (
          <div style={{
            marginTop: 10, padding: 12, borderRadius: 8, textAlign: "center", fontWeight: 700, fontSize: 20,
            background: change < 0 ? "#fdecea" : "#e8f5e9", color: change < 0 ? "#b3261e" : "#1a6b3c",
          }}>
            {change < 0 ? `Short by ${pretty(String(-change))}` : `Give back ${pretty(String(change))}`}
          </div>
        )}
      </div>

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h4 style={{ margin: 0 }}>History</h4>
          {history.length > 0 && (
            <button className="btn btn-secondary btn-sm" onClick={() => setHistory([])}>Clear</button>
          )}
        </div>
        {history.length === 0 ? (
          <p className="hint" style={{ marginBottom: 0 }}>Your past calculations will appear here, even after you close the app. Tap any result to use it again.</p>
        ) : (
          <div style={{ marginTop: 8, fontSize: 14, color: "#444", fontFamily: "monospace" }}>
            {history.map((h, i) => (
              <button key={i} onClick={() => reuse(h)}
                title="Tap to use this result"
                style={{
                  display: "block", width: "100%", textAlign: "left", background: "none",
                  border: "none", borderBottom: "1px solid #eee", padding: "8px 4px",
                  fontSize: 14, fontFamily: "monospace", color: "#444", cursor: "pointer",
                }}>
                {h.text} <span style={{ color: "#1a6b3c" }}>↩</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

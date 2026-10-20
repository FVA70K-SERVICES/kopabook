import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";

// 4-digit PIN app lock UI: the numeric pad, the two-step PIN entry used
// by Settings and the dashboard invitation, the password reset panel,
// and AppLockGate, which covers the app on cold open and when it comes
// back from the background after the account's own re-lock time away.
// The lock lives only at the door, like a bank app: while the app is in
// the foreground being used it NEVER locks, and there is deliberately
// no idle or inactivity timer anywhere in this file. The only two
// triggers are the cold-open state check and a visibility return. The
// PIN only gates the screen; the session underneath is never touched.

// Fallback delay used only until the account's own setting loads.
export const BACKGROUND_LOCK_MS = 5 * 60 * 1000;

// Settings and the invitation dispatch this after any change, carrying
// the fresh server state, so a new re-lock time applies to the very
// next background return without a re-login or a reload.
export const APP_LOCK_STATE_EVENT = "kopabook:app-lock-state";

export function announceAppLockState(appLock) {
  try {
    if (appLock) window.dispatchEvent(new CustomEvent(APP_LOCK_STATE_EVENT, { detail: appLock }));
  } catch { /* a missed announcement only delays the update to the next state load */ }
}

export function relockMsFromState(appLock) {
  const minutes = Number(appLock && appLock.relockMinutes);
  return [0, 1, 5, 15, 30].includes(minutes) ? minutes * 60 * 1000 : BACKGROUND_LOCK_MS;
}

export function PinDots({ value, shakeKey }) {
  return (
    <div className="pin-dots" key={shakeKey || 0} aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <span key={i} className={value.length > i ? "filled" : ""} />
      ))}
    </div>
  );
}

export function PinPad({ onDigit, onBackspace, disabled }) {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "back"];
  return (
    <div className="pin-pad" role="group" aria-label="PIN pad">
      {keys.map((k, i) => {
        if (k === "") return <span key={"blank" + i} />;
        if (k === "back") {
          return (
            <button key="back" type="button" className="pin-key pin-key-back"
              onClick={onBackspace} disabled={disabled} aria-label="Delete last digit">⌫</button>
          );
        }
        return (
          <button key={k} type="button" className="pin-key"
            onClick={() => onDigit(k)} disabled={disabled} aria-label={"Digit " + k}>{k}</button>
        );
      })}
    </div>
  );
}

// Two-step (or one-step) PIN entry. Calls onComplete(pin) once a full
// PIN is entered and, for two-step flows, confirmed identically.
export function PinEntryPanel({ title, prompt, stageCount = 2, onComplete, onCancel, completeLabel }) {
  const [stage, setStage] = useState(0);
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);
  // Refs are the source of truth while digits arrive (fast taps and
  // keyboard input must never outrun a render); state mirrors for paint.
  const valueRef = useRef("");
  const stageRef = useRef(0);
  const firstRef = useRef("");
  const busyRef = useRef(false);

  const fail = useCallback((message) => {
    valueRef.current = "";
    setError(message);
    setValue("");
    setShakeKey((k) => k + 1);
  }, []);

  const append = useCallback(async (digit) => {
    if (busyRef.current || valueRef.current.length >= 4) return;
    const next = valueRef.current + digit;
    valueRef.current = next;
    setValue(next);
    setError("");
    if (next.length < 4) return;
    if (stageCount === 2 && stageRef.current === 0) {
      firstRef.current = next;
      stageRef.current = 1;
      valueRef.current = "";
      setStage(1);
      setValue("");
      return;
    }
    if (stageCount === 2 && next !== firstRef.current) {
      fail("The two PINs do not match. Try again.");
      return;
    }
    busyRef.current = true;
    setBusy(true);
    try {
      await onComplete(next);
    } catch (e) {
      busyRef.current = false;
      setBusy(false);
      if (stageCount === 2) { stageRef.current = 0; firstRef.current = ""; setStage(0); }
      fail(e.message || "Something went wrong. Try again.");
    }
  }, [stageCount, onComplete, fail]);

  const backspace = useCallback(() => {
    if (busyRef.current) return;
    valueRef.current = valueRef.current.slice(0, -1);
    setValue(valueRef.current);
    setError("");
  }, []);

  useEffect(() => {
    function onKey(e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target && e.target.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (/^\d$/.test(e.key)) { e.preventDefault(); append(e.key); }
      else if (e.key === "Backspace") { e.preventDefault(); backspace(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [append, backspace]);

  const stagePrompt = stageCount === 2 && stage === 1 ? "Enter the same PIN again to confirm it." : prompt;

  return (
    <div className={shakeKey ? "pin-shake" : ""} key={"panel" + shakeKey}>
      {title && <h3 style={{ marginTop: 0, textAlign: "center" }}>{title}</h3>}
      <p className="hint" style={{ textAlign: "center" }}>{stagePrompt}</p>
      <PinDots value={value} />
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      <PinPad onDigit={append} onBackspace={backspace} disabled={busy} />
      {busy && <p className="hint" style={{ textAlign: "center" }}>{completeLabel || "Working..."}</p>}
      {onCancel && (
        <div style={{ textAlign: "center", marginTop: 12 }}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onCancel} disabled={busy}>Cancel</button>
        </div>
      )}
    </div>
  );
}

// Forgot-PIN recovery: account password first, then a fresh PIN.
// onReset(password, pin) must return the server state or throw.
export function PinResetPanel({ onReset, onCancel, title }) {
  const [password, setPassword] = useState("");
  const [step, setStep] = useState("password");
  const [error, setError] = useState("");

  if (step === "pin") {
    return (
      <PinEntryPanel
        title={title || "Reset your PIN"}
        prompt="Choose a new 4-digit PIN."
        onComplete={(pin) => onReset(password, pin)}
        onCancel={() => { setStep("password"); setPassword(""); }}
        completeLabel="Resetting..."
      />
    );
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); if (password) { setError(""); setStep("pin"); } }}>
      {title && <h3 style={{ marginTop: 0, textAlign: "center" }}>{title}</h3>}
      <p className="hint" style={{ textAlign: "center" }}>Enter your account password, then choose a new PIN.</p>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      <div className="field">
        <label>Account password</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password" required autoFocus />
      </div>
      <button type="submit" className="btn btn-primary btn-block" disabled={!password}>Continue</button>
      {onCancel && (
        <div style={{ textAlign: "center", marginTop: 12 }}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onCancel}>Back</button>
        </div>
      )}
    </form>
  );
}

function formatLockout(seconds) {
  if (seconds >= 60) {
    const m = Math.ceil(seconds / 60);
    return `Try again in ${m} minute${m === 1 ? "" : "s"}.`;
  }
  return `Try again in ${seconds} second${seconds === 1 ? "" : "s"}.`;
}

// The lock screen itself: app name and a neutral prompt only. No
// business name, no figures, nothing from the account's data.
function LockScreen({ onUnlocked }) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [shakeKey, setShakeKey] = useState(0);
  const [lockoutSeconds, setLockoutSeconds] = useState(0);
  const [mode, setMode] = useState("pin");
  const pinRef = useRef("");
  pinRef.current = pin;
  const busyRef = useRef(false);

  useEffect(() => {
    if (lockoutSeconds <= 0) return;
    const t = setInterval(() => setLockoutSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [lockoutSeconds > 0]);

  const submit = useCallback(async (candidate) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const d = await api.post("/api/auth/app-lock", { action: "verify", pin: candidate });
      busyRef.current = false;
      setBusy(false);
      onUnlocked(d.appLock);
    } catch (e) {
      busyRef.current = false;
      setBusy(false);
      setPin("");
      pinRef.current = "";
      setShakeKey((k) => k + 1);
      if (e && typeof e.retryAfterSeconds === "number") setLockoutSeconds(e.retryAfterSeconds);
      setError(e.message || "Incorrect PIN.");
    }
  }, [onUnlocked]);

  const append = useCallback((digit) => {
    if (busyRef.current || lockoutSeconds > 0) return;
    const next = (pinRef.current + digit).slice(0, 4);
    pinRef.current = next;
    setPin(next);
    setError("");
    if (next.length === 4) submit(next);
  }, [lockoutSeconds, submit]);

  const backspace = useCallback(() => {
    if (busyRef.current) return;
    const next = pinRef.current.slice(0, -1);
    pinRef.current = next;
    setPin(next);
    setError("");
  }, []);

  useEffect(() => {
    if (mode !== "pin") return;
    function onKey(e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^\d$/.test(e.key)) { e.preventDefault(); append(e.key); }
      else if (e.key === "Backspace") { e.preventDefault(); backspace(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, append, backspace]);

  async function resetPassword(password, newPin) {
    const d = await api.post("/api/auth/app-lock", {
      action: "reset", password, newPin, confirmPin: newPin,
    });
    onUnlocked(d.appLock);
  }

  return (
    <div className="app-lock-screen" role="dialog" aria-modal="true" aria-label="App locked">
      <div className="app-lock-card">
        <div className="app-lock-mark" aria-hidden="true">🔒</div>
        <div className="brand" style={{ textAlign: "center" }}>Kopa<span>Book</span></div>
        {mode === "reset" ? (
          <PinResetPanel
            title="Forgot PIN"
            onReset={resetPassword}
            onCancel={() => setMode("pin")}
          />
        ) : (
          <div className={shakeKey ? "pin-shake" : ""} key={"lock" + shakeKey}>
            <p className="hint" style={{ textAlign: "center" }}>Enter your PIN to continue.</p>
            <PinDots value={pin} />
            {lockoutSeconds > 0
              ? <div className="alert alert-error" role="alert">Too many wrong attempts. {formatLockout(lockoutSeconds)}</div>
              : error && <div className="alert alert-error" role="alert">{error}</div>}
            <PinPad onDigit={append} onBackspace={backspace} disabled={busy || lockoutSeconds > 0} />
            {busy && <p className="hint" style={{ textAlign: "center" }}>Checking...</p>}
            <div style={{ textAlign: "center", marginTop: 14 }}>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setMode("reset"); setError(""); }}>
                Forgot PIN?
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Session memory for the gate.
//
// Navigation in this app is a full page load per screen, so a gate that
// only remembers "unlocked" in component state asks for the PIN on every
// single page. The bank model is: pass the door ONCE per browser
// session, then ask again only after a genuine background absence at
// least as long as the account's chosen minutes. sessionStorage is
// exactly that lifetime: it survives page loads and dies with the
// browser session, so a true cold open always asks.
//
// The passed flag is keyed to the account id, so a different account
// signing in inside the same browser session never inherits it. The
// hidden-at stamp records when the page last went into the background;
// when the browser kills and reloads the page while the user is away,
// the stamp is how the fresh page knows how long the absence really
// was, instead of treating every reload as a cold open.
const SESSION_PASSED_USER_KEY = "kopabook:app-lock-passed-user";
const SESSION_HIDDEN_AT_KEY = "kopabook:app-lock-hidden-at";

// No background absence shorter than this ever re-locks, whatever the
// account's setting says (even "Immediately"): an app-switcher peek,
// the notification shade, a system dialog or an incoming call is not
// leaving the app. "Immediately" therefore means "the first genuine
// absence", never "any flicker".
export const MIN_BACKGROUND_AWAY_MS = 30 * 1000;

export function effectiveRelockMs(relockMs) {
  return Math.max(relockMs, MIN_BACKGROUND_AWAY_MS);
}

function sessionPassedFor(userId) {
  if (userId == null) return false;
  try {
    return window.sessionStorage.getItem(SESSION_PASSED_USER_KEY) === String(userId);
  } catch (e) {
    return false;
  }
}

function setSessionPassed(userId, passed) {
  if (userId == null) return;
  try {
    if (passed) window.sessionStorage.setItem(SESSION_PASSED_USER_KEY, String(userId));
    else window.sessionStorage.removeItem(SESSION_PASSED_USER_KEY);
  } catch (e) {}
}

function readHiddenAt() {
  try {
    const n = Number(window.sessionStorage.getItem(SESSION_HIDDEN_AT_KEY));
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch (e) {
    return null;
  }
}

function writeHiddenAt(ts) {
  try {
    if (ts) window.sessionStorage.setItem(SESSION_HIDDEN_AT_KEY, String(ts));
    else window.sessionStorage.removeItem(SESSION_HIDDEN_AT_KEY);
  } catch (e) {}
}

// Wraps the signed-in app. On cold open with the lock on, the app waits
// behind the lock screen; once the PIN is entered it holds for the
// whole session, across every page navigation, until the app returns
// from a genuine background absence at least as long as the account's
// chosen re-lock time (and never for an absence under 30 seconds).
// Then the lock screen covers the app again with every page and its
// state exactly as it was left. Any amount of time spent using the app
// in the foreground never locks it.
export function AppLockGate({ session, children }) {
  const userId = session?.user?.id;
  const [phase, setPhase] = useState(() => {
    // A session that already passed the door starts open with no
    // loading flash; the mount effect still re-checks the case where
    // the stamped absence since then has grown long enough to lock.
    const hiddenAt = readHiddenAt();
    if (sessionPassedFor(userId) && !(hiddenAt && Date.now() - hiddenAt >= MIN_BACKGROUND_AWAY_MS)) {
      return "open";
    }
    return "checking";
  }); // checking | open | locked
  const hiddenAtRef = useRef(null);
  const engagedRef = useRef(false);
  // The account's current re-lock delay. Starts at the default and is
  // refreshed from every server state this gate sees, plus immediately
  // whenever Settings announces a change.
  const relockMsRef = useRef(BACKGROUND_LOCK_MS);

  const applyState = useCallback((appLock) => {
    if (appLock) relockMsRef.current = relockMsFromState(appLock);
  }, []);

  const engage = useCallback((source) => {
    // Engaging always ends the session's free pass: the next opening
    // must come through the PIN screen (or a settings announce).
    setSessionPassed(userId, false);
    setPhase("locked");
    if (!engagedRef.current) {
      engagedRef.current = true;
      api.post("/api/auth/app-lock", { action: "lock", source }).catch(() => {});
    }
  }, [userId]);

  useEffect(() => {
    let active = true;
    engagedRef.current = false;
    relockMsRef.current = BACKGROUND_LOCK_MS;
    const hiddenAt = readHiddenAt();
    writeHiddenAt(null);

    if (sessionPassedFor(userId)) {
      const away = hiddenAt ? Date.now() - hiddenAt : 0;
      if (hiddenAt && away >= MIN_BACKGROUND_AWAY_MS) {
        // The page was reloaded after a real absence (the browser may
        // have killed it in the background). The absence counts only
        // if it also meets the account's own minutes, read fresh.
        api.get("/api/auth/app-lock")
          .then((d) => {
            if (!active) return;
            applyState(d.appLock);
            if (d.appLock && d.appLock.enabled && away >= effectiveRelockMs(relockMsRef.current)) {
              engage("background");
            } else {
              setPhase("open");
            }
          })
          .catch(() => { if (active) setPhase("open"); }); // a failed check never locks anyone out
      } else {
        // Same session, door already passed: this load is in-app
        // navigation. Open at once; refresh the timer quietly so the
        // background trigger stays current.
        setPhase("open");
        api.get("/api/auth/app-lock")
          .then((d) => { if (active) applyState(d.appLock); })
          .catch(() => {});
      }
      return () => { active = false; };
    }

    api.get("/api/auth/app-lock")
      .then((d) => {
        if (!active) return;
        applyState(d.appLock);
        if (d.appLock && d.appLock.enabled) engage("cold_open");
        else {
          // Nothing to prove (no PIN, or lock off): this session is in.
          setSessionPassed(userId, true);
          setPhase("open");
        }
      })
      .catch(() => { if (active) setPhase("open"); }); // never lock a user out over a failed state check
    return () => { active = false; };
  }, [userId, engage, applyState]);

  useEffect(() => {
    function onAnnounced(e) {
      applyState(e && e.detail);
      // Announced states come from in-session PIN flows (setup, timer
      // change, turn on/off) that only run inside the unlocked app, so
      // the session counts as passed.
      if (e && e.detail) setSessionPassed(userId, true);
    }
    window.addEventListener(APP_LOCK_STATE_EVENT, onAnnounced);
    return () => window.removeEventListener(APP_LOCK_STATE_EVENT, onAnnounced);
  }, [applyState, userId]);

  useEffect(() => {
    function stampHidden() {
      // Only the first stamp counts: it marks when the user actually
      // left. A pagehide arriving while the page is already hidden
      // (the browser discarding it in the background) must not restart
      // the absence clock.
      if (hiddenAtRef.current != null) return;
      const now = Date.now();
      hiddenAtRef.current = now;
      writeHiddenAt(now);
    }
    function onVisibility() {
      if (document.visibilityState === "hidden") {
        stampHidden();
      } else if (document.visibilityState === "visible") {
        const hiddenAt = hiddenAtRef.current != null ? hiddenAtRef.current : readHiddenAt();
        hiddenAtRef.current = null;
        writeHiddenAt(null);
        // The single background trigger: a genuine absence that meets
        // the account's own setting, floored at 30 seconds so brief
        // peeks and flickers never count, whatever the setting says.
        if (hiddenAt && Date.now() - hiddenAt >= effectiveRelockMs(relockMsRef.current)) {
          api.get("/api/auth/app-lock")
            .then((d) => {
              applyState(d.appLock);
              if (d.appLock && d.appLock.enabled) engage("background");
            })
            .catch(() => {});
        }
      }
    }
    document.addEventListener("visibilitychange", onVisibility);
    // A page being unloaded (navigation, or the browser closing the
    // tab in the background) also stamps the absence, so a later
    // reload can tell a real absence from a plain navigation.
    window.addEventListener("pagehide", stampHidden);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", stampHidden);
    };
  }, [engage, applyState]);

  if (phase === "checking") {
    return (
      <div className="app-lock-screen" aria-label="Loading">
        <div className="app-lock-card">
          <div className="brand" style={{ textAlign: "center" }}>Kopa<span>Book</span></div>
          <p className="hint" style={{ textAlign: "center" }}>Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <>
      {children}
      {phase === "locked" && (
        <LockScreen onUnlocked={(appLock) => { applyState(appLock); setSessionPassed(userId, true); writeHiddenAt(null); engagedRef.current = false; setPhase("open"); }} />
      )}
    </>
  );
}

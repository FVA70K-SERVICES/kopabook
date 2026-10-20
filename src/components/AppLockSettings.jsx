import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { PinEntryPanel, PinResetPanel, announceAppLockState } from "./AppLock";

const RELOCK_OPTIONS = [
  { minutes: 0, label: "Immediately" },
  { minutes: 1, label: "1 minute" },
  { minutes: 5, label: "5 minutes" },
  { minutes: 15, label: "15 minutes" },
  { minutes: 30, label: "30 minutes" },
];

// Settings → App lock. Per signed-in account: set a PIN up, turn the
// lock on or off (turning it off asks for the PIN), change the PIN
// (current PIN required), or reset it with the account password.
export default function AppLockSettings() {
  const [state, setState] = useState(null);
  const [mode, setMode] = useState(""); // setup | disable | change-current | change-new | reset
  const [status, setStatus] = useState({ error: "", ok: "" });
  const [busy, setBusy] = useState(false);
  const [timerBusy, setTimerBusy] = useState(false);
  // The current PIN, held only in memory between the two change steps.
  const pendingCurrent = useRef({ pin: "" });

  const load = useCallback(() => {
    api.get("/api/auth/app-lock")
      .then((d) => setState(d.appLock || null))
      .catch((e) => setStatus({ error: e.message, ok: "" }));
  }, []);

  useEffect(() => { load(); }, [load]);

  function done(message, nextState) {
    if (nextState) {
      setState(nextState);
      // So the running app picks the change up on the next background
      // return, with no re-login and no reload.
      announceAppLockState(nextState);
    }
    setMode("");
    pendingCurrent.current.pin = "";
    setStatus({ error: "", ok: message });
  }

  // The re-lock timer is a plain preference: saving it never asks for
  // the PIN (turning the lock off still does), and it counts from the
  // moment it is saved, on this device and every other one.
  async function doTimer(minutes) {
    setTimerBusy(true);
    setStatus({ error: "", ok: "" });
    try {
      const d = await api.post("/api/auth/app-lock", { action: "set_timer", relockMinutes: minutes });
      if (d.appLock) {
        setState(d.appLock);
        announceAppLockState(d.appLock);
      }
      setStatus({ error: "", ok: d.message || "Re-lock time saved." });
    } catch (e) { setStatus({ error: e.message, ok: "" }); }
    setTimerBusy(false);
  }

  async function doSetup(pin) {
    const d = await api.post("/api/auth/app-lock", { action: "setup", pin, confirmPin: pin });
    done(d.message || "App lock is on. Your PIN is set.", d.appLock);
  }

  async function doEnable() {
    setBusy(true);
    setStatus({ error: "", ok: "" });
    try {
      const d = await api.post("/api/auth/app-lock", { action: "set_enabled", enabled: true });
      done(d.message || "App lock is on.", d.appLock);
    } catch (e) { setStatus({ error: e.message, ok: "" }); }
    setBusy(false);
  }

  async function doDisable(pin) {
    const d = await api.post("/api/auth/app-lock", { action: "set_enabled", enabled: false, currentPin: pin });
    done(d.message || "App lock is off.", d.appLock);
  }

  async function doChange(newPin) {
    const d = await api.post("/api/auth/app-lock", {
      action: "change", currentPin: pendingCurrent.current.pin, newPin, confirmPin: newPin,
    });
    done(d.message || "PIN changed.", d.appLock);
  }

  async function doReset(password, newPin) {
    const d = await api.post("/api/auth/app-lock", {
      action: "reset", password, newPin, confirmPin: newPin,
    });
    done(d.message || "PIN reset and app lock is on.", d.appLock);
  }

  if (!state) return <p className="hint">Loading app lock...</p>;

  return (
    <div>
      <p className="hint">
        A 4-digit PIN that guards the door of the app, like a bank app. It asks
        when the app opens, and again after you have been away for the time you
        choose below. It never interrupts you while you are using the app, and
        it protects the screen only; your password and sign-in stay the same.
      </p>
      {status.error && <div className="alert alert-error">{status.error}</div>}
      {status.ok && <div className="alert alert-ok">{status.ok}</div>}

      {!state.configured && mode !== "setup" && (
        <>
          <p><strong>App lock is off.</strong> No PIN is set yet.</p>
          <button type="button" className="btn btn-primary" onClick={() => { setMode("setup"); setStatus({ error: "", ok: "" }); }}>
            Set up a PIN
          </button>
        </>
      )}

      {!state.configured && mode === "setup" && (
        <PinEntryPanel
          prompt="Choose a 4-digit PIN for this account."
          onComplete={doSetup}
          onCancel={() => setMode("")}
          completeLabel="Setting up..."
        />
      )}

      {state.configured && mode === "" && (
        <>
          <p>
            <strong>{state.enabled ? "App lock is on." : "App lock is off."}</strong>{" "}
            A PIN is set for your account.
            {state.lockoutSecondsRemaining > 0 &&
              ` PIN entry is paused for about ${Math.ceil(state.lockoutSecondsRemaining / 60)} more minute(s) after too many wrong attempts.`}
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {state.enabled ? (
              <button type="button" className="btn btn-secondary" onClick={() => setMode("disable")}>
                Turn off
              </button>
            ) : (
              <button type="button" className="btn btn-primary" onClick={doEnable} disabled={busy}>
                {busy ? "Turning on..." : "Turn on"}
              </button>
            )}
            <button type="button" className="btn btn-secondary" onClick={() => setMode("change-current")}>
              Change PIN
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setMode("reset")}>
              Forgot PIN
            </button>
          </div>
          <div className="field" style={{ marginTop: 16 }}>
            <label htmlFor="app-lock-relock">Lock again after I leave the app for</label>
            <select
              id="app-lock-relock"
              value={String(state.relockMinutes ?? 5)}
              disabled={timerBusy}
              onChange={(e) => doTimer(Number(e.target.value))}
            >
              {RELOCK_OPTIONS.map((o) => (
                <option key={o.minutes} value={o.minutes}>{o.label}</option>
              ))}
            </select>
            <p className="hint" style={{ margin: "4px 0 0" }}>
              The PIN is asked when the app opens, and again once you have been
              away this long. While you are inside the app it never locks, no
              matter how long you spend. Saving this never asks for your PIN,
              and it applies on every device you sign in on.
            </p>
          </div>
        </>
      )}

      {state.configured && mode === "disable" && (
        <PinEntryPanel
          stageCount={1}
          prompt="Enter your current PIN to turn the lock off. Your PIN stays saved for when you turn it back on."
          onComplete={doDisable}
          onCancel={() => setMode("")}
          completeLabel="Turning off..."
        />
      )}

      {state.configured && mode === "change-current" && (
        <PinEntryPanel
          stageCount={1}
          prompt="First, enter your current PIN."
          onComplete={async (pin) => { pendingCurrent.current.pin = pin; setMode("change-new"); }}
          onCancel={() => setMode("")}
        />
      )}

      {state.configured && mode === "change-new" && (
        <PinEntryPanel
          prompt="Now choose your new 4-digit PIN."
          onComplete={doChange}
          onCancel={() => { pendingCurrent.current.pin = ""; setMode(""); }}
          completeLabel="Changing..."
        />
      )}

      {state.configured && mode === "reset" && (
        <PinResetPanel
          title="Reset your PIN"
          onReset={doReset}
          onCancel={() => setMode("")}
        />
      )}
    </div>
  );
}

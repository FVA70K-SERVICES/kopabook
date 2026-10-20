import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { PinEntryPanel, PinResetPanel } from "./AppLock";

// Settings → App lock. Per signed-in account: set a PIN up, turn the
// lock on or off (turning it off asks for the PIN), change the PIN
// (current PIN required), or reset it with the account password.
export default function AppLockSettings() {
  const [state, setState] = useState(null);
  const [mode, setMode] = useState(""); // setup | disable | change-current | change-new | reset
  const [status, setStatus] = useState({ error: "", ok: "" });
  const [busy, setBusy] = useState(false);
  // The current PIN, held only in memory between the two change steps.
  const pendingCurrent = useRef({ pin: "" });

  const load = useCallback(() => {
    api.get("/api/auth/app-lock")
      .then((d) => setState(d.appLock || null))
      .catch((e) => setStatus({ error: e.message, ok: "" }));
  }, []);

  useEffect(() => { load(); }, [load]);

  function done(message, nextState) {
    if (nextState) setState(nextState);
    setMode("");
    pendingCurrent.current.pin = "";
    setStatus({ error: "", ok: message });
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
        A 4-digit PIN that locks the app on this account when it opens and after
        5 minutes in the background. It protects the screen only; your password
        and sign-in stay the same.
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

import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { PinEntryPanel, announceAppLockState } from "./AppLock";

// Dashboard invitation to set up the PIN app lock. The server decides
// who sees it (no PIN yet, second sign-in onward, not snoozed, fewer
// than 3 dismissals); this component only renders that decision.
// "Set up now" creates the PIN in place; "Later" snoozes it server-side
// for 3 days, and after the third dismissal it never returns.
export default function PinInvite() {
  const [visible, setVisible] = useState(false);
  const [mode, setMode] = useState("invite"); // invite | setup | done
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    api.get("/api/auth/app-lock")
      .then((d) => {
        if (active && d.appLock && d.appLock.invite && d.appLock.invite.shouldShow) {
          setVisible(true);
        }
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  if (!visible) return null;

  async function later() {
    setBusy(true);
    try { await api.post("/api/auth/app-lock", { action: "dismiss_invite" }); } catch (e) {}
    setBusy(false);
    setVisible(false);
  }

  async function setup(pin) {
    const d = await api.post("/api/auth/app-lock", { action: "setup", pin, confirmPin: pin });
    if (d && d.appLock) {
      announceAppLockState(d.appLock);
      setMode("done");
    }
  }

  return (
    <div className="modal-back pin-invite-back">
      <div className="modal pin-invite-card" role="dialog" aria-modal="true" aria-labelledby="pin-invite-title">
        {mode === "done" ? (
          <>
            <div className="app-lock-mark" aria-hidden="true">🔒</div>
            <h2 id="pin-invite-title" style={{ textAlign: "center" }}>App lock is on</h2>
            <p className="hint" style={{ textAlign: "center" }}>
              KopaBook will now ask for your PIN when it opens and after it has been
              in the background for a while. You can change it any time in Settings.
            </p>
            <button type="button" className="btn btn-primary btn-block" onClick={() => setVisible(false)}>
              Done
            </button>
          </>
        ) : mode === "setup" ? (
          <PinEntryPanel
            title="Create your PIN"
            prompt="Choose a 4-digit PIN for this account."
            onComplete={setup}
            onCancel={() => setMode("invite")}
            completeLabel="Setting up..."
          />
        ) : (
          <>
            <div className="app-lock-mark" aria-hidden="true">🔒</div>
            <h2 id="pin-invite-title" style={{ textAlign: "center" }}>Add a PIN lock</h2>
            <p className="hint" style={{ textAlign: "center" }}>
              Secure KopaBook on this device with a 4-digit PIN. The app will ask for it
              when it opens and after it has been sitting in the background, so nobody
              can wander into your records from your phone. It takes ten seconds.
            </p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={later} disabled={busy}>
                {busy ? "One moment..." : "Later"}
              </button>
              <button type="button" className="btn btn-primary" style={{ flex: 1 }} onClick={() => setMode("setup")}>
                Set up now
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

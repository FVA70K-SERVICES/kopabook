import { useEffect, useRef, useState } from "react";
import {
  captureInstallPrompt,
  getDeferredPrompt,
  isAndroid,
  isInstallDismissed,
  isStandalone,
  onDeferredPromptChange,
  promptInstall,
  rememberInstallDismissed,
} from "../lib/installPrompt";

// The native prompt usually arrives soon after load when the browser
// supports it; the sheet waits a beat so it never flashes over first
// paint. When the event never comes, the fallback waits a little
// longer first, so a slow Chromium still gets the native prompt.
const NATIVE_DELAY_MS = 1200;
const FALLBACK_DELAY_MS = 4000;

// Android install pop-up. Two faces, one sheet:
// - "native": the browser fired beforeinstallprompt, so Install shows
//   the real native prompt. This only happens in Chromium-based
//   Android browsers; no other browser fires the event.
// - "fallback": the event never fired, so the sheet shows Add to Home
//   Screen steps, plus the Android app download the /download page
//   already links (/downloads/kopabook.apk). There is no other
//   download URL and none is invented here.
export default function InstallPrompt() {
  const [visible, setVisible] = useState(null); // null | "native" | "fallback"
  const [installing, setInstalling] = useState(false);
  const shownRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    if (window.location.pathname === "/download") return undefined;
    if (!isAndroid() || isStandalone() || isInstallDismissed()) return undefined;
    captureInstallPrompt();
    let cancelled = false;
    let nativeTimer = 0;
    let fallbackTimer = 0;

    function show(kind) {
      if (cancelled || shownRef.current) return;
      shownRef.current = true;
      setVisible(kind);
    }

    function armNative() {
      window.clearTimeout(nativeTimer);
      nativeTimer = window.setTimeout(() => show("native"), NATIVE_DELAY_MS);
    }

    // The event may already have fired before this component mounted
    // (capture runs in main.jsx). Otherwise wait for it, and fall back
    // to Add to Home Screen guidance if it never comes.
    if (getDeferredPrompt()) {
      armNative();
    } else {
      fallbackTimer = window.setTimeout(() => show("fallback"), FALLBACK_DELAY_MS);
    }
    const off = onDeferredPromptChange((d) => {
      if (cancelled) return;
      if (d) {
        window.clearTimeout(fallbackTimer);
        armNative();
      } else {
        // The event was spent, or the app was installed: hide.
        setVisible(null);
      }
    });
    return () => {
      cancelled = true;
      window.clearTimeout(nativeTimer);
      window.clearTimeout(fallbackTimer);
      off();
    };
  }, []);

  // Escape closes the sheet, like every other KopaBook modal.
  useEffect(() => {
    if (!visible) return undefined;
    function onKey(e) {
      if (e.key === "Escape") dismiss();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible]);

  function dismiss() {
    rememberInstallDismissed();
    setVisible(null);
  }

  async function onInstall() {
    if (installing) return;
    setInstalling(true);
    await promptInstall();
    setInstalling(false);
    // Accepted or dismissed, the sheet is done for now; the 7-day
    // record keeps it quiet either way.
    rememberInstallDismissed();
    setVisible(null);
  }

  if (!visible) return null;

  return (
    <div className="kb-install-back" onClick={dismiss} role="presentation">
      <div
        className="modal kb-install-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="kb-install-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="modal-close" aria-label="Close install prompt" onClick={dismiss}>
          ✕
        </button>
        <div className="kb-install-head">
          <img src="/icon-192.png" alt="" className="kb-install-icon" width="48" height="48" />
          <div>
            <h2 id="kb-install-title">Install KopaBook</h2>
            <p className="kb-install-sub">Your shop records, one tap away.</p>
          </div>
        </div>
        {visible === "native" ? (
          <>
            <p className="kb-install-text">
              Install KopaBook on your phone for one-tap access to your sales, stock and debts. Free, and it works
              offline.
            </p>
            <div className="kb-install-actions">
              <button type="button" className="btn btn-primary kb-install-btn" onClick={onInstall} disabled={installing}>
                {installing ? "Installing…" : "Install"}
              </button>
              <button type="button" className="btn btn-secondary kb-install-btn" onClick={dismiss}>
                Not now
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="kb-install-text">
              Add KopaBook to your home screen for one-tap access. It takes under a minute.
            </p>
            <ol className="kb-install-steps">
              <li>Tap your browser menu (the three dots at the top).</li>
              <li>
                Tap <strong>Add to Home screen</strong>.
              </li>
              <li>
                Tap <strong>Add</strong>, then open KopaBook from your home screen.
              </li>
            </ol>
            <p className="kb-install-note">
              Prefer a download? The Android app is a small file (about 4.8 MB), free, from kopabook.com.
            </p>
            <div className="kb-install-actions">
              <a className="btn btn-primary kb-install-btn" href="/downloads/kopabook.apk" download>
                Download for Android
              </a>
              <button type="button" className="btn btn-secondary kb-install-btn" onClick={dismiss}>
                Not now
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

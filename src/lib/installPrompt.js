// KopaBook install prompt: one shared home for the beforeinstallprompt
// event. The event is captured early (main.jsx, before React renders)
// because the browser fires it once, soon after load; a listener
// attached after React mounts can miss it. The InstallPrompt sheet and
// the Settings install card both read the event captured here, so the
// native prompt can never be spent twice (a spent event throws if
// prompted again).
export const INSTALL_DISMISS_KEY = "kopabook-install-dismissed-at";
export const INSTALL_DISMISS_DAYS = 7;

let deferredPrompt = null;
const listeners = new Set();
let captured = false;

function notify() {
  listeners.forEach((fn) => {
    try {
      fn(deferredPrompt);
    } catch {
      // One broken listener must not break the others.
    }
  });
}

// True when the app already runs installed (standalone window), on
// Android or iOS. The pop-up must never show there.
export function isStandalone() {
  try {
    if (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) return true;
  } catch {
    // matchMedia unavailable; fall through to the iOS check.
  }
  try {
    if (window.navigator && window.navigator.standalone) return true;
  } catch {
    // navigator unavailable.
  }
  return false;
}

// The install pop-up is an Android pop-up: only Android devices see
// it. iOS is out of scope and desktop users have the /download page.
export function isAndroid() {
  try {
    return /Android/i.test(window.navigator.userAgent || "");
  } catch {
    return false;
  }
}

// True when the user dismissed (or installed from) the prompt less
// than 7 days ago. The record is a plain timestamp, nothing else.
export function isInstallDismissed() {
  try {
    const raw = localStorage.getItem(INSTALL_DISMISS_KEY);
    if (!raw) return false;
    const at = Number(raw);
    if (!Number.isFinite(at)) return false;
    return Date.now() - at < INSTALL_DISMISS_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

export function rememberInstallDismissed() {
  try {
    localStorage.setItem(INSTALL_DISMISS_KEY, String(Date.now()));
  } catch {
    // Storage unavailable (private mode); the prompt just shows again.
  }
}

export function getDeferredPrompt() {
  return deferredPrompt;
}

// Subscribe to the captured event arriving (or being spent). Returns
// an unsubscribe function. The listener gets the event, or null once
// it has been spent or the app was installed.
export function onDeferredPromptChange(fn) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function captureInstallPrompt() {
  if (captured) return;
  captured = true;
  try {
    window.addEventListener("beforeinstallprompt", (e) => {
      // Stop the browser's own mini-infobar: the KopaBook sheet is
      // the prompt the user sees.
      e.preventDefault();
      deferredPrompt = e;
      notify();
    });
    window.addEventListener("appinstalled", () => {
      deferredPrompt = null;
      rememberInstallDismissed();
      notify();
    });
  } catch {
    // No window (SSR) or listeners unavailable; the prompt stays off.
  }
}

// Show the native install prompt once and forget the event, so no
// other caller can prompt with a spent event. Returns the browser's
// userChoice ({ outcome: "accepted" | "dismissed" }) or null when
// there is no event to show.
export async function promptInstall() {
  const d = deferredPrompt;
  if (!d) return null;
  deferredPrompt = null;
  notify();
  try {
    d.prompt();
  } catch {
    return null;
  }
  try {
    return await d.userChoice;
  } catch {
    return null;
  }
}

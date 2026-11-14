import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import './motion.css'
import './a11y.css'
import './print.css'
import App from './App.jsx'
import { initTheme } from './lib/theme'
import { captureInstallPrompt } from './lib/installPrompt'

// Capture beforeinstallprompt as early as possible: the browser fires
// it once, soon after load, and a listener attached after React mounts
// can miss it. The InstallPrompt sheet and the Settings install card
// both read the event this captures.
captureInstallPrompt()

// Apply the saved theme before first paint (the index.html inline script
// usually beats this; this is the fallback).
initTheme()

// WORLD-BEST: Accessibility — apply the saved text size before first paint.
try {
  if (localStorage.getItem("kopabook-text-size") === "large") {
    document.documentElement.dataset.text = "large";
  }
} catch { /* no saved choice; normal text */ }

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Register the service worker for offline support (app shell + API read cache).
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Offline support is a nice-to-have; the app still works online.
    });
  });
}

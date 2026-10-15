import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import App from './App.jsx'
import { initTheme } from './lib/theme'

// Apply the saved theme before first paint (the index.html inline script
// usually beats this; this is the fallback).
initTheme()

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

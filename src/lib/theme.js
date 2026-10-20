// Theme: three modes — "auto" (follow the system), "light", "dark".
// The chosen MODE is persisted in localStorage; the RESOLVED theme
// ("light" | "dark") is applied as data-theme on <html>, and the mode as
// data-theme-mode. Styles key off data-theme only, so Auto switching the
// resolved theme restyles everything (including the chat widget) live.
const MODE_KEY = "kopabook-theme-mode";
const LEGACY_KEY = "kopabook-theme"; // pre-Auto storage: "light" | "dark"
const MODES = ["auto", "light", "dark"];

const listeners = new Set();
let mq = null;
let mqBound = false;

export function getThemeMode() {
  try {
    const saved = localStorage.getItem(MODE_KEY);
    if (MODES.indexOf(saved) !== -1) return saved;
    // Migrate a pre-Auto saved choice: it was a deliberate pick, keep it
    // as the mode so existing users see no surprise change.
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy === "light" || legacy === "dark") return legacy;
  } catch {}
  return "auto";
}

export function resolveTheme(mode) {
  if (mode === "light" || mode === "dark") return mode;
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

// The resolved theme currently in effect ("light" | "dark").
export function getTheme() {
  return resolveTheme(getThemeMode());
}

function notify() {
  const state = { mode: getThemeMode(), theme: getTheme() };
  listeners.forEach((fn) => {
    try { fn(state); } catch {}
  });
}

function onSystemChange() {
  if (getThemeMode() !== "auto") return;
  document.documentElement.setAttribute("data-theme", resolveTheme("auto"));
  notify();
}

function bindSystemListener() {
  if (mqBound || typeof window === "undefined" || !window.matchMedia) return;
  mq = window.matchMedia("(prefers-color-scheme: dark)");
  if (mq.addEventListener) mq.addEventListener("change", onSystemChange);
  else if (mq.addListener) mq.addListener(onSystemChange);
  mqBound = true;
}

export function applyThemeMode(mode) {
  if (MODES.indexOf(mode) === -1) mode = "auto";
  const root = document.documentElement;
  root.setAttribute("data-theme", resolveTheme(mode));
  root.setAttribute("data-theme-mode", mode);
  try { localStorage.setItem(MODE_KEY, mode); } catch {}
  bindSystemListener();
  notify();
}

export function setThemeMode(mode) {
  applyThemeMode(mode);
  return getThemeMode();
}

// Cycle Auto -> Light -> Dark -> Auto.
export function cycleThemeMode() {
  const order = ["auto", "light", "dark"];
  const next = order[(order.indexOf(getThemeMode()) + 1) % order.length];
  applyThemeMode(next);
  return next;
}

export function onThemeChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function initTheme() {
  applyThemeMode(getThemeMode());
}

// Back-compat for any older caller: jump straight to the opposite
// resolved theme as a manual choice.
export function toggleTheme() {
  const next = getTheme() === "dark" ? "light" : "dark";
  applyThemeMode(next);
  return next;
}

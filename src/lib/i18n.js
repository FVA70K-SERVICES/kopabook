// KopaBook i18n runtime (world-best upgrade, Phase A: Translation).
// Zero configuration: importing this module loads all 10 locale dictionaries
// and applies the stored language (localStorage, else the browser language
// when it matches a supported code, else English).
// Fallback rule: any key missing in the active language shows English,
// never blank, never a key id. A key missing everywhere returns "".
//
// Language is per USER, not per business: stored in localStorage
// ('kopabook.language') and persisted to the server via
// POST /api/auth/language (functions/api/auth/language.js, users.language,
// migration 0061). The server call is skipped when signed out
// (LanguageSwitcher gets persist={false} on the sign-in screen) and any
// failure is swallowed: the local choice always wins immediately.
// Screens re-render through a tiny subscription: subscribe(fn) / useLanguage().
// Phase B wires t() calls into the screens; this phase builds the system.
import { useEffect, useState } from "react";
import en from "./locales/en.js";
import pcm from "./locales/pcm.js";
import ha from "./locales/ha.js";
import yo from "./locales/yo.js";
import ig from "./locales/ig.js";
import fr from "./locales/fr.js";
import es from "./locales/es.js";
import pt from "./locales/pt.js";
import ar from "./locales/ar.js";
import sw from "./locales/sw.js";

export const LANGUAGES = [
  { code: "en", name: "English", native: "English", rtl: false, intl: "en" },
  { code: "pcm", name: "Nigerian Pidgin", native: "Pidgin", rtl: false, intl: "en-NG" },
  { code: "ha", name: "Hausa", native: "Hausa", rtl: false, intl: "ha" },
  { code: "yo", name: "Yoruba", native: "Yorùbá", rtl: false, intl: "yo" },
  { code: "ig", name: "Igbo", native: "Igbo", rtl: false, intl: "ig" },
  { code: "fr", name: "French", native: "Français", rtl: false, intl: "fr" },
  { code: "es", name: "Spanish", native: "Español", rtl: false, intl: "es" },
  { code: "pt", name: "Portuguese", native: "Português", rtl: false, intl: "pt" },
  { code: "ar", name: "Arabic", native: "العربية", rtl: true, intl: "ar" },
  { code: "sw", name: "Swahili", native: "Kiswahili", rtl: false, intl: "sw" },
];

export const SUPPORTED_CODES = LANGUAGES.map((l) => l.code);
export const DEFAULT_LANGUAGE = "en";
export const LANGUAGE_STORAGE_KEY = "kopabook.language";

// Mutable registry so tests (and a future lazy loader) can inspect or patch
// a dictionary without rebuilding the module. Never edited by the app.
export const dictionaries = { en, pcm, ha, yo, ig, fr, es, pt, ar, sw };

export function isSupported(code) {
  return SUPPORTED_CODES.includes(String(code || ""));
}

export function languageMeta(code) {
  return LANGUAGES.find((l) => l.code === code) || LANGUAGES[0];
}

function readStored() {
  try {
    if (typeof localStorage !== "undefined") {
      const v = localStorage.getItem(LANGUAGE_STORAGE_KEY);
      if (isSupported(v)) return v;
    }
  } catch { /* storage unavailable (private mode, SSR): fall through */ }
  return null;
}

function browserLanguage() {
  try {
    if (typeof navigator !== "undefined" && navigator.language) {
      const tag = String(navigator.language).toLowerCase();
      const hit = LANGUAGES.find((l) => tag === l.code || tag.startsWith(l.code + "-"));
      if (hit) return hit.code;
    }
  } catch { /* ignore */ }
  return null;
}

let current = readStored() || browserLanguage() || DEFAULT_LANGUAGE;
const listeners = new Set();

function applyToDocument(code) {
  try {
    if (typeof document !== "undefined" && document.documentElement) {
      const meta = languageMeta(code);
      document.documentElement.lang = meta.code;
      // dir="rtl" only for Arabic. Numbers and amounts stay left-to-right
      // inside RTL text because Intl formats them with bidi isolation.
      document.documentElement.dir = meta.rtl ? "rtl" : "ltr";
    }
  } catch { /* non-DOM environment (tests): nothing to apply */ }
}

function notify() {
  listeners.forEach((fn) => {
    try { fn(current); } catch { /* one bad listener must not break the rest */ }
  });
}

// Subscribe to language changes; returns an unsubscribe function.
// Pattern for screens (Phase B): const lang = useLanguage(); then t(...) in render.
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useLanguage() {
  const [lang, setLang] = useState(current);
  useEffect(() => subscribe(setLang), []);
  return lang;
}

export function getLanguage() {
  return current;
}

export function setLanguage(code, opts = {}) {
  const next = isSupported(code) ? code : DEFAULT_LANGUAGE;
  const persist = opts.persist !== false;
  const changed = next !== current;
  current = next;
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
    }
  } catch { /* storage unavailable: in-memory choice still applies */ }
  applyToDocument(next);
  if (changed) notify();
  // Persist server-side (signed-in only). Fire-and-forget: a failure
  // (signed out, offline) never blocks or reverts the local choice.
  if (persist && typeof window !== "undefined" && typeof fetch === "function") {
    fetch("/api/auth/language", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ language: next }),
    }).catch(() => {});
  }
  return next;
}

// Translate a key, interpolating {var} placeholders from `vars`.
// Fallback: active language -> English -> "" (never blank in a real
// dictionary, never a key id). Never throws, even for a missing dictionary.
export function t(key, vars) {
  const k = String(key || "");
  let s = (dictionaries[current] && dictionaries[current][k]) || dictionaries.en[k] || "";
  if (vars && typeof vars === "object") {
    s = s.replace(/\{(\w+)\}/g, (m, name) =>
      vars[name] === undefined || vars[name] === null ? m : String(vars[name]));
  }
  return s;
}

// Translate in a specific language without changing the active one
// (used by the receipt renderer, which follows the business language).
export function tIn(code, key, vars) {
  const lang = isSupported(code) ? code : DEFAULT_LANGUAGE;
  const k = String(key || "");
  let s = (dictionaries[lang] && dictionaries[lang][k]) || dictionaries.en[k] || "";
  if (vars && typeof vars === "object") {
    s = s.replace(/\{(\w+)\}/g, (m, name) =>
      vars[name] === undefined || vars[name] === null ? m : String(vars[name]));
  }
  return s;
}

// Currency symbols kept identical to base src/lib/api.js fmt().
// Intl narrowSymbol agrees with them for the listed currencies; anything
// else falls back to "CODE " so an unknown currency never renders blank.
const CURRENCY_SYMBOLS = {
  NGN: "₦", GHS: "₵", USD: "$", EUR: "€", GBP: "£", KES: "KSh ", UGX: "USh ",
  TZS: "TSh ", ZAR: "R ", INR: "₹", PHP: "₱", CNY: "¥", JPY: "¥", AED: "د.إ ",
};

export function formatMoney(amount, currency) {
  const code = /^[A-Z]{3}$/.test(String(currency || "")) ? currency : "NGN";
  const v = Number(amount || 0);
  try {
    return new Intl.NumberFormat(languageMeta(current).intl, {
      style: "currency",
      currency: code,
      currencyDisplay: "narrowSymbol",
      maximumFractionDigits: 2,
    }).format(v);
  } catch {
    const sym = CURRENCY_SYMBOLS[code] || (code + " ");
    return sym + v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  }
}

export function formatDate(date, opts) {
  const d = date instanceof Date ? date : new Date(date);
  try {
    return new Intl.DateTimeFormat(
      languageMeta(current).intl,
      opts || { dateStyle: "medium" }
    ).format(d);
  } catch {
    return new Intl.DateTimeFormat("en", opts || { dateStyle: "medium" }).format(d);
  }
}

// Receipt language: the BUSINESS's receipt language (businesses.receipt_language,
// migration 0061), read from the /api/business response object. It is NOT the
// signed-in user's app language: the receipt goes to the customer.
// Returns a supported code, defaulting to 'en' for anything unknown/blank.
export function getReceiptLanguage(business) {
  const code = business && (business.receipt_language || business.receiptLanguage);
  return isSupported(code) ? code : DEFAULT_LANGUAGE;
}

// The exact labels interface the Receipt stream's card accepts (Phase B
// wires this in). All 11 keys, translated in the receipt language, with
// English fallback via tIn(). No other receipt string is needed from i18n:
// business name, items, dates and figures come from the sale itself.
export const RECEIPT_LABEL_KEYS = [
  "receipt.title", "receipt.paidInFull", "receipt.total", "receipt.subtotal",
  "receipt.discount", "receipt.paid", "receipt.changeGiven", "receipt.balanceDue",
  "receipt.customer", "receipt.poweredBy", "receipt.thankYou",
];

export function getReceiptLabels(businessOrCode) {
  const code = typeof businessOrCode === "string"
    ? businessOrCode
    : getReceiptLanguage(businessOrCode);
  const labels = {};
  for (const key of RECEIPT_LABEL_KEYS) {
    const short = key.split(".")[1];
    labels[short] = tIn(code, key);
  }
  return labels;
}

// Apply the stored language to <html> as soon as the module loads.
applyToDocument(current);

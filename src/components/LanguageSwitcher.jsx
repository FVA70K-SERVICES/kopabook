// Language switcher (world-best upgrade, Phase A: Translation).
// A <select> listing the 10 languages by native name + English name.
// 44px min-height, 16px font (no iOS zoom, reachable target).
// On change it calls setLanguage() and applies immediately: the <html>
// lang/dir update at once and every subscribed component re-renders
// (see subscribe()/useLanguage() in ../lib/i18n.js) — no reload needed.
// Props:
//   persist (default true) — persist to the server via POST /api/auth/language.
//     Pass persist={false} on signed-out screens (Auth), where only
//     localStorage applies until the user signs in.
import { LANGUAGES, getLanguage, setLanguage, t, useLanguage } from "../lib/i18n";

export default function LanguageSwitcher({ persist = true, id = "language-switcher" }) {
  useLanguage();
  const current = getLanguage();
  return (
    <div className="field" style={{ marginBottom: 12 }}>
      <label htmlFor={id}>{t("settings.languageLabel")}</label>
      <select
        id={id}
        value={current}
        onChange={(e) => setLanguage(e.target.value, { persist })}
        style={{ minHeight: 44, fontSize: 16, width: "100%" }}
        aria-label={t("settings.languageLabel")}
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.native} ({l.name})
          </option>
        ))}
      </select>
    </div>
  );
}

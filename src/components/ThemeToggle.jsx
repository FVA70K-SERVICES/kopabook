import { useEffect, useState } from "react";
import { getThemeMode, cycleThemeMode, onThemeChange } from "../lib/theme";

const META = {
  auto: { icon: "🌗", label: "Auto", hint: "follows your device" },
  light: { icon: "☀️", label: "Light", hint: "" },
  dark: { icon: "🌙", label: "Dark", hint: "" },
};
const NEXT = { auto: "Light", light: "Dark", dark: "Auto" };

export default function ThemeToggle() {
  const [mode, setMode] = useState(() => getThemeMode());

  useEffect(() => onThemeChange(({ mode: m }) => setMode(m)), []);

  const meta = META[mode] || META.auto;

  return (
    <button
      onClick={() => setMode(cycleThemeMode())}
      className="btn btn-secondary btn-sm"
      aria-label={`Theme: ${meta.label}${meta.hint ? ` (${meta.hint})` : ""}. Switch to ${NEXT[mode]}.`}
      title={`Theme: ${meta.label}${meta.hint ? ` (${meta.hint})` : ""}`}
      style={{ padding: "8px 10px", gap: 6 }}
    >
      <span aria-hidden="true">{meta.icon}</span>
      <span style={{ fontSize: 12.5, fontWeight: 700 }}>{meta.label}</span>
    </button>
  );
}

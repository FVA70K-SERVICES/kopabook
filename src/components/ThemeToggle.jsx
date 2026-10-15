import { useState } from "react";
import { getTheme, toggleTheme } from "../lib/theme";

export default function ThemeToggle() {
  const [theme, setTheme] = useState(() => getTheme());

  function onClick() {
    setTheme(toggleTheme());
  }

  return (
    <button
      onClick={onClick}
      className="btn btn-secondary btn-sm"
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      title={theme === "dark" ? "Light mode" : "Dark mode"}
      style={{ padding: "8px 10px" }}
    >
      {theme === "dark" ? "☀️" : "🌙"}
    </button>
  );
}

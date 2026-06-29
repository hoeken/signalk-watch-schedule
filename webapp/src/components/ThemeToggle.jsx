import { useState } from "react";
import { getTheme, setTheme } from "../theme.js";

// A sun/moon button for the top bar. Shows the icon for the mode you'd switch TO
// (a sun while dark, a moon while light). Drawn as SVGs, not glyphs, because the
// MFD's Chromium 69 font set lacks the sun/moon emoji and renders them as tofu.
export default function ThemeToggle() {
  const [theme, setLocalTheme] = useState(getTheme);
  const dark = theme === "dark";

  const toggle = () => {
    const next = dark ? "light" : "dark";
    setTheme(next);
    setLocalTheme(next);
  };

  const label = dark ? "Switch to light mode" : "Switch to dark mode";
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      title={label}
      aria-label={label}
    >
      {dark ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

function SunIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

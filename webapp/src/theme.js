// The active theme lives on <html data-theme>. The inline bootstrap in
// index.html resolves it before first paint (saved choice -> ?mode query ->
// OS preference); this module only reads, toggles, and persists it. An explicit
// toggle is the user's choice, so it persists and wins on the next load.

const STORAGE_KEY = "theme";

// Keep the browser chrome (mobile address bar) in step with the page background.
const META_COLOR = { dark: "#0b1220", light: "#f1f5f9" };

export function getTheme() {
  return document.documentElement.getAttribute("data-theme") === "light"
    ? "light"
    : "dark";
}

function syncMeta(theme) {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta)
    meta.setAttribute("content", META_COLOR[theme]);
}

export function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Storage can be blocked (private mode); the toggle still works this session.
  }
  syncMeta(theme);
}

// Align the address-bar color with whatever the bootstrap resolved, without
// re-persisting it — only an explicit toggle should be treated as a choice.
export function initThemeMeta() {
  syncMeta(getTheme());
}

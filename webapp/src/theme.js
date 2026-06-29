// The active theme lives on <html data-theme>. The inline bootstrap in
// index.html resolves it before first paint (?mode query -> OS preference);
// this module only reads and toggles it. The toggle is session-only: it is
// never persisted, so each reload re-resolves from the query param / OS.

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
  syncMeta(theme);
}

// Align the address-bar color with whatever the bootstrap resolved.
export function initThemeMeta() {
  syncMeta(getTheme());
}

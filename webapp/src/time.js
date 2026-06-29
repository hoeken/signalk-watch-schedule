/** Small formatting helpers for the UI. */

/** "14:00" in the viewer's local timezone (the boat's clock). */
export function formatClock(epochMs) {
  return new Date(epochMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** "Monday\n14:00" — weekday on its own line above the clock, for shifts crossing day boundaries. */
export function formatClockDay(epochMs) {
  const d = new Date(epochMs);
  const weekday = d.toLocaleDateString([], { weekday: 'long' });
  return `${weekday}\n${formatClock(epochMs)}`;
}

/** "4h", "3h 30m", "45m" from a minute count. */
export function formatDuration(minutes) {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

/** Signed gap to a target, as "2h 15m" (absolute value). Empty if past. */
export function untilLabel(targetMs, nowMs) {
  const diff = targetMs - nowMs;
  if (diff <= 0) return '';
  return formatDuration(diff / 60000);
}

/** Hex (#rrggbb) → rgba() string with the given alpha. */
export function hexToRgba(hex, alpha) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

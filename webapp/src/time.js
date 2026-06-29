/** Small formatting helpers for the UI. */

import { snapToHour } from "@core/index.js";

// We format dates from the legacy Date getters (getHours/getDay/…) rather than
// toLocale*()/Intl. Both honor the same local timezone on a healthy browser, but
// on Navico MFDs (Chromium 69) the two disagree: the OS exposes only a UTC
// offset, which the legacy getters pick up correctly, while ICU/Intl has no real
// IANA zone and falls back to Europe/London — so toLocale*() renders the wrong
// time. Going through the getters keeps us on the offset that's actually right.
const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const pad2 = (n) => String(n).padStart(2, "0");

/** "14:00" in the viewer's local timezone (the boat's clock). */
export function formatClock(epochMs) {
  const d = new Date(epochMs);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * Label for a whole-hour start-time option, read relative to `now`: the clock
 * time (prefixed with a weekday when it falls on another day, since the picker
 * spans ±12h across midnight) plus a compact offset in parentheses — "(now)",
 * "(+3h)", "(−2h)".
 */
export function formatHourOption(epochMs, nowMs) {
  const d = new Date(epochMs);
  const sameDay = d.toDateString() === new Date(nowMs).toDateString();
  const time = sameDay ? formatClock(epochMs) : `${WEEKDAYS_SHORT[d.getDay()]} ${formatClock(epochMs)}`;
  const diffH = Math.round((epochMs - snapToHour(nowMs, "nearest")) / 3_600_000);
  const rel = diffH === 0 ? "now" : diffH > 0 ? `+${diffH}h` : `−${-diffH}h`;
  return `${time} (${rel})`;
}

/** "Mon, Jun 29, 14:00" — full date and clock, for a watch that may span multiple days. */
export function formatDateTime(epochMs) {
  const d = new Date(epochMs);
  return `${WEEKDAYS_SHORT[d.getDay()]}, ${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}, ${formatClock(epochMs)}`;
}

/** "Monday\n14:00" — weekday on its own line above the clock, for shifts crossing day boundaries. */
export function formatClockDay(epochMs) {
  const d = new Date(epochMs);
  return `${WEEKDAYS_LONG[d.getDay()]}\n${formatClock(epochMs)}`;
}

/** "4h", "3h 30m", "45m" from a minute count. */
export function formatDuration(minutes) {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h && m)
    return `${h}h ${m}m`;
  if (h)
    return `${h}h`;
  return `${m}m`;
}

/** Gap until a future target, as "2h 15m". Empty if the target is now or past. */
export function untilLabel(targetMs, nowMs) {
  const diff = targetMs - nowMs;
  if (diff <= 0)
    return "";
  return formatDuration(diff / 60000);
}

/** Time elapsed since a past target, as "2h 15m". Empty if the target is now or future. */
export function agoLabel(targetMs, nowMs) {
  const diff = nowMs - targetMs;
  if (diff <= 0)
    return "";
  return formatDuration(diff / 60000);
}

/** Hex (#rrggbb) → rgba() string with the given alpha. */
export function hexToRgba(hex, alpha) {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

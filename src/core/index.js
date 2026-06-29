/**
 * Public API of the shared core module — the single source of truth for watch
 * schedule data and math, imported unchanged by both the server plugin and the
 * webapp.
 */

export { PALETTE, getTeamColor } from './colors.js';
export { snapToHour, snapToDay, validateSystem, getCurrentSegment, resolveSchedule } from './schedule.js';
export { BUILTIN_SYSTEMS, getSystemById, availableSystems } from './systems.js';

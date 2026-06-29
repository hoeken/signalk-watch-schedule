/**
 * Core schedule math — pure functions, no dependencies, no side effects.
 *
 * This module is the single source of truth for turning a time-agnostic
 * {@link WatchSystem} plus an absolute `startedAt` into concrete shifts. The
 * server publishes its output under watch.* and the webapp renders the same
 * output, so they cannot disagree.
 *
 * @typedef {import('./types.js').WatchSystem} WatchSystem
 * @typedef {import('./types.js').WatchTeam} WatchTeam
 * @typedef {import('./types.js').ResolvedShift} ResolvedShift
 */

import { getTeamColor } from './colors.js';

const MS_PER_MIN = 60_000;
const MS_PER_HOUR = 3_600_000;

/**
 * Snap an epoch-ms timestamp to a whole clock hour in local time. A watch is
 * always started on a whole-number hour so segment boundaries land on clean
 * clock times.
 * @param {number} epochMs
 * @param {'nearest'|'up'|'down'} [mode='nearest']
 * @returns {number} epoch ms at a whole local hour
 */
export function snapToHour(epochMs, mode = 'nearest') {
  const d = new Date(epochMs);
  const subHourMin = d.getMinutes() + d.getSeconds() / 60 + d.getMilliseconds() / 60000;
  d.setMinutes(0, 0, 0);
  const floor = d.getTime();
  if (subHourMin === 0) return floor;
  const ceil = floor + MS_PER_HOUR;
  if (mode === 'down') return floor;
  if (mode === 'up') return ceil;
  return subHourMin >= 30 ? ceil : floor; // nearest
}

/**
 * Snap an epoch-ms timestamp down to the most recent local midnight. Used as the
 * cycle anchor for clock-anchored systems, so segment offset 0 lands at 00:00.
 * @param {number} epochMs
 * @returns {number} epoch ms at local midnight on or before epochMs
 */
export function snapToDay(epochMs) {
  const d = new Date(epochMs);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * The cycle anchor for a system — the absolute time at which segment offset 0
 * sits. Anchored systems align to local midnight so their boundaries fall on
 * fixed clock hours; rotating systems simply repeat from `startedAt`.
 * @param {WatchSystem} system
 * @param {number} startedAt epoch ms (already snapped to the hour)
 * @returns {number} epoch ms
 */
function cycleAnchor(system, startedAt) {
  return system.anchored ? snapToDay(startedAt) : startedAt;
}

/**
 * Validate that a system's segments are contiguous, cover the whole cycle, and
 * reference valid teams.
 * @param {WatchSystem} system
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateSystem(system) {
  const errors = [];
  if (!system || typeof system !== 'object') {
    return { valid: false, errors: ['system is not an object'] };
  }
  if (typeof system.id !== 'string' || !system.id) errors.push('missing id');
  if (typeof system.teamCount !== 'number' || system.teamCount < 1) errors.push('teamCount must be >= 1');
  if (typeof system.cycleDuration !== 'number' || system.cycleDuration <= 0) errors.push('cycleDuration must be > 0');
  if (system.anchored !== undefined && typeof system.anchored !== 'boolean') errors.push('anchored must be a boolean');
  if (!Array.isArray(system.segments) || system.segments.length === 0) {
    errors.push('segments must be a non-empty array');
    return { valid: false, errors };
  }

  const sorted = [...system.segments].sort((a, b) => a.offset - b.offset);
  let cursor = 0;
  for (const seg of sorted) {
    if (seg.offset !== cursor) {
      errors.push(`segment at offset ${seg.offset} leaves a gap/overlap (expected ${cursor})`);
    }
    if (typeof seg.duration !== 'number' || seg.duration <= 0) {
      errors.push(`segment at offset ${seg.offset} has non-positive duration`);
    }
    if (seg.teamIndex < 0 || seg.teamIndex >= system.teamCount) {
      errors.push(`segment at offset ${seg.offset} references teamIndex ${seg.teamIndex} (teamCount ${system.teamCount})`);
    }
    cursor += seg.duration;
  }
  if (cursor !== system.cycleDuration) {
    errors.push(`segments sum to ${cursor} min but cycleDuration is ${system.cycleDuration}`);
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Identify the segment on duty at `now`.
 * @param {WatchSystem} system
 * @param {number} startedAt epoch ms
 * @param {number} now epoch ms
 * @returns {{ segment: import('./types.js').WatchSegment, cycleIndex: number } | null}
 *   null if not started or `now` is before `startedAt`.
 */
export function getCurrentSegment(system, startedAt, now) {
  if (!startedAt || now < startedAt) return null;
  const anchor = cycleAnchor(system, startedAt);
  const cycleMs = system.cycleDuration * MS_PER_MIN;
  const elapsed = now - anchor;
  const cycleIndex = Math.floor(elapsed / cycleMs);
  const posMin = (elapsed - cycleIndex * cycleMs) / MS_PER_MIN;
  for (const segment of system.segments) {
    if (posMin >= segment.offset && posMin < segment.offset + segment.duration) {
      return { segment, cycleIndex };
    }
  }
  return null;
}

/**
 * Resolve an ordered list of upcoming concrete shifts, starting with the one
 * active at `now` (or the first upcoming shift if `now` is before `startedAt`).
 *
 * @param {WatchSystem} system
 * @param {WatchTeam[]} teams
 * @param {number} startedAt epoch ms (already snapped to the hour)
 * @param {number} now epoch ms
 * @param {{ count?: number }} [opts]
 * @returns {ResolvedShift[]}
 */
export function resolveSchedule(system, teams, startedAt, now, opts = {}) {
  const count = opts.count ?? 8;
  if (!system || !Array.isArray(system.segments) || system.segments.length === 0) return [];

  const anchor = cycleAnchor(system, startedAt);
  const cycleMs = system.cycleDuration * MS_PER_MIN;
  const segs = [...system.segments].sort((a, b) => a.offset - b.offset);

  // Locate the starting segment: the one containing `now`, else the first.
  const elapsed = Math.max(0, now - anchor);
  let cycleIndex = Math.floor(elapsed / cycleMs);
  const posMin = (elapsed - cycleIndex * cycleMs) / MS_PER_MIN;
  let segIdx = segs.findIndex((s) => posMin >= s.offset && posMin < s.offset + s.duration);
  if (segIdx === -1) segIdx = 0;

  const shifts = [];
  let ci = cycleIndex;
  let si = segIdx;
  for (let n = 0; n < count; n++) {
    const seg = segs[si];
    const startTime = anchor + ci * cycleMs + seg.offset * MS_PER_MIN;
    const endTime = startTime + seg.duration * MS_PER_MIN;
    const team = teams[seg.teamIndex];
    shifts.push({
      teamIndex: seg.teamIndex,
      teamId: team?.id ?? `team${seg.teamIndex + 1}`,
      teamName: team?.name ?? `Team ${seg.teamIndex + 1}`,
      crew: team?.crew ?? [],
      startTime,
      endTime,
      durationMin: seg.duration,
      color: getTeamColor(seg.teamIndex),
      label: seg.label,
      isCurrent: now >= startTime && now < endTime,
      cycleIndex: ci,
    });
    si += 1;
    if (si >= segs.length) {
      si = 0;
      ci += 1;
    }
  }
  return shifts;
}

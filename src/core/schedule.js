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

import { getTeamColor } from "./colors.js";

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
export function snapToHour(epochMs, mode = "nearest") {
  const d = new Date(epochMs);
  const subHourMin = d.getMinutes() + d.getSeconds() / 60 + d.getMilliseconds() / 60000;
  d.setMinutes(0, 0, 0);
  const floor = d.getTime();
  if (subHourMin === 0)
    return floor;
  const ceil = floor + MS_PER_HOUR;
  if (mode === "down")
    return floor;
  if (mode === "up")
    return ceil;
  return subHourMin >= 30 ? ceil : floor; // nearest
}

/**
 * True if `order` is a permutation of the integers [0, n): exactly the indices
 * 0..n-1, each appearing once. Used to validate a requested team ordering before
 * it is stored or applied.
 * @param {unknown} order
 * @param {number} n
 * @returns {boolean}
 */
export function isTeamOrder(order, n) {
  if (!Array.isArray(order) || order.length !== n)
    return false;
  const seen = new Set();
  for (const i of order) {
    if (!Number.isInteger(i) || i < 0 || i >= n || seen.has(i))
      return false;
    seen.add(i);
  }
  return true;
}

/**
 * Reorder a team list by a permutation of its indices, so the team listed first
 * in `order` becomes teamIndex 0 — i.e. the first on watch. Returns `teams`
 * unchanged when `order` is missing or not a valid permutation of its indices,
 * so a stale/garbage order can never drop or duplicate a team.
 * @param {WatchTeam[]} teams
 * @param {number[]|null|undefined} order
 * @returns {WatchTeam[]}
 */
export function orderTeams(teams, order) {
  if (!Array.isArray(teams) || !isTeamOrder(order, teams.length))
    return teams;
  return order.map((i) => teams[i]);
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
 * The amount by which a system's stored team assignment must be rotated so the
 * team on duty at `startedAt` becomes the first team in the ordered list.
 *
 * Anchored systems align their boundaries to local midnight, so the segment a
 * chosen start time lands in carries whatever team the rotation pattern placed
 * there relative to midnight — not necessarily the first crew member listed.
 * This returns that segment's stored teamIndex; subtracting it (mod teamCount)
 * from every segment re-bases the rotation so the chosen start gets team 0,
 * while the clock-aligned boundaries and the fair rotation are both preserved.
 *
 * Rotating systems already begin their cycle at `startedAt` (offset 0 → team 0),
 * so the shift is 0 for them.
 * @param {WatchSystem} system
 * @param {number} startedAt epoch ms
 * @returns {number} stored teamIndex to treat as the first on watch
 */
function teamShift(system, startedAt) {
  const cycleMs = system.cycleDuration * MS_PER_MIN;
  const elapsed = Math.max(0, startedAt - cycleAnchor(system, startedAt));
  const posMin = (elapsed % cycleMs) / MS_PER_MIN;
  const seg = system.segments.find(
    (s) => posMin >= s.offset && posMin < s.offset + s.duration,
  );
  return seg ? seg.teamIndex : 0;
}

/**
 * Validate that a system's segments are contiguous, cover the whole cycle, and
 * reference valid teams.
 * @param {WatchSystem} system
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateSystem(system) {
  const errors = [];
  if (!system || typeof system !== "object") {
    return { valid: false, errors: ["system is not an object"] };
  }
  if (typeof system.id !== "string" || !system.id)
    errors.push("missing id");
  if (typeof system.teamCount !== "number" || system.teamCount < 1)
    errors.push("teamCount must be >= 1");
  if (typeof system.cycleDuration !== "number" || system.cycleDuration <= 0)
    errors.push("cycleDuration must be > 0");
  if (system.anchored !== undefined && typeof system.anchored !== "boolean")
    errors.push("anchored must be a boolean");
  if (!Array.isArray(system.segments) || system.segments.length === 0) {
    errors.push("segments must be a non-empty array");
    return { valid: false, errors };
  }

  const sorted = [...system.segments].sort((a, b) => a.offset - b.offset);
  let cursor = 0;
  for (const seg of sorted) {
    if (seg.offset !== cursor) {
      errors.push(`segment at offset ${seg.offset} leaves a gap/overlap (expected ${cursor})`);
    }
    if (typeof seg.duration !== "number" || seg.duration <= 0) {
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
  if (!startedAt || now < startedAt)
    return null;
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
 * The rotation is re-based so the first team in `teams` is on watch for the
 * segment containing `startedAt`: anchored systems keep their clock-aligned
 * boundaries but no longer let midnight decide who leads off, and rotating
 * systems are unaffected (their cycle already begins at `startedAt`).
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
  if (!system || !Array.isArray(system.segments) || system.segments.length === 0)
    return [];

  const anchor = cycleAnchor(system, startedAt);
  const cycleMs = system.cycleDuration * MS_PER_MIN;
  const segs = [...system.segments].sort((a, b) => a.offset - b.offset);

  // Re-base the rotation so the team on duty at `startedAt` is first in the
  // ordered list — for anchored systems the chosen start time, not midnight,
  // decides who leads off. teamCount is the modulus for the rotation.
  const shift = teamShift(system, startedAt);
  const teamCount = system.teamCount;

  // Locate the starting segment, never earlier than `startedAt`: a watch
  // scheduled to begin in the future shows its first shift, not the segments
  // that precede it. (Anchored systems read offsets from midnight, so without
  // this clamp `now` would point at a pre-start segment; for a live or
  // back-dated start `now` is already ≥ startedAt, so this is a no-op.)
  const locateAt = Math.max(now, startedAt);
  const elapsed = Math.max(0, locateAt - anchor);
  let cycleIndex = Math.floor(elapsed / cycleMs);
  const posMin = (elapsed - cycleIndex * cycleMs) / MS_PER_MIN;
  let segIdx = segs.findIndex((s) => posMin >= s.offset && posMin < s.offset + s.duration);
  if (segIdx === -1)
    segIdx = 0;

  const shifts = [];
  let ci = cycleIndex;
  let si = segIdx;
  for (let n = 0; n < count; n++) {
    const seg = segs[si];
    const teamIndex = (((seg.teamIndex - shift) % teamCount) + teamCount) % teamCount;
    const startTime = anchor + ci * cycleMs + seg.offset * MS_PER_MIN;
    const endTime = startTime + seg.duration * MS_PER_MIN;
    const team = teams[teamIndex];
    shifts.push({
      teamIndex,
      teamId: `team${teamIndex + 1}`,
      teamName: team?.name ?? `Team ${teamIndex + 1}`,
      startTime,
      endTime,
      durationMin: seg.duration,
      color: getTeamColor(teamIndex),
      label: seg.label,
      // Nothing is on duty until the watch has actually begun. For anchored
      // systems the first shift can open on a clock boundary that precedes
      // `startedAt`, so gate on `startedAt` too — otherwise that pre-start
      // sliver would read as current (and the server would publish it).
      isCurrent: now >= startedAt && now >= startTime && now < endTime,
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

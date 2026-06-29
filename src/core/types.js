/**
 * Shared data contracts for signalk-watch-schedule.
 *
 * This file holds only JSDoc typedefs — it emits no runtime code. Both the Node
 * server plugin and the browser webapp import the sibling modules in this folder,
 * so these types describe the single source of truth for schedule data.
 *
 * All schedule definitions are TIME-AGNOSTIC: segments are expressed purely as
 * minute offsets and durations from the start of a rotation cycle. Absolute clock
 * times only ever exist in a {@link ResolvedShift}, computed at runtime.
 */

/**
 * A watch TEAM — a named group of crew. Teams are ordered; rotations reference
 * them by 0-based index (their position in the array is their stable key), so a
 * rotation preset is reusable for any crew.
 * @typedef {Object} WatchTeam
 * @property {string} name    Display name, e.g. "Port Watch".
 * @property {string[]} crew  Crew member names assigned to this team.
 */

/**
 * One segment of a rotation cycle. Time-agnostic: minutes only.
 * @typedef {Object} WatchSegment
 * @property {number} offset    Minutes from the start of the cycle this segment begins.
 * @property {number} duration  Length of this segment in minutes (> 0).
 * @property {number} teamIndex Which team is on duty (0-based, < WatchSystem.teamCount).
 * @property {string} [label]   Optional nominal label, e.g. "First Dog Watch".
 */

/**
 * A WATCH SYSTEM — a complete repeating rotation definition.
 * Segments must be contiguous and exactly cover [0, cycleDuration).
 *
 * `anchored` decides how segment offsets are interpreted when resolved:
 *   - falsy (a simple ROTATING cycle): offset 0 is the moment the watch is
 *     started. The rotation simply repeats from `startedAt`; clock times fall
 *     wherever the start lands.
 *   - true (ANCHORED to the clock): offset 0 is local midnight, so segment
 *     boundaries always land on the same clock hours no matter when the watch
 *     is started. Use for traditional named systems (Middle, Morning, …).
 *
 * @typedef {Object} WatchSystem
 * @property {string} id            Stable key, e.g. "rn-dog-watches".
 * @property {string} name          Display name.
 * @property {string} description   Human description for the picker.
 * @property {number} teamCount     Number of teams this rotation requires.
 * @property {number} cycleDuration Total minutes in one full cycle (segments sum to this).
 * @property {boolean} [anchored]   True to anchor offset 0 to local midnight (clock-aligned).
 * @property {boolean} [builtin]    True for shipped presets.
 * @property {WatchSegment[]} segments  Ordered, contiguous segments.
 */

/**
 * A concrete, resolved shift with absolute times. Produced at runtime by
 * resolveSchedule(); never persisted.
 * @typedef {Object} ResolvedShift
 * @property {number} teamIndex
 * @property {string} teamId       Derived from position, e.g. "team1" for teamIndex 0.
 * @property {string} teamName
 * @property {string[]} crew
 * @property {number} startTime    Epoch ms.
 * @property {number} endTime      Epoch ms.
 * @property {number} durationMin
 * @property {string} color        Hex color for the team.
 * @property {string} [label]
 * @property {boolean} isCurrent    True if this shift contains `now`.
 * @property {number} cycleIndex    Which rotation cycle (0, 1, 2, …) this shift is in.
 */

export {};

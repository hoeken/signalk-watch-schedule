/**
 * Built-in watch-system presets. Segments are always stored in minutes only; a
 * system's `anchored` flag decides whether those offsets are read from the watch
 * start (a simple rotating cycle) or from local midnight (clock-anchored, so the
 * watches land on fixed clock hours). All pass validateSystem().
 *
 * @typedef {import('./types.js').WatchSystem} WatchSystem
 * @typedef {import('./types.js').WatchSegment} WatchSegment
 */

/**
 * Build segments for a rotation whose per-day slot template stays the same but
 * whose team assignment shifts by one team each day, so over `days` days every
 * team cycles through every slot. The number of slots per day need not divide
 * the team count for this to rotate fairly.
 *
 * @param {{ duration: number, label?: string }[]} slots  Daily slot template.
 * @param {number} teamCount
 * @param {number} days  Days until the rotation repeats (cycle = days × 24h worth of slots).
 * @returns {WatchSegment[]}
 */
function buildRotatingDaily(slots, teamCount, days) {
  const segments = [];
  let offset = 0;
  for (let d = 0; d < days; d += 1) {
    slots.forEach((slot, i) => {
      segments.push({
        offset,
        duration: slot.duration,
        teamIndex: (i + d) % teamCount,
        ...(slot.label ? { label: slot.label } : {}),
      });
      offset += slot.duration;
    });
  }
  return segments;
}

const H = 60; // minutes per hour, for readability below

/**
 * A simple rotating watch: `teamCount` teams each stand an equal
 * `watchHours`-hour watch in turn, so every team is `watchHours` hours on then
 * `(teamCount - 1) × watchHours` hours off. Not clock-anchored — the cycle just
 * repeats from whenever the watch is started.
 *
 * The id encodes on/off hours (`fixed-4-4`, `fixed-4-8`, …); since
 * off = (teamCount − 1) × on, the pair uniquely identifies the system, so ids
 * never collide across team counts and the long-standing two-team ids stay valid.
 *
 * @param {number} teamCount
 * @param {number} watchHours length of each watch in hours
 * @returns {WatchSystem}
 */
function fixedRotation(teamCount, watchHours) {
  const duration = watchHours * H;
  const offHours = (teamCount - 1) * watchHours;
  return {
    id: `fixed-${watchHours}-${offHours}`,
    name: `${watchHours}-on / ${offHours}-off`,
    description: `${teamCount} teams take turns standing equal ${watchHours}-hour watches: ${watchHours}h on, ${offHours}h off.`,
    teamCount,
    cycleDuration: teamCount * duration,
    anchored: false,
    builtin: true,
    segments: Array.from({ length: teamCount }, (_, i) => ({
      offset: i * duration,
      duration,
      teamIndex: i,
    })),
  };
}

/** Team sizes we ship simple rotations for, and the watch lengths offered. */
const TEAM_COUNTS = [2, 3, 4, 5];
const WATCH_HOURS = [4, 3, 2];

/**
 * Royal Navy day: four 4-hour watches, two 2-hour dog watches, then a 4-hour
 * watch. Seven watches/day (an odd count) means alternating teams land on
 * opposite watches the next day — the whole point of dog watches. Repeats over
 * two days. This system is clock-ANCHORED (offset 0 = midnight), so the labels
 * line up with their traditional hours: Middle 00:00, Morning 04:00, Forenoon
 * 08:00, Afternoon 12:00, First Dog 16:00, Last Dog 18:00, First 20:00.
 */
const RN_DAY = [
  { duration: 4 * H, label: "Middle" },
  { duration: 4 * H, label: "Morning" },
  { duration: 4 * H, label: "Forenoon" },
  { duration: 4 * H, label: "Afternoon" },
  { duration: 2 * H, label: "First Dog" },
  { duration: 2 * H, label: "Last Dog" },
  { duration: 4 * H, label: "First" },
];

/** @type {WatchSystem[]} */
export const BUILTIN_SYSTEMS = [
  // Classic short-handed two-team schedule, kept alongside the generated family.
  fixedRotation(2, 6),
  // Simple rotations for 2–5 teams at 4h / 3h / 2h watch lengths.
  ...TEAM_COUNTS.flatMap((teamCount) => WATCH_HOURS.map((hours) => fixedRotation(teamCount, hours))),
  {
    id: "rn-dog-watches",
    name: "Royal Navy (Dog Watches)",
    description: "Classic four-hour watches with two short evening dog watches so the rotation shifts daily between two teams. Anchored to the clock (Middle starts at midnight).",
    teamCount: 2,
    cycleDuration: 2 * 24 * H,
    anchored: true,
    builtin: true,
    segments: buildRotatingDaily(RN_DAY, 2, 2),
  },
];

/**
 * Look up a system by id from a list (defaults to built-ins).
 * @param {string} id
 * @param {WatchSystem[]} [systems]
 * @returns {WatchSystem | undefined}
 */
export function getSystemById(id, systems = BUILTIN_SYSTEMS) {
  return systems.find((s) => s.id === id);
}

/**
 * Built-in systems available for a crew of the given size, filtered to those that
 * need exactly the number of configured teams. A rotation with fewer teams would
 * leave some teams without a watch and one with more can't be staffed, so only an
 * exact match is offered.
 * @param {number} teamCount
 * @returns {WatchSystem[]}
 */
export function availableSystems(teamCount) {
  return BUILTIN_SYSTEMS.filter((s) => s.teamCount === teamCount);
}

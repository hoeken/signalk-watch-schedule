/**
 * Built-in watch-system presets. All are time-agnostic (minutes only) and pass
 * validateSystem(). Captains may add custom systems via plugin config; they use
 * the same {@link WatchSystem} schema and are merged with these.
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
 * Royal Navy day: four 4-hour watches, two 2-hour dog watches, then a 4-hour
 * watch. Seven watches/day (an odd count) means alternating teams land on
 * opposite watches the next day — the whole point of dog watches. Repeats over
 * two days. Labels are nominal (relative to start, which is snapped to a whole
 * hour) since the system is time-agnostic.
 */
const RN_DAY = [
  { duration: 4 * H, label: 'Middle' },
  { duration: 4 * H, label: 'Morning' },
  { duration: 4 * H, label: 'Forenoon' },
  { duration: 4 * H, label: 'Afternoon' },
  { duration: 2 * H, label: 'First Dog' },
  { duration: 2 * H, label: 'Last Dog' },
  { duration: 4 * H, label: 'First' },
];

/**
 * Swedish/Scandinavian day: variable-length watches, shorter through the night.
 * Six watches/day rotated across three teams over a three-day cycle so each
 * team rotates through every slot — nobody is permanently stuck on the worst
 * night watch.
 */
const SWEDISH_DAY = [
  { duration: 5 * H, label: 'Forenoon' },
  { duration: 5 * H, label: 'Afternoon' },
  { duration: 4 * H, label: 'Evening' },
  { duration: 3 * H, label: 'First Night' },
  { duration: 3 * H, label: 'Middle Night' },
  { duration: 4 * H, label: 'Dawn' },
];

/** @type {WatchSystem[]} */
export const BUILTIN_SYSTEMS = [
  {
    id: 'fixed-4-4',
    name: '4-on / 4-off',
    description: 'Two teams alternate equal four-hour watches.',
    teamCount: 2,
    cycleDuration: 8 * H,
    builtin: true,
    segments: [
      { offset: 0, duration: 4 * H, teamIndex: 0 },
      { offset: 4 * H, duration: 4 * H, teamIndex: 1 },
    ],
  },
  {
    id: 'fixed-3-3',
    name: '3-on / 3-off',
    description: 'Two teams alternate equal three-hour watches — shorter blocks, gentler sleep swing.',
    teamCount: 2,
    cycleDuration: 6 * H,
    builtin: true,
    segments: [
      { offset: 0, duration: 3 * H, teamIndex: 0 },
      { offset: 3 * H, duration: 3 * H, teamIndex: 1 },
    ],
  },
  {
    id: 'fixed-6-6',
    name: '6-on / 6-off',
    description: 'Two teams alternate equal six-hour watches — two watches a day.',
    teamCount: 2,
    cycleDuration: 12 * H,
    builtin: true,
    segments: [
      { offset: 0, duration: 6 * H, teamIndex: 0 },
      { offset: 6 * H, duration: 6 * H, teamIndex: 1 },
    ],
  },
  {
    id: 'rn-dog-watches',
    name: 'Royal Navy (Dog Watches)',
    description: 'Classic four-hour watches with two short evening dog watches so the rotation shifts daily between two teams.',
    teamCount: 2,
    cycleDuration: 2 * 24 * H,
    builtin: true,
    segments: buildRotatingDaily(RN_DAY, 2, 2),
  },
  {
    id: 'swedish-5',
    name: 'Swedish / Scandinavian',
    description: 'Variable-length watches, shorter at night, rotated across three teams over three days so the night watch is shared fairly.',
    teamCount: 3,
    cycleDuration: 3 * 24 * H,
    builtin: true,
    segments: buildRotatingDaily(SWEDISH_DAY, 3, 3),
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
 * All systems available for a crew of the given size: built-ins plus custom,
 * filtered to those whose teamCount fits the number of configured teams.
 * @param {number} teamCount
 * @param {WatchSystem[]} [customSystems]
 * @returns {WatchSystem[]}
 */
export function availableSystems(teamCount, customSystems = []) {
  return [...BUILTIN_SYSTEMS, ...customSystems].filter((s) => s.teamCount <= teamCount);
}

/**
 * Resolves the effective watch teams from three sources, in priority order:
 *
 *   1. the plugin's configured `teams` (when non-empty)
 *   2. SignalK's `communication.crewNames` (when present)
 *   3. a generic ["Team 1", "Team 2", "Team 3"] fallback
 *
 * Keeping this in one place means the publisher, the REST API and the
 * start/stop logic all agree on who is standing watch.
 */

/** Last-resort teams when nothing is configured and no crew is published. */
const DEFAULT_TEAMS = [{ name: "Team 1" }, { name: "Team 2" }, { name: "Team 3" }];

/**
 * Read communication.crewNames for self, tolerating both a bare value and a
 * `{ value }` wrapper, and servers that don't expose getSelfPath.
 * @param {object} app SignalK app handle
 * @returns {string[]} trimmed, non-empty crew names (possibly empty)
 */
function readCrewNames(app) {
  if (!app || typeof app.getSelfPath !== "function")
    return [];
  let raw;
  try {
    raw = app.getSelfPath("communication.crewNames");
  } catch {
    return [];
  }
  // getSelfPath may hand back the stored data node ({ value, timestamp, … }) or
  // the bare value, depending on how the path was set — accept either.
  const value = raw && typeof raw === "object" && !Array.isArray(raw) ? raw.value : raw;
  if (!Array.isArray(value))
    return [];
  return value.filter((n) => typeof n === "string" && n.trim() !== "").map((n) => n.trim());
}

/**
 * Validate a client-supplied team list (the web UI's per-watch teams override).
 * Returns a cleaned copy ([{ name }] with trimmed names) or null when the input
 * is not a non-empty array of teams with non-empty string names — callers fall
 * back to the configured defaults, so a bad override can never break /start.
 * @param {unknown} teams
 * @returns {import('../core/types.js').WatchTeam[]|null}
 */
export function sanitizeTeams(teams) {
  if (!Array.isArray(teams) || teams.length === 0)
    return null;
  const cleaned = [];
  for (const team of teams) {
    const name = team && typeof team.name === "string" ? team.name.trim() : "";
    if (name === "")
      return null;
    cleaned.push({ name });
  }
  return cleaned;
}

/**
 * The default teams to schedule, applying the config → crewNames → default
 * fallback. A running watch may carry its own per-watch override (see
 * startWatch); this is the list used when it doesn't.
 * @param {object} app SignalK app handle (used to read communication.crewNames)
 * @param {object} options plugin config
 * @returns {import('../core/types.js').WatchTeam[]}
 */
export function resolveTeams(app, options) {
  const configured = options && options.teams;
  if (Array.isArray(configured) && configured.length > 0)
    return configured;

  const crew = readCrewNames(app);
  if (crew.length > 0)
    return crew.map((name) => ({ name }));

  return DEFAULT_TEAMS;
}

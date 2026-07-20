/**
 * Custom watch systems from the plugin config.
 *
 * The config carries each custom system as { id, name, description, config }
 * where `config` is a JSON string holding the schedule definition itself
 * (teamCount, cycleDuration, anchored, segments) — the same shape as a
 * built-in WatchSystem, documented in the README. Parsing and validation live
 * here so every consumer (schema, API, publisher, watch control) sees the same
 * cleaned list, and a broken entry can never take the plugin down: it is
 * skipped and reported, and the built-ins keep working.
 *
 * @typedef {import('../core/types.js').WatchSystem} WatchSystem
 */

import { BUILTIN_SYSTEMS, validateSystem } from "../core/index.js";

// The web UI's team editor supports at most this many teams, so a system
// needing more could never be staffed or selected there — reject it outright
// rather than let it dangle unreachable in the pickers.
const MAX_TEAM_COUNT = 5;

/**
 * Parse and validate the configured custom systems.
 *
 * Invalid entries are skipped, each contributing a human-readable message to
 * `errors` (surfaced once at plugin start). Ids must be unique across the
 * built-ins and the other custom systems, so a custom system can never shadow
 * a built-in rotation a persisted watch may reference.
 *
 * @param {unknown} entries options.customSystems
 * @returns {{ systems: WatchSystem[], errors: string[] }}
 */
export function parseCustomSystems(entries) {
  const systems = [];
  const errors = [];
  if (!Array.isArray(entries))
    return { systems, errors };

  const takenIds = new Set(BUILTIN_SYSTEMS.map((s) => s.id));
  entries.forEach((entry, i) => {
    const label = (id) => `custom system ${i + 1}${id ? ` ("${id}")` : ""}`;
    if (!entry || typeof entry !== "object") {
      errors.push(`${label()}: not an object`);
      return;
    }
    const id = typeof entry.id === "string" ? entry.id.trim() : "";
    const name = typeof entry.name === "string" ? entry.name.trim() : "";
    if (!id || !name) {
      errors.push(`${label(id)}: id and name are required`);
      return;
    }
    if (takenIds.has(id)) {
      errors.push(`${label(id)}: id already used by another system`);
      return;
    }

    let config;
    try {
      config = JSON.parse(entry.config);
    } catch (err) {
      errors.push(`${label(id)}: config is not valid JSON — ${err.message}`);
      return;
    }
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      errors.push(`${label(id)}: config must be a JSON object`);
      return;
    }

    // The entry's own fields win over anything the JSON happens to carry, so
    // the id shown in the config UI is always the id the system runs under.
    const system = {
      ...config,
      id,
      name,
      description: typeof entry.description === "string" ? entry.description.trim() : "",
      builtin: false,
    };
    const { valid, errors: systemErrors } = validateSystem(system);
    if (!valid) {
      errors.push(`${label(id)}: ${systemErrors.join("; ")}`);
      return;
    }
    if (system.teamCount > MAX_TEAM_COUNT) {
      errors.push(`${label(id)}: teamCount ${system.teamCount} exceeds the ${MAX_TEAM_COUNT}-team maximum`);
      return;
    }
    takenIds.add(id);
    systems.push(system);
  });
  return { systems, errors };
}

/**
 * The full list of watch systems for a given plugin config: the built-ins plus
 * every valid custom system. Parse errors are dropped here — plugin start
 * reports them once via parseCustomSystems().
 * @param {object} options plugin config
 * @returns {WatchSystem[]}
 */
export function allSystems(options) {
  return [...BUILTIN_SYSTEMS, ...parseCustomSystems(options && options.customSystems).systems];
}

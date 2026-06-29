/**
 * Builds the watch.* view of the world and emits it as SignalK deltas.
 *
 * Everything the webapp needs to render is derived here from (state + config)
 * using the shared core module, so the published data and the UI's own
 * computation always agree.
 *
 * @typedef {import('./state.js').WatchState} WatchState
 */

import { resolveSchedule, getSystemById, availableSystems, orderTeams } from "../core/index.js";

/**
 * Assemble the full watch view.
 * @param {WatchState} state
 * @param {object} options plugin config
 * @param {number} now epoch ms
 */
export function buildWatchData(state, options, now) {
  const baseTeams = options.teams ?? [];
  // Apply the chosen watch order so position 0 is first on watch. Both the
  // resolved schedule and the published `watch.teams` use this order, and the
  // webapp recomputes from the same order — they cannot disagree.
  const teams = orderTeams(baseTeams, state.teamOrder);
  const systems = availableSystems(baseTeams.length);
  const system = state.systemId ? getSystemById(state.systemId, systems) ?? null : null;

  let schedule = [];
  let current = null;
  let next = null;

  if (state.onWatch && system && state.startedAt) {
    schedule = resolveSchedule(system, teams, state.startedAt, now, {
      count: options.publishHorizon ?? 8,
    });
    const idx = schedule.findIndex((s) => s.isCurrent);
    current = idx >= 0 ? schedule[idx] : null;
    next = idx >= 0 ? schedule[idx + 1] ?? null : schedule[0] ?? null;
  }

  return { state, system, teams, current, next, schedule };
}

/** Path → metadata description, emitted once so the data browser is readable. */
const META = {
  "watch.state.onWatch": "Whether the boat is currently standing watches",
  "watch.state.startedAt": "Epoch ms the current watch began (snapped to a whole hour)",
  "watch.state.systemId": "Id of the active watch rotation system",
  "watch.system": "Full definition of the active watch system",
  "watch.teams": "Configured watch teams, in rotation order",
  "watch.current": "The shift currently on duty",
  "watch.next": "The next shift coming on duty",
  "watch.schedule": "Ordered list of upcoming shifts, starting with the current one",
};

/**
 * Emit the watch view as a SignalK delta.
 * @param {object} app
 * @param {string} pluginId
 * @param {ReturnType<typeof buildWatchData>} data
 */
export function publish(app, pluginId, data) {
  const values = [
    { path: "watch.state.onWatch", value: data.state.onWatch },
    { path: "watch.state.startedAt", value: data.state.startedAt },
    { path: "watch.state.systemId", value: data.state.systemId },
    { path: "watch.system", value: data.system },
    { path: "watch.teams", value: data.teams },
    { path: "watch.current", value: data.current },
    { path: "watch.next", value: data.next },
    { path: "watch.schedule", value: data.schedule },
  ];
  app.handleMessage(pluginId, { updates: [{ values }] });
}

/**
 * Emit path metadata once (descriptions for the data browser).
 * @param {object} app
 * @param {string} pluginId
 */
export function publishMeta(app, pluginId) {
  const meta = Object.entries(META).map(([path, description]) => ({ path, value: { description } }));
  app.handleMessage(pluginId, { updates: [{ meta }] });
}

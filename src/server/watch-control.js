/**
 * Core start/stop logic, shared by the REST API and the navigation.state
 * auto-watcher so both behave identically. These operate purely on
 * (store + options); transport concerns (HTTP status, auth) stay in the caller.
 */

import { availableSystems, getSystemById, snapToHour, isTeamOrder } from "../core/index.js";
import { allSystems } from "./custom-systems.js";
import { resolveTeams, sanitizeTeams } from "./teams.js";

/**
 * Start (or restart) a watch. Resolves the watch system from the request (or
 * the configured default), snaps the start time to a whole hour, and applies a
 * requested team order when it is a valid permutation. A `teams` override (the
 * web UI's per-watch teams) replaces the configured defaults for this watch —
 * it is stored with the watch and cleared on stop. All params are optional and
 * fall back to the defaults when absent or invalid.
 *
 * @param {object} store state store from createStateStore
 * @param {object} options plugin config
 * @param {{ systemId?: string, startAt?: number, teamOrder?: number[], teams?: {name: string}[] }} [params]
 * @param {object} [app] SignalK app handle, used to fall back to communication.crewNames
 * @returns {{ ok: true, state: object } | { ok: false, error: string }}
 */
export function startWatch(store, options, params = {}, app) {
  const customTeams = sanitizeTeams(params.teams);
  const teams = customTeams ?? resolveTeams(app, options);
  const systems = availableSystems(teams.length, allSystems(options));
  const requestedId = params.systemId || options.defaultSystemId;
  const system = getSystemById(requestedId, systems);
  if (!system)
    return { ok: false, error: `unknown or unavailable watch system: ${requestedId}` };

  const baseTime = Number.isFinite(params.startAt) ? params.startAt : Date.now();
  const startedAt = snapToHour(baseTime, options.snapMode || "nearest");
  const teamOrder = isTeamOrder(params.teamOrder, teams.length) ? params.teamOrder : null;

  const state = store.set({ onWatch: true, startedAt, systemId: system.id, teamOrder, teams: customTeams });
  return { ok: true, state };
}

/**
 * Stop the watch and clear the per-watch team order and teams override, so an
 * idle plugin reads its teams from the defaults again.
 * @param {object} store
 * @returns {object} the new state
 */
export function stopWatch(store) {
  return store.set({ onWatch: false, startedAt: null, teamOrder: null, teams: null });
}

/**
 * Reconcile a persisted watch against the current config on startup.
 *
 * The crew — and therefore the team count — can change while the plugin is
 * stopped (a team added/removed, or communication.crewNames changing under the
 * crewNames fallback). An active watch whose system needs a different number of
 * teams than we now have can't be scheduled or restarted, so the schedule and
 * the start picker disagree and every /start request 400s. When that happens we
 * stop the watch to fall back to a clean idle state the operator can restart
 * from. A watch started with its own per-watch teams is self-contained — its
 * team count is checked against those teams, so config changes can't strand it.
 *
 * @param {object} store state store from createStateStore
 * @param {object} options plugin config
 * @param {object} [app] SignalK app handle, used to resolve crewNames teams
 * @returns {{ stopped: boolean, reason?: string }}
 */
export function reconcileWatch(store, options, app) {
  const state = store.get();
  if (!state.onWatch)
    return { stopped: false };

  const teams = sanitizeTeams(state.teams) ?? resolveTeams(app, options);
  const system = getSystemById(state.systemId, allSystems(options));
  if (!system) {
    stopWatch(store);
    return { stopped: true, reason: `unknown watch system "${state.systemId}"` };
  }
  if (system.teamCount !== teams.length) {
    stopWatch(store);
    return {
      stopped: true,
      reason: `system "${system.id}" needs ${system.teamCount} teams but ${teams.length} are configured`,
    };
  }
  return { stopped: false };
}

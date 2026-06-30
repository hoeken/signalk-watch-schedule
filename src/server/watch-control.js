/**
 * Core start/stop logic, shared by the REST API and the navigation.state
 * auto-watcher so both behave identically. These operate purely on
 * (store + options); transport concerns (HTTP status, auth) stay in the caller.
 */

import { availableSystems, getSystemById, snapToHour, isTeamOrder } from "../core/index.js";
import { resolveTeams } from "./teams.js";

/**
 * Start (or restart) a watch. Resolves the watch system from the request (or
 * the configured default), snaps the start time to a whole hour, and applies a
 * requested team order when it is a valid permutation.
 *
 * @param {object} store state store from createStateStore
 * @param {object} options plugin config
 * @param {{ systemId?: string, startAt?: number, teamOrder?: number[] }} [params]
 * @param {object} [app] SignalK app handle, used to fall back to communication.crewNames
 * @returns {{ ok: true, state: object } | { ok: false, error: string }}
 */
export function startWatch(store, options, params = {}, app) {
  const teams = resolveTeams(app, options);
  const systems = availableSystems(teams.length);
  const requestedId = params.systemId || options.defaultSystemId;
  const system = getSystemById(requestedId, systems);
  if (!system)
    return { ok: false, error: `unknown or unavailable watch system: ${requestedId}` };

  const baseTime = Number.isFinite(params.startAt) ? params.startAt : Date.now();
  const startedAt = snapToHour(baseTime, options.snapMode || "nearest");
  const teamOrder = isTeamOrder(params.teamOrder, teams.length) ? params.teamOrder : null;

  const state = store.set({ onWatch: true, startedAt, systemId: system.id, teamOrder });
  return { ok: true, state };
}

/**
 * Stop the watch and clear the per-watch team order.
 * @param {object} store
 * @returns {object} the new state
 */
export function stopWatch(store) {
  return store.set({ onWatch: false, startedAt: null, teamOrder: null });
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
 * from.
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

  const teams = resolveTeams(app, options);
  const system = getSystemById(state.systemId);
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

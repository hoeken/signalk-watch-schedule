/**
 * Runtime watch state with JSON-file persistence.
 *
 * Only the small, authoritative runtime flags live here — whether the boat is
 * on watch, when the watch began (snapped to the hour), which system is active,
 * and the per-watch team choices. Default team and rotation definitions live
 * in plugin config, not here.
 *
 * `teamOrder` is a permutation of the effective teams' indices (or null for the
 * natural order): the team at position 0 is first on watch. `teams` is a
 * per-watch override of the default teams (or null to use the defaults) — it
 * persists with an active watch and is cleared on stop.
 *
 * @typedef {{ onWatch: boolean, startedAt: number|null, systemId: string|null, teamOrder: number[]|null, teams: import('../core/types.js').WatchTeam[]|null }} WatchState
 */

import fs from "node:fs";
import path from "node:path";

/** @type {WatchState} */
const DEFAULT_STATE = { onWatch: false, startedAt: null, systemId: null, teamOrder: null, teams: null };

/**
 * @param {object} app SignalK app object (provides getDataDirPath + logging).
 */
export function createStateStore(app) {
  const file = path.join(app.getDataDirPath(), "state.json");

  /** @returns {WatchState} */
  function load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      return { ...DEFAULT_STATE, ...parsed };
    } catch {
      return { ...DEFAULT_STATE };
    }
  }

  let state = load();

  function save() {
    try {
      fs.writeFileSync(file, JSON.stringify(state, null, 2));
    } catch (err) {
      if (typeof app.error === "function")
        app.error(`watch-schedule: failed to persist state: ${err.message}`);
    }
  }

  return {
    /** @returns {WatchState} a copy */
    get: () => ({ ...state }),
    /**
     * Merge a patch into the state and persist it.
     * @param {Partial<WatchState>} patch
     * @returns {WatchState} the new state (a copy)
     */
    set: (patch) => {
      state = { ...state, ...patch };
      save();
      return { ...state };
    },
  };
}

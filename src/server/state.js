/**
 * Runtime watch state with JSON-file persistence.
 *
 * Only the small, authoritative runtime flags live here — whether the boat is
 * on watch, when the watch began (snapped to the hour), which system is active,
 * and the chosen team order for this watch. Team/rotation definitions live
 * in plugin config, not here.
 *
 * `teamOrder` is a permutation of the configured teams' indices (or null for the
 * natural config order): the team at position 0 is first on watch.
 *
 * @typedef {{ onWatch: boolean, startedAt: number|null, systemId: string|null, teamOrder: number[]|null }} WatchState
 */

import fs from "node:fs";
import path from "node:path";

/** @type {WatchState} */
const DEFAULT_STATE = { onWatch: false, startedAt: null, systemId: null, teamOrder: null };

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

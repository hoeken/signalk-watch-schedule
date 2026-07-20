/**
 * Automatic watch start/stop driven by SignalK's navigation.state.
 *
 * We classify each state into one of two groups we care about — "at rest"
 * (moored/anchored) and "under way" (sailing/motoring) — and act only on
 * transitions *between* those groups:
 *
 *   rest      → under way   start a watch (default system, teams, rounding)
 *   under way → rest        stop the watch
 *
 * Everything else is ignored: the first value only establishes a baseline,
 * sailing↔motoring and moored↔anchored stay within a group, and any other
 * state (aground, not-under-command, …) leaves the baseline untouched.
 */

import { startWatch, stopWatch } from "./watch-control.js";
import { syncDeadmansSwitch } from "./deadman.js";

/** navigation.state value → the group we track, or null when we don't care. */
const GROUP = {
  moored: "rest",
  anchored: "rest",
  sailing: "underway",
  motoring: "underway",
};

/** @param {unknown} state @returns {"rest"|"underway"|null} */
function groupOf(state) {
  if (typeof state !== "string")
    return null;
  return GROUP[state.trim().toLowerCase()] ?? null;
}

/**
 * Subscribe to navigation.state and auto start/stop the watch on
 * rest↔under-way transitions.
 *
 * @param {{ app: object, getOptions: () => object, getStore: () => object|null, publishNow: () => void }} ctx
 * @returns {() => void} an unsubscribe function (always safe to call)
 */
export function startAutoWatch(ctx) {
  const { app, getOptions, getStore, publishNow } = ctx;

  if (!app.streambundle || typeof app.streambundle.getSelfStream !== "function") {
    if (typeof app.error === "function")
      app.error("watch-schedule: streambundle unavailable; auto-watch disabled");
    return () => {};
  }

  // Last rest/underway group we observed. The first value sets this baseline
  // without acting, so we never auto-start merely because the boat is already
  // under way when the plugin loads.
  let lastGroup = null;

  const onState = (value) => {
    const group = groupOf(value);
    if (!group)
      return; // a state we don't track — leave the baseline as-is

    const prev = lastGroup;
    lastGroup = group;
    if (prev === null || prev === group)
      return; // baseline, or a within-group transition

    const store = getStore();
    if (!store)
      return;
    const options = getOptions() || {};

    if (group === "underway") {
      if (!options.enableAutoWatchStart)
        return;
      // Don't clobber a watch already in progress (e.g. started manually).
      if (store.get().onWatch)
        return;
      const result = startWatch(store, options, {}, app);
      if (!result.ok) {
        if (typeof app.error === "function")
          app.error(`watch-schedule: auto-start failed: ${result.error}`);
        return;
      }
      if (typeof app.debug === "function")
        app.debug(`auto-started watch (navigation.state → ${value})`);
      publishNow();
      syncDeadmansSwitch(app, options, true);
    } else {
      // group === "rest"
      if (!options.enableAutoWatchStop)
        return;
      if (!store.get().onWatch)
        return;
      stopWatch(store);
      if (typeof app.debug === "function")
        app.debug(`auto-stopped watch (navigation.state → ${value})`);
      publishNow();
      syncDeadmansSwitch(app, options, false);
    }
  };

  const unsubscribe = app.streambundle.getSelfStream("navigation.state").onValue(onState);
  return typeof unsubscribe === "function" ? unsubscribe : () => {};
}

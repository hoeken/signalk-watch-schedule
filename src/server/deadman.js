/**
 * Optional integration with the signalk-dead-mans-switch plugin.
 *
 * When enabled (options.enableDeadMansSwitch), arm the switch when a watch
 * starts and disarm it when the watch stops, through the switch plugin's
 * in-process API: signalk-dead-mans-switch (v0.6.0+) announces
 * { ack, arm, disarm, getStatus } once on start via SignalK's PropertyValues
 * mechanism (app.emitPropertyValue / app.onPropertyValues). Plugins share the
 * server process, so the methods are called directly — no HTTP and no auth.
 * (Earlier releases of this plugin POSTed to the switch's REST API instead,
 * which on a security-enabled server required an admin token obtained through
 * SignalK's access-request flow; all of that is gone.)
 *
 * Fire-and-forget, same contract as before: starting/stopping the watch never
 * fails because the switch plugin is missing, disabled, or errors — problems
 * are only logged. One improvement the in-process mechanism makes cheap:
 * plugin start order is not guaranteed, so an arm/disarm requested before the
 * switch has announced its API is remembered and delivered when the
 * announcement arrives instead of being dropped.
 *
 * Day gating (options.disableDeadMansSwitchDuringDay, on by default): during
 * daylight the crew is up and about, so check-ins are just noise. While
 * environment.mode is "day" every arm request is executed as a disarm instead
 * — the watch runs, the switch stays off — and a mode change mid-watch
 * re-syncs the switch (disarm at daybreak, arm at nightfall). The gate is
 * fail-safe: when environment.mode is unknown (not published, or streambundle
 * unavailable) the switch is armed for the whole watch as before.
 */

export const DEADMAN_PLUGIN_ID = "signalk-dead-mans-switch";

/** PropertyValues name the switch plugin announces its in-process API under. */
export const DEADMAN_API_PROPERTY = `${DEADMAN_PLUGIN_ID}-api`;

/** SignalK path carrying the day/night indicator the day gate tracks. */
export const MODE_PATH = "environment.mode";

/**
 * Normalize an environment.mode reading to "day" | "night", or null for
 * anything else. getSelfPath may hand back the stored data node
 * ({ value, timestamp, … }) or the bare value — accept either.
 * @param {unknown} raw
 * @returns {"day"|"night"|null}
 */
function normalizeMode(raw) {
  const value = raw && typeof raw === "object" ? raw.value : raw;
  if (typeof value !== "string")
    return null;
  const mode = value.trim().toLowerCase();
  return mode === "day" || mode === "night" ? mode : null;
}

/** Current environment.mode from the full model — the day gate's initial state. */
function readMode(app) {
  if (!app || typeof app.getSelfPath !== "function")
    return null;
  try {
    return normalizeMode(app.getSelfPath(MODE_PATH));
  } catch {
    return null;
  }
}

/**
 * Subscribe to the switch plugin's API announcement and expose sync/close.
 * Create only while the integration is enabled — the connection itself has no
 * enabled check (options can only change through a plugin restart anyway).
 *
 * On announcement — meaning the switch plugin just (re)started, or it was
 * already up when we subscribed (PropertyValues replays the emission history):
 *   - a sync requested while the API was missing is delivered, otherwise
 *   - a running watch (re)arms the switch, so a switch restart mid-watch, or
 *     a server restart with a persisted watch, comes back armed. Arm-only on
 *     purpose: with no watch running we never disarm on announcement, so a
 *     switch somebody armed by hand stays armed.
 * Both are subject to the day gate — with a watch running in daylight the
 * announcement syncs the switch to disarmed instead.
 *
 * @param {{ app: object, getStore: () => object|null, disableDuringDay?: boolean }} ctx
 * @returns {{ sync: (onWatch: boolean) => void, close: () => void }}
 */
export function connectDeadmansSwitch(ctx) {
  const { app, getStore, disableDuringDay = false } = ctx;
  const debug = typeof app?.debug === "function" ? app.debug : () => {};
  const error = typeof app?.error === "function" ? app.error : () => {};

  // The latest announced API object, and the last sync requested while none
  // was announced yet (a boolean watch state; delivered on announcement).
  let api = null;
  let pending = null;
  let unsubscribe = () => {};
  let unsubscribeMode = () => {};

  // Last known environment.mode ("day" | "night"), null while unknown. Only
  // tracked when day gating is on; unknown fails safe to armed.
  let mode = disableDuringDay ? readMode(app) : null;

  const call = (onWatch, why) => {
    // Day gating: while it's day, an arm request is executed as a disarm — the
    // watch keeps the switch matching the schedule, and the schedule says no
    // check-ins in daylight. Disarm requests always pass through.
    const arm = onWatch && !(disableDuringDay && mode === "day");
    if (arm !== onWatch)
      why = `${why} — switch disabled during the day`;
    const action = arm ? "arm" : "disarm";
    if (typeof api[action] !== "function") {
      error(`watch-schedule: dead man's switch ${action} failed: the announced API has no ${action}() — update ${DEADMAN_PLUGIN_ID}`);
      return;
    }
    try {
      // The reason string shows up in the switch plugin's debug log.
      api[action](`signalk-watch-schedule: ${why}`);
      debug(`dead man's switch ${action}ed (${why})`);
    } catch (e) {
      error(`watch-schedule: dead man's switch ${action} failed: ${e.message}`);
    }
  };

  if (disableDuringDay) {
    if (app?.streambundle && typeof app.streambundle.getSelfStream === "function") {
      const onMode = (value) => {
        const next = normalizeMode(value);
        // Ignore anything but a day/night *change* — the path is typically
        // republished continuously (e.g. by signalk-derived-data).
        if (next === null || next === mode)
          return;
        mode = next;
        debug(`${MODE_PATH} → ${next}`);
        // Only a running watch is managed: re-sync it to the new mode (disarm
        // at daybreak, arm at nightfall). With no watch we never touch the
        // switch, and before the API has announced the announcement handler
        // applies the then-current mode anyway.
        const store = typeof getStore === "function" ? getStore() : null;
        if (api && store && store.get().onWatch)
          call(true, `${MODE_PATH} → ${next}`);
      };
      const unsub = app.streambundle.getSelfStream(MODE_PATH).onValue(onMode);
      if (typeof unsub === "function")
        unsubscribeMode = unsub;
    } else {
      error(`watch-schedule: streambundle unavailable — cannot track ${MODE_PATH}, so the dead man's switch stays armed for the whole watch`);
    }
  }

  if (typeof app?.onPropertyValues === "function") {
    const unsub = app.onPropertyValues(DEADMAN_API_PROPERTY, (history) => {
      // The callback receives the full emission history — entries wrapped as
      // { timestamp, setter, name, value }, seeded with undefined — and the
      // switch announces once per start, so the newest value is the live API.
      const latest = (history ?? []).filter((pv) => pv && pv.value).pop();
      if (!latest || latest.value === api)
        return;
      api = latest.value;
      debug(`dead man's switch in-process API announced (${DEADMAN_API_PROPERTY})`);
      if (pending !== null) {
        const onWatch = pending;
        pending = null;
        call(onWatch, onWatch ? "watch started" : "watch stopped");
      } else {
        const store = typeof getStore === "function" ? getStore() : null;
        if (store && store.get().onWatch)
          call(true, "watch in progress");
      }
    });
    if (typeof unsub === "function")
      unsubscribe = unsub;
  } else {
    // PropertyValues has been in the server for many years — only a very old
    // server lands here.
    error("watch-schedule: this server has no app.onPropertyValues — the dead man's switch integration needs a newer SignalK server");
  }

  return {
    /** Bring the switch in line with the watch: arm on watch, disarm off watch. */
    sync(onWatch) {
      if (api) {
        call(onWatch, onWatch ? "watch started" : "watch stopped");
        return;
      }
      pending = onWatch;
      error(`watch-schedule: dead man's switch ${onWatch ? "arm" : "disarm"} is waiting: no in-process API announced — is ${DEADMAN_PLUGIN_ID} v0.6.0+ installed and enabled? (applied as soon as it announces itself)`);
    },
    close() {
      unsubscribe();
      unsubscribeMode();
      api = null;
      pending = null;
    },
  };
}

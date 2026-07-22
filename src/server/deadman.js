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
 */

export const DEADMAN_PLUGIN_ID = "signalk-dead-mans-switch";

/** PropertyValues name the switch plugin announces its in-process API under. */
export const DEADMAN_API_PROPERTY = `${DEADMAN_PLUGIN_ID}-api`;

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
 *
 * @param {{ app: object, getStore: () => object|null }} ctx
 * @returns {{ sync: (onWatch: boolean) => void, close: () => void }}
 */
export function connectDeadmansSwitch(ctx) {
  const { app, getStore } = ctx;
  const debug = typeof app?.debug === "function" ? app.debug : () => {};
  const error = typeof app?.error === "function" ? app.error : () => {};

  // The latest announced API object, and the last sync requested while none
  // was announced yet (a boolean watch state; delivered on announcement).
  let api = null;
  let pending = null;
  let unsubscribe = () => {};

  const call = (onWatch, why) => {
    const action = onWatch ? "arm" : "disarm";
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
      api = null;
      pending = null;
    },
  };
}

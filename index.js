/**
 * signalk-watch-schedule — plugin entry point.
 *
 * Holds authoritative watch state, publishes the watch.* view as SignalK
 * deltas, and exposes a small REST API for the webapp to read state and
 * start/stop the watch.
 */

import { BUILTIN_SYSTEMS } from "./src/core/index.js";
import openapi from "./src/server/openApi.json" with { type: "json" };
import { createStateStore } from "./src/server/state.js";
import { buildWatchData, publish, publishMeta } from "./src/server/publisher.js";
import { registerRoutes } from "./src/server/api.js";
import { startAutoWatch } from "./src/server/auto-watch.js";
import { reconcileWatch } from "./src/server/watch-control.js";

const PUBLISH_INTERVAL_MS = 30_000;

// SignalK paths this plugin consumes. Surfaced as read-only ✅/❌ checks at the
// top of the settings form so the operator can see at a glance whether the data
// the plugin relies on is actually present on the server.
const PATH_CHECKS = [
  {
    path: "communication.crewNames",
    description:
      "Optional - used as the default Watch Teams when the list above is empty. Publish crew via a plugin such as @meri-imperiumi/signalk-logbook.",
  },
  {
    path: "navigation.state",
    description:
      "Optional - required for Automatic watch start/stop. Detects when the boat is under way (sailing/motoring) or at rest (moored/anchored).",
  },
];

// Build the read-only pathChecks schema properties, one per PATH_CHECKS entry,
// with a ✅/❌ title reflecting whether the path currently resolves on self.
function buildPathChecks(app) {
  const props = {};
  for (const { path, description } of PATH_CHECKS) {
    const present =
      typeof app.getSelfPath === "function" && app.getSelfPath(path) != null;
    props[path] = {
      title: `${present ? "✅" : "❌"} ${path}`,
      description: present ? "" : description,
      type: "null",
      readOnly: true,
      default: null,
    };
  }
  return props;
}

export default function (app) {
  const plugin = {
    id: "signalk-watch-schedule",
    name: "Watch Schedule",
    description: "Crew watch schedule for offshore and overnight sailing.",
  };

  let options = {};
  let store = null;
  let timer = null;
  // Unsubscribe handle for the navigation.state listener (auto-watch). This tears
  // down the subscription only — the watch itself is persisted and survives stop.
  let unsubscribeAutoWatch = null;

  // Reflect the effective crew size in the plugin status. The built-in rotations
  // only cover 2–5 teams (availableSystems), so a crew outside that range can't
  // be scheduled — surface it as a plugin error, the same condition the webapp
  // shows as a banner. Driven off the published view so both a config change and
  // a runtime communication.crewNames change are caught.
  const updateStatus = (data) => {
    const count = data.teams.length;
    if (count < 2 || count > 5) {
      app.setPluginError(`Watch needs 2–5 teams — ${count} configured. Update Watch Teams in the plugin settings.`);
      return;
    }
    app.setPluginStatus(data.state.onWatch ? `On watch (${data.state.systemId})` : "Idle — no watch in progress");
  };

  const publishNow = () => {
    if (!store)
      return;
    const data = buildWatchData(store.get(), options, Date.now(), app);
    publish(app, plugin.id, data);
    updateStatus(data);
  };

  plugin.schema = () => ({
    type: "object",
    properties: {
      pathChecks: {
        title: "Path Checks",
        type: "object",
        properties: buildPathChecks(app),
      },
      teams: {
        type: "array",
        title: "Watch Teams",
        default: [],
        items: {
          type: "object",
          required: ["name"],
          properties: {
            name: { type: "string", title: "Name", description: "e.g. Crew member or Team name" },
          },
        },
      },
      defaultSystemId: {
        type: "string",
        title: "Default Watch System",
        description: "Pre-selected rotation when starting a watch.",
        enum: BUILTIN_SYSTEMS.map((s) => s.id),
        enumNames: BUILTIN_SYSTEMS.map((s) => `${s.name} — ${s.description}`),
        default: "fixed-4-4",
      },
      snapMode: {
        type: "string",
        title: "Start-time rounding",
        description: "How the watch start is snapped to a whole hour.",
        enum: ["nearest", "up", "down"],
        default: "nearest",
      },
      publishHorizon: {
        type: "number",
        title: "Shifts to publish",
        description: "How many upcoming shifts to publish and show in the UI.",
        default: 8,
        minimum: 1,
      },
      enableAutoWatchStart: {
        type: "boolean",
        title: "Automatically start a watch under way",
        description:
          "Automatically start a watch (using the default system, teams, and rounding) when the boat gets under way — navigation.state becomes sailing or motoring.",
        default: false,
      },
      enableAutoWatchStop: {
        type: "boolean",
        title: "Automatically stop the watch at rest",
        description:
          "Automatically stop the watch when the boat comes to rest — navigation.state becomes moored or anchored.",
        default: false,
      },
    },
  });

  plugin.start = (opts) => {
    options = opts || {};
    store = createStateStore(app);
    // A watch persisted from a previous run may no longer match the current
    // config (e.g. the team count changed while we were stopped). Stop such a
    // stale watch on start so the UI and /start agree on the available systems.
    const reconciled = reconcileWatch(store, options, app);
    if (reconciled.stopped && typeof app.debug === "function")
      app.debug(`stopped stale watch on start — ${reconciled.reason}`);
    publishMeta(app, plugin.id);
    publishNow();
    timer = setInterval(publishNow, PUBLISH_INTERVAL_MS);
    // The publish timer should never be the sole reason the process stays alive
    // (the SignalK server has its own keep-alive); unref so it can't wedge a
    // test runner or a shutting-down host.
    if (typeof timer.unref === "function")
      timer.unref();
    if (options.enableAutoWatchStart || options.enableAutoWatchStop)
      unsubscribeAutoWatch = startAutoWatch({ app, getOptions: () => options, getStore: () => store, publishNow });
  };

  plugin.stop = () => {
    if (timer)
      clearInterval(timer);
    timer = null;
    if (unsubscribeAutoWatch)
      unsubscribeAutoWatch();
    unsubscribeAutoWatch = null;
    store = null;
  };

  // Machine-readable API spec, served by SignalK under Documentation → OpenAPI.
  plugin.getOpenApi = () => openapi;

  plugin.registerWithRouter = (router) => {
    registerRoutes(router, {
      app,
      getOptions: () => options,
      getStore: () => store,
      publishNow,
    });
  };

  return plugin;
}

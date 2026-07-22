/**
 * signalk-watch-schedule — plugin entry point.
 *
 * Holds authoritative watch state, publishes the watch.* view as SignalK
 * deltas, and exposes a small REST API for the webapp to read state and
 * start/stop the watch.
 */

import openapi from "./src/server/openApi.json" with { type: "json" };
import { allSystems, parseCustomSystems } from "./src/server/custom-systems.js";
import { createStateStore } from "./src/server/state.js";
import { buildWatchData, publish, publishMeta } from "./src/server/publisher.js";
import { registerRoutes } from "./src/server/api.js";
import { startAutoWatch } from "./src/server/auto-watch.js";
import { reconcileWatch } from "./src/server/watch-control.js";
import { connectDeadmansSwitch } from "./src/server/deadman.js";

const PUBLISH_INTERVAL_MS = 30_000;

// SignalK paths this plugin consumes. Surfaced as read-only ✅/❌ checks at the
// top of the settings form so the operator can see at a glance whether the data
// the plugin relies on is actually present on the server.
const PATH_CHECKS = [
  {
    path: "communication.crewNames",
    description:
      "Optional - used as the Default Watch Teams when none are configured. Publish crew via a plugin such as @meri-imperiumi/signalk-logbook.",
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

// Render a sorted list of supported team counts for the status message,
// collapsing runs: [2,3,4,5] → "2–5", [2,3,4,5,7] → "2–5, 7".
function formatCounts(counts) {
  const runs = [];
  for (const n of counts) {
    const last = runs[runs.length - 1];
    if (last && n === last[1] + 1)
      last[1] = n;
    else
      runs.push([n, n]);
  }
  return runs.map(([lo, hi]) => (lo === hi ? `${lo}` : `${lo}–${hi}`)).join(", ");
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
  // Connection to the dead man's switch plugin's in-process API; null while the
  // integration is disabled or the plugin is stopped.
  let deadman = null;

  // Arm/disarm the dead man's switch to match the watch state — a no-op unless
  // the integration is enabled and started. Shared with the routes and auto-watch.
  const syncDeadman = (onWatch) => {
    if (deadman)
      deadman.sync(onWatch);
  };

  // Reflect the effective crew size in the plugin status. Only team counts some
  // system covers (2–5 for the built-ins, plus whatever custom systems add) can
  // be scheduled — surface anything else as a plugin error, the same condition
  // the webapp shows as a banner. Driven off the published view so both a config
  // change and a runtime communication.crewNames change are caught.
  const updateStatus = (data) => {
    const count = data.teams.length;
    const counts = [...new Set(allSystems(options).map((s) => s.teamCount))].sort((a, b) => a - b);
    if (!counts.includes(count)) {
      app.setPluginError(`Watch needs ${formatCounts(counts)} teams — ${count} configured. Adjust the teams in the web UI or the Default Watch Teams in the plugin settings.`);
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

  // Systems offered in the default-system dropdown: built-ins plus any valid
  // custom systems, grouped by team count (the sort is stable, so within a
  // count the built-ins keep their order and customs follow).
  const schemaSystems = () => [...allSystems(options)].sort((a, b) => a.teamCount - b.teamCount);

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
        title: "Default Watch Teams",
        description:
          "The default teams offered when starting a watch — teams can be added, removed, renamed, and reordered per watch in the web UI. Leave empty to use communication.crewNames when published.",
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
        enum: schemaSystems().map((s) => s.id),
        enumNames: schemaSystems().map((s) => `[${s.teamCount} Teams] ${s.name}`),
        default: "fixed-4-4",
      },
      customSystems: {
        type: "array",
        title: "Custom Watch Systems",
        description:
          "Your own rotations, offered alongside the built-in systems (and in the Default Watch System dropdown after saving). See the README for the config JSON format and how to generate one with AI. Invalid entries are skipped and reported in the server log.",
        default: [],
        items: {
          type: "object",
          required: ["id", "name", "config"],
          properties: {
            id: {
              type: "string",
              title: "Id",
              description: "Stable unique key, e.g. swedish-6. Must not collide with a built-in system id.",
            },
            name: { type: "string", title: "Name", description: "Display name shown in the pickers." },
            description: { type: "string", title: "Description", description: "Optional human description." },
            config: {
              type: "string",
              title: "Config JSON",
              description:
                'The schedule definition as JSON: {"teamCount", "cycleDuration", "anchored", "segments": [{"offset", "duration", "teamIndex", "label"}]} — all times in minutes. See the README for the full format.',
            },
          },
        },
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
      enableDeadMansSwitch: {
        type: "boolean",
        title: "Enable signalk-dead-mans-switch integration",
        description:
          "Automatically arm signalk-dead-mans-switch when a watch starts, disarm it when the watch stops, and enable the arm/disarm controls in the watch schedule UI. Requires signalk-dead-mans-switch v0.6.0 or newer to be installed and enabled.",
        default: false,
      },
    },
  });

  plugin.start = (opts) => {
    options = opts || {};
    // Custom systems are parsed on demand wherever they're used, silently
    // skipping broken entries — report those once here so a config mistake is
    // visible in the server log instead of a rotation just going missing.
    const custom = parseCustomSystems(options.customSystems);
    for (const err of custom.errors)
      app.error(`watch-schedule: ${err} — entry skipped`);
    if (custom.systems.length && typeof app.debug === "function")
      app.debug(`loaded ${custom.systems.length} custom watch system(s): ${custom.systems.map((s) => s.id).join(", ")}`);
    store = createStateStore(app);
    // A watch persisted from a previous run may no longer match the current
    // config (e.g. the team count changed while we were stopped). Stop such a
    // stale watch on start so the UI and /start agree on the available systems.
    const reconciled = reconcileWatch(store, options, app);
    // Connect to the switch plugin's in-process API after reconciling, so its
    // arm-a-running-watch-on-announcement logic sees the settled watch state.
    if (options.enableDeadMansSwitch)
      deadman = connectDeadmansSwitch({ app, getStore: () => store });
    if (reconciled.stopped) {
      if (typeof app.debug === "function")
        app.debug(`stopped stale watch on start — ${reconciled.reason}`);
      // The switch may still be armed from the watch we just stopped.
      syncDeadman(false);
    }
    publishMeta(app, plugin.id);
    publishNow();
    timer = setInterval(publishNow, PUBLISH_INTERVAL_MS);
    // The publish timer should never be the sole reason the process stays alive
    // (the SignalK server has its own keep-alive); unref so it can't wedge a
    // test runner or a shutting-down host.
    if (typeof timer.unref === "function")
      timer.unref();
    if (options.enableAutoWatchStart || options.enableAutoWatchStop)
      unsubscribeAutoWatch = startAutoWatch({ app, getOptions: () => options, getStore: () => store, publishNow, syncDeadman });
  };

  plugin.stop = () => {
    if (timer)
      clearInterval(timer);
    timer = null;
    if (unsubscribeAutoWatch)
      unsubscribeAutoWatch();
    unsubscribeAutoWatch = null;
    if (deadman)
      deadman.close();
    deadman = null;
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
      syncDeadman,
    });
  };

  return plugin;
}

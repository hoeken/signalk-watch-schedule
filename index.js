/**
 * signalk-watch-schedule — plugin entry point.
 *
 * Holds authoritative watch state, publishes the watch.* view as SignalK
 * deltas, and exposes a small REST API for the webapp to read state and
 * start/stop the watch.
 */

import { BUILTIN_SYSTEMS } from "./src/core/index.js";
import { createStateStore } from "./src/server/state.js";
import { buildWatchData, publish, publishMeta } from "./src/server/publisher.js";
import { registerRoutes } from "./src/server/api.js";
import { startAutoWatch } from "./src/server/auto-watch.js";

const PUBLISH_INTERVAL_MS = 30_000;

export default function (app) {
  const plugin = {
    id: "signalk-watch-schedule",
    name: "Watch Schedule",
    description: "Crew watch schedule for offshore and overnight sailing.",
  };

  let options = {};
  let store = null;
  let timer = null;
  let stopAutoWatch = null;

  const publishNow = () => {
    if (!store)
      return;
    publish(app, plugin.id, buildWatchData(store.get(), options, Date.now(), app));
  };

  plugin.schema = () => ({
    type: "object",
    properties: {
      teams: {
        type: "array",
        title: "Watch Teams",
        description:
          "One entry per watch, in rotation order. Name it whatever you like — a watch name (e.g. Port Watch) or, if you prefer, the crew member(s) standing it (e.g. Alice & Bob). Leave empty to use the crew listed in communication.crewNames, or a generic Team 1/2/3 if no crew is published.",
        default: [],
        items: {
          type: "object",
          required: ["name"],
          properties: {
            name: { type: "string", title: "Name", description: "e.g. Port Watch, or a crew member's name" },
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
      autoWatch: {
        type: "boolean",
        title: "Automatic watch start/stop",
        description:
          "Automatically start a watch (using the default system, teams, and rounding) when the boat gets under way — navigation.state becomes sailing or motoring — and stop it when at rest — moored or anchored.",
        default: false,
      },
    },
  });

  plugin.start = (opts) => {
    options = opts || {};
    store = createStateStore(app);
    publishMeta(app, plugin.id);
    publishNow();
    timer = setInterval(publishNow, PUBLISH_INTERVAL_MS);
    // The publish timer should never be the sole reason the process stays alive
    // (the SignalK server has its own keep-alive); unref so it can't wedge a
    // test runner or a shutting-down host.
    if (typeof timer.unref === "function")
      timer.unref();
    if (options.autoWatch)
      stopAutoWatch = startAutoWatch({ app, getOptions: () => options, getStore: () => store, publishNow });
    const s = store.get();
    app.setPluginStatus(s.onWatch ? `On watch (${s.systemId})` : "Idle — no watch in progress");
  };

  plugin.stop = () => {
    if (timer)
      clearInterval(timer);
    timer = null;
    if (stopAutoWatch)
      stopAutoWatch();
    stopAutoWatch = null;
    store = null;
  };

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

/**
 * signalk-watch-schedule — plugin entry point.
 *
 * Holds authoritative watch state, publishes the watch.* view as SignalK
 * deltas, and exposes a small REST API for the webapp to read state and
 * start/stop the watch.
 */

import { BUILTIN_SYSTEMS } from './src/core/index.js';
import { createStateStore } from './src/server/state.js';
import { buildWatchData, publish, publishMeta } from './src/server/publisher.js';
import { registerRoutes } from './src/server/api.js';

const PUBLISH_INTERVAL_MS = 30_000;

export default function (app) {
  const plugin = {
    id: 'signalk-watch-schedule',
    name: 'Watch Schedule',
    description: 'Crew watch schedule for offshore and overnight sailing.',
  };

  let options = {};
  let store = null;
  let timer = null;

  const publishNow = () => {
    if (!store) return;
    publish(app, plugin.id, buildWatchData(store.get(), options, Date.now()));
  };

  plugin.schema = () => ({
    type: 'object',
    properties: {
      teams: {
        type: 'array',
        title: 'Watch Teams',
        description: 'Each team is a group of crew that stands watch together. Add a team per watch.',
        default: [
          { id: 'team1', name: 'Watch 1', crew: [] },
          { id: 'team2', name: 'Watch 2', crew: [] },
        ],
        items: {
          type: 'object',
          required: ['id', 'name'],
          properties: {
            id: { type: 'string', title: 'ID', description: 'Stable unique key, e.g. team1' },
            name: { type: 'string', title: 'Name', description: 'e.g. Port Watch' },
            crew: {
              type: 'array',
              title: 'Crew',
              items: { type: 'string' },
            },
          },
        },
      },
      defaultSystemId: {
        type: 'string',
        title: 'Default Watch System',
        description: 'Pre-selected rotation when starting a watch.',
        enum: BUILTIN_SYSTEMS.map((s) => s.id),
        enumNames: BUILTIN_SYSTEMS.map((s) => `${s.name} — ${s.description}`),
        default: 'fixed-4-4',
      },
      snapMode: {
        type: 'string',
        title: 'Start-time rounding',
        description: 'How the watch start is snapped to a whole hour.',
        enum: ['nearest', 'up', 'down'],
        default: 'nearest',
      },
      publishHorizon: {
        type: 'number',
        title: 'Shifts to publish',
        description: 'How many upcoming shifts to publish and show in the UI.',
        default: 8,
        minimum: 1,
      },
      customSystems: {
        type: 'array',
        title: 'Custom Watch Systems (advanced)',
        description: 'Optional captain-defined rotations using the same schema as the built-ins.',
        default: [],
        items: {
          type: 'object',
          required: ['id', 'name', 'teamCount', 'cycleDuration', 'segments'],
          properties: {
            id: { type: 'string', title: 'ID' },
            name: { type: 'string', title: 'Name' },
            description: { type: 'string', title: 'Description' },
            teamCount: { type: 'number', title: 'Team count', minimum: 1 },
            cycleDuration: { type: 'number', title: 'Cycle duration (minutes)', minimum: 1 },
            segments: {
              type: 'array',
              title: 'Segments',
              items: {
                type: 'object',
                required: ['offset', 'duration', 'teamIndex'],
                properties: {
                  offset: { type: 'number', title: 'Offset (minutes from cycle start)' },
                  duration: { type: 'number', title: 'Duration (minutes)', minimum: 1 },
                  teamIndex: { type: 'number', title: 'Team index (0-based)', minimum: 0 },
                  label: { type: 'string', title: 'Label' },
                },
              },
            },
          },
        },
      },
    },
  });

  plugin.start = (opts) => {
    options = opts || {};
    store = createStateStore(app);
    publishMeta(app, plugin.id);
    publishNow();
    timer = setInterval(publishNow, PUBLISH_INTERVAL_MS);
    const s = store.get();
    app.setPluginStatus(s.onWatch ? `On watch (${s.systemId})` : 'Idle — no watch in progress');
  };

  plugin.stop = () => {
    if (timer) clearInterval(timer);
    timer = null;
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

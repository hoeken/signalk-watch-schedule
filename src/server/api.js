/**
 * REST API for the webapp. Routes are mounted by SignalK under
 * /plugins/signalk-watch-schedule, so paths here are prefixed with /api.
 *
 *   GET  /api/state         current state + resolved schedule        (read)
 *   GET  /api/config        teams + defaults                         (read)
 *   GET  /api/systems       available watch systems for this crew    (read)
 *   POST /api/watch/start   { systemId } → start (snaps to the hour) (write)
 *   POST /api/watch/stop    stop the watch                           (write)
 */

import { availableSystems, getSystemById, snapToHour } from '../core/index.js';
import { buildWatchData } from './publisher.js';

/** Is SignalK security turned on for this server? */
function securityEnabled(app) {
  try {
    if (app.securityStrategy && typeof app.securityStrategy.isEnabled === 'function') {
      return app.securityStrategy.isEnabled();
    }
  } catch {
    /* fall through */
  }
  return false;
}

/**
 * A request may perform a write if security is off (open server) or it carries
 * an authenticated principal.
 */
function canWrite(app, req) {
  if (!securityEnabled(app)) return true;
  return !!req.skPrincipal;
}

/**
 * @param {object} router express router supplied by SignalK
 * @param {{ app: object, getOptions: () => object, getStore: () => object|null, publishNow: () => void }} ctx
 */
export function registerRoutes(router, ctx) {
  const { app, getOptions, getStore, publishNow } = ctx;

  const notReady = (res) => res.status(503).json({ error: 'plugin not started' });

  router.get('/api/state', (req, res) => {
    const store = getStore();
    if (!store) return notReady(res);
    res.json(buildWatchData(store.get(), getOptions(), Date.now()));
  });

  router.get('/api/config', (req, res) => {
    const options = getOptions() || {};
    res.json({
      teams: options.teams ?? [],
      defaultSystemId: options.defaultSystemId ?? null,
      publishHorizon: options.publishHorizon ?? 8,
    });
  });

  router.get('/api/systems', (req, res) => {
    const options = getOptions() || {};
    const teams = options.teams ?? [];
    res.json(availableSystems(teams.length));
  });

  router.post('/api/watch/start', (req, res) => {
    const store = getStore();
    if (!store) return notReady(res);
    if (!canWrite(app, req)) return res.status(401).json({ error: 'login required' });

    const options = getOptions() || {};
    const teams = options.teams ?? [];
    const systems = availableSystems(teams.length);
    const requestedId = (req.body && req.body.systemId) || options.defaultSystemId;
    const system = getSystemById(requestedId, systems);
    if (!system) {
      return res.status(400).json({ error: `unknown or unavailable watch system: ${requestedId}` });
    }

    const startedAt = snapToHour(Date.now(), options.snapMode || 'nearest');
    const newState = store.set({ onWatch: true, startedAt, systemId: system.id });
    publishNow();
    res.json(buildWatchData(newState, options, Date.now()));
  });

  router.post('/api/watch/stop', (req, res) => {
    const store = getStore();
    if (!store) return notReady(res);
    if (!canWrite(app, req)) return res.status(401).json({ error: 'login required' });

    const newState = store.set({ onWatch: false, startedAt: null });
    publishNow();
    res.json(buildWatchData(newState, getOptions(), Date.now()));
  });
}

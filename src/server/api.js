/**
 * REST API for the webapp. Routes are mounted by SignalK under
 * /plugins/signalk-watch-schedule, so paths here are prefixed with /api.
 *
 *   GET  /api/state         current state + resolved schedule        (read)
 *   GET  /api/config        teams + defaults                         (read)
 *   GET  /api/systems       available watch systems for this crew    (read)
 *   POST /api/watch/start   { systemId, startAt?, teamOrder? } → start (write)
 *                           startAt snaps to the hour (defaults to now);
 *                           teamOrder picks which team is first on watch.
 *   POST /api/watch/stop    stop the watch                           (write)
 */

import { availableSystems } from "../core/index.js";
import { buildWatchData } from "./publisher.js";
import { startWatch, stopWatch } from "./watch-control.js";
import { resolveTeams } from "./teams.js";

/** Is SignalK security turned on for this server? */
function securityEnabled(app) {
  try {
    if (app.securityStrategy && typeof app.securityStrategy.isEnabled === "function") {
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
  if (!securityEnabled(app))
    return true;
  return !!req.skPrincipal;
}

/**
 * @param {object} router express router supplied by SignalK
 * @param {{ app: object, getOptions: () => object, getStore: () => object|null, publishNow: () => void }} ctx
 */
export function registerRoutes(router, ctx) {
  const { app, getOptions, getStore, publishNow } = ctx;

  const notReady = (res) => res.status(503).json({ error: "plugin not started" });

  router.get("/api/state", (req, res) => {
    const store = getStore();
    if (!store)
      return notReady(res);
    res.json(buildWatchData(store.get(), getOptions(), Date.now(), app));
  });

  router.get("/api/config", (req, res) => {
    const options = getOptions() || {};
    res.json({
      teams: resolveTeams(app, options),
      defaultSystemId: options.defaultSystemId ?? null,
      publishHorizon: options.publishHorizon ?? 8,
    });
  });

  router.get("/api/systems", (req, res) => {
    const options = getOptions() || {};
    const teams = resolveTeams(app, options);
    res.json(availableSystems(teams.length));
  });

  router.post("/api/watch/start", (req, res) => {
    const store = getStore();
    if (!store)
      return notReady(res);
    if (!canWrite(app, req))
      return res.status(401).json({ error: "login required" });

    const options = getOptions() || {};
    // startAt: the UI offers ±12h of whole hours; teamOrder: which team is
    // first on watch. Both are validated in startWatch and fall back to
    // sensible defaults when absent or invalid.
    const result = startWatch(store, options, {
      systemId: req.body && req.body.systemId,
      startAt: req.body && req.body.startAt,
      teamOrder: req.body && req.body.teamOrder,
    }, app);
    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }
    publishNow();
    res.json(buildWatchData(result.state, options, Date.now(), app));
  });

  router.post("/api/watch/stop", (req, res) => {
    const store = getStore();
    if (!store)
      return notReady(res);
    if (!canWrite(app, req))
      return res.status(401).json({ error: "login required" });

    const newState = stopWatch(store);
    publishNow();
    res.json(buildWatchData(newState, getOptions(), Date.now(), app));
  });
}

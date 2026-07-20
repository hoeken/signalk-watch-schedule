/**
 * REST API for the webapp. Routes are mounted by SignalK under
 * /plugins/signalk-watch-schedule, so paths here are prefixed with /api.
 *
 *   GET  /api/state         current state + resolved schedule        (read)
 *   GET  /api/config        default teams + defaults                 (read)
 *   GET  /api/systems       available watch systems                  (read)
 *                           ?teamCount=N for a team count other than the
 *                           current default (the web UI edits teams locally).
 *   POST /api/watch/start   { systemId?, startAt?, teamOrder?, teams? }
 *                           → start (write). startAt snaps to the hour
 *                           (defaults to now); teamOrder picks which team is
 *                           first on watch; teams overrides the default teams
 *                           for this watch. All optional — defaults apply.
 *   POST /api/watch/stop    stop the watch                           (write)
 */

import { availableSystems } from "../core/index.js";
import { allSystems } from "./custom-systems.js";
import { buildWatchData } from "./publisher.js";
import { startWatch, stopWatch } from "./watch-control.js";
import { resolveTeams } from "./teams.js";
import { syncDeadmansSwitch } from "./deadman.js";

/**
 * Is SignalK security turned on for this server? The server installs either a
 * real security strategy or a dummy pass-through when security is off, and
 * there is no isEnabled() — "not the dummy" is the check the server itself
 * uses.
 */
function securityEnabled(app) {
  try {
    if (app.securityStrategy && typeof app.securityStrategy.isDummy === "function") {
      return !app.securityStrategy.isDummy();
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
      // Lets the webapp know whether to show the dead man's switch panel.
      deadMansSwitch: !!options.enableDeadMansSwitch,
    });
  });

  router.get("/api/systems", (req, res) => {
    const options = getOptions() || {};
    // The web UI can add/remove teams before starting a watch, so it may ask
    // for the systems matching its edited team count rather than the default.
    const requested = Number.parseInt(req.query && req.query.teamCount, 10);
    const count =
      Number.isInteger(requested) && requested > 0 ? requested : resolveTeams(app, options).length;
    res.json(availableSystems(count, allSystems(options)));
  });

  router.post("/api/watch/start", (req, res) => {
    const store = getStore();
    if (!store)
      return notReady(res);
    if (!canWrite(app, req))
      return res.status(401).json({ error: "login required" });

    const options = getOptions() || {};
    // startAt: the UI offers ±12h of whole hours; teamOrder: which team is
    // first on watch; teams: per-watch override of the default teams. All are
    // validated in startWatch and fall back to sensible defaults when absent
    // or invalid.
    const result = startWatch(store, options, {
      systemId: req.body && req.body.systemId,
      startAt: req.body && req.body.startAt,
      teamOrder: req.body && req.body.teamOrder,
      teams: req.body && req.body.teams,
    }, app);
    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }
    publishNow();
    syncDeadmansSwitch(app, options, true);
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
    syncDeadmansSwitch(app, getOptions(), false);
    res.json(buildWatchData(newState, getOptions(), Date.now(), app));
  });
}

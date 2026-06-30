import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildWatchData } from "../src/server/publisher.js";
import { resolveTeams } from "../src/server/teams.js";
import createPlugin from "../index.js";

const TEAMS = [
  { name: "Port" },
  { name: "Starboard" },
];
const OPTIONS = { teams: TEAMS, defaultSystemId: "fixed-4-4", publishHorizon: 6, snapMode: "nearest" };

test("buildWatchData is empty when off watch", () => {
  const data = buildWatchData({ onWatch: false, startedAt: null, systemId: null }, OPTIONS, Date.now());
  assert.equal(data.current, null);
  assert.deepEqual(data.schedule, []);
});

test("buildWatchData resolves current/next/schedule when on watch", () => {
  const startedAt = new Date(2026, 0, 1, 0, 0, 0).getTime();
  const now = startedAt + 30 * 60_000;
  const data = buildWatchData({ onWatch: true, startedAt, systemId: "fixed-4-4" }, OPTIONS, now);
  assert.equal(data.schedule.length, 6);
  assert.equal(data.current.teamName, "Port");
  assert.equal(data.next.teamName, "Starboard");
  assert.equal(data.system.id, "fixed-4-4");
});

test("buildWatchData omits pre-start watches and leaves current null for a future start", () => {
  // Anchored system + a start later today: the segments before the start must
  // not leak into the published schedule, and nothing is on duty yet.
  const startedAt = new Date(2026, 0, 1, 8, 0, 0).getTime();
  const now = startedAt - 5 * 60 * 60_000; // 03:00, before the watch begins
  const data = buildWatchData({ onWatch: true, startedAt, systemId: "rn-dog-watches" }, OPTIONS, now);
  assert.equal(data.current, null, "nothing is on duty before the start");
  assert.equal(data.next.startTime, startedAt, "next is the first scheduled shift");
  assert.equal(data.schedule[0].startTime, startedAt, "schedule begins at the start time");
  assert.ok(data.schedule.every((s) => s.startTime >= startedAt), "no watches before the start");
});

test("buildWatchData applies teamOrder to the schedule and published teams", () => {
  const startedAt = new Date(2026, 0, 1, 0, 0, 0).getTime();
  const now = startedAt + 30 * 60_000;
  const data = buildWatchData(
    { onWatch: true, startedAt, systemId: "fixed-4-4", teamOrder: [1, 0] },
    OPTIONS,
    now,
  );
  // Starboard is listed first, so it stands the first watch.
  assert.equal(data.teams[0].name, "Starboard");
  assert.equal(data.current.teamName, "Starboard");
  assert.equal(data.next.teamName, "Port");
});

// --- team resolution: config → communication.crewNames → generic default ---

/** A minimal app whose getSelfPath returns `crewNames` for communication.crewNames. */
const appWithCrew = (crewNames) => ({
  getSelfPath: (path) => (path === "communication.crewNames" ? crewNames : undefined),
});

test("resolveTeams prefers configured teams over crew and default", () => {
  const teams = resolveTeams(appWithCrew(["Alice", "Bob"]), { teams: TEAMS });
  assert.deepEqual(teams, TEAMS);
});

test("resolveTeams falls back to communication.crewNames when teams are empty", () => {
  // bare array form
  assert.deepEqual(
    resolveTeams(appWithCrew(["Zach Smith", "Apatsara Kirum"]), { teams: [] }),
    [{ name: "Zach Smith" }, { name: "Apatsara Kirum" }],
  );
  // { value } wrapper form, plus trimming and dropping blanks
  assert.deepEqual(
    resolveTeams(appWithCrew({ value: [" Alice ", "", "Bob"] }), {}),
    [{ name: "Alice" }, { name: "Bob" }],
  );
});

test("resolveTeams falls back to generic teams when no config and no crew", () => {
  const expected = [{ name: "Team 1" }, { name: "Team 2" }, { name: "Team 3" }];
  assert.deepEqual(resolveTeams(appWithCrew(undefined), { teams: [] }), expected);
  assert.deepEqual(resolveTeams(appWithCrew([]), {}), expected);
  // server without getSelfPath, or a throwing one, still yields the default
  assert.deepEqual(resolveTeams({}, {}), expected);
  assert.deepEqual(resolveTeams({ getSelfPath: () => { throw new Error("nope"); } }, {}), expected);
});

// --- helpers to exercise the plugin + routes with a mock SignalK app ---

function makeApp(crewNames) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ws-test-"));
  const deltas = [];
  // Minimal Bacon-like stream: tests push navigation.state values via navState.
  let stateCb = null;
  return {
    dir,
    deltas,
    navState: (v) => stateCb && stateCb(v),
    getSelfPath: (p) => (p === "communication.crewNames" ? crewNames : undefined),
    getDataDirPath: () => dir,
    handleMessage: (_id, delta) => deltas.push(delta),
    setPluginStatus: () => {},
    error: () => {},
    debug: () => {},
    streambundle: {
      getSelfStream: () => ({
        onValue: (cb) => {
          stateCb = cb;
          return () => { stateCb = null; };
        },
      }),
    },
    // no securityStrategy → security disabled → writes allowed
  };
}

function makeRouter() {
  const routes = {};
  const register = (method) => (p, ...handlers) => {
    routes[`${method} ${p}`] = handlers[handlers.length - 1];
  };
  return { get: register("get"), post: register("post"), routes };
}

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test("plugin publishes watch.* deltas on start", () => {
  const app = makeApp();
  const plugin = createPlugin(app);
  plugin.start(OPTIONS);
  plugin.stop();

  const paths = app.deltas.flatMap((d) => d.updates).flatMap((u) => (u.values ?? []).map((v) => v.path));
  for (const p of ["watch.state.onWatch", "watch.system", "watch.schedule", "watch.current"]) {
    assert.ok(paths.includes(p), `expected delta for ${p}`);
  }
});

test("start route snaps to the hour and stop clears state", async () => {
  const app = makeApp();
  const plugin = createPlugin(app);
  plugin.start(OPTIONS);

  const router = makeRouter();
  plugin.registerWithRouter(router);

  const startRes = makeRes();
  await router.routes["post /api/watch/start"]({ body: { systemId: "fixed-3-3" } }, startRes);
  assert.equal(startRes.statusCode, 200);
  assert.equal(startRes.body.state.onWatch, true);
  assert.equal(startRes.body.state.systemId, "fixed-3-3");
  assert.equal(new Date(startRes.body.state.startedAt).getMinutes(), 0, "start snapped to whole hour");

  // persisted state survives a restart (new store reading the same data dir)
  const reloaded = createPlugin(app);
  reloaded.start(OPTIONS);
  const reloadedRouter = makeRouter();
  reloaded.registerWithRouter(reloadedRouter);
  const stateRes = makeRes();
  await reloadedRouter.routes["get /api/state"](({}), stateRes);
  assert.equal(stateRes.body.state.onWatch, true);
  assert.equal(stateRes.body.state.systemId, "fixed-3-3");

  const stopRes = makeRes();
  await reloadedRouter.routes["post /api/watch/stop"]({ body: {} }, stopRes);
  assert.equal(stopRes.body.state.onWatch, false);
  assert.deepEqual(stopRes.body.schedule, []);

  plugin.stop();
  reloaded.stop();
  fs.rmSync(app.dir, { recursive: true, force: true });
});

test("start honors a requested start time and team order", async () => {
  const app = makeApp();
  const plugin = createPlugin(app);
  plugin.start(OPTIONS); // 2 teams: Port (0), Starboard (1)
  const router = makeRouter();
  plugin.registerWithRouter(router);

  // A whole hour two hours from now, plus an order that puts Starboard first.
  const startAt = new Date(2026, 5, 1, 18, 0, 0).getTime();
  const res = makeRes();
  await router.routes["post /api/watch/start"](
    { body: { systemId: "fixed-4-4", startAt, teamOrder: [1, 0] } },
    res,
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.state.startedAt, startAt, "uses the requested (already whole-hour) start time");
  assert.deepEqual(res.body.state.teamOrder, [1, 0]);
  // The reordered team is first on watch in the published teams list.
  assert.equal(res.body.teams[0].name, "Starboard");

  plugin.stop();
  fs.rmSync(app.dir, { recursive: true, force: true });
});

test("start snaps an off-hour requested start time and ignores a bad team order", async () => {
  const app = makeApp();
  const plugin = createPlugin(app);
  plugin.start(OPTIONS);
  const router = makeRouter();
  plugin.registerWithRouter(router);

  const offHour = new Date(2026, 5, 1, 18, 40, 0).getTime();
  const res = makeRes();
  await router.routes["post /api/watch/start"](
    { body: { systemId: "fixed-4-4", startAt: offHour, teamOrder: [9, 9] } },
    res,
  );
  assert.equal(res.statusCode, 200);
  assert.equal(new Date(res.body.state.startedAt).getMinutes(), 0, "snapped to a whole hour");
  assert.equal(res.body.state.teamOrder, null, "invalid order ignored");
  assert.equal(res.body.teams[0].name, "Port", "natural order preserved");

  plugin.stop();
  fs.rmSync(app.dir, { recursive: true, force: true });
});

test("stop clears the team order", async () => {
  const app = makeApp();
  const plugin = createPlugin(app);
  plugin.start(OPTIONS);
  const router = makeRouter();
  plugin.registerWithRouter(router);

  const startRes = makeRes();
  await router.routes["post /api/watch/start"]({ body: { systemId: "fixed-4-4", teamOrder: [1, 0] } }, startRes);
  assert.deepEqual(startRes.body.state.teamOrder, [1, 0]);

  const stopRes = makeRes();
  await router.routes["post /api/watch/stop"]({ body: {} }, stopRes);
  assert.equal(stopRes.body.state.teamOrder, null);
  assert.equal(stopRes.body.teams[0].name, "Port", "back to natural order off watch");

  plugin.stop();
  fs.rmSync(app.dir, { recursive: true, force: true });
});

// --- navigation.state auto-watch ---

const AUTO_OPTIONS = { ...OPTIONS, autoWatch: true };

async function readState(router) {
  const res = makeRes();
  await router.routes["get /api/state"]({}, res);
  return res.body.state;
}

test("auto-watch starts under way and stops at rest, ignoring in-group changes", async () => {
  const app = makeApp();
  const plugin = createPlugin(app);
  plugin.start(AUTO_OPTIONS);
  const router = makeRouter();
  plugin.registerWithRouter(router);

  // First value only establishes a baseline — no auto-start.
  app.navState("anchored");
  assert.equal((await readState(router)).onWatch, false, "baseline does not start");

  // anchored (rest) → sailing (under way): start.
  app.navState("sailing");
  let state = await readState(router);
  assert.equal(state.onWatch, true, "got under way → watch started");
  assert.equal(state.systemId, "fixed-4-4", "uses the default system");
  assert.equal(new Date(state.startedAt).getMinutes(), 0, "start snapped to the hour");

  // sailing → motoring: within the under-way group, ignored (watch unchanged).
  const startedAt = state.startedAt;
  app.navState("motoring");
  state = await readState(router);
  assert.equal(state.onWatch, true, "sailing↔motoring leaves the watch running");
  assert.equal(state.startedAt, startedAt, "watch is not restarted");

  // motoring (under way) → moored (rest): stop.
  app.navState("moored");
  state = await readState(router);
  assert.equal(state.onWatch, false, "at rest → watch stopped");

  // moored → anchored: within the rest group, ignored (stays stopped).
  app.navState("anchored");
  assert.equal((await readState(router)).onWatch, false, "moored↔anchored stays stopped");

  plugin.stop();
  fs.rmSync(app.dir, { recursive: true, force: true });
});

test("auto-watch ignores untracked states without disturbing the baseline", async () => {
  const app = makeApp();
  const plugin = createPlugin(app);
  plugin.start(AUTO_OPTIONS);
  const router = makeRouter();
  plugin.registerWithRouter(router);

  app.navState("anchored");       // baseline: at rest
  app.navState("aground");        // untracked → ignored, baseline unchanged
  assert.equal((await readState(router)).onWatch, false);

  app.navState("sailing");        // rest → under way (across the ignored value)
  assert.equal((await readState(router)).onWatch, true, "transition still detected");

  plugin.stop();
  fs.rmSync(app.dir, { recursive: true, force: true });
});

test("auto-watch does not clobber a watch already in progress", async () => {
  const app = makeApp();
  const plugin = createPlugin(app);
  plugin.start(AUTO_OPTIONS);
  const router = makeRouter();
  plugin.registerWithRouter(router);

  // Start manually with a non-default system, while at rest.
  app.navState("anchored");
  const startRes = makeRes();
  await router.routes["post /api/watch/start"]({ body: { systemId: "fixed-3-3" } }, startRes);
  assert.equal(startRes.body.state.systemId, "fixed-3-3");

  // Getting under way must not reset the in-progress watch to the default.
  app.navState("sailing");
  const state = await readState(router);
  assert.equal(state.onWatch, true);
  assert.equal(state.systemId, "fixed-3-3", "manual system preserved");

  plugin.stop();
  fs.rmSync(app.dir, { recursive: true, force: true });
});

test("auto-watch is disabled by default", async () => {
  const app = makeApp();
  const plugin = createPlugin(app);
  plugin.start(OPTIONS); // no autoWatch flag
  const router = makeRouter();
  plugin.registerWithRouter(router);

  app.navState("anchored");
  app.navState("sailing");
  assert.equal((await readState(router)).onWatch, false, "no subscription when disabled");

  plugin.stop();
  fs.rmSync(app.dir, { recursive: true, force: true });
});

test("with no configured teams, the API falls back to communication.crewNames", async () => {
  const app = makeApp(["Zach Smith", "Apatsara Kirum", "Lee"]); // 3 crew published
  const plugin = createPlugin(app);
  plugin.start({ ...OPTIONS, teams: [] }); // empty config → fall back to crew
  const router = makeRouter();
  plugin.registerWithRouter(router);

  const configRes = makeRes();
  await router.routes["get /api/config"]({}, configRes);
  assert.deepEqual(
    configRes.body.teams,
    [{ name: "Zach Smith" }, { name: "Apatsara Kirum" }, { name: "Lee" }],
    "config reports the crew as teams",
  );

  // Systems are offered for the 3-crew count, and a watch can be started/ordered.
  // fixed-4-8 is a 3-team rotation (4h on, (3-1)×4 = 8h off).
  const startRes = makeRes();
  await router.routes["post /api/watch/start"]({ body: { systemId: "fixed-4-8" } }, startRes);
  assert.equal(startRes.statusCode, 200);
  assert.equal(startRes.body.teams[0].name, "Zach Smith");
  assert.equal(startRes.body.schedule[0].teamName, "Zach Smith");

  plugin.stop();
  fs.rmSync(app.dir, { recursive: true, force: true });
});

test("a watch whose team count no longer matches the config is stopped on start", async () => {
  // Start a 4-team watch (hoekens-dog-watch) with 4 configured teams, then
  // restart with only 2 teams. The persisted watch can no longer be scheduled,
  // so reconciliation on start must stop it rather than leave the plugin in a
  // state where every /start 400s.
  const app = makeApp();
  const fourTeams = { ...OPTIONS, teams: [{ name: "A" }, { name: "B" }, { name: "C" }, { name: "D" }] };

  const plugin = createPlugin(app);
  plugin.start(fourTeams);
  const router = makeRouter();
  plugin.registerWithRouter(router);
  const startRes = makeRes();
  await router.routes["post /api/watch/start"]({ body: { systemId: "hoekens-dog-watch" } }, startRes);
  assert.equal(startRes.statusCode, 200);
  assert.equal(startRes.body.state.onWatch, true);
  plugin.stop();

  // Restart with two teams: the 4-team watch is now invalid and gets stopped.
  const reloaded = createPlugin(app);
  reloaded.start(OPTIONS); // 2 teams
  const reloadedRouter = makeRouter();
  reloaded.registerWithRouter(reloadedRouter);
  assert.equal((await readState(reloadedRouter)).onWatch, false, "stale watch stopped on start");

  reloaded.stop();
  fs.rmSync(app.dir, { recursive: true, force: true });
});

test("start rejects an unavailable system", async () => {
  const app = makeApp();
  const plugin = createPlugin(app);
  plugin.start(OPTIONS); // only 2 teams configured
  const router = makeRouter();
  plugin.registerWithRouter(router);

  const res = makeRes();
  await router.routes["post /api/watch/start"]({ body: { systemId: "no-such-system" } }, res); // unknown id
  assert.equal(res.statusCode, 400);
  plugin.stop();
  fs.rmSync(app.dir, { recursive: true, force: true });
});

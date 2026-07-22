import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildWatchData } from "../src/server/publisher.js";
import { parseCustomSystems } from "../src/server/custom-systems.js";
import { resolveTeams } from "../src/server/teams.js";
import { DEADMAN_API_PROPERTY } from "../src/server/deadman.js";
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
  // PropertyValues mock with the real server's semantics: subscribers get the
  // full emission history — entries wrapped { timestamp, setter, name, value },
  // seeded with undefined — synchronously on subscribe and on every emission.
  const propertyValues = new Map();
  const pvTuple = (name) => {
    if (!propertyValues.has(name))
      propertyValues.set(name, { history: [undefined], subs: new Set() });
    return propertyValues.get(name);
  };
  const app = {
    dir,
    deltas,
    navState: (v) => stateCb && stateCb(v),
    getSelfPath: (p) => (p === "communication.crewNames" ? crewNames : undefined),
    getDataDirPath: () => dir,
    handleMessage: (_id, delta) => deltas.push(delta),
    // Record the latest status/error so tests can assert the crew-size feedback.
    pluginStatus: null,
    pluginError: null,
    setPluginStatus: (m) => { app.pluginStatus = m; app.pluginError = null; },
    setPluginError: (m) => { app.pluginError = m; },
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
    emitPropertyValue: (name, value) => {
      const t = pvTuple(name);
      t.history.push({ timestamp: Date.now(), setter: "test", name, value });
      for (const cb of t.subs)
        cb(t.history);
    },
    onPropertyValues: (name, cb) => {
      const t = pvTuple(name);
      t.subs.add(cb);
      cb(t.history);
      return () => t.subs.delete(cb);
    },
    // no securityStrategy → security disabled → writes allowed
  };
  return app;
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

test("plugin status reflects an unschedulable crew size", () => {
  // Valid range is a normal status...
  const ok = makeApp();
  createPlugin(ok).start(OPTIONS); // 2 teams
  assert.equal(ok.pluginError, null);
  assert.match(ok.pluginStatus, /Idle/);

  // ...too few teams (the built-in rotations need at least 2) is an error...
  const few = makeApp();
  createPlugin(few).start({ ...OPTIONS, teams: [{ name: "Solo" }] });
  assert.match(few.pluginError, /2–5 teams/);

  // ...and so is too many.
  const many = makeApp();
  const sixTeams = Array.from({ length: 6 }, (_, i) => ({ name: `T${i}` }));
  createPlugin(many).start({ ...OPTIONS, teams: sixTeams });
  assert.match(many.pluginError, /2–5 teams/);
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

test("start accepts custom teams for the watch and stop restores the defaults", async () => {
  const app = makeApp();
  const plugin = createPlugin(app);
  plugin.start(OPTIONS); // 2 configured teams: Port, Starboard
  const router = makeRouter();
  plugin.registerWithRouter(router);

  // Three custom teams enable a 3-team rotation the 2-team config couldn't run.
  const custom = [{ name: "Alice" }, { name: "Bob" }, { name: "Chloe" }];
  const startRes = makeRes();
  await router.routes["post /api/watch/start"](
    { body: { systemId: "fixed-4-8", teams: custom, teamOrder: [2, 0, 1] } },
    startRes,
  );
  assert.equal(startRes.statusCode, 200);
  assert.deepEqual(startRes.body.state.teams, custom, "custom teams stored with the watch");
  assert.equal(startRes.body.teams[0].name, "Chloe", "teamOrder applies to the custom teams");
  assert.equal(startRes.body.schedule[0].teamName, "Chloe");

  // Systems endpoint still reports the configured (2-team) defaults…
  const sysRes = makeRes();
  await router.routes["get /api/systems"]({}, sysRes);
  assert.ok(sysRes.body.every((s) => s.teamCount === 2));
  // …but honors an explicit teamCount, as the web UI requests while editing.
  const sys3Res = makeRes();
  await router.routes["get /api/systems"]({ query: { teamCount: "3" } }, sys3Res);
  assert.ok(sys3Res.body.length > 0);
  assert.ok(sys3Res.body.every((s) => s.teamCount === 3));

  // Stopping clears the override — back to the configured defaults.
  const stopRes = makeRes();
  await router.routes["post /api/watch/stop"]({ body: {} }, stopRes);
  assert.equal(stopRes.body.state.teams, null);
  assert.deepEqual(stopRes.body.teams, TEAMS, "defaults apply again off watch");

  plugin.stop();
  fs.rmSync(app.dir, { recursive: true, force: true });
});

test("start ignores invalid custom teams and falls back to the defaults", async () => {
  const app = makeApp();
  const plugin = createPlugin(app);
  plugin.start(OPTIONS);
  const router = makeRouter();
  plugin.registerWithRouter(router);

  // A blank name invalidates the whole list; an empty array and a non-array do too.
  for (const teams of [[{ name: "A" }, { name: "  " }], [], "nonsense"]) {
    const res = makeRes();
    await router.routes["post /api/watch/start"]({ body: { systemId: "fixed-4-4", teams } }, res);
    assert.equal(res.statusCode, 200, "start still succeeds on the defaults");
    assert.equal(res.body.state.teams, null, "invalid override not stored");
    assert.equal(res.body.teams[0].name, "Port");
  }

  plugin.stop();
  fs.rmSync(app.dir, { recursive: true, force: true });
});

test("a watch with its own custom teams survives a config team-count change", async () => {
  // Unlike a defaults-based watch (see the reconcile test below), a watch
  // started with explicit teams carries them in state, so changing the
  // configured defaults while the plugin is stopped must not stop it.
  const app = makeApp();
  const plugin = createPlugin(app);
  plugin.start(OPTIONS); // 2 configured teams
  const router = makeRouter();
  plugin.registerWithRouter(router);
  const custom = [{ name: "A" }, { name: "B" }, { name: "C" }, { name: "D" }];
  const startRes = makeRes();
  await router.routes["post /api/watch/start"](
    { body: { systemId: "hoekens-dog-watch", teams: custom } },
    startRes,
  );
  assert.equal(startRes.statusCode, 200);
  plugin.stop();

  const reloaded = createPlugin(app);
  reloaded.start(OPTIONS); // still 2 configured teams ≠ the watch's 4
  const reloadedRouter = makeRouter();
  reloaded.registerWithRouter(reloadedRouter);
  const stateRes = makeRes();
  await reloadedRouter.routes["get /api/state"]({}, stateRes);
  assert.equal(stateRes.body.state.onWatch, true, "custom-team watch keeps running");
  assert.equal(stateRes.body.teams.length, 4);
  assert.equal(stateRes.body.teams[0].name, "A");

  reloaded.stop();
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

const AUTO_OPTIONS = { ...OPTIONS, enableAutoWatchStart: true, enableAutoWatchStop: true };

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
  plugin.start(OPTIONS); // neither enableAutoWatchStart nor enableAutoWatchStop
  const router = makeRouter();
  plugin.registerWithRouter(router);

  app.navState("anchored");
  app.navState("sailing");
  assert.equal((await readState(router)).onWatch, false, "no subscription when disabled");

  plugin.stop();
  fs.rmSync(app.dir, { recursive: true, force: true });
});

test("enableAutoWatchStart only: starts under way but does not auto-stop", async () => {
  const app = makeApp();
  const plugin = createPlugin(app);
  plugin.start({ ...OPTIONS, enableAutoWatchStart: true });
  const router = makeRouter();
  plugin.registerWithRouter(router);

  app.navState("anchored");       // baseline
  app.navState("sailing");        // rest → under way: start
  assert.equal((await readState(router)).onWatch, true, "got under way → watch started");

  app.navState("moored");         // under way → rest: stop is disabled
  assert.equal((await readState(router)).onWatch, true, "watch keeps running when auto-stop is off");

  plugin.stop();
  fs.rmSync(app.dir, { recursive: true, force: true });
});

test("enableAutoWatchStop only: stops at rest but does not auto-start", async () => {
  const app = makeApp();
  const plugin = createPlugin(app);
  plugin.start({ ...OPTIONS, enableAutoWatchStop: true });
  const router = makeRouter();
  plugin.registerWithRouter(router);

  app.navState("anchored");       // baseline
  app.navState("sailing");        // rest → under way: start is disabled
  assert.equal((await readState(router)).onWatch, false, "watch stays off when auto-start is off");

  // Start manually, then coming to rest should auto-stop.
  const startRes = makeRes();
  await router.routes["post /api/watch/start"]({ body: {} }, startRes);
  assert.equal((await readState(router)).onWatch, true, "manual start");

  app.navState("moored");         // under way → rest: stop
  assert.equal((await readState(router)).onWatch, false, "came to rest → watch stopped");

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

// --- custom watch systems ---

/** A valid 2-team custom system: a clock-anchored 12h day/night split. */
const DAY_NIGHT_CONFIG = JSON.stringify({
  teamCount: 2,
  cycleDuration: 24 * 60,
  anchored: true,
  segments: [
    { offset: 0, duration: 720, teamIndex: 0, label: "Day" },
    { offset: 720, duration: 720, teamIndex: 1, label: "Night" },
  ],
});
const CUSTOM_SYSTEMS = [
  { id: "day-night", name: "Day / Night", description: "12-hour split", config: DAY_NIGHT_CONFIG },
];

test("parseCustomSystems accepts a valid entry and fills the system fields", () => {
  const { systems, errors } = parseCustomSystems(CUSTOM_SYSTEMS);
  assert.deepEqual(errors, []);
  assert.equal(systems.length, 1);
  const sys = systems[0];
  assert.equal(sys.id, "day-night");
  assert.equal(sys.name, "Day / Night");
  assert.equal(sys.description, "12-hour split");
  assert.equal(sys.builtin, false);
  assert.equal(sys.teamCount, 2);
  assert.equal(sys.segments.length, 2);
});

test("parseCustomSystems skips broken entries but keeps the valid ones", () => {
  const { systems, errors } = parseCustomSystems([
    { id: "", name: "No Id", config: DAY_NIGHT_CONFIG },                    // missing id
    { id: "bad-json", name: "Bad JSON", config: "{not json" },              // unparseable
    { id: "fixed-4-4", name: "Shadow", config: DAY_NIGHT_CONFIG },          // collides with a built-in
    { id: "gap", name: "Gap", config: JSON.stringify({ teamCount: 2, cycleDuration: 120, segments: [{ offset: 0, duration: 30, teamIndex: 0 }, { offset: 60, duration: 60, teamIndex: 1 }] }) }, // invalid schedule
    ...CUSTOM_SYSTEMS,                                                       // still accepted
    { id: "day-night", name: "Dupe", config: DAY_NIGHT_CONFIG },            // duplicate custom id
  ]);
  assert.equal(systems.length, 1);
  assert.equal(systems[0].id, "day-night");
  assert.equal(errors.length, 5);
  assert.match(errors[0], /id and name are required/);
  assert.match(errors[1], /not valid JSON/);
  assert.match(errors[2], /already used/);
  assert.match(errors[3], /gap\/overlap/);
  assert.match(errors[4], /already used/);
});

test("a custom system is offered, startable, published, and survives a restart", async () => {
  const app = makeApp();
  const plugin = createPlugin(app);
  const options = { ...OPTIONS, customSystems: CUSTOM_SYSTEMS };
  plugin.start(options);
  const router = makeRouter();
  plugin.registerWithRouter(router);

  // Offered alongside the built-ins for the matching team count…
  const sysRes = makeRes();
  await router.routes["get /api/systems"]({}, sysRes);
  assert.ok(sysRes.body.some((s) => s.id === "day-night"), "custom system listed");

  // …startable, with the resolved schedule using its segments. Pin startAt to
  // the top of the current hour: a bare start snaps "now" to the *nearest*
  // hour, which past half-past lands in the future and makes `current` null.
  const startAt = new Date();
  startAt.setMinutes(0, 0, 0);
  const startRes = makeRes();
  await router.routes["post /api/watch/start"]({ body: { systemId: "day-night", startAt: startAt.getTime() } }, startRes);
  assert.equal(startRes.statusCode, 200);
  assert.equal(startRes.body.system.id, "day-night");
  assert.equal(startRes.body.system.builtin, false);
  assert.ok(["Day", "Night"].includes(startRes.body.current.label));
  plugin.stop();

  // …and reconciliation on restart keeps it running (the custom system is
  // still in the config, so the persisted watch remains schedulable).
  const reloaded = createPlugin(app);
  reloaded.start(options);
  const reloadedRouter = makeRouter();
  reloaded.registerWithRouter(reloadedRouter);
  assert.equal((await readState(reloadedRouter)).onWatch, true, "custom-system watch survives restart");

  // Removing the custom system from the config strands the watch → stopped.
  reloaded.stop();
  const stripped = createPlugin(app);
  stripped.start(OPTIONS);
  const strippedRouter = makeRouter();
  stripped.registerWithRouter(strippedRouter);
  assert.equal((await readState(strippedRouter)).onWatch, false, "watch stopped once its system is gone");

  stripped.stop();
  fs.rmSync(app.dir, { recursive: true, force: true });
});

test("invalid custom systems are reported on start and do not break the built-ins", async () => {
  const app = makeApp();
  const reported = [];
  app.error = (msg) => reported.push(msg);
  const plugin = createPlugin(app);
  plugin.start({ ...OPTIONS, customSystems: [{ id: "broken", name: "Broken", config: "{oops" }] });
  const router = makeRouter();
  plugin.registerWithRouter(router);

  assert.equal(reported.length, 1);
  assert.match(reported[0], /custom system 1 \("broken"\)/);

  const res = makeRes();
  await router.routes["post /api/watch/start"]({ body: { systemId: "fixed-4-4" } }, res);
  assert.equal(res.statusCode, 200, "built-ins unaffected by a broken custom entry");

  plugin.stop();
  fs.rmSync(app.dir, { recursive: true, force: true });
});

test("custom systems needing more than 5 teams are rejected", () => {
  // The web UI's team editor tops out at 5 teams, so a 6-team system could
  // never be staffed there — it must be refused, not offered.
  const sixTeamConfig = JSON.stringify({
    teamCount: 6,
    cycleDuration: 6 * 60,
    segments: Array.from({ length: 6 }, (_, i) => ({ offset: i * 60, duration: 60, teamIndex: i })),
  });
  const customSystems = [{ id: "six-up", name: "Six Up", config: sixTeamConfig }];

  const { systems, errors } = parseCustomSystems(customSystems);
  assert.equal(systems.length, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /teamCount 6 exceeds the 5-team maximum/);

  // Six teams therefore remain an unschedulable crew size.
  const app = makeApp();
  const sixTeams = Array.from({ length: 6 }, (_, i) => ({ name: `T${i}` }));
  createPlugin(app).start({ ...OPTIONS, teams: sixTeams, customSystems });
  assert.match(app.pluginError, /2–5 teams/);
});

test("the config schema lists systems as \"[X Teams] name\" including customs", () => {
  const app = makeApp();
  const plugin = createPlugin(app);
  plugin.start({ ...OPTIONS, customSystems: CUSTOM_SYSTEMS });

  const schema = plugin.schema();
  const { enum: ids, enumNames: names } = schema.properties.defaultSystemId;
  assert.equal(ids.length, names.length);
  assert.ok(names.every((n) => /^\[\d+ Teams\] /.test(n)), "every entry uses the [X Teams] prefix");
  const customIdx = ids.indexOf("day-night");
  assert.ok(customIdx >= 0, "custom system offered as a default");
  assert.equal(names[customIdx], "[2 Teams] Day / Night");
  // Grouped by team count: the counts read in non-decreasing order.
  const counts = names.map((n) => Number(n.match(/^\[(\d+) Teams\]/)[1]));
  assert.deepEqual(counts, [...counts].sort((a, b) => a - b));

  plugin.stop();
  fs.rmSync(app.dir, { recursive: true, force: true });
});

// --- signalk-dead-mans-switch integration ---

const DEADMAN_OPTIONS = { ...OPTIONS, enableDeadMansSwitch: true };

/**
 * Announce a fake switch in-process API (as signalk-dead-mans-switch >= 0.6.0
 * does once on start, via PropertyValues) and record the arm/disarm calls the
 * integration makes on it.
 */
function mockDeadmanApi(app, { throwing = false } = {}) {
  const calls = [];
  const record = (action) => (reason) => {
    calls.push({ action, reason });
    if (throwing)
      throw new Error("boom");
    return true;
  };
  app.emitPropertyValue(DEADMAN_API_PROPERTY, { arm: record("arm"), disarm: record("disarm") });
  return calls;
}

test("start arms and stop disarms the dead man's switch when enabled", async () => {
  const app = makeApp();
  const calls = mockDeadmanApi(app);
  const plugin = createPlugin(app);
  plugin.start(DEADMAN_OPTIONS);
  const router = makeRouter();
  plugin.registerWithRouter(router);

  const startRes = makeRes();
  await router.routes["post /api/watch/start"]({ body: {} }, startRes);
  assert.equal(startRes.statusCode, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].action, "arm");
  assert.match(calls[0].reason, /watch started/, "a reason is passed for the switch's debug log");

  const stopRes = makeRes();
  await router.routes["post /api/watch/stop"]({ body: {} }, stopRes);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].action, "disarm");

  plugin.stop();
  fs.rmSync(app.dir, { recursive: true, force: true });
});

test("dead man's switch integration is off by default", async () => {
  const app = makeApp();
  const calls = mockDeadmanApi(app);
  const plugin = createPlugin(app);
  plugin.start(OPTIONS); // enableDeadMansSwitch not set
  const router = makeRouter();
  plugin.registerWithRouter(router);

  await router.routes["post /api/watch/start"]({ body: {} }, makeRes());
  await router.routes["post /api/watch/stop"]({ body: {} }, makeRes());
  assert.equal(calls.length, 0, "no dead man's switch calls when disabled");

  plugin.stop();
  fs.rmSync(app.dir, { recursive: true, force: true });
});

test("a missing or broken dead man's switch does not break start or stop", async () => {
  // No API announced at all (plugin missing/disabled/too old)…
  const missing = makeApp();
  const plugin = createPlugin(missing);
  plugin.start(DEADMAN_OPTIONS);
  const router = makeRouter();
  plugin.registerWithRouter(router);

  const startRes = makeRes();
  await router.routes["post /api/watch/start"]({ body: {} }, startRes);
  assert.equal(startRes.statusCode, 200, "watch starts even without the switch");
  assert.equal(startRes.body.state.onWatch, true);

  const stopRes = makeRes();
  await router.routes["post /api/watch/stop"]({ body: {} }, stopRes);
  assert.equal(stopRes.statusCode, 200);
  assert.equal(stopRes.body.state.onWatch, false);
  plugin.stop();
  fs.rmSync(missing.dir, { recursive: true, force: true });

  // …and an announced API whose methods throw is just as harmless.
  const broken = makeApp();
  const calls = mockDeadmanApi(broken, { throwing: true });
  const plugin2 = createPlugin(broken);
  plugin2.start(DEADMAN_OPTIONS);
  const router2 = makeRouter();
  plugin2.registerWithRouter(router2);

  const res = makeRes();
  await router2.routes["post /api/watch/start"]({ body: {} }, res);
  assert.equal(res.statusCode, 200, "watch starts even if the switch API throws");
  assert.equal(calls.length, 1, "the throwing arm was attempted");
  plugin2.stop();
  fs.rmSync(broken.dir, { recursive: true, force: true });
});

test("an arm requested before the switch announces its API is delivered on announcement", async () => {
  // Plugin start order is not guaranteed: the watch starts while the switch
  // plugin hasn't announced its API yet — the arm must not be lost.
  const app = makeApp();
  const plugin = createPlugin(app);
  plugin.start(DEADMAN_OPTIONS);
  const router = makeRouter();
  plugin.registerWithRouter(router);

  const startRes = makeRes();
  await router.routes["post /api/watch/start"]({ body: {} }, startRes);
  assert.equal(startRes.statusCode, 200);

  const calls = mockDeadmanApi(app); // the switch plugin starts late
  assert.equal(calls.length, 1, "the deferred arm is delivered");
  assert.equal(calls[0].action, "arm");

  plugin.stop();
  fs.rmSync(app.dir, { recursive: true, force: true });
});

test("a running watch re-arms the switch when its API (re)announces", async () => {
  const app = makeApp();
  const calls = mockDeadmanApi(app);
  const plugin = createPlugin(app);
  plugin.start(DEADMAN_OPTIONS);
  const router = makeRouter();
  plugin.registerWithRouter(router);
  await router.routes["post /api/watch/start"]({ body: {} }, makeRes());
  assert.deepEqual(calls.map((c) => c.action), ["arm"]);

  // The switch plugin restarts mid-watch and announces a fresh API: re-arm it.
  const reannounced = mockDeadmanApi(app);
  assert.deepEqual(reannounced.map((c) => c.action), ["arm"]);

  // A server restart with the watch persisted arms on plugin start too (the
  // announcement is replayed from the PropertyValues history on subscribe).
  plugin.stop();
  const reloaded = createPlugin(app);
  reloaded.start(DEADMAN_OPTIONS);
  assert.deepEqual(reannounced.map((c) => c.action), ["arm", "arm"]);

  reloaded.stop();
  fs.rmSync(app.dir, { recursive: true, force: true });
});

test("no watch running means no arm/disarm on announcement (a hand-armed switch stays armed)", () => {
  const app = makeApp();
  const plugin = createPlugin(app);
  plugin.start(DEADMAN_OPTIONS); // idle — no watch
  const calls = mockDeadmanApi(app);
  assert.equal(calls.length, 0, "an idle watch plugin leaves the switch alone");

  plugin.stop();
  fs.rmSync(app.dir, { recursive: true, force: true });
});

test("auto-watch arms and disarms the dead man's switch when enabled", async () => {
  const app = makeApp();
  const calls = mockDeadmanApi(app);
  const plugin = createPlugin(app);
  plugin.start({ ...AUTO_OPTIONS, enableDeadMansSwitch: true });
  plugin.registerWithRouter(makeRouter());

  app.navState("anchored"); // baseline
  app.navState("sailing"); // rest → under way: start + arm
  assert.equal(calls.length, 1);
  assert.equal(calls[0].action, "arm");

  app.navState("moored"); // under way → rest: stop + disarm
  assert.equal(calls.length, 2);
  assert.equal(calls[1].action, "disarm");

  plugin.stop();
  fs.rmSync(app.dir, { recursive: true, force: true });
});

test("reconciling away a stale watch on start disarms the dead man's switch", async () => {
  const app = makeApp();
  const calls = mockDeadmanApi(app);
  const fourTeams = Array.from({ length: 4 }, (_, i) => ({ name: `T${i}` }));

  const plugin = createPlugin(app);
  plugin.start({ ...DEADMAN_OPTIONS, teams: fourTeams });
  const router = makeRouter();
  plugin.registerWithRouter(router);
  await router.routes["post /api/watch/start"]({ body: { systemId: "hoekens-dog-watch" } }, makeRes());
  plugin.stop();
  assert.equal(calls.length, 1, "armed on start");

  // Restart with two teams: the 4-team watch is stopped — the switch must not
  // stay armed with no watch running.
  const reloaded = createPlugin(app);
  reloaded.start(DEADMAN_OPTIONS);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].action, "disarm");

  reloaded.stop();
  fs.rmSync(app.dir, { recursive: true, force: true });
});

test("config reports whether the dead man's switch integration is enabled", async () => {
  const app = makeApp();
  const plugin = createPlugin(app);
  plugin.start(DEADMAN_OPTIONS);
  const router = makeRouter();
  plugin.registerWithRouter(router);

  const res = makeRes();
  await router.routes["get /api/config"]({}, res);
  assert.equal(res.body.deadMansSwitch, true);

  plugin.stop();
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

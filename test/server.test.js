import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildWatchData } from '../src/server/publisher.js';
import createPlugin from '../index.js';

const TEAMS = [
  { id: 'team1', name: 'Port', crew: ['Alice'] },
  { id: 'team2', name: 'Starboard', crew: ['Bob'] },
];
const OPTIONS = { teams: TEAMS, defaultSystemId: 'fixed-4-4', publishHorizon: 6, snapMode: 'nearest' };

test('buildWatchData is empty when off watch', () => {
  const data = buildWatchData({ onWatch: false, startedAt: null, systemId: null }, OPTIONS, Date.now());
  assert.equal(data.current, null);
  assert.deepEqual(data.schedule, []);
});

test('buildWatchData resolves current/next/schedule when on watch', () => {
  const startedAt = new Date(2026, 0, 1, 0, 0, 0).getTime();
  const now = startedAt + 30 * 60_000;
  const data = buildWatchData({ onWatch: true, startedAt, systemId: 'fixed-4-4' }, OPTIONS, now);
  assert.equal(data.schedule.length, 6);
  assert.equal(data.current.teamName, 'Port');
  assert.equal(data.next.teamName, 'Starboard');
  assert.equal(data.system.id, 'fixed-4-4');
});

// --- helpers to exercise the plugin + routes with a mock SignalK app ---

function makeApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-test-'));
  const deltas = [];
  return {
    dir,
    deltas,
    getDataDirPath: () => dir,
    handleMessage: (_id, delta) => deltas.push(delta),
    setPluginStatus: () => {},
    error: () => {},
    debug: () => {},
    // no securityStrategy → security disabled → writes allowed
  };
}

function makeRouter() {
  const routes = {};
  const register = (method) => (p, ...handlers) => {
    routes[`${method} ${p}`] = handlers[handlers.length - 1];
  };
  return { get: register('get'), post: register('post'), routes };
}

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('plugin publishes watch.* deltas on start', () => {
  const app = makeApp();
  const plugin = createPlugin(app);
  plugin.start(OPTIONS);
  plugin.stop();

  const paths = app.deltas.flatMap((d) => d.updates).flatMap((u) => (u.values ?? []).map((v) => v.path));
  for (const p of ['watch.state.onWatch', 'watch.system', 'watch.schedule', 'watch.current']) {
    assert.ok(paths.includes(p), `expected delta for ${p}`);
  }
});

test('start route snaps to the hour and stop clears state', async () => {
  const app = makeApp();
  const plugin = createPlugin(app);
  plugin.start(OPTIONS);

  const router = makeRouter();
  plugin.registerWithRouter(router);

  const startRes = makeRes();
  await router.routes['post /api/watch/start']({ body: { systemId: 'fixed-3-3' } }, startRes);
  assert.equal(startRes.statusCode, 200);
  assert.equal(startRes.body.state.onWatch, true);
  assert.equal(startRes.body.state.systemId, 'fixed-3-3');
  assert.equal(new Date(startRes.body.state.startedAt).getMinutes(), 0, 'start snapped to whole hour');

  // persisted state survives a restart (new store reading the same data dir)
  const reloaded = createPlugin(app);
  reloaded.start(OPTIONS);
  const reloadedRouter = makeRouter();
  reloaded.registerWithRouter(reloadedRouter);
  const stateRes = makeRes();
  await reloadedRouter.routes['get /api/state'](({}), stateRes);
  assert.equal(stateRes.body.state.onWatch, true);
  assert.equal(stateRes.body.state.systemId, 'fixed-3-3');

  const stopRes = makeRes();
  await reloadedRouter.routes['post /api/watch/stop']({ body: {} }, stopRes);
  assert.equal(stopRes.body.state.onWatch, false);
  assert.deepEqual(stopRes.body.schedule, []);

  plugin.stop();
  reloaded.stop();
  fs.rmSync(app.dir, { recursive: true, force: true });
});

test('start rejects an unavailable system', async () => {
  const app = makeApp();
  const plugin = createPlugin(app);
  plugin.start(OPTIONS); // only 2 teams configured
  const router = makeRouter();
  plugin.registerWithRouter(router);

  const res = makeRes();
  await router.routes['post /api/watch/start']({ body: { systemId: 'no-such-system' } }, res); // unknown id
  assert.equal(res.statusCode, 400);
  plugin.stop();
  fs.rmSync(app.dir, { recursive: true, force: true });
});

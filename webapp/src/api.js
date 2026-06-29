/**
 * Thin client for the plugin REST API, SignalK auth, and the delta stream.
 * All requests are relative to the SignalK server origin that serves this app.
 */

const BASE = '/plugins/signalk-watch-schedule';
const SK_SELF = '/signalk/v1/api/vessels/self';
const json = { 'Content-Type': 'application/json' };

async function getJSON(url) {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw Object.assign(new Error(`GET ${url} → ${res.status}`), { code: res.status });
  return res.json();
}

/**
 * Unwrap a SignalK "full format" subtree into plain values. Leaf nodes carry a
 * `value` key (alongside meta/$source/timestamp); branch nodes nest children.
 */
function unwrapFull(node) {
  if (node === null || typeof node !== 'object') return node;
  if ('value' in node) return node.value; // leaf
  const out = {};
  for (const [key, child] of Object.entries(node)) {
    if (key === 'meta' || key === '$source' || key === 'timestamp' || key === 'pgn' || key === 'sentence') {
      continue;
    }
    out[key] = unwrapFull(child);
  }
  return out;
}

const EMPTY_STATE = { onWatch: false, startedAt: null, systemId: null };

/**
 * Composed watch view: { state, system, teams, current, next, schedule }.
 *
 * SignalK has no auth-free plugin API, so anonymous viewers get a 401 from
 * `${BASE}/api/state`. Instead we read the published `watch` tree from the
 * public SignalK REST API and unwrap its full format into the same composed
 * shape the writes (`startWatch`/`stopWatch`) return.
 */
export async function getState() {
  let tree;
  try {
    tree = await getJSON(`${SK_SELF}/watch`);
  } catch (e) {
    if (e.code === 404) return { state: { ...EMPTY_STATE }, teams: [], schedule: [] };
    throw e;
  }
  return unwrapFull(tree);
}

/**
 * Watch systems available for the configured crew. Served by the auth-gated
 * plugin API, so anonymous viewers get nothing — that's fine, the system picker
 * is only shown to users who can control the watch (and are thus logged in).
 */
export async function getSystems() {
  try {
    return await getJSON(`${BASE}/api/systems`);
  } catch {
    return [];
  }
}

/**
 * SignalK login status. Degrades gracefully to "not logged in / auth required"
 * if the endpoint is unavailable.
 */
export async function getLoginStatus() {
  try {
    return await getJSON('/skServer/loginStatus');
  } catch {
    return { status: 'notLoggedIn', authenticationRequired: true };
  }
}

/** True if the current viewer may start/stop the watch. */
export function canControl(loginStatus) {
  if (!loginStatus) return false;
  if (loginStatus.authenticationRequired === false) return true; // open server
  return loginStatus.status === 'loggedIn';
}

async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: json,
    credentials: 'include',
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw Object.assign(new Error(`POST ${url} → ${res.status}`), { code: res.status });
  return res.json();
}

/**
 * Start the watch. `opts.startAt` (epoch ms, snapped server-side to the hour)
 * and `opts.teamOrder` (a permutation of team indices, first on watch first)
 * are optional; omitting them starts now in the natural team order.
 */
export const startWatch = (systemId, opts = {}) =>
  post(`${BASE}/api/watch/start`, { systemId, startAt: opts.startAt, teamOrder: opts.teamOrder });
export const stopWatch = () => post(`${BASE}/api/watch/stop`);

/** Log in against SignalK; the auth cookie is then sent with future requests. */
export async function login(username, password) {
  const res = await fetch('/signalk/v1/auth/login', {
    method: 'POST',
    headers: json,
    credentials: 'include',
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error('Login failed — check username and password');
  return res.json();
}

export async function logout() {
  try {
    await fetch('/signalk/v1/auth/logout', { method: 'PUT', credentials: 'include' });
  } catch {
    /* ignore */
  }
}

/**
 * Subscribe to watch.* deltas. Invokes `onChange` whenever the server publishes
 * an update (the app then re-fetches the composed state). Returns an unsubscribe.
 */
export function subscribeWatch(onChange) {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  let ws;
  try {
    ws = new WebSocket(`${proto}//${window.location.host}/signalk/v1/stream?subscribe=none`);
    ws.onopen = () =>
      ws.send(
        JSON.stringify({
          context: 'vessels.self',
          subscribe: [{ path: 'watch.*', period: 2000, policy: 'instant' }],
        }),
      );
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (Array.isArray(msg.updates)) onChange();
      } catch {
        /* ignore non-JSON frames */
      }
    };
  } catch {
    /* WS unavailable; the app still polls as a fallback */
  }
  return () => {
    try {
      ws && ws.close();
    } catch {
      /* ignore */
    }
  };
}

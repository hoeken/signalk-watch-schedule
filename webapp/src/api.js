/**
 * Thin client for the plugin REST API, SignalK auth, and the delta stream.
 * All requests are relative to the SignalK server origin that serves this app.
 */

const BASE = '/plugins/signalk-watch-schedule';
const json = { 'Content-Type': 'application/json' };

async function getJSON(url) {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw Object.assign(new Error(`GET ${url} → ${res.status}`), { code: res.status });
  return res.json();
}

/** Composed watch view: { state, system, teams, current, next, schedule }. */
export const getState = () => getJSON(`${BASE}/api/state`);

/** Watch systems available for the configured crew. */
export const getSystems = () => getJSON(`${BASE}/api/systems`);

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

export const startWatch = (systemId) => post(`${BASE}/api/watch/start`, { systemId });
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

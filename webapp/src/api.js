/**
 * Thin client for the plugin REST API, SignalK auth, and the delta stream.
 * All requests are relative to the SignalK server origin that serves this app.
 */

const BASE = "/plugins/signalk-watch-schedule";
const SK_SELF = "/signalk/v1/api/vessels/self";
const json = { "Content-Type": "application/json" };

async function getJSON(url) {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok)
    throw Object.assign(new Error(`GET ${url} → ${res.status}`), { code: res.status });
  return res.json();
}

/**
 * Unwrap a SignalK "full format" subtree into plain values. Leaf nodes carry a
 * `value` key (alongside meta/$source/timestamp); branch nodes nest children.
 */
function unwrapFull(node) {
  if (node === null || typeof node !== "object")
    return node;
  if ("value" in node)
    return node.value; // leaf
  const out = {};
  for (const [key, child] of Object.entries(node)) {
    if (key === "meta" || key === "$source" || key === "timestamp" || key === "pgn" || key === "sentence") {
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
    if (e.code === 404)
      return { state: { ...EMPTY_STATE }, teams: [], schedule: [] };
    throw e;
  }
  return unwrapFull(tree);
}

/**
 * Watch systems available for a crew of `teamCount` teams (defaults to the
 * server's configured teams when omitted). Served by the auth-gated plugin API,
 * so anonymous viewers get nothing — that's fine, the system picker is only
 * shown to users who can control the watch (and are thus logged in).
 */
export async function getSystems(teamCount) {
  const query = Number.isInteger(teamCount) && teamCount > 0 ? `?teamCount=${teamCount}` : "";
  try {
    return await getJSON(`${BASE}/api/systems${query}`);
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
    return await getJSON("/skServer/loginStatus");
  } catch {
    return { status: "notLoggedIn", authenticationRequired: true };
  }
}

/** True if the current viewer may start/stop the watch. */
export function canControl(loginStatus) {
  if (!loginStatus)
    return false;
  if (loginStatus.authenticationRequired === false)
    return true; // open server
  return loginStatus.status === "loggedIn";
}

async function post(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: json,
    credentials: "include",
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok)
    throw Object.assign(new Error(`POST ${url} → ${res.status}`), { code: res.status });
  return res.json();
}

/**
 * Start the watch. `opts.startAt` (epoch ms, snapped server-side to the hour)
 * and `opts.teams` (the teams for this watch, first on watch first — overrides
 * the server's default teams) are optional; omitting them starts now with the
 * default teams in their natural order.
 */
export const startWatch = (systemId, opts = {}) =>
  post(`${BASE}/api/watch/start`, { systemId, startAt: opts.startAt, teams: opts.teams });
export const stopWatch = () => post(`${BASE}/api/watch/stop`);

/** Log in against SignalK; the auth cookie is then sent with future requests. */
export async function login(username, password, rememberMe = true) {
  const res = await fetch("/signalk/v1/auth/login", {
    method: "POST",
    headers: json,
    credentials: "include",
    body: JSON.stringify({ username, password, rememberMe }),
  });
  if (!res.ok)
    throw new Error("Login failed — check username and password");
  return res.json();
}

export async function logout() {
  try {
    await fetch("/signalk/v1/auth/logout", { method: "PUT", credentials: "include" });
  } catch {
    /* ignore */
  }
}

/** Default interval between state polls, in ms. */
export const POLL_INTERVAL_MS = 5000;

/**
 * Poll the composed watch state on an interval, invoking `onState` with each
 * successful fetch. The watch refreshes slowly (shifts rotate hourly; state
 * changes only on start/stop), so simple HTTP polling is enough — no WebSocket,
 * and no reconnection edge cases that can silently stall after idle periods.
 *
 * Transient fetch errors are swallowed so one failed poll doesn't stop the rest.
 * Returns a stop function.
 */
export function pollState(onState, intervalMs = POLL_INTERVAL_MS) {
  let stopped = false;
  const id = setInterval(() => {
    getState()
      .then((v) => {
        if (!stopped)
          onState(v);
      })
      .catch(() => {
        /* transient failure; the next tick will retry */
      });
  }, intervalMs);
  return () => {
    stopped = true;
    clearInterval(id);
  };
}

/**
 * Optional integration with the signalk-dead-mans-switch plugin.
 *
 * When enabled (options.enableDeadMansSwitch), arm the switch when a watch
 * starts and disarm it when the watch stops, by POSTing to the switch plugin's
 * REST API on the local SignalK server. Fire-and-forget: starting/stopping the
 * watch never fails because the switch plugin is missing, disabled, or errors —
 * problems are only logged.
 *
 * On a security-enabled server those POSTs need an authenticated admin
 * principal, so the plugin obtains a token via SignalK's access request flow
 * (https://signalk.org/specification/1.8.2/doc/access_requests.html): on start,
 * with the integration enabled and no token configured, it submits an access
 * request and polls until the admin approves it in Security → Access Requests,
 * then saves the granted token into the plugin config.
 */

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const DEADMAN_PLUGIN_ID = "signalk-dead-mans-switch";

/**
 * Base URL of the local SignalK server the plugin routes are mounted on.
 *
 * The port is NOT reliably in settings.json: the standard Raspberry Pi install
 * is socket-activated by systemd (e.g. ListenStream=80) and only surfaces the
 * port via the EXTERNALPORT env var. app.config.getExternalPort() resolves the
 * whole chain (EXTERNALPORT → proxy_port → settings → default), so prefer it
 * and fall back to reading the settings directly on servers too old to have it.
 */
function localServerBase(app) {
  const settings = app?.config?.settings ?? {};
  const protocol = settings.ssl ? "https" : "http";
  const port =
    (typeof app?.config?.getExternalPort === "function" && Number(app.config.getExternalPort())) ||
    Number(settings.port) ||
    3000;
  return `${protocol}://127.0.0.1:${port}`;
}

/**
 * Bring the dead man's switch in line with the watch state: arm on watch,
 * disarm off watch. A no-op unless the integration is enabled in the options.
 *
 * @param {object} app SignalK app handle (server settings + logging)
 * @param {object} options plugin config
 * @param {boolean} onWatch the watch state the switch should reflect
 * @returns {Promise<void>} settles when the request finishes; never rejects
 */
export function syncDeadmansSwitch(app, options, onWatch) {
  if (!options || !options.enableDeadMansSwitch)
    return Promise.resolve();

  const action = onWatch ? "arm" : "disarm";
  const url = `${localServerBase(app)}/plugins/${DEADMAN_PLUGIN_ID}/${action}`;
  const debug = typeof app?.debug === "function" ? app.debug : () => {};
  const error = typeof app?.error === "function" ? app.error : () => {};

  // When server security is enabled, /plugins/* routes require an authenticated
  // readwrite/admin user — a bare loopback POST gets a 401. The configured
  // access token authenticates us the same way the admin UI's requests do.
  const token = typeof options.deadMansSwitchToken === "string" ? options.deadMansSwitchToken.trim() : "";
  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  debug(`dead man's switch: POST ${url} (getExternalPort=${typeof app?.config?.getExternalPort === "function" ? app.config.getExternalPort() : "n/a"}, settings.port=${app?.config?.settings?.port}, ssl=${!!app?.config?.settings?.ssl}, token=${token ? "set" : "not set"})`);
  return fetch(url, { method: "POST", headers })
    .then(async (res) => {
      // Read the body either way — on failure it usually says why (e.g. an
      // auth error page), and on success it confirms the switch's new state.
      const body = await res.text().catch(() => "");
      if (res.ok) {
        debug(`dead man's switch ${action}ed: ${res.status} ${body}`);
      } else {
        const hint =
          res.status === 401 || res.status === 403
            ? " — server security is enabled; set a valid Dead man's switch access token in the plugin config"
            : "";
        error(`watch-schedule: dead man's switch ${action} failed: POST ${url} → ${res.status} ${body.slice(0, 200)}${hint}`);
      }
    })
    .catch((e) => {
      error(`watch-schedule: dead man's switch ${action} failed: POST ${url} → ${e.cause?.code ?? e.message} — is ${DEADMAN_PLUGIN_ID} installed and enabled?`);
    });
}

// How often a pending access request is polled, and how long to wait before
// re-submitting after a failure (endpoint unreachable, request rejected, or the
// pending request vanished — the server keeps them in memory and prunes after
// an hour, so a server restart or a slow admin both land here).
const ACCESS_POLL_MS = 10_000;
const ACCESS_RETRY_MS = 60_000;

/**
 * Obtain a security token for the arm/disarm calls via SignalK's access
 * request flow. Submits (or resumes) a device access request for admin
 * permissions — /plugins/* routes require an admin principal — and polls until
 * the admin approves or denies it. On approval, `onToken(token)` is invoked so
 * the caller can save it into the plugin config. On denial the flow stops; the
 * next plugin start asks again.
 *
 * The clientId (a UUID, per the spec) and the pending request href are
 * persisted in the plugin data dir so a plugin restart resumes the same
 * request instead of stacking up new ones.
 *
 * Whether a token is needed at all is read from GET /skServer/loginStatus
 * (`authenticationRequired`) — the same source of truth the webapp uses; the
 * flow stops without requesting anything when security is disabled.
 *
 * @param {{ app: object, onToken: (token: string) => void, pollMs?: number, retryMs?: number }} ctx
 * @returns {() => void} cancel function (safe to call any time)
 */
export function requestDeadmanToken(ctx) {
  const { app, onToken } = ctx;
  const pollMs = ctx.pollMs ?? ACCESS_POLL_MS;
  const retryMs = ctx.retryMs ?? ACCESS_RETRY_MS;
  const debug = typeof app?.debug === "function" ? app.debug : () => {};
  const error = typeof app?.error === "function" ? app.error : () => {};

  const base = localServerBase(app);
  const file = path.join(app.getDataDirPath(), "deadman-access-request.json");
  let cancelled = false;
  let timer = null;

  const load = () => {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8")) || {};
    } catch {
      return {};
    }
  };
  const save = (data) => {
    try {
      fs.writeFileSync(file, JSON.stringify(data));
    } catch (e) {
      error(`watch-schedule: failed to persist access request state: ${e.message}`);
    }
  };
  const schedule = (fn, ms) => {
    if (cancelled)
      return;
    timer = setTimeout(fn, ms);
    if (typeof timer.unref === "function")
      timer.unref();
  };

  // Does this server need a token at all? Ask the server rather than poking at
  // app.securityStrategy — the strategy object has no public "is security on"
  // API, while /skServer/loginStatus reports authenticationRequired (and
  // whether device access requests are allowed) to anyone.
  async function checkSecurity() {
    if (cancelled)
      return;
    try {
      const res = await fetch(`${base}/skServer/loginStatus`);
      if (cancelled)
        return;
      if (!res.ok)
        throw new Error(`GET /skServer/loginStatus → ${res.status}`);
      const status = await res.json();
      if (cancelled)
        return;
      if (!status.authenticationRequired) {
        debug("dead man's switch: server security is disabled — no access token needed");
        return;
      }
      if (status.allowDeviceAccessRequests === false) {
        error("watch-schedule: cannot request a dead man's switch access token — enable 'Allow Device Access Requests' in the server's Security settings, or set a token manually (retrying)");
        schedule(checkSecurity, retryMs);
        return;
      }
      // Resume a request left pending by a previous run (e.g. the plugin
      // restarted on a config change while the admin hadn't answered yet),
      // else start fresh.
      const pending = load().href;
      if (pending)
        poll(pending);
      else
        submit();
    } catch (e) {
      if (!cancelled) {
        error(`watch-schedule: could not read the server's login status: ${e.cause?.code ?? e.message}`);
        schedule(checkSecurity, retryMs);
      }
    }
  }

  async function submit() {
    if (cancelled)
      return;
    // The clientId identifies this plugin across requests (spec: a UUID kept
    // stable), so a re-request after a prune/restart reuses the same identity.
    const clientId = load().clientId || randomUUID();
    save({ clientId });
    try {
      const res = await fetch(`${base}/signalk/v1/access/requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          description: "Watch Schedule — dead man's switch integration",
          permissions: "admin",
        }),
      });
      const reply = await res.json().catch(() => ({}));
      if (cancelled)
        return;
      if (res.status === 202 && reply.href) {
        save({ clientId, href: reply.href });
        debug(`dead man's switch: access request submitted (${reply.href}) — approve it in the admin UI under Security → Access Requests`);
        schedule(() => poll(reply.href), 0); // an admin may already have approved a resumed request
      } else {
        const hint = res.status === 403 ? " — enable 'Allow Device Access Requests' in the server's Security settings" : "";
        error(`watch-schedule: dead man's switch access request rejected: ${res.status} ${reply.message ?? ""}${hint}`);
        schedule(submit, retryMs);
      }
    } catch (e) {
      if (!cancelled) {
        error(`watch-schedule: dead man's switch access request failed: ${e.cause?.code ?? e.message}`);
        schedule(submit, retryMs);
      }
    }
  }

  async function poll(href) {
    if (cancelled)
      return;
    try {
      const res = await fetch(`${base}${href}`);
      if (cancelled)
        return;
      if (!res.ok) {
        // The request is gone (server restarted, or pruned unanswered after an
        // hour) — drop the stale href and ask again.
        debug(`dead man's switch: pending access request ${href} is gone (${res.status}) — re-submitting`);
        save({ clientId: load().clientId });
        schedule(submit, retryMs);
        return;
      }
      const reply = await res.json();
      if (reply.state !== "COMPLETED") {
        schedule(() => poll(href), pollMs);
        return;
      }
      save({ clientId: load().clientId }); // request finished either way — clear the href
      const outcome = reply.accessRequest ?? {};
      if (outcome.permission === "APPROVED" && outcome.token) {
        debug("dead man's switch: access request approved — saving the token to the plugin config");
        onToken(outcome.token);
      } else {
        error("watch-schedule: dead man's switch access request was denied — approve the next request, set a token manually, or disable the integration");
      }
    } catch (e) {
      if (!cancelled) {
        error(`watch-schedule: dead man's switch access request poll failed: ${e.cause?.code ?? e.message}`);
        schedule(() => poll(href), pollMs);
      }
    }
  }

  checkSecurity();

  return () => {
    cancelled = true;
    if (timer)
      clearTimeout(timer);
  };
}

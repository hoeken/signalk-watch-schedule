# signalk-watch-schedule

A [SignalK](https://signalk.org) plugin + webapp for running a crew **watch schedule**
on offshore or overnight passages. The captain defines watch teams and picks a
rotation; the plugin tracks whether the boat is on watch, when it started, and shows a clean,
color-coded, responsive schedule on any device.

## Features

- **Watch teams** configured in the plugin settings — name each for the watch or the crew standing it.
- **Built-in rotation systems**: 4-on/4-off, 3-on/3-off, 6-on/6-off, and Royal Navy dog watches.
- **Whole-hour starts** — the schedule always begins on a clean clock hour, with a start-time
  picker covering ±12 hours so you can sync a watch that began earlier or schedule one ahead.
- **Pick who's first** — drag (or nudge with ▲/▼) the watch teams into order; the team on top
  starts at the chosen time, the rest follow.
- **Live, color-coded schedule** starting with the active shift, highlighted and counting down.
- **Auth-aware UI** — anyone can view the schedule; logged-in users get start/stop control.
- **Everything published under `watch.*`** so other SignalK consumers can use it too.

## How it works

```
src/core/    Shared, dependency-free schedule logic — the single source of truth.
             Imported unchanged by both the server plugin and the webapp.
index.js     Plugin: holds state, publishes watch.*, exposes the REST API.
webapp/      React + Vite UI, builds into public/.
```

The core module turns a **time-agnostic** rotation definition (segments as minute offsets +
durations) plus an absolute start time into concrete shifts. The server publishes the inputs
(`watch.state.*`, `watch.system`, `watch.teams`) and the webapp re-runs the *same* core
function each second, so the displayed schedule, countdowns, and the server's published
`watch.schedule` can never disagree.

## Install

From the SignalK **App Store**, search for `signalk-watch-schedule`. Or manually:

```bash
cd ~/.signalk/node_modules
git clone https://github.com/hoeken/signalk-watch-schedule.git
cd signalk-watch-schedule && npm install && npm run build:webapp
```

Then enable the plugin in **Server → Plugin Config** and open it from **Webapps**.

## Configuration

| Setting | Description |
|---|---|
| **Watch Teams** | One entry per watch, in rotation order. Name it for the watch (e.g. Port Watch) or the crew member(s) standing it. |
| **Default Watch System** | Rotation pre-selected when starting a watch. |
| **Start-time rounding** | How the start snaps to the hour: `nearest` / `up` / `down`. |
| **Shifts to publish** | How many upcoming shifts to publish and show. |

Only systems whose required team count fits your configured teams are offered (e.g. a
three-team rotation appears once you have three teams).

## SignalK paths

| Path | Description |
|---|---|
| `watch.state.onWatch` | Watch active flag. |
| `watch.state.startedAt` | Epoch ms the watch began (whole hour). |
| `watch.state.systemId` | Active rotation id. |
| `watch.system` | Full active system definition. |
| `watch.teams` | Configured watch teams, in rotation order. |
| `watch.current` / `watch.next` | Active and upcoming shift. |
| `watch.schedule` | Ordered upcoming shifts, current first. |

## REST API

Base: `/plugins/signalk-watch-schedule/api`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/state` | read | Current state + resolved schedule. |
| GET | `/config` | read | Teams + defaults. |
| GET | `/systems` | read | Available watch systems. |
| POST | `/watch/start` | write | Start (or restart) the watch. |
| POST | `/watch/stop` | write | Stop the watch. |

The machine-readable OpenAPI spec is browsable in the SignalK admin UI under
**Documentation → OpenAPI**.

### Starting and stopping the watch

`POST /watch/start` takes an optional JSON body:

| Field | Type | Description |
|---|---|---|
| `systemId` | string | Which rotation to run — one of the ids from `GET /systems`. Defaults to the configured default system. |
| `startAt` | number | Start time in epoch ms, snapped to a whole clock hour (per the configured rounding). May be in the past or future. Defaults to now. |
| `teamOrder` | number[] | Permutation of team indices; the team at position 0 is first on watch. Defaults to configuration order. |

Both endpoints return the full watch view (the same data published under `watch.*`),
so a `200` response means the change took effect. Starting while a watch is already
running restarts it with the new parameters; stopping is idempotent.

```bash
BASE=http://localhost:3000/plugins/signalk-watch-schedule/api

# Start a 4-on/4-off watch now, with the second team first on watch
curl -X POST "$BASE/watch/start" \
  -H 'Content-Type: application/json' \
  -d '{"systemId": "fixed-4-4", "teamOrder": [1, 0]}'

# Stop the watch
curl -X POST "$BASE/watch/stop"
```

When server security is enabled, the write endpoints (`/watch/start`, `/watch/stop`)
return `401` unless the request is authenticated. Log in first and send the token:

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/signalk/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username": "me", "password": "secret"}' | jq -r .token)

curl -X POST "$BASE/watch/start" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"systemId": "fixed-4-4"}'
```

The read endpoints are always open, so dashboards and other consumers can follow the
schedule without credentials.

## Development

```bash
npm install
npm test                 # core + server unit tests (node:test)
npm run dev:webapp       # Vite dev server, proxies to SignalK on :3000
npm run build:webapp     # build the UI into public/
```

The dev server proxies `/plugins`, `/skServer`, and `/signalk` (incl. WebSocket) to a SignalK
server on `localhost:3000`.

## License

Apache-2.0 © Zach Hoeken

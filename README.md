# signalk-watch-schedule

A [SignalK](https://signalk.org) plugin + webapp for running a crew **watch schedule**
on offshore or overnight passages. The captain defines watch teams, assigns crew, and picks a
rotation; the plugin tracks whether the boat is on watch, when it started, and shows a clean,
color-coded, responsive schedule on any device.

![status: alpha](https://img.shields.io/badge/status-alpha-orange)

## Features

- **Watch teams + crew** configured in the plugin settings.
- **Built-in rotation systems**: 4-on/4-off, 3-on/3-off, 6-on/6-off, and Royal Navy dog watches.
- **Whole-hour starts** — the schedule always begins on a clean clock hour, with a start-time
  picker covering ±12 hours so you can log a watch that began earlier or schedule one ahead.
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
| **Watch Teams** | One entry per watch; each has a name and a crew list. |
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
| `watch.teams` | Teams and crew. |
| `watch.current` / `watch.next` | Active and upcoming shift. |
| `watch.schedule` | Ordered upcoming shifts, current first. |

## REST API

Base: `/plugins/signalk-watch-schedule/api`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/state` | read | Current state + resolved schedule. |
| GET | `/config` | read | Teams + defaults. |
| GET | `/systems` | read | Available watch systems. |
| POST | `/watch/start` | write | Body `{ systemId, startAt?, teamOrder? }`. `startAt` (epoch ms) snaps to the hour and defaults to now; `teamOrder` is a permutation of team indices putting one team first. |
| POST | `/watch/stop` | write | Stops the watch. |

Write endpoints require an authenticated SignalK user when server security is enabled.

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

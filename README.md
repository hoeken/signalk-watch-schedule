# signalk-watch-schedule

A [SignalK](https://signalk.org) plugin + webapp for running a crew **watch schedule**
on offshore or overnight passages. The captain defines watch teams and picks a
rotation; the plugin tracks whether the boat is on watch, when it started, and shows a clean,
color-coded, responsive schedule on any device.

## Features

- **Watch teams** — default teams come from the plugin settings (or `communication.crewNames`),
  and can be renamed, added, removed, and reordered per watch right in the web UI.
- **Built-in rotation systems**: 4-on/4-off, 3-on/3-off, 6-on/6-off, and Royal Navy dog watches —
  the picker offers the rotations that fit your team count.
- **Custom watch systems** — define your own rotations as JSON in the plugin settings; they're
  offered everywhere the built-ins are. See [Custom watch systems](#custom-watch-systems).
- **Whole-hour starts** — the schedule always begins on a clean clock hour, with a start-time
  picker covering ±12 hours so you can sync a watch that began earlier or schedule one ahead.
- **Pick who's first** — drag (or nudge with ▲/▼) the watch teams into order; the team on top
  starts at the chosen time, the rest follow.
- **Live, color-coded schedule** starting with the active shift, highlighted and counting down.
- **Auth-aware UI** — anyone can view the schedule; logged-in users get start/stop control.
- **Dead man's switch integration** — optionally arm
  [signalk-dead-mans-switch](https://www.npmjs.com/package/signalk-dead-mans-switch) while a
  watch is running, with its check-in panel embedded right in the web UI.
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
| **Default Watch Teams** | The default teams offered when starting a watch, in rotation order. Name each for the watch (e.g. Port Watch) or the crew member(s) standing it. Leave empty to use `communication.crewNames` when published. |
| **Default Watch System** | Rotation pre-selected when starting a watch, listed as `[X Teams] Name`. |
| **Custom Watch Systems** | Your own rotations, offered alongside the built-ins — see [Custom watch systems](#custom-watch-systems). |
| **Start-time rounding** | How the start snaps to the hour: `nearest` / `up` / `down`. |
| **Shifts to publish** | How many upcoming shifts to publish and show. |
| **Automatically start a watch under way** | Start a watch (defaults apply) when `navigation.state` becomes sailing/motoring. |
| **Automatically stop the watch at rest** | Stop the watch when `navigation.state` becomes moored/anchored. |
| **Arm the dead man's switch on watch** | Arm `signalk-dead-mans-switch` when a watch starts and disarm it when the watch stops. Off by default; see below. |
| **Dead man's switch access token** | Only used when server security is enabled: the SignalK access token sent with the arm/disarm requests. Filled in automatically via an access request — see below. |

These teams are only the *defaults*: the web UI can add, remove, rename, and reorder teams
before starting a watch. Those per-watch edits are kept in the browser (so they come back
after stopping a watch to tweak something) — only an active watch's teams are stored on the
server. Only systems whose required team count matches the current teams are offered (e.g. a
three-team rotation appears once you have three teams).

## Custom watch systems

When the built-in rotations don't fit your crew, add your own under **Custom Watch
Systems** in the plugin settings. Each entry has an **Id** (a stable unique key, e.g.
`swedish-3` — it must not collide with a built-in or another custom id), a **Name**
shown in the pickers, an optional **Description**, and a **Config JSON** holding the
schedule definition itself.

Valid custom systems behave exactly like built-ins: they appear in the web UI picker
(when the team count matches), in `GET /systems`, and in the **Default Watch System**
dropdown. Invalid entries are skipped and the reason is written to the server log when
the plugin starts, so a typo can never take the schedule down.

### Config JSON format

The config is one JSON object describing a repeating rotation. All times are **minutes**.

```json
{
  "teamCount": 2,
  "cycleDuration": 1440,
  "anchored": true,
  "segments": [
    { "offset": 0,   "duration": 720, "teamIndex": 0, "label": "Day" },
    { "offset": 720, "duration": 720, "teamIndex": 1, "label": "Night" }
  ]
}
```

| Key | Type | Description |
|---|---|---|
| `teamCount` | number | Teams the rotation needs, at most 5 (the web UI's team limit — systems needing more are rejected). The system is only offered when the watch has exactly this many teams. |
| `cycleDuration` | number | Total minutes in one full cycle. The segments must sum to exactly this; the rotation repeats forever. |
| `anchored` | boolean, optional | Omitted/`false`: a plain rotating cycle — offset 0 is whenever the watch starts. `true`: anchored to the clock — offset 0 is local midnight, so segment boundaries always land on the same clock hours (use this for traditional named watches). |
| `segments` | array | The shifts of one cycle, in order. They must be contiguous and gap-free: the first `offset` is 0 and each subsequent one equals the previous `offset + duration`. |
| `segments[].offset` | number | Minutes from the start of the cycle. |
| `segments[].duration` | number | Length of the shift in minutes (> 0). |
| `segments[].teamIndex` | number | Which team stands it — 0-based, less than `teamCount`. |
| `segments[].label` | string, optional | Nominal watch name, e.g. `"First Dog"`. |

Two things the plugin handles for you: fairness math (a cycle can span several days —
see the built-in dog-watch systems, which use an odd number of watches per day so teams
rotate through every slot), and who goes first (the rotation is re-based at start time so
the team listed first is on duty for the starting segment, even in anchored systems —
`teamIndex` only defines the *pattern*, not which crew ends up where).

### Generating a config with AI

The format is simple enough that any LLM assistant (Claude, ChatGPT, …) can write one for
you. Paste the table and example above — or this ready-made prompt — and describe your
rotation in plain language:

> Write a watch-schedule config JSON: one object with `teamCount`, `cycleDuration`,
> optional `anchored`, and `segments` (`offset`, `duration`, `teamIndex`, optional
> `label`), all times in minutes. Segments must be contiguous from offset 0 and sum
> exactly to `cycleDuration`; `teamCount` is at most 5; `teamIndex` is 0-based and less than `teamCount`. Set
> `anchored: true` only if the watches should land on fixed clock hours (offset 0 =
> local midnight). My rotation: **three crew, classic Swedish system — night split
> into two 3-hour watches (19–22, 22–01… adjust to taste), days in 4–5 hour blocks,
> rotating so everyone gets each slot over three days.**
>
> Check your math, then output only the JSON.

Paste the result into the entry's **Config JSON** field, save, and check the server log
if the system doesn't appear in the pickers (validation errors are reported there).

## Dead man's switch integration

With [signalk-dead-mans-switch](https://www.npmjs.com/package/signalk-dead-mans-switch)
installed and **Arm the dead man's switch on watch** enabled, the two plugins work as one:

- Starting a watch (from the web UI, the REST API, or the automatic
  `navigation.state` triggers) **arms** the switch, so periodic "you still there?"
  check-ins run while someone is supposed to be on watch.
- Stopping the watch **disarms** it — no more check-ins at anchor.
- While a watch is running, the switch's check-in panel is embedded below the
  controls in the web UI, so the on-watch crew can acknowledge without leaving
  the schedule. The `mode=day|night` query param (passed by B&G displays for
  theming) is forwarded to the embedded panel so both apps match.

The arm/disarm calls are plain `POST`s to the switch plugin's API on the local
server (`/plugins/signalk-dead-mans-switch/arm` and `/disarm`), fire-and-forget:
if the switch plugin is missing or unreachable the watch still starts and stops
normally, and the failure is only logged.

When server security is enabled, SignalK requires an authenticated admin
principal for all `/plugins/*` requests, so the arm/disarm calls need a token.
The plugin obtains one by itself using SignalK's
[access request](https://signalk.org/specification/1.8.2/doc/access_requests.html)
flow: on startup, with the integration enabled and no token configured, it
submits a device access request — approve it in the admin UI under
**Security → Access Requests** (it appears as *"Watch Schedule — dead man's
switch integration"*) and the granted token is saved into the plugin config
automatically. If the request is denied, the plugin asks again on its next
start. You can also paste a token in manually (e.g. one from
`signalk-generate-token`) to skip the approval step.

Note that the server must have **Allow Device Access Requests** enabled
(Security settings) for the automatic flow to work.

## SignalK paths

| Path | Description |
|---|---|
| `watch.state.onWatch` | Watch active flag. |
| `watch.state.startedAt` | Epoch ms the watch began (whole hour). |
| `watch.state.systemId` | Active rotation id. |
| `watch.system` | Full active system definition. |
| `watch.teams` | Watch teams, in rotation order (per-watch overrides applied). |
| `watch.current` / `watch.next` | Active and upcoming shift. |
| `watch.schedule` | Ordered upcoming shifts, current first. |

## REST API

Base: `/plugins/signalk-watch-schedule/api`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/state` | read | Current state + resolved schedule. |
| GET | `/config` | read | Default teams + defaults. |
| GET | `/systems` | read | Available watch systems (`?teamCount=N` for a specific team count). |
| POST | `/watch/start` | write | Start (or restart) the watch. |
| POST | `/watch/stop` | write | Stop the watch. |

The machine-readable OpenAPI spec is browsable in the SignalK admin UI under
**Documentation → OpenAPI**.

### Starting and stopping the watch

`POST /watch/start` takes an optional JSON body — every field is optional and falls back
to the plugin defaults:

| Field | Type | Description |
|---|---|---|
| `systemId` | string | Which rotation to run — one of the ids from `GET /systems`. Defaults to the configured default system. |
| `startAt` | number | Start time in epoch ms, snapped to a whole clock hour (per the configured rounding). May be in the past or future. Defaults to now. |
| `teams` | {name}[] | Custom teams for this watch, in watch order (position 0 first on watch). Overrides the default teams; the `systemId` must match this team count. Stored with the watch and cleared on stop. Defaults to the configured teams (or `communication.crewNames`). |
| `teamOrder` | number[] | Permutation of team indices; the team at position 0 is first on watch. Defaults to the natural order. |

Both endpoints return the full watch view (the same data published under `watch.*`),
so a `200` response means the change took effect. Starting while a watch is already
running restarts it with the new parameters; stopping is idempotent.

```bash
BASE=http://localhost:3000/plugins/signalk-watch-schedule/api

# Start a 4-on/4-off watch now, with the second team first on watch
curl -X POST "$BASE/watch/start" \
  -H 'Content-Type: application/json' \
  -d '{"systemId": "fixed-4-4", "teamOrder": [1, 0]}'

# Start a three-team rotation with custom teams for this watch only
curl -X POST "$BASE/watch/start" \
  -H 'Content-Type: application/json' \
  -d '{"systemId": "fixed-4-8", "teams": [{"name": "Alice"}, {"name": "Bob"}, {"name": "Chloe"}]}'

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

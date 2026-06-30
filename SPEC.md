# signalk-watch-schedule — Specification

A [SignalK](https://signalk.org) server plugin + embedded webapp for running a crew
**watch schedule** on offshore or overnight passages. The captain defines watch teams,
assigns crew, and picks a rotation system; the plugin tracks whether the boat is "on watch",
when the watch began, and publishes everything the UI needs under the `watch.*` path.

---

## 1. Goals & Principles

1. **Single source of truth for schedule math.** A pure, dependency-free `core` module
   computes the schedule. It is imported *unchanged* by both the Node server plugin and the
   browser webapp. No duplicated logic.
2. **Time-agnostic schedule definitions.** A watch *system* (rotation) is defined as repeating
   segments expressed as **offsets and durations in minutes** from the start of the cycle — it
   contains no absolute clock times. Absolute times are derived at runtime from `startedAt`.
3. **Watch starts on a whole hour.** When a watch is started, the effective start time is
   snapped to a whole-number hour so segment boundaries land on clean clock times.
4. **Server owns truth; UI is a view.** The server holds authoritative state and exposes it via
   SignalK deltas (`watch.*`) and a small REST API. The webapp renders and issues start/stop.
5. **Responsive & auth-aware.** Clean UI for mobile / tablet / desktop. Read-only for anonymous
   users; control surface appears only when logged in with write permission.

---

## 2. Repository Layout

Single npm package (so it installs cleanly from the SignalK app store) with a shared `core`
folder consumed by both runtimes.

```
signalk-watch-schedule/
├── package.json              # plugin manifest (keywords: signalk-node-server-plugin, signalk-webapp)
├── index.js                  # plugin entry point (registers with SignalK)
├── src/
│   ├── server/
│   │   ├── state.js          # runtime state + JSON state-file persistence
│   │   ├── api.js            # REST route handlers (start/stop, config, systems, state)
│   │   └── publisher.js      # builds & emits watch.* SignalK deltas
│   └── core/                 # ★ SHARED MODULE — pure JS, zero dependencies ★
│       ├── index.js          # public API re-exports
│       ├── types.js          # JSDoc typedefs (the data contracts)
│       ├── systems.js        # built-in watch-system presets
│       ├── schedule.js       # resolveSchedule(), getCurrentShift(), snapToHour()
│       └── colors.js         # deterministic team → color palette
├── webapp/
│   ├── index.html
│   ├── vite.config.js        # builds to ../public, allows importing ../src/core
│   └── src/                  # React app (imports from ../../src/core)
└── public/                   # built webapp (generated; git-ignored)
```

> **Why not workspaces?** A single package keeps SignalK app-store install/discovery trivial.
> Vite's `server.fs.allow` / `resolve.alias` lets the webapp import `src/core` directly, and
> Node `require`s the same files — one copy, two consumers.

---

## 3. The Shared `core` Module (single source of truth)

### 3.1 Data contracts (`types.js`)

```js
/**
 * A watch TEAM = a named group of crew. Teams are ordered; rotations reference them by
 * index, and their position in the array is their stable key (index 0 = first on watch).
 * @typedef {Object} WatchTeam
 * @property {string} name      - display name, e.g. "Port Watch" / "Alice & Bob"
 * @property {string[]} crew    - crew member names assigned to this team
 */

/**
 * One segment of a rotation cycle. Time-agnostic: minutes only, no clock times.
 * @typedef {Object} WatchSegment
 * @property {number} offset    - minutes from the start of the cycle when this segment begins
 * @property {number} duration  - length of this segment in minutes
 * @property {number} teamIndex - which team is on duty (0-based index into the team list)
 * @property {string} [label]   - optional label, e.g. "First Dog Watch"
 */

/**
 * A WATCH SYSTEM = a complete repeating rotation definition.
 * @typedef {Object} WatchSystem
 * @property {string} id            - stable key, e.g. "rn-dog-watches"
 * @property {string} name          - "Royal Navy (Dog Watches)"
 * @property {string} description
 * @property {number} teamCount     - number of teams this rotation requires
 * @property {number} cycleDuration - total minutes in one full cycle (segments sum to this)
 * @property {boolean} [builtin]    - true for shipped presets
 * @property {WatchSegment[]} segments  - ordered, contiguous, covering [0, cycleDuration)
 */

/**
 * A concrete, resolved shift with absolute times — produced at runtime, never stored.
 * @typedef {Object} ResolvedShift
 * @property {number} teamIndex
 * @property {string} teamName
 * @property {string[]} crew
 * @property {number} startTime   - epoch ms
 * @property {number} endTime     - epoch ms
 * @property {number} durationMin
 * @property {string} color       - hex
 * @property {string} [label]
 * @property {boolean} isCurrent
 * @property {number} cycleIndex  - which rotation cycle this shift belongs to (0,1,2…)
 */
```

### 3.2 Core API (`schedule.js`)

```js
/** Snap an epoch-ms timestamp UP/NEAREST to a whole hour (for watch start). */
snapToHour(epochMs, mode = 'nearest') => epochMs

/** Validate a system: segments contiguous, cover the full cycle, teamIndex < teamCount. */
validateSystem(system) => { valid: boolean, errors: string[] }

/** Index of the team on duty at `now` (or null if not started / before start). */
getCurrentSegment(system, startedAt, now) => { segment, cycleIndex } | null

/**
 * Produce an ordered list of upcoming concrete shifts, starting with the one active at `now`.
 * @param {WatchSystem} system
 * @param {WatchTeam[]} teams
 * @param {number} startedAt   - epoch ms (already snapped to the hour)
 * @param {number} now         - epoch ms
 * @param {Object} [opts]
 * @param {number} [opts.count=8]       - how many shifts to return
 * @param {number} [opts.horizonHours]  - alternative to count: cap by time window
 * @returns {ResolvedShift[]}
 */
resolveSchedule(system, teams, startedAt, now, opts) => ResolvedShift[]
```

`resolveSchedule` is the heart: it walks segments forward from `startedAt`, repeating the cycle,
emits concrete shifts with absolute `startTime`/`endTime`, attaches the team's crew + color,
and flags the one containing `now` as `isCurrent`. **This same function renders the server's
published `watch.schedule` and the webapp's shift list — guaranteeing they always agree.**

### 3.3 Colors (`colors.js`)

`getTeamColor(teamIndex)` returns a deterministic, high-contrast, colorblind-considerate hex
from a fixed palette so team N is always the same color in server output and UI.

---

## 4. Built-in Watch Systems (`systems.js`)

Shipped as presets. All are time-agnostic (offsets/durations in minutes). Captain selects which
to use at start time; only systems whose `teamCount` ≤ configured team count are offered.

| id                 | Name                         | Teams | Cycle  | Notes |
|--------------------|------------------------------|-------|--------|-------|
| `fixed-4-4`        | 4-on / 4-off                 | 2     | 8 h    | Equal blocks, two teams alternate. |
| `fixed-3-3`        | 3-on / 3-off                 | 2     | 6 h    | Shorter blocks, less sleep debt swing. |
| `fixed-6-6`        | 6-on / 6-off                 | 2     | 12 h   | Two watches a day. |
| `rn-dog-watches`   | Royal Navy (Dog Watches)     | 2     | 24 h   | 4-h watches + two 2-h dog watches (16:00–18:00, 18:00–20:00) so the rotation shifts daily. |

Each preset includes `description` text for display. Example (`fixed-4-4`):

```js
{
  id: 'fixed-4-4', name: '4-on / 4-off', teamCount: 2, cycleDuration: 480, builtin: true,
  segments: [
    { offset: 0,   duration: 240, teamIndex: 0 },
    { offset: 240, duration: 240, teamIndex: 1 },
  ],
}
```

> Exact dog-watch segment tables will be finalized in implementation and validated by
> `validateSystem()`. The Royal Navy dog-watch table is defined relative to a whole-hour
> start so the published watches land on clean clock times.

---

## 5. Server Plugin

### 5.1 Plugin config schema (SignalK `schema`)

```jsonc
{
  "teams": [                      // "how many watches" + crew assignment; order is the key
    { "name": "Port Watch",      "crew": ["Alice", "Bob"] },
    { "name": "Starboard Watch", "crew": ["Carol", "Dave"] }
  ],
  "defaultSystemId": "fixed-4-4", // default rotation offered/selected at start
  "publishHorizon": 8,            // how many upcoming shifts to publish/return
  "snapMode": "nearest"           // how to round start time to the hour: nearest | up | down
}
```

The SignalK plugin `schema` (JSON-Schema) renders an editable form in the admin UI for the
above. Team count is dynamic (add/remove array items); crew are free-text arrays.

### 5.2 Runtime state (persisted to `<dataDir>/state.json`)

```jsonc
{
  "onWatch": false,        // is the boat currently standing watches?
  "startedAt": null,       // epoch ms, snapped to the hour, when current watch began
  "systemId": null,        // which WatchSystem is active
  "teamOrder": null        // permutation of team indices (team at position 0 is first on watch); null = config order
}
```

Loaded on `start()`, written on every change, so state survives a server restart.

### 5.3 SignalK published paths (`watch.*`)

Emitted as deltas whenever state changes and on a periodic tick (so `current`/`next`
transitions publish even with no API call). Values may be objects (SignalK permits this).

| Path                    | Value | Description |
|-------------------------|-------|-------------|
| `watch.state.onWatch`   | bool  | Watch active flag. |
| `watch.state.startedAt` | number / null | Epoch ms the watch began (whole hour). |
| `watch.state.systemId`  | string / null | Active system id. |
| `watch.system`          | object | The full resolved `WatchSystem` in use (so UI needs nothing else). |
| `watch.teams`           | array | Configured teams + crew. |
| `watch.current`         | object / null | The active `ResolvedShift`. |
| `watch.next`            | object / null | The upcoming `ResolvedShift`. |
| `watch.schedule`        | array | Next `publishHorizon` `ResolvedShift`s (the list the UI renders). |

Plugin registers metadata for these paths. Everything required to build the web UI is reachable
from `watch.*` alone.

### 5.4 REST API

Mounted under the plugin's router base: `/plugins/signalk-watch-schedule/api`.

| Method | Path             | Auth        | Body / Result |
|--------|------------------|-------------|---------------|
| GET    | `/state`         | read        | `{ onWatch, startedAt, systemId, current, next, schedule }` |
| GET    | `/config`        | read        | `{ teams, defaultSystemId, publishHorizon }` |
| GET    | `/systems`       | read        | `WatchSystem[]` — built-ins + custom, filtered to `teamCount ≤ teams.length` |
| POST   | `/watch/start`   | **write**   | body `{ systemId, startAt?, teamOrder? }` → snaps `startAt` (default now) to a whole hour, applies `teamOrder`, sets state, returns new `/state` |
| POST   | `/watch/stop`    | **write**   | clears `onWatch` and `teamOrder`, returns new `/state` |

- Start with no/invalid `systemId` falls back to `defaultSystemId`.
- `startAt` (epoch ms) lets the caller begin a watch up to ±12h from now; it is always snapped to a whole hour. `teamOrder` must be a permutation of the configured teams' indices, else it is ignored (natural order). Both are applied by the shared core (`orderTeams`) so the published `watch.teams`/`watch.schedule` and the UI's recompute agree.
- Start while already on watch returns the current state (idempotent) unless `?force=1` restarts.
- Write endpoints rely on SignalK's security layer (`server.securityStrategy`); unauthenticated
  writes get 401, which the UI uses to drive the login prompt.

---

## 6. Webapp (React + Vite)

### 6.1 Stack

- **React 18 + Vite** build → `public/`, served by SignalK at `/signalk-watch-schedule`.
- Lightweight styling via CSS modules / a small utility layer (no heavyweight UI kit needed);
  responsive with CSS grid/flex + container queries. Mobile-first.
- Data layer: `fetch` to the plugin REST API for control + initial load, and **HTTP
  polling** of the composed watch state on an interval for live updates (the watch
  refreshes slowly, so polling avoids WebSocket reconnection edge cases). Imports `src/core`
  to resolve/format shifts client-side as a fallback and for relative-time labels.

### 6.2 Auth detection

- On load, query SignalK login status (`/signalk/v1/auth/...` / `loginStatus`).
- **Anonymous / read-only:** render the schedule plus a **Login** button (links to SignalK
  login) — no control surface.
- **Logged in with write:** render the **watch control** (start/stop + system picker).
- A `403/401` from a control call also flips the UI back to the login prompt.

### 6.3 Views

**Schedule list** (always visible):
- Vertical list of upcoming shifts, **starting with the currently active one**.
- Each card: team name, assigned crew (if any), start–end clock times, duration, relative
  countdown ("on watch now", "in 2h 15m").
- **Each team has its own color** (from `core/colors`); the **current shift is highlighted**
  (elevated card, accent border, "ON WATCH" badge).
- If `onWatch === false`: empty/idle state ("No watch in progress").

**Watch control** (authed only):
- **System picker**: dropdown of systems from `/systems`. Selecting a system **dynamically
  re-renders** the previewed schedule (using `core/resolveSchedule` against the chosen start
  hour and team order) before committing — so the captain sees the rotation before starting.
- **Start-time picker**: dropdown of every whole hour from now−12h to now+12h, defaulting to the
  nearest hour, so a watch can be logged as having begun earlier or scheduled to begin later.
- **Watch order**: a reorderable list of the configured teams (with their crew). Drag to reorder,
  or use the ▲/▼ buttons (so it works on touch screens and the keyboard). The team at the top
  starts at the chosen time; the rest follow in order. The preview updates live.
- **Start / Stop** button:
  - Start → `POST /watch/start { systemId, startAt, teamOrder }`; UI shows the chosen whole-hour start time.
  - Stop → `POST /watch/stop`.
- Reflects live server state (disabled/loading states during requests).

### 6.4 Responsiveness

- **Mobile:** single column, large touch targets, sticky current-watch header.
- **Tablet/Desktop:** wider cards, optional two-column schedule, control panel beside the list.

---

## 7. Build & Tooling

- `npm run build:webapp` → Vite build into `public/`.
- `npm run dev:webapp` → Vite dev server proxying API + WS to a running SignalK instance.
- `package.json` keywords: `signalk-node-server-plugin`, `signalk-webapp`.
- `core` is plain ES modules with JSDoc types (no TS build step required); unit-tested in
  isolation (it's pure functions) — this is where the bulk of tests live.

---

## 8. Testing Strategy

- **Core (highest value):** unit tests for `snapToHour`, `validateSystem`, `getCurrentSegment`,
  `resolveSchedule` — including cycle wrap-around, dog-watch daily shift, and current-flag edge
  cases at exact boundaries. Every built-in system must pass `validateSystem`.
- **Server:** API handler tests (start snaps to hour, stop clears, auth gating, persistence
  round-trip through the state file).
- **Webapp:** component tests for auth-state branching and current-shift highlighting.

---

## 9. Suggested Milestones

1. **Core module** + built-in systems + tests (the contract everything depends on).
2. **Server plugin**: config schema, state persistence, `watch.*` publisher, REST API.
3. **Webapp**: read-only schedule view wired to `watch.*` + core.
4. **Auth + control**: login detection, system picker with live preview, start/stop.
5. Polish: colors/accessibility, responsive passes, docs/README, app-store metadata.

---

## 10. Open Questions / Future

- Per-segment crew overrides (a one-off swap without editing teams)?
- Watch-handover alarms / notifications (emit a SignalK notification at shift change)?
- Skipper/standby roles outside the rotation?
- Timezone display preference (boat local vs UTC) in the UI.

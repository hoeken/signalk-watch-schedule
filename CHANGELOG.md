# v1.1.0

## ✨ Improvements

- Custom watch systems: define your own rotations in the plugin config (name, optional description, and a schedule JSON). Valid entries behave exactly like the built-ins — offered in the picker, startable, published under `watch.*`, and reconciled across restarts — while broken entries are skipped and reported in the server log so they can never take the built-ins down. The README documents the format and includes a ready-made AI prompt for generating one
- Per-watch team editing (#4): the configured teams are now defaults — add, remove, rename, and reorder teams in the web UI before starting a watch, and those edits apply to that watch only. Custom-team watches survive a server restart even if the config changed
- Optional [signalk-dead-mans-switch](https://www.npmjs.com/package/signalk-dead-mans-switch) integration (#5): when enabled, the dead man's switch is armed whenever a watch starts (manual, API, or automatic) and disarmed when the watch stops — so overnight check-ins run exactly while someone is supposed to be on watch. Off by default
- On security-enabled servers the integration authenticates itself: the plugin submits a SignalK access request on startup, and once you approve it (Security → Access Requests) the granted token is saved into the plugin config automatically
- The REST API is now documented (#3): a machine-readable OpenAPI 3.0 spec appears in the SignalK admin UI under Documentation → OpenAPI, and the README's REST API section has request details and curl examples, including authentication
- Recommends [signalk-einklabel-plugin](https://www.npmjs.com/package/signalk-einklabel-plugin) from the SignalK app store, which now supports displaying the watch schedule on an e-ink label (#6)

## 🎨 Webapp

- Full team editor on the start screen: rename, add/remove (2–5 teams), and drag/▲▼ reorder, seeded from the server defaults with a reset link. Edits persist in localStorage so stopping a watch to tweak something brings the same custom teams back
- While a watch is running with the integration enabled, the dead man's switch check-in panel is embedded below the controls, so the crew can acknowledge without leaving the schedule
- Team colors now lead with red (port) and green (starboard) for a nautical theme (#2)
- The Default Watch System dropdown lists every system — including customs — as "[X Teams] Name", grouped by team count
- Fixed styling when the webapp is embedded in an iframe

# v1.0.0

First stable release. 🎉

## ✨ Improvements

- Automatic watches driven by `navigation.state`: a watch starts when the boat gets under way (sailing/motoring) and stops when it comes to rest (moored/anchored). Independent toggles let you enable start-on-under-way and stop-on-rest separately, and the first reading only sets a baseline — so the plugin won't auto-start just because you're already moving when it loads
- Crew-aware teams: when no teams are configured, the schedule now falls back to SignalK's `communication.crewNames` before the generic "Team 1/2/3" list
- Changing the team count refreshes the available rotations and stops any running watch that no longer fits the new crew size

## 🎨 Webapp

- Click a shift to highlight that team's watches and dim the rest, making a single crew's rotation easy to trace
- The active watch and rotation-picker views now show the selected watch system's description
- A clear warning when the crew size has no matching rotation (rotations cover 2–5 teams)
- "Remember me?" toggle on the login form

## 🔧 Under the hood

- Check for `communication.crewNames` and `navigation.state` paths in config
- Dropped the unused `teamId` from resolved shifts
- Refreshed screenshots and removed the alpha badge now that the plugin is stable

# v0.2.2

## ✨ Improvements

- Hoeken's Dog Watch now names every shift — "Graveyard Shift", "Dawn Patrol", "Up Dog", "Down Dog", "Dinner" and friends — so the rotation reads at a glance

## 🎨 Webapp

- The schedule list is now split around the on-duty watch under "Past Watches", "Current Watch", and "Upcoming Watches" headings (pending and preview watches all group under "Upcoming Watches")

# v0.2.1

## ✨ Improvements

- The live schedule view stays reliably up to date — it now polls the watch state every 5s instead of relying on a streaming WebSocket connection that could quietly stall after the screen sat idle

## 🎨 Webapp

- Bigger, bolder, clearer banners when a watch is in preview or scheduled to start later

# v0.2.0

## ✨ Improvements

- Anchored rotations now lead off with the first team in your order at the chosen start time, instead of letting midnight decide who's on watch first — clock-aligned boundaries and fair rotation are preserved
- Watches scheduled to start in the future stay inactive until they begin: `watch.current` is held null and the webapp shows a "Scheduled" header with a countdown to the start
- Recommends companion plugins (`@meri-imperiumi/signalk-autostate`, `signalk-navico-embedder`) from the SignalK app store

## 🎨 Webapp

- Login moved into a centered modal triggered from the title bar
- Restyled shift card layout and typography, with tighter alignment and a wider, fixed-width watch-time column

## 🔧 Under the hood

- Publish workflow skips releasing a version that's already on npm
- Refreshed screenshots and added a read-only view

# v0.1.0

Initial release.

## ✨ Features

- Crew watch schedule for offshore and overnight sailing — a SignalK plugin plus an embedded webapp
- Rotation library of clock-anchored systems (including 2.5h watches and dog-watch rotations), filtered by team count
- Watch control for authenticated users: pick the rotation, start time (±12h of whole hours), and team order, with a live preview
- Authoritative watch state published as `watch.*` SignalK deltas, plus a small REST API for the webapp

## 🎨 Webapp

- Live schedule view: current shift highlighted with countdowns to upcoming and elapsed shifts, and a full start date-time for multi-day watches
- Draggable team-order list with ▲/▼ controls for nav-station touch screens
- Light/dark theme toggle (session-only)
- PWA: favicons, app icons, and an installable home-screen app generated from the logo at build
- Renders on Chromium 69 (Navico MFDs)

## 🔧 Under the hood

- Shared scheduling core (`src/core`) used by both the server and the webapp
- ESLint (with @stylistic) + Prettier formatting, enforced on pre-commit and in CI
- GitHub Actions CI (SignalK plugin workflow + unit tests) and automated npm release/publish via OIDC trusted publishing

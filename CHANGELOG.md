# v0.2.2

## ✨ Improvements

- 🐕 Hoeken's Dog Watch now names every shift — "Graveyard Shift", "Dawn Patrol", "Up Dog", "Down Dog", "Dinner" and friends — so the rotation reads at a glance

## 🎨 Webapp

- 🗂️ The schedule list is now split around the on-duty watch under "Past Watches", "Current Watch", and "Upcoming Watches" headings (pending and preview watches all group under "Upcoming Watches")

# v0.2.1

## ✨ Improvements

- 🔄 The live schedule view stays reliably up to date — it now polls the watch state every 5s instead of relying on a streaming WebSocket connection that could quietly stall after the screen sat idle

## 🎨 Webapp

- 🔔 Bigger, bolder, clearer banners when a watch is in preview or scheduled to start later

# v0.2.0

## ✨ Improvements

- 🕛 Anchored rotations now lead off with the first team in your order at the chosen start time, instead of letting midnight decide who's on watch first — clock-aligned boundaries and fair rotation are preserved
- ⏳ Watches scheduled to start in the future stay inactive until they begin: `watch.current` is held null and the webapp shows a "Scheduled" header with a countdown to the start
- 🔌 Recommends companion plugins (`@meri-imperiumi/signalk-autostate`, `signalk-navico-embedder`) from the SignalK app store

## 🎨 Webapp

- 🔐 Login moved into a centered modal triggered from the title bar
- 💳 Restyled shift card layout and typography, with tighter alignment and a wider, fixed-width watch-time column

## 🔧 Under the hood

- 🚦 Publish workflow skips releasing a version that's already on npm
- 🖼️ Refreshed screenshots and added a read-only view

# v0.1.0

Initial release.

## ✨ Features

- ⚓ Crew watch schedule for offshore and overnight sailing — a SignalK plugin plus an embedded webapp
- 🔄 Rotation library of clock-anchored systems (including 2.5h watches and dog-watch rotations), filtered by team count
- 🎛️ Watch control for authenticated users: pick the rotation, start time (±12h of whole hours), and team order, with a live preview
- 📡 Authoritative watch state published as `watch.*` SignalK deltas, plus a small REST API for the webapp

## 🎨 Webapp

- 🟢 Live schedule view: current shift highlighted with countdowns to upcoming and elapsed shifts, and a full start date-time for multi-day watches
- ☰ Draggable team-order list with ▲/▼ controls for nav-station touch screens
- 🌓 Light/dark theme toggle (session-only)
- 📱 PWA: favicons, app icons, and an installable home-screen app generated from the logo at build
- 🖥️ Renders on Chromium 69 (Navico MFDs)

## 🔧 Under the hood

- 🧩 Shared scheduling core (`src/core`) used by both the server and the webapp
- 🧹 ESLint (with @stylistic) + Prettier formatting, enforced on pre-commit and in CI
- 🚀 GitHub Actions CI (SignalK plugin workflow + unit tests) and automated npm release/publish via OIDC trusted publishing

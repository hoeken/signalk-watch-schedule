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

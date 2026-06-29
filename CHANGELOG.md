# v0.1.0

Initial release.

## New features

- Crew watch schedule for offshore and overnight sailing, as a SignalK plugin plus an embedded webapp
- Configurable rotation library with clock-anchored systems, filtered by team count
- Live schedule view: current shift highlighted with an ON WATCH badge, with countdowns to upcoming and elapsed shifts
- Watch control for authenticated users: pick the rotation, start time (±12h of whole hours), and team order, with a live preview that updates as you change them
- Draggable team-order list with ▲/▼ controls for touch screens at the nav station
- Authoritative watch state published as `watch.*` SignalK deltas, with a small REST API for the webapp

## Under the hood

- Shared scheduling core (`src/core`) used by both the server and the webapp
- ESLint (with @stylistic) + Prettier formatting, enforced on pre-commit and in CI
- GitHub Actions CI (SignalK plugin workflow + unit tests) and automated npm release/publish via OIDC trusted publishing

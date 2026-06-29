# Development

## Building the webapp

The web UI source lives in `webapp/` (React + Vite) and the shared scheduling
core in `src/core/`. Built artifacts go to `public/`, which is gitignored and
produced fresh on each build.

```bash
npm install
npm run build:webapp
```

For a live dev server with a proxy to a running SignalK server on
`localhost:3000`:

```bash
npm run dev:webapp
```

## Linting & formatting

JS/JSX are linted and formatted by ESLint (with [@stylistic](https://eslint.style));
JSON/CSS/HTML are formatted by Prettier. Configuration lives in
[eslint.config.js](eslint.config.js) and [.prettierrc.json](.prettierrc.json).

```bash
npm run lint          # report problems
npm run lint:fix      # auto-fix what ESLint can
npm run format        # eslint --fix + prettier --write
npm run format:check  # CI check: eslint + prettier --check
```

A Husky pre-commit hook runs `lint-staged` (ESLint/Prettier on staged files)
and the test suite. The same `format:check` and tests run in CI
([.github/workflows/signalk-ci.yml](.github/workflows/signalk-ci.yml)).

## Testing

```bash
npm test
```

## Releasing

The webapp builds automatically before publishing via the `prepack` script in
[package.json](package.json), so `public/` does not need to be committed — both
`npm pack` and `npm publish` rebuild it. See [RELEASE.md](RELEASE.md) for the
full release process.

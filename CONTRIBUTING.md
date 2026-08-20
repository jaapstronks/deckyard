# Contributing

Thanks for your interest in improving this project. This repo is intentionally **dependency-light** (plain Node.js + vanilla ESM; no bundler) and optimized for **maintainability**.

This page is the short version; the full contributor guide (workflow, i18n, testing patterns) lives in [`docs/developer/contributing.md`](docs/developer/contributing.md).

## Development setup

- Install dependencies: `npm install`
- Start server: `npm run start`
- Open: `http://localhost:4177`

Optional: copy `.env.example` to `.env` if you want to test auth or optional features (`AUTH_DEV_BYPASS=true` gives auto-login in dev). Full setup notes in [`docs/developer/dev-setup.md`](docs/developer/dev-setup.md).

## Project structure (quick guide)

- `shared/`: shared logic used by both server and client
  - Slide types are the **single source of truth**
- `client/`: browser UI (no build step)
- `server/`: Node server + file-based persistence

See `AGENTS.md` for architectural non-negotiables (separation of concerns, theming boundaries, cleanup lifecycle).

## Adding or changing slide types (preferred contribution)

Slide types live in:

- `shared/slide-types/types/*.js` (canonical definition: schema + defaults + pure HTML rendering)
- `shared/slide-types/registry.js` (registration)
- `client/styles/slides/**` (CSS for slide styling)

Guidelines:

- Keep `renderHtml()` **pure** (no DOM reads/writes, timers, fetch).
- Escape user-provided text (`esc()` or `markdownToSafeHtml()`).
- If you add runtime behavior, do it in `client/lib/*` and ensure cleanup via the slide mounting pipeline.

## Code style

- Prefer small modules with clear boundaries.
- Avoid adding dependencies unless there's a strong reason.
- Avoid hardcoding brand/copy in shared templates; keep copy centralized in view modules.

## Test the switch, not its position

Assert the _property_ a feature guarantees, not the _setting_ this repo happens
to ship. `--t-gradient-enabled: 0` in every export path is upstream policy, and
a fork that legitimately turns it on is not a regression — but a test written as
"the flag is off everywhere" says it is. Written as "a layer is rasterized
exactly when it paints", the same test covers the same ground and holds on both
sides.

This matters more now that `custom/styles/` lets a fork change styling without
patching core (see [fork-setup.md](docs/reference/fork-setup.md)): the more a
fork may legitimately flip, the more a test that pins a switch _position_ fails
for the wrong reason. When you need a policy default pinned, assert it once
where it is decided — not in every path that reads it.

## Running checks

- `npm test` — the node test suite (also runs in CI on every PR)
- `npm run audit` — refactor snapshot / large-file audit

## Submitting a PR

Please include:

- A clear problem statement
- Before/after screenshots for UI changes (where applicable)
- Notes on cleanup/lifecycle if you added event listeners/timers/SSE/etc.

## Licensing of contributions

By submitting a contribution you agree that it is licensed under the same
[MIT license](LICENSE) as the project (inbound = outbound). See
[`GOVERNANCE.md`](GOVERNANCE.md).

## Branching & releases

- **`main` is stable.** Every commit on it should be releasable; forks are
  told to sync on release tags (see `docs/reference/fork-setup.md`).
- **Small changes** go via a feature branch + PR to `main`.
- **Large multi-PR tracks** (features whose architecture is still being
  proven) go via an **integration branch** (e.g. `collab` for real-time
  collaboration). Sub-PRs target that branch and are reviewed/merged there;
  `main` is only touched by one final umbrella PR once the track as a whole
  is accepted — or never, if it isn't. Integration branches get `main`
  merged into them regularly to prevent drift.
- **Releases** are git tags (`v1.1.0`) + a GitHub Release, with the changes
  summarized in `CHANGELOG.md` (Keep a Changelog format; maintain the
  `[Unreleased]` section as you merge).

# Deckyard — Claude Code instructions

Deckyard is a self-hosted presentation engine for humans and AI agents:
vanilla JS ESM on client and server, no framework, no bundler. Deep
conventions (module layout, slide-type system, theming, escaping, lifecycle
cleanup) live in **`AGENTS.md`** — read it before structural work.

## Where to start

- **`docs/plans/TODO.md`** — the operational worklist (in progress / queue /
  done). When asked to "pick up the next thing" or plan work, read this file
  first, not the whole plans folder.
- **`ROADMAP.md`** — the coarse public overview. One line per project, linked
  to an elaborated briefing in `docs/plans/<slug>.md` (problem, scope with
  file references, "done when").

## Docs discipline (maintain this in every session)

- **New docs go in the right folder, never loose in `docs/`**:
  plan for future work → `docs/plans/<slug>.md` + a line in `TODO.md` and
  `ROADMAP.md`; how something works → `docs/reference/`; contributor how-to →
  `docs/developer/`; deploy/server notes → `docs/ops/`. Exception:
  `docs/openapi.yaml` stays put (served at `/api/v1/openapi.yaml`).
- **Starting a plan**: move its entry to *In progress* in `docs/plans/TODO.md`.
- **Finishing a plan**: move the entry to *Recently done* (dated), then delete
  the plan file or convert its durable parts to `docs/reference/`, and remove
  the `ROADMAP.md` line. Don't leave shipped plans lying around as if open —
  that's how the docs rotted last time.
- **Plans describe change, reference describes what is.** If a doc mixes both,
  split it. Keep status headers truthful (a "not merged" banner on merged work
  is worse than no banner).
- `docs/plans/` is gitignored (local working docs); everything else in `docs/`
  is public — no client PII or personal notes outside `docs/plans/`.

## Frontend patterns (use these, don't invent parallels)

- **DOM**: `h()` from `client/lib/dom.js` — no raw `document.createElement`.
- **Strings**: `t(key, fallback)` from `client/lib/ui-i18n.js` for all
  user-facing copy; translations in `client/i18n/<locale>/<component>.json`
  (`client/i18n/en.json` is a stale build artifact, ignore it).
- **Feedback**: `toast` from `client/lib/toast.js`. No `alert()`.
- **Confirmations**: `confirmModal` / `createTextInput` from
  `client/lib/modal.js`. No native `confirm()`/`prompt()` in new code.
- **Modals**: follow the `client/lib/modal.js` helpers (focus trap and
  aria wiring come free).
- **CSS**: reuse `.editor-card`, `.field-label`, `.help`, `.btn`/`.btn-primary`/
  `.btn-danger`, `.row`/`.stack`, `.is-between` — check existing views before
  adding classes.
- JSDoc on exports; small modules; match the structure of a neighboring
  feature (e.g. `client/views/settings/api-keys/` for a settings panel).

## Git workflow

- **Docs-only changes** (`docs/`, `ROADMAP.md`, `README.md`, `CLAUDE.md`,
  `AGENTS.md`, `.gitignore`) may be committed and pushed **directly on
  `main`** — no branch or PR needed.
- **Code changes** go via a feature branch, merged into `main` (PR for
  anything substantial).

## Verifying work

- `npm test` runs the node test suite.
- `npm run start` serves on http://localhost:4177 (config in `.env`;
  `AUTH_DEV_BYPASS=true` gives auto-login in dev).
- For UI changes, actually drive the flow in a browser before calling it done.

# Deckyard — Claude Code instructions

Deckyard is a self-hosted presentation engine for humans and AI agents:
vanilla JS ESM on client and server, no framework, no bundler. Deep
conventions (module layout, slide-type system, theming, escaping, lifecycle
cleanup) live in **`AGENTS.md`** — read it before structural work.

## Where to start

Three planning horizons, three files:

- **`docs/plans/TODO.md`** — *now*: the operational worklist (in progress / queue
  / done). When asked to "pick up the next thing" or plan work, read this file
  first, not the whole plans folder.
- **`docs/plans/STRATEGY.md`** — *internal longer-term*: directional tracks with
  rationale and "done when", not yet public. Elaborated briefings live in
  `docs/plans/briefs/<slug>.md` (the three anchors — `TODO.md`, `STRATEGY.md`,
  `README.md` — sit at the `docs/plans/` root, the per-item briefings one level
  down in `briefs/`). (Private; in the `deckyard-planning` sibling.)
- **`ROADMAP.md`** — *public commitment*: the coarse, public-facing overview,
  one line per project. This is the only one of the three that ships in the OSS
  repo.

> **Where the plans actually live.** `docs/plans/` is a **symlink** to the
> private `deckyard-planning` sibling repo (kept out of this OSS repo on
> purpose). Read/edit `docs/plans/*` as normal — the paths resolve — but
> **commit those changes in `deckyard-planning`, not here**. On a fresh machine
> the symlink is absent (it's gitignored): clone `deckyard-planning` as a
> sibling and run its `setup-symlink.sh`. Repo:
> `github.com/jaapstronks/deckyard-planning` (private).

## Docs discipline (maintain this in every session)

- **New docs go in the right folder, never loose in `docs/`**:
  plan for future work → `docs/plans/briefs/<slug>.md` + a line in
  `docs/plans/TODO.md` and `ROADMAP.md`; how something works → `docs/reference/`;
  contributor how-to →
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
- **Long-running feature tracks** use an integration branch: sub-PRs target
  that branch (not `main`), which gets one umbrella PR to `main` when the
  whole track is accepted. Active: `collab` (real-time collaboration, ADR
  001) — all collab PRs base on `collab`; merge `main` into it periodically.
  **The base branch is set at PR creation** and GitHub defaults to `main`,
  so always pass it explicitly: `gh pr create --base collab …`. Double-check
  the "wants to merge into" line before finishing up. Exception only when
  the plan explicitly says a step goes to `main` (e.g. a standalone fix
  that must survive a track no-go, like collab step 0 / PR #6).
- **Releases**: tag `vX.Y.Z` + GitHub Release; update `CHANGELOG.md`
  (`[Unreleased]` → release section). Forks sync on tags, not `main`.
- **After merging a delegated PR** (a "review en merge" hand-off you completed):
  run the **`merge-housekeeping`** skill as the tail of the flow, before you
  stop. It cleans up the branch, ticks the shipped item off `docs/plans/TODO.md`,
  and runs a shallow TODO/roadmap consistency scan that logs drift and nudges
  Jaap when a deeper reorganization audit is warranted. It is part of the merge,
  not a proposed "next step". Skip it for PRs you only opened (Jaap merges those).

## Verifying work

- `npm test` runs the node test suite.
- `npm run start` serves on http://localhost:4177 (config in `.env`;
  `AUTH_DEV_BYPASS=true` gives auto-login in dev).
- For UI changes, actually drive the flow in a browser before calling it done.

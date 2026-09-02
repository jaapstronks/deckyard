# Deckyard — Claude Code instructions

Deckyard is a self-hosted presentation engine for humans and AI agents:
vanilla JS ESM on client and server, no framework, no bundler. Deep
conventions (module layout, slide-type system, theming, escaping, lifecycle
cleanup) live in **`AGENTS.md`** — read it before structural work.

## Where to start

Three planning horizons, three files:

- **`docs/plans/TODO.md`** — _now_: the operational worklist (in progress / queue
  / done). When asked to "pick up the next thing" or plan work, read this file
  first, not the whole plans folder.
- **`docs/plans/STRATEGY.md`** — _internal longer-term_: directional tracks with
  rationale and "done when", not yet public. Elaborated briefings live in
  `docs/plans/briefs/<slug>.md` (the three anchors — `TODO.md`, `STRATEGY.md`,
  `README.md` — sit at the `docs/plans/` root, the per-item briefings one level
  down in `briefs/`). (Private; in the `deckyard-planning` sibling.)
- **`ROADMAP.md`** — _public commitment_: the coarse, public-facing overview,
  one line per project. This is the only one of the three that ships in the OSS
  repo.

> **Where the plans actually live.** `docs/plans/` is a **symlink** to the
> private `deckyard-planning` sibling repo (kept out of this OSS repo on
> purpose). Read/edit `docs/plans/*` as normal — the paths resolve — but
> **commit those changes in `deckyard-planning`, not here**. On a fresh machine
> the symlink is absent (it's gitignored): clone `deckyard-planning` as a
> sibling and run its `setup-symlink.sh`. Repo:
> `github.com/jaapstronks/deckyard-planning` (private).

## Werkwijze en handoff

Deze repo volgt de universele werkwijze (skill `werkwijze` in `~/.claude`);
de drie planning-horizonnen hierboven zijn er de deckyard-instantie van.

- **Handoff**: `/handoff` leest het lane-bestand van deze machine —
  `docs/plans/handoff/dev.md` (dev-server) of `handoff/mbp.md` (MacBook) —
  en voert 'm uit als sessie-opdracht; het gedeelde doorgeefblok +
  terugkeer-check staan in `handoff/queue.md`. Elke werk-afrondende sessie
  **overschrijft het eigen lane-bestand** met de volgende opdracht en sluit
  het antwoord af met de sluitregel (`/handoff` + sessiesoort + model).
  Cross-machine doorgeven gaat via `queue.md` met een lane-tag (`→ mbp` /
  `→ dev`). Volledige regels: `docs/plans/handoff-systematiek.md` § Lanes.
- **Rollen**: Fable brieft, beslist en reviewt; Opus voert één item/PR per
  sessie uit en merget nooit de eigen PR. Een review-en-merge-sessie draait
  op Fable — sinds 2 sep 2026 geldt dat in elke repo, en zijn de repo-tiers
  en het reviewbudget ingetrokken. De canonieke tabel staat in `werkwijze`
  § Modelkeuze per sessie; de zes oude escalatiesignalen leven daar verder
  als checklist voor de reviewer, niet als modelschakelaar.
- **Ritmes**: `merge-housekeeping` (repo-eigen skill) per gedelegeerde merge;
  `reorg-audit` bij de drift-drempel; `tighten-scan` (repo-eigen skill) op
  aanvraag.

Afwijkingen van de universele werkwijze: plans leven in de private
`deckyard-planning`-sibling (OSS-repo), en de repo-eigen `merge-housekeeping`
en `tighten-scan` shadowen de generieke skills — bewust.

## The course: beta doctrine (apply at every ritual)

Deckyard is in beta with a near-zero installed base (one fork, ours). The
standing direction of the current work is **tightening**: one canonical form
per concept, drift reduced, a spec/API/slide-type system that is consistent,
understandable and elegant. The canonical statement is
`docs/reference/versioning.md` § _The beta stance: purity over compatibility_.
Apply it at the recurring moments:

- **Picking up work** ("check TODO.md", "geef een prompt om verder te gaan"):
  frame the item against the course — prefer the structural fix over the
  tolerant patch, and say so in the prompt or plan you produce.
- **Reviewing a PR**: tolerance-creep is a _blocking_ finding, not a style
  nit — a second accepted shape/spelling for one meaning, an "accepts both"
  without a normalize-and-remove story, a "valid forever" promise while the
  beta badge is up. Breaking-but-clean beats compatible-but-cluttered during
  beta.
- **Writing docs**: state the normative target plus an honest
  implementation-status note; never promise eternal compatibility during beta.
- **Weighing a design**: "the code already accepts X" is never an argument —
  current behaviour describes the codebase, it does not justify the contract.
  When surfaces disagree, the inconsistency is the defect, not the precedent.

## Docs discipline (maintain this in every session)

- **New docs go in the right folder, never loose in `docs/`**:
  plan for future work → `docs/plans/briefs/<slug>.md` + a line in
  `docs/plans/TODO.md` and `ROADMAP.md`; how something works → `docs/reference/`;
  contributor how-to →
  `docs/developer/`; deploy/server notes → `docs/ops/`. Exception:
  `docs/openapi.yaml` stays put (served at `/api/v1/openapi.yaml`).
- **`TODO.md` is a worklist, not a research report.** An entry there is **max ~12
  lines**: title, status, one sentence on why it matters, and a link. Diagnosis,
  code locations, option space, measurements and step-checklists go in
  `docs/plans/briefs/<slug>.md` — including sub-items that get ticked off
  individually. Writing the whole investigation into `TODO.md` is how it reached
  2.468 lines by 2026-07-27; the folding rules and the line budget live in
  `docs/plans/LEESWIJZER.md`, and `merge-housekeeping` measures it every merge.
- **Starting a plan**: move its entry to _In progress_ in `docs/plans/TODO.md`.
- **Finishing a plan**: move the entry to _Recently done_ (dated), then delete
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
  user-facing copy; translations in `client/i18n/<locale>/<component>.json`.
- **Feedback**: `toast` from `client/lib/dom/toast.js` for a _passing_
  message — a confirmation, or the failure of an action that has no form on
  screen to attach to. No `alert()`. A refusal of the form the user is filling
  in is a state of that form, not a notification: it stays beside the control
  or the Save button until the next attempt, names the field, and is not
  toasted alongside (precedent: `client/views/settings/slide-type-editor/`,
  #1072). The per-kind doctrine (place, lifetime, content, focus) is B202.
- **Confirmations**: `confirmModal` / `createTextInput` from
  `client/lib/dom/modal.js`. No native `confirm()`/`prompt()` in new code.
- **Modals**: follow the `client/lib/dom/modal.js` helpers (focus trap and
  aria wiring come free).
- **URL state**: `client/lib/state/router.js` owns the whole current URL.
  Read query params with `queryParam(key)` / `queryString()`, write them with
  `setQueryParams({ key: value })` (`null` deletes; replaces, so no history
  entry and no re-route), build a destination with `urlWithQuery(patch)` and
  name the current page with `currentUrl()`. No `new URL(location.href)` or
  `location.search` anywhere else — a guard test pins it.
- **Lifecycle**: a factory returns `{ el, detach }` — not `destroy`/`teardown`/
  `cleanup`, not `element`. Run disposal through `disposeAll()`.
- **CSS**: reuse `.editor-card`, `.field-label`, `.help`, `.btn`/`.btn-primary`/
  `.btn-danger`, `.row`/`.stack`, `.is-between` — check existing views before
  adding classes.
- JSDoc on exports; small modules; match the structure of a neighboring
  feature (e.g. `client/views/settings/api-keys/` for a settings panel).

## Git workflow

- **Docs-only changes** (`docs/`, `ROADMAP.md`, `README.md`, `CLAUDE.md`,
  `AGENTS.md`, `.gitignore`) may be committed and pushed **directly on
  `main`** — no branch or PR needed.
- **Code changes** go via a feature branch and a **PR** — and there the
  work-agent stops. Open the PR, hand it off with `claude-notify-pr`, and let a
  _different_ actor review and merge (Jaap, or a Fable agent Jaap points at it).
  **Do not self-merge code to `main`**, even when it's green and tested. The
  only exception is an explicit "review en merge" hand-off — then you're in the
  reviewing role, so merge and run `merge-housekeeping` as the tail (see below).
  This is the global rule (author ≠ merger), not a deckyard-specific one.
- **Long-running feature tracks** use an integration branch: sub-PRs target
  that branch (not `main`), which gets one umbrella PR to `main` when the
  whole track is accepted. **No integration branch is active right now** —
  the `collab` track (ADR 001) shipped to `main` and its branch is gone, so
  everything currently bases on `main`. When a track _does_ open one:
  **the base branch is set at PR creation** and GitHub defaults to `main`,
  so always pass it explicitly (`gh pr create --base <track> …`) and
  double-check the "wants to merge into" line before finishing up.
- **Commit / PR titles** use [Conventional Commits](https://www.conventionalcommits.org/)
  (`feat:`, `fix:`, `security:`, `feat!:` for breaking, …) — release-please reads
  the **squash-merge PR title** to compute the next version and changelog. Full
  prefix→bump table in `docs/reference/versioning.md`.
- **No MAJOR bumps while Deckyard is in beta.** The version stays in `1.x` until
  the beta badge comes off; `2.0.0` is reserved for leaving beta, not for a
  tidy-up that happens to break something. `BREAKING CHANGE:` / `!` still force a
  MAJOR automatically, so if the Release PR proposes a `2.x`, override it down
  with a `Release-As: 1.<next>.0` trailer before merging. Retiring an unused
  slide type and moving internal modules are explicitly **not** breaking —
  rationale and procedure in `docs/reference/versioning.md`.
- **Releases are automated** via `release-please`: it keeps one open Release PR
  (`chore(main): release X.Y.Z`) up to date on every push to `main`. Cutting a
  release = **merging that Release PR** (bumps `package.json`, finalizes
  `CHANGELOG.md`, tags `vX.Y.Z`, publishes a GitHub Release). You never bump the
  number by hand. Merges to `main` are internal CI; a release is the deliberate
  outward signal — the two are decoupled. Forks sync on tags, not `main`.
  Details + one-time PAT setup: `docs/reference/versioning.md`.
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

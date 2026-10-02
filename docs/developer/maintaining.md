# Maintaining upstream Deckyard — agent instructions

Upstream's maintainer guide: how work is planned, handed off, reviewed,
merged and released in `jaapstronks/deckyard`. The root `CLAUDE.md` imports it
with `AGENTS.md` (the code conventions); a fork imports only `AGENTS.md`
([fork-setup.md](../reference/fork-setup.md) § Your own CLAUDE.md). Paths below
are from the repo root.

## Where to start

Three planning horizons, three files:

- **`docs/plans/TODO.md`** — _now_: the operational worklist (in progress / queue
  / done). When asked to "pick up the next thing" or plan work, read this file
  first, not the whole plans folder.
- **`docs/plans/STRATEGY.md`** — _internal longer-term_: directional tracks with
  rationale and "done when". Per-item briefings live in
  `docs/plans/briefs/<slug>.md`.
- **`ROADMAP.md`** — _public commitment_: one line per project; the only one of
  the three that ships in the OSS repo.

> `docs/plans/` is a gitignored **symlink** to the private `deckyard-planning`
> sibling: edit `docs/plans/*` as normal, but **commit it in
> `deckyard-planning`, not here**. Fresh machine: clone it as a sibling and run
> its `setup-symlink.sh`.

## Werkwijze en handoff

Deze repo volgt de universele werkwijze (skill `werkwijze` in `~/.claude`);
de drie planning-horizonnen hierboven zijn er de deckyard-instantie van.

- **Handoff**: `/handoff` voert het lane-bestand van deze machine uit
  (`docs/plans/handoff/dev.md` of `mbp.md`); doorgeefblok en terugkeer-check
  staan in `handoff/queue.md`. Elke werk-afrondende sessie overschrijft het
  eigen lane-bestand en sluit af met de sluitregel. Volledige regels:
  `docs/plans/handoff-systematiek.md` § Lanes.
- **Rollen**: `stuur` brieft, beslist en reviewt; `uitvoer` bouwt één item/PR
  per sessie en merget nooit de eigen PR. De tier van het item bepaalt welk
  model bouwt en reviewt, ook wanneer de workhorse in Codex draait. Los de
  modelnaam op via het actieve modelprofiel en `werkwijze` § Modelkeuze per
  sessie; leg geen vaste modelnaam in de handoff vast.
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
- **Meeting a form question mid-build**: decide it on the doctrine side
  (declaration over a branch on a name, one shape, refuse over silently
  repair) and state the decision in the PR body for the reviewer to test.
  "Behaviour preserved, minted as a B-number, test pins the disagreement" is
  not an option — that parks tolerance with a label on it (D92, 2026-09-09).
  Only a _product_ question (does Jaap want X at all) is parked, with an
  advice, in the terugkeer-check of `docs/plans/handoff/queue.md`.
- **Reviewing for parked tolerance**: a PR that _leaves_ an existing second
  form standing and mints a number for it is the same blocking finding as a
  PR that adds one. Decide it in the review (a D-number) or send it back.

## Docs discipline (maintain this in every session)

- **New docs go in the right folder, never loose in `docs/`**:
  plan for future work → `docs/plans/briefs/<slug>.md` + a line in
  `docs/plans/TODO.md` and `ROADMAP.md`; how something works → `docs/reference/`;
  contributor how-to →
  `docs/developer/`; deploy/server notes → `docs/ops/`. Exception:
  `docs/openapi.yaml` stays put (served at `/api/v1/openapi.yaml`).
- **`TODO.md` is a worklist, not a research report.** An entry is **max ~1.000
  characters**: title, status, why it matters, a link. Diagnosis, code
  locations, options and step-checklists go in `docs/plans/briefs/<slug>.md`.
  Folding rules and the file budget: `docs/plans/LEESWIJZER.md`.
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

## Git workflow

- **Docs-only changes** (`docs/`, `ROADMAP.md`, `README.md`, `CLAUDE.md`,
  `AGENTS.md`, `.gitignore`) may be committed and pushed **directly on
  `main`** — no branch or PR needed.
- **Code changes** go via a feature branch and a **PR**, and there the
  work-agent stops: hand it off with `claude-notify-pr` and let a _different_
  actor review and merge (author ≠ merger). **Never self-merge code to
  `main`**, even green; the only exception is an explicit "review en merge"
  hand-off, where you are the reviewer.
- **Long-running feature tracks** use an integration branch (none is active
  now; everything bases on `main`). When a track opens one, sub-PRs target it:
  pass `gh pr create --base <track> …` explicitly, GitHub defaults to `main`.
- **Commit / PR titles** use [Conventional Commits](https://www.conventionalcommits.org/)
  (`feat:`, `fix:`, `security:`, `feat!:` for breaking, …) — release-please reads
  the **squash-merge PR title** to compute the next version and changelog. Full
  prefix→bump table in `docs/reference/versioning.md`.
- **Releases**: `release-please` keeps one Release PR open; cutting a release
  is merging it, never a hand bump, and forks sync on tags. No MAJOR while in
  beta (override a proposed `2.x` with `Release-As: 1.<next>.0`). Whoever merges
  it writes the release notes on `deckyard-website` (hub → spoke) and moves the
  sandbox to the new tag, in the same session. The full recipes, including the
  integration-branch history: `docs/reference/versioning.md` § Upstream release
  recipes.
- **After merging a delegated PR**: run the **`merge-housekeeping`** skill as
  the tail of the merge, before you stop (branch cleanup, TODO tick-off, drift
  scan; at the threshold your closing hand-off becomes the reorg-audit). It is
  part of the merge, not a "next step". Skip it for PRs you only opened.

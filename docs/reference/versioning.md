# Versioning & releases

How Deckyard version numbers work, what counts as a breaking change, and how a
release gets cut. The automation is [`release-please`](https://github.com/googleapis/release-please);
this doc is the human-readable contract around it.

## The version number

Deckyard follows [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`
(e.g. `1.4.2`). The three parts are independent counters, not decimals — `1.9.0`
is followed by `1.10.0`, not `2.0`.

| Part      | Bumped when …                                         | Signal to someone running Deckyard              |
| --------- | ----------------------------------------------------- | ----------------------------------------------- |
| **MAJOR** | a backward-incompatible change ships                  | Read the notes before upgrading; you may need to adjust config or an API call. |
| **MINOR** | a backward-compatible feature ships (resets PATCH)    | Safe to upgrade; nothing you had breaks, and there's something new. |
| **PATCH** | a backward-compatible fix ships                       | Blindly safe; often you want it (bug/security). |

`1.0.0` was the commitment to honor the MAJOR rule from there on. A rewrite that
breaks nothing stays `1.x`; MAJOR moves to `2` only on a genuine break.

## Merges are not releases

Merging to `main` is **continuous integration** — internal, may happen dozens of
times a day. A **release** is an **outward signal** to people running Deckyard
that a moment is worth updating to. The two are deliberately decoupled: merges
flow continuously, releases are cut when enough has accumulated to be worth it.
Cutting a release 20× a day would destroy the signal value of the number.

## What counts as a breaking change (MAJOR)

Breaking means nothing until the stable surface is named. For Deckyard, a change
is **MAJOR** only if it breaks one of these for an existing install:

1. **The public HTTP API** (`/api/v1`, the OpenAPI spec) — removing or reshaping a route or field.
2. **The MCP tool surface** — removing or reshaping a tool or parameter agents depend on.
3. **The on-disk deck JSON format** — an existing deck that no longer loads after upgrade.
4. **Config** (`.env` keys, Docker setup) — a required new variable with no default, or a renamed key.

Everything else — internal modules, UI microcopy, most refactors — is MINOR or
PATCH. When in doubt, if a fork or self-hoster has to change something on upgrade,
it's MAJOR.

## Commit conventions

Releases are computed from [Conventional Commits](https://www.conventionalcommits.org/).
Prefix each commit (or the squash-merge PR title, since we squash-merge):

| Prefix                    | Bump  | Changelog section |
| ------------------------- | ----- | ----------------- |
| `feat:`                   | MINOR | Added             |
| `fix:`                    | PATCH | Fixed             |
| `security:`               | PATCH | Security          |
| `perf:` / `revert:`       | PATCH | Changed           |
| `docs:` `chore:` `refactor:` `style:` `test:` `ci:` `build:` | none | hidden |
| any of the above with **`!`** (e.g. `feat!:`) or a `BREAKING CHANGE:` trailer | MAJOR | Added, flagged breaking |

Only `feat`/`fix`/`security`/`perf`/`revert` and breaking changes surface in the
changelog and move the version; the rest are invisible to consumers by design.
A scope is optional: `feat(theme): …`. Because we squash-merge, the **PR title**
is what release-please reads — keep it a valid Conventional Commit.

## How a release is cut

1. You merge feature PRs to `main` as usual (with Conventional-Commit titles).
2. On every push to `main`, the `release-please` workflow maintains **one open
   Release PR** titled `chore(main): release X.Y.Z`. It carries the computed next
   version and a generated `CHANGELOG.md` entry, and grows as more merges land.
3. When enough has accumulated to be worth shipping, you **merge the Release PR**.
   That single merge bumps `package.json`, finalizes the changelog, tags
   `vX.Y.Z`, and publishes a **GitHub Release**. You never pick the number by
   hand — it's derived from what's in the PR.

The [`merge-housekeeping`](../../.claude/skills/merge-housekeeping/SKILL.md) skill
nudges (phone push) when the accumulated merges warrant cutting a release, so the
Release PR doesn't sit open and forgotten. It never cuts the release itself.

## One-time setup

- **`RELEASE_PLEASE_TOKEN` secret (recommended).** PRs opened by the built-in
  `GITHUB_TOKEN` don't trigger other workflows, so the Release PR wouldn't run CI
  and the required `test` check on `main` would never pass. Add a **fine-grained
  PAT** (repository access: this repo; permissions: **Contents: Read and write**,
  **Pull requests: Read and write**) as a repo secret named
  `RELEASE_PLEASE_TOKEN`. The workflow uses it if present and falls back to
  `GITHUB_TOKEN` otherwise (in which case the Release PR must be admin-merged).
- **First release.** The current `CHANGELOG.md` has a hand-curated `[Unreleased]`
  section written before this automation. The first Release PR will generate its
  own `1.1.0` notes from commit history and prepend them **above** that section.
  Reconcile once during review — keep the curated prose as the `1.1.0` body, or
  the generated list, or a merge of both — then delete the stale `[Unreleased]`.
  From the next cycle on, the changelog is fully machine-maintained.

## How people hear about a release

- **GitHub Releases + "Watch → Custom → Releases".** Ingebouwd; a watcher is
  mailed on each release and only on releases — the best reason to keep them scarce.
- **The releases feed:** `https://github.com/jaapstronks/deckyard/releases.atom`.
- **Forks sync on tags, not on `main`** — a new tag is itself how a fork (e.g. the
  CIIIC fork) learns there's something to pull.
- **Not yet:** Deckyard surfaces its own running version nowhere (no
  `/api/version`, no footer). Adding that, then an in-app "update available" check
  against the latest GitHub Release, is a sensible later step — see `ROADMAP.md`.

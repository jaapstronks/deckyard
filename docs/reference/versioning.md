# Versioning & releases

How Deckyard version numbers work, what counts as a breaking change, and how a
release gets cut. The automation is [`release-please`](https://github.com/googleapis/release-please);
this doc is the human-readable contract around it.

## The version number

Deckyard follows [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`
(e.g. `1.4.2`). The three parts are independent counters, not decimals — `1.9.0`
is followed by `1.10.0`, not `2.0`.

| Part      | Bumped when …                                      | Signal to someone running Deckyard                                             |
| --------- | -------------------------------------------------- | ------------------------------------------------------------------------------ |
| **MAJOR** | a backward-incompatible change ships               | Read the notes before upgrading; you may need to adjust config or an API call. |
| **MINOR** | a backward-compatible feature ships (resets PATCH) | Safe to upgrade; nothing you had breaks, and there's something new.            |
| **PATCH** | a backward-compatible fix ships                    | Blindly safe; often you want it (bug/security).                                |

`1.0.0` was the commitment to honor the MAJOR rule from there on. A rewrite that
breaks nothing stays `1.x`; MAJOR moves to `2` only on a genuine break.

### While Deckyard is in beta: no MAJOR bumps

Deckyard went open source and launched publicly in July 2026, and still carries a
**beta** badge. The foundation is being reworked in the open: modules are moving,
slide types are being consolidated, seams are being cut. In that phase a MAJOR
bump communicates the wrong thing — `2.0.0` reads as "a second era of the
product", not as "we removed a slide type nobody used while tidying up".

So until the beta badge comes off, **the version stays in `1.x`**. Breaking
changes are still _documented_ (the `⚠ BREAKING CHANGES` section in the changelog
is the point), but they ship as a MINOR bump, not a MAJOR one. `2.0.0` is reserved
for a deliberate moment: leaving beta.

Keep writing the `BREAKING CHANGE:` trailer when a change genuinely meets the
criteria below — the warning in the notes is worth more than the digit. But
`BREAKING CHANGE:` and `!` force a MAJOR bump automatically, and no
release-please setting caps that. So during beta the Release PR's version is
**reviewed, not trusted**: if it proposes a `2.x`, override it down to the next
MINOR before merging (see [Correcting a version](#correcting-a-version)). A
`1.x` release carrying a `⚠ BREAKING CHANGES` section is the intended shape
while the badge is up, not a mistake.

### The beta stance: purity over compatibility

The no-MAJOR rule above is about the _number_; this is about the policy the
number serves. Deckyard went public weeks ago, with essentially no marketing:
the installed base is deliberately near zero (one fork, run by the maintainer,
upgrading in lockstep). While the beta badge is up, the priority order is
explicit — and it is the standing lens for planning, refactoring, PR review
and docs alike:

1. **A clean, consistent spec and API beat backward compatibility.** Every
   month of public life raises the price of tightening; right now that price is
   as low as it will ever be. Structural corrections — one canonical spelling,
   one write path, one meaning per name — ship _now_, as documented breaking
   changes, rather than surviving as permanent caveats. Being open source with
   a published spec must not breed fear of refactoring; that fear is how a
   codebase clouds over.
2. **A breaking change is announced, not feared.** It ships as MINOR with a
   `⚠ BREAKING CHANGES` note (the beta rule above) and a migration for stored
   data where one applies. Forks sync on tags and should expect breaking
   releases while the badge is up — the beta badge _is_ that warning.
3. **Tolerance is not compatibility.** Accepting several shapes or spellings
   for one meaning, without normalizing to a single canonical form, is drift
   wearing a friendly face. The rule at every boundary: accept what you must,
   normalize immediately, persist and emit only the canonical form. A second
   accepted shape without a normalize-and-remove story is a blocking review
   finding, not a style nit.
4. **"It already accepts X" is never a design argument.** Current behaviour
   describes the codebase; it does not justify the contract. When most
   surfaces are inconsistent, the inconsistency is the defect to fix, not the
   precedent to follow.
5. **A half-built feature is stripped, not parked.** A feature that never ran
   in production, was never really exercised, and needs substantial surrounding
   machinery to be honest — consent, retention, erasure, notification — is not
   improved by leaving it in place behind a `deprecated` flag. Remove it, and
   write the plan for doing it properly as a separate, deliberate project.
   Parking keeps the maintenance surface, the half-shape and the wrong
   assumptions; stripping keeps only the lesson. The plan is the deliverable
   that replaces the code, and it is not optional — "strip and forget" loses
   what the attempt taught.
6. **The promises start when the badge comes off.** From that moment the
   [evolution rule](./deck-format.md#evolution-rule) binds absolutely and
   MAJOR means MAJOR. The beta window is the one chance to correct structure
   cheaply, and it is spent deliberately.

Adopted 2026-08-01, triggered by the type-id one-spelling decision (an early
draft argued for keeping three spellings because most write paths already
tolerated them — the exact reasoning rule 4 forbids). Rule 5 was added
2026-08-22, triggered by the lead-capture decision: a feature parked in
July 2026 "until consent is wired" was still parked in August, still carrying a
GDPR self-service page, a retention job, a webhook event and two runtimes for
something no deck had ever used. This section is the anchor other docs,
`CLAUDE.md` rituals and review checklists point at.

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
it's MAJOR (during beta: MINOR with a breaking note — see above).

Two things this list deliberately does _not_ make breaking:

- **Retiring a slide type nobody stored.** A deck that carries the removed type
  still loads; the slide falls back to the archived-slide placeholder, which
  names the retired type, points at its successor and keeps the stored content
  readable (`shared/slide-types/unresolved.js`). That is a degraded render, not a
  load failure, and `scripts/scan-slide-type.js` is how you check the deck
  population before removing. This is what the `freeform-slide` removal (#377)
  was, and it should not have carried a `BREAKING CHANGE:` trailer.
- **Moving or splitting an internal module.** Deckyard has no published JS package
  surface; `client/` and `server/` internals are not a contract. A fork that
  patched a specific file has to reconcile — that is what forking costs, and it is
  not a version signal.

### Wire changes are never titled `refactor:`

The changelog is generated from commit titles (release-please), and
`refactor:` commits are dropped from it. So the title is not a description of
the diff — it is a routing decision about whether the change reaches the
changelog. The rule (decided 2026-08-25, after the 1.17–1.25 note backfill):

**A commit that changes any public contract — a webhook event name, an API or
MCP parameter, a response status, an export artifact's shape — is titled
`feat:` or `fix:` (with a `!`/`BREAKING CHANGE:` footer when breaking), even
when the diff is internally refactor-shaped.** `refactor:` is reserved for
changes with no observable effect on any of the surfaces above.

This was learned the expensive way: the webhook rename (#829), the MCP
`scope` → `ownership` argument (#798), the shelf-axis rename in the bulk-export
ZIP (#806/#827), two retracted wizard endpoints (#835) and the follow-API's
status-code change (#830) were all titled `refactor:` and all fell out of the
changelog; the public notes had to be reconstructed from briefings.

Related, same lesson: a release briefing describes what a migration does by
reading **the migration and the PR body**, never by inferring from the
changelog line — the 1.24.0 briefing claimed migration 080 deletes slides when
it only drops two lead-capture tables and the slide degrades to the
archived-slide placeholder.

### Renamed slide-type classes go in the release notes

The class names a slide type renders are a **public contract**, on the same
footing as the four surfaces above for the purpose of _announcing_ a change —
though not for the version number, since during beta nothing bumps MAJOR.

Renaming one is the quietest breakage Deckyard has shipped. v1.8.0 replaced the
title slide's `.slide-title` / `.title-*` / `.logo-*` family with
`.slide-title-universal` and `tsu-*`, and only the new names carried CSS. A
fork's own title slide still emitted the old ones and fell back to bare document
flow — a full-bleed title became an inline image with the heading underneath.
(The root class has since gone back to `.slide-title`; the `tsu-*` family stands.)
Nothing that CI or an agent watches broke: no import failed, the HTML was valid,
the suite was green, the site returned 200. A human found it hours after deploy.

So: **when a slide type's emitted classes are renamed or removed, say so in the
release notes, under the same heading as breaking changes.** One line per rename.
A fork styling its own slide types against core CSS is relying on those names,
and the release notes are the only place it can learn they moved.

`tests/slide-type-css-contract.test.js` enforces the upstream half — every class
a core type emits must resolve to a CSS rule — so a rename cannot silently leave
one side behind. It cannot see a fork's types, which is why the release-notes
line matters. Details: `docs/reference/slide-type-css-contract.md`.

## Commit conventions

Releases are computed from [Conventional Commits](https://www.conventionalcommits.org/).
Prefix each commit (or the squash-merge PR title, since we squash-merge):

| Prefix                                                                        | Bump  | Changelog section       |
| ----------------------------------------------------------------------------- | ----- | ----------------------- |
| `feat:`                                                                       | MINOR | Added                   |
| `fix:`                                                                        | PATCH | Fixed                   |
| `security:`                                                                   | PATCH | Security                |
| `perf:` / `revert:`                                                           | PATCH | Changed                 |
| `docs:` `chore:` `refactor:` `style:` `test:` `ci:` `build:`                  | none  | hidden                  |
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

## Correcting a version

Step 3 above says you never pick the number by hand, and that holds for the
normal path. The exception is when a commit already on `main` computed the wrong
bump — a `BREAKING CHANGE:` trailer on something that isn't breaking, or a MAJOR
during beta. The trailer can't be unwritten (history is history), so you override
the result instead.

Push a commit to `main` whose message carries a `Release-As:` trailer with the
version you actually want:

```
docs: recalibrate the versioning policy for beta

Release-As: 1.4.0
```

On the next push, release-please rewrites the open Release PR to that version —
title, `package.json`, tag, changelog heading. The generated changelog _body_
still reflects the commits (a `⚠ BREAKING CHANGES` section stays), which is
correct: the note was accurate, only the digit was wrong.

Use this sparingly. It is the release equivalent of a manual override — every
use means the commit convention failed upstream, so fix that too (in this case:
[the beta rule](#while-deckyard-is-in-beta-no-major-bumps) and the two
non-breaking cases named above).

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

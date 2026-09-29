# Fork Setup Guide

This guide explains how to set up your own fork of Deckyard with custom themes, slide types, and branding.

## For OSS Maintainers: Initial Repository Setup

After cloning the OSS repository for the first time, run these commands to ensure the custom directories are properly gitignored:

```bash
# Remove any tracked custom content (keeps files locally but stops tracking)
git rm -r --cached custom/themes custom/slide-types custom/assets 2>/dev/null || true

# Commit the clean state
git commit -m "Ensure custom directories are gitignored" --allow-empty

# Push to origin
git push origin main
```

This ensures the OSS repo only contains `.gitkeep` placeholder files in the custom directories.

---

## For Fork Users: Setting Up Your Fork

### Step 1: Fork the Repository

A GitHub "Fork" of a public repository is public too, and cannot be made
private. Pick the form before you start:

**A public fork.**

1. Go to https://github.com/jaapstronks/deckyard
2. Click "Fork" to create your own copy
3. Clone your fork locally:
   ```bash
   git clone https://github.com/YOUR-ORG/YOUR-FORK.git
   cd YOUR-FORK
   ```

**A private fork** (what a fork with client content usually wants): a plain
clone with upstream as a second remote, pushed to an empty private repository.

```bash
# Create an empty private repository first (no README, no licence), then:
git clone https://github.com/jaapstronks/deckyard.git YOUR-FORK
cd YOUR-FORK
git remote rename origin upstream
git remote add origin https://github.com/YOUR-ORG/YOUR-FORK.git
git fetch upstream --tags
git checkout -B main v1.49.0   # start on a release tag, not on upstream's tip
git push -u origin main --tags
```

Either way, `upstream` is the remote you merge releases from (Step 6).

**Upstream's bots stay upstream's.** A fork takes its versions and dependency
bumps from upstream, through a merge round; it should not cut releases or open
bump PRs of its own.

- `.github/workflows/release-please.yml` only runs in `jaapstronks/deckyard`
  (a condition on its job), so in a fork it does nothing. Leave the file as it
  is; editing it would make a seam.
- `.github/dependabot.yml` cannot carry such a condition. Turn it off in your
  repository instead: Settings → Code security → "Dependabot version updates"
  off. Security alerts can stay on.
- `.github/workflows/ci.yml` does run, and should: it is your fork's own gate on
  every PR.

### Step 2: Enable Custom Content Tracking

Edit `.gitignore` and remove or comment out these lines:

Upstream ships `custom/` empty (only `.gitkeep` placeholders are tracked); the
contents are gitignored so a clean checkout carries no client content. To
version your own customizations, un-ignore them by removing these lines from
`.gitignore`:

```gitignore
custom/themes/*
!custom/themes/.gitkeep
custom/assets/*
!custom/assets/.gitkeep
custom/slide-types/*
!custom/slide-types/.gitkeep
custom/styles/*
!custom/styles/.gitkeep
custom/ai/*
!custom/ai/.gitkeep
custom/scripts/*
!custom/scripts/.gitkeep
custom/extension.json
custom/fork.json
custom/fonts.js
custom/google-fonts.lock.json
```

### What the fork owns

A fork is upstream's tree plus your own files. Three rules say which is which,
and tools read them, so you do not keep the list only in prose:

- **`custom/` is yours.** Everything under it, always.
- **`CLAUDE.md` is yours.** Upstream's is two import lines that do not change
  (see _Your own CLAUDE.md_ below), so you replace it without a seam.
- **Everything else is core**, unless you declare otherwise in
  `custom/fork.json`:

```json
{
  "owned": ["docs/<your-tree>/", "tests/<your-fork-test>.test.js"],
  "deviations": {
    "server/<patched-file>.js": "why the fork patches this core file, and whether it is briefed upstream"
  }
}
```

`owned` lists further paths that are the fork's (a trailing `/` marks a tree):
a private doc tree, a fork-only test file. `deviations` lists the core files
your fork patches on purpose, each with its reason. Both are optional; a
missing file means "only the two rules above". The file is read strictly: an
unknown field, a path under `custom/`, a path listed twice or a deviation
without a reason fails instead of being ignored. It describes the repository,
so it stays at `custom/fork.json` in the checkout even when
`DECKYARD_CUSTOM_DIR` moves the runtime fork root (next section).

Two tools read it:

- **The doc gate** (`tests/docs-paths-resolvable.test.js`) does not scan your
  owned paths or `CLAUDE.md`, and does not require links into them. A private
  doc tree or a `CLAUDE.md` that names paths in sibling repositories keeps
  `npm test` green without a change to the test.
- **`npm run fork:seams`** classifies every core file you diverge on against
  this list (see _Merge round checklist_).

A difference in any other core file is either a deviation you declare here or
drift. Prefer the upstream route: if another forker would want the change,
propose it upstream, and the deviation goes away at the next merge round.

### Your own CLAUDE.md

Claude Code loads `CLAUDE.md` automatically. Upstream's holds no instructions,
only two imports:

```markdown
@AGENTS.md
@docs/developer/maintaining.md
```

`AGENTS.md` carries the conventions of the code (module layout, slide-type
system, frontend patterns, how to verify work) and is as true in your fork as
upstream. `docs/developer/maintaining.md` is upstream's own workflow (its
planning, releases and review rules) and is not yours. So a fork writes its own
`CLAUDE.md`, imports `AGENTS.md`, and adds its own rules:

```markdown
# Our Deckyard fork

@AGENTS.md

## How we work here

- ...
```

Because upstream's file does not change, git keeps yours at every merge
without a conflict. Keep `AGENTS.md` itself untouched: it is core, and your
agents want upstream's latest version of it.

### Where the fork root lives

Slide types, their stylesheets, themes, assets, fonts, AI copy and MCP tools share one fork root. `shared/custom-root.js` resolves it; the default is `custom/` in the checkout.

Set `DECKYARD_CUSTOM_DIR` to move the whole root. It must be an absolute path; relative values fail startup. The HTTP and MCP entrypoints load the installation's `.env` before initializing the fork loaders. An exported environment variable takes precedence over `.env`. Standalone scripts take the variable from their process environment.

Render and serving paths accept an installation root so they can render against a fixture tree. Loaders are imported once and use the process installation root. With `DECKYARD_CUSTOM_DIR` set, both resolve to the configured fork root for the lifetime of the process.

### Step 3: Add Your Custom Content

1. **Create an organization theme in Settings.** Duplicate a read-only core seed, then edit the copy. Theme records use UUIDs; `default` follows the organization's chosen default. Add custom fonts through that organization's font storage. `custom/themes/*.json` is only an optional source of shared, read-only seeds, never the editable theme store. Put theme images under `/custom/assets/` or upload them through the app. A `.deck` export includes the effective theme record and its available images as a snapshot.

2. **Add your assets** in `custom/assets/`:

   ```
   custom/assets/
   ├── images/
   │   └── your-logo.svg
   └── fonts/
       └── YourFont.woff2
   ```

3. **Optionally add custom slide types** in `custom/slide-types/`

4. **Optionally add your own CSS** in `custom/styles/` (see the next section)

5. **Optionally tune AI generation** in `custom/ai/` (see below)

6. **Optionally add curated fonts** in `custom/fonts.js` (see below)

7. **Optionally add your own scripts** in `custom/scripts/`

When custom slide types, CSS, AI code, fonts or MCP tools are loaded, declare the installation extension in `custom/extension.json`:

```json
{ "name": "nl.example.deckyard" }
```

The single name travels in exported decks alongside earlier imported names. Import warns when a name is absent locally. This is provenance only: a name neither loads code nor grants permissions.

### Add your own curated fonts (`custom/fonts.js`)

The font picker offers a curated set of self-hosted Google Fonts. Upstream's set
is `CURATED_FONTS` in `shared/theme-fonts.js`, pinned file-by-file in
`scripts/google-fonts.lock.json` — both core files, and editing the first
without the second makes `npm install` fail. Your families go in your own pair
instead:

```js
// custom/fonts.js
export default [
  {
    family: 'League Spartan',
    category: 'sans-serif',
    weights: [400, 500, 700],
  },
];
```

`category` is one of `sans-serif`, `serif`, `display`, `monospace`; `weights` are
the Google Fonts weights you want self-hosted. Then resolve and pin them:

```bash
node scripts/download-google-fonts.js --update-lock
```

That writes `custom/google-fonts.lock.json` — your half of the pin, in the same
format and with the same URL + SHA-256 guarantee as upstream's. Commit both
files. From then on your families are curated fonts like any other: valid in a
theme, downloaded by `postinstall`, embedded in exports.

Two things this deliberately does _not_ do. It does not touch upstream's list or
upstream's lockfile, so a font addition survives every merge untouched. And it is
server-side only — the in-browser font picker shows upstream's set. Your font
reaches a deck through the theme that names it, whose `@font-face` rules are
generated from your pins.

Self-hosted faces that are not on Google Fonts stay a `custom/styles/fonts.css`
job (see above); this seam is specifically the curated-Google-Fonts list.

### Add your own scripts (`custom/scripts/`)

`tests/scripts-reachable-gate.test.js` requires every file in `scripts/` to be
named in `package.json`, a workflow, or the docs — it exists because an unused
core script silently rotted for months. That ledger is upstream's, and a fork
script dropped in `scripts/` had no way past the gate except an edit to it.

Put fork scripts in `custom/scripts/` instead. The gate does not scan that tree,
so nothing is required of you there and no core file changes.

### Write your own CSS (`custom/styles/`)

A theme sets `--t-*` variables and nothing else — it is a database row a user
can edit, so it is filtered down to values on purpose. `custom/styles/*.css` is
the other half: real CSS rules, at fork level (a file on disk, in your git,
through your review). It is where the house-style changes go that used to force
a patch in `client/styles/`.

```
custom/styles/
├── 00-tokens.css      # loaded in filename order, like client/styles/
├── 30-title-slide.css
└── fonts.css
```

Every file in the folder is concatenated in filename order and loaded **last**:
after the core stylesheets, after the theme, after the slide-type CSS, in the
app **and** in every render path. Screen and export get the same bytes in the
same position, so they cannot drift.

#### Two chains, one seam

Deckyard assembles CSS through two named chains, not one — and both end in your
seam. The list of paths each one covers is a module, `server/render-paths.js`,
which a test walks; a ninth path added without a chain fails the suite rather
than silently shipping without your CSS.

|                       | **Canvas chain**                                                                | **Reader chain**                               |
| --------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------- |
| Paths                 | PDF, PNG, standalone HTML, print, single-slide render, embed, both MCP previews | the reflow reader at `/p/:id-:slug/reader`     |
| Layers above the seam | core bundle → theme vars → theme → slide CSS → per-path document CSS            | one reflow stylesheet                          |
| Vocabulary            | `.slide`, `.deck-slide`, `--t-*`, a fixed 1600×900 stage                        | `.reader-*`, relative units, no fixed geometry |
| Your seam             | last                                                                            | last                                           |

The reader is a genuinely different document — a semantic re-projection meant to
stay readable with JavaScript _and_ author CSS off — so it deliberately shares
no selectors with the canvas. **It reads no `--t-*` variable either**, which is
the part that surprises people: a dark theme does not make the reading view
dark. That is deliberate — the reader answers to the reading environment
(`color-scheme: light dark`) and to its own contrast and line-length
obligations, and a canvas theme picked for a projector is not a promise about
either. Colour on the reader is a `custom/styles/` decision, not a theme one. Two named chains is the honest description; one
chain plus an unexplained exception was the old one, and it left the reader as
the single user-facing page a fork could not restyle. If you want your fork's
type and colour on the reading view, write `.reader-*` rules in the same
`custom/styles/` folder; they land last there too.

One exception, worth knowing before you debug it: a _theme's_ generated rules —
its `@font-face` blocks and its `slideBackgrounds` variants — are injected into
the page at runtime, so in the app they land after the seam, while exports
inline them before it. Those selectors (`.slide.slide-bg-<id>`) outrank a
single-class fork rule either way; if you need to beat one on screen, raise your
selector rather than relying on load order.

> **This loads after everything else and can override anything.** That is the
> point — it is what makes patching a core file unnecessary — but it also means
> a stray selector here outranks the whole design system, with no merge
> conflict to warn you. Write the narrowest selector that does the job, and
> prefer setting `--t-*` in your theme when a variable is enough. Rules here are
> also not covered by upstream's tests: if a core class is renamed, your CSS
> silently stops matching.

**Self-hosted fonts** belong here too, as `custom/styles/fonts.css`. The core
font sheet (`assets/fonts/google/fonts.css`) is generated by
`scripts/download-google-fonts.js` and rewritten on every install, so an
`@font-face` block added there does not survive; put yours in the seam:

```css
@font-face {
  font-family: 'YourFont';
  src: url('/custom/assets/fonts/YourFont.woff2') format('woff2');
  font-weight: 400;
  font-display: swap;
}
```

Point the family at your theme with `--t-font-heading` / `--t-font-body` in
`theme.json`. Reference your files by absolute URL (`/custom/assets/...`);
exports inline those font files as data URLs so a downloaded HTML or PDF still
renders in your typeface. (The font _picker_ in the theme editor still reads
the core `CURATED_FONTS` list — adding a family there is a separate change.)

Two things the seam does not do: it does not resolve `@import` (add another
file to the folder instead), and it is read once at boot — restart the server
after editing, like `custom/slide-types/`.

### Customize AI generation (`custom/ai/`)

Deckyard's AI deck generation ships with a good, generic set of prompts and a
core slide-type catalog. A fork can override both without patching the
pipeline: the OSS repo carries the _mechanism_ (builders, schemas, the LLM
transport) plus a base copy layer, and resolves your overrides on top of it
(base-then-overlay, last writer wins). The `custom/ai/` folder is empty in OSS
(only `.gitkeep` is tracked) and gitignored, exactly like `custom/themes` and
`custom/slide-types`.

There are two independent seams:

#### 1. Override prompt copy — `custom/ai/prompts.js`

The instruction prompts (system + user messages for outline, deck, refine,
iterate, revise) are built by named builder functions. Default-export a map of
`{ builderName: fn }`; each function replaces the same-named base builder and
keeps its call signature. Anything you don't override falls back to the base.

```js
// custom/ai/prompts.js
export default {
  // Same signature as the base builder it replaces.
  buildPhase1SystemPrompt({
    detectedLang,
    requestedLang,
    targetSlides,
    estimatedInputLines,
  }) {
    return `...your tuned outline system prompt...`;
  },
};
```

The overridable builder names (from `server/utils/ai/prompts/base/index.js`):

| Builder                                                  | Used for                             |
| -------------------------------------------------------- | ------------------------------------ |
| `buildPhase1SystemPrompt` / `buildPhase1UserPrompt`      | outline generation                   |
| `buildPhase2SystemPrompt` / `buildPhase2UserPrompt`      | full-deck (slide) generation         |
| `buildRevisionSystemPrompt` / `buildRevisionUserPrompt`  | outline revision                     |
| `buildSectionSystemPrompt` / `buildSectionUserPrompt`    | per-section refine                   |
| `buildSlideIterationPrompt` / `buildDeckIterationPrompt` | "Refine" iteration on a slide / deck |

Rules the loader enforces (a typo fails loud, never silent): only
function-valued entries whose key matches a known builder are applied; anything
else is ignored with a console warning. A missing or broken `custom/ai/prompts.js`
leaves the OSS base prompts fully in force.

#### 2. Override a core slide type's catalog copy — `custom/ai/catalog.js`

The AI catalog tells the model what each slide type is for. To replace the
`description` / `bestFor` / `notFor` a **core** type contributes to the prompt
(while keeping its schema and allowed icons), default-export a map of
`{ coreTypeName: partialOverride }`. Only the fields you set are overridden;
the rest of the core entry is preserved.

```js
// custom/ai/catalog.js
export default {
  'content-slide': {
    description: 'Your house-style description of when to use a content slide.',
    bestFor: [
      'dense explanatory points',
      'a single argument built out in prose',
    ],
    notFor: ['lists (use list-slide)', 'comparisons (use comparison-slide)'],
  },
};
```

Overridable fields: `description`, `bestFor`, `notFor`, `category`,
`resolveInPhase1`. Keys must match a core type name (e.g. `content-slide`,
`quote-slide`, `image-text-slide` — see
`server/utils/ai/slide-catalog/type-ai.js` for the full list); an unknown
type name or a stray field is dropped with a warning. To _add_ an entirely new
slide type (rather than override a core one), define it in
`custom/slide-types/*.js` with an `ai` block — that path adds to the catalog;
this one overrides.

Both seams take effect on server start; no build step. Nothing here needs to be
wired up beyond dropping the file in `custom/ai/`.

### Step 4: Set Your Default Theme

Create or edit `.env`:

```bash
DEFAULT_THEME=your-org
```

To limit which themes people can pick at all, add the allowlist alongside it.
It is enforced server-side, so an id left out is offered by no picker:

```bash
ENABLED_THEMES=your-org,editorial
```

Leave it unset to offer every theme. Admins can override it per instance in
Settings → Themes; see `docs/reference/deck-creation-and-reuse.md` § Theme
default and the allowlist.

### Step 5: Commit Your Customizations

```bash
git add custom/themes/ custom/slide-types/ custom/assets/ custom/ai/ .gitignore
git commit -m "Add organization branding and themes"
git push origin main
```

### Step 6: Set Up Upstream Tracking

To receive updates from the main Deckyard project:

```bash
# Add upstream remote
git remote add upstream https://github.com/jaapstronks/deckyard.git

# Fetch upstream changes, including release tags
git fetch upstream --tags
```

Because your customizations live in paths upstream does not modify (`custom/`, `CLAUDE.md` and what `custom/fork.json` declares as owned), merges conflict only where you patch core. `npm run fork:seams` shows where that is (see _Merge round checklist_).

---

## Updating Your Fork

**Track releases, not the tip of `main`.** Releases are tagged (`v1.0.0`,
`v1.1.0`, …) and each release's changes are summarized in `CHANGELOG.md` —
that summary tells you whether an update affects your fork before you merge
anything. The tip of `main` may additionally contain work that just hasn't
been released yet, and long-running feature tracks live on integration
branches (e.g. `collab`) that you should never merge directly.

```bash
# Fetch the latest from upstream, including tags
git fetch upstream --tags

# See what releases are available
git tag -l 'v*'

# Read the release notes first (CHANGELOG.md at that tag), then merge it
git merge v1.1.0

# If there are conflicts (rare), resolve them
# Then push to your fork
git push origin main
```

Merging `upstream/main` directly still works if you want the bleeding edge,
but you're then integrating unreleased work at whatever state it happens to
be in — releases are the supported sync points.

### After the merge, run the suite

Two checks in the suite exist specifically for this moment, because the
expensive breakages in a fork upgrade are the silent ones — nothing throws at
merge time:

- **`npm test` → `tests/custom-imports-resolvable.test.js`** — every relative
  import in your `custom/` tree still resolves. There is no bundler, so a core
  module that moved upstream does not fail the build; it fails at runtime, on
  the import that never loads. A green suite without this check proves nothing.
- **`npm run lint`** — the same check (`import-x/no-unresolved`) across the core
  trees, in case your merge left one half-applied.

### Merge round checklist

One release per round, on a branch, through your own PR:

1. **Read the release notes** (`CHANGELOG.md` at the tag) for anything that
   touches your fork.
2. **Merge the tag** on a branch: `git switch -c chore/upstream-v1.49.0 && git merge v1.49.0`.
   Resolve a conflict by keeping your deliberate deviation and taking every
   upstream line that is not that deviation.
3. **Cross the seams**: `npm run fork:seams -- v1.49.0`. It lists the files
   upstream changed in this round that your fork also changes outside what it
   owns, each marked as a documented seam (`.gitignore`), a declared deviation
   (from `custom/fork.json`, with its reason) or **undeclared**: a new core patch
   or drift. For each undeclared file, propose the change upstream or declare it
   as a deviation; the command exits 1 while one remains. It also lists quieter
   divergence in files upstream did not touch this round. It works before and
   after the merge; `--from <ref>` sets the start of the round by hand, `--json`
   prints machine output.
4. **Run the gates**, in this order: `npm test` (it includes
   `tests/custom-imports-resolvable.test.js`, see above), `npm run lint`,
   `npm run format:check`, `npm run i18n:sync` (reports missing keys;
   `npm run i18n:sync:apply` writes them), and start the app once to see your
   themes and slide types load.
5. **Open the PR**, merge it after review, and deploy.

## Deployment

Your fork deploys exactly like the OSS version:

```bash
docker compose up -d --build
```

Deckyard runs on PostgreSQL; the compose stack ships its own `postgres:16` and
applies pending migrations automatically at container start. File storage and
its one-time import were both removed in 1.x — see `docs/ops/self-hosting.md`.

Make sure your `.env` file on the server has:

- `DEFAULT_THEME=your-org` (your seed theme's slug)
- Any API keys (OpenAI, ImageKit, etc.)

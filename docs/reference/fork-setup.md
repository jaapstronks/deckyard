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

1. Go to https://github.com/jaapstronks/deckyard
2. Click "Fork" to create your own copy
3. Clone your fork locally:
   ```bash
   git clone https://github.com/YOUR-ORG/YOUR-FORK.git
   cd YOUR-FORK
   ```

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
```

### Step 3: Add Your Custom Content

1. **Add your theme** as a self-contained folder
   `custom/themes/your-org/theme.json` (recommended folder layout — see
   `docs/developer/themes.md` for the flat legacy layout and a migration
   recipe):

   ```
   custom/themes/your-org/
     theme.json
     assets/images/your-logo.svg
     assets/fonts/YourFont-Regular.woff2
   ```

   ```json
   {
     "id": "your-org",
     "label": "Your Organization",
     "assets": {
       "logo": "/custom/themes/your-org/assets/images/your-logo.svg",
       "logoAlt": "Your Organization"
     },
     "cssVars": {
       "--t-color-accent": "#your-brand-color"
     }
   }
   ```

   Deck-content assets shared across themes (uploaded images, partner logos)
   still live in `custom/assets/`.

   Add `backgroundPresets` if you want title slides to get one of your own
   background images automatically (on deck import, and when converting a
   chapter-title slide). Without it they stay flat — Deckyard will never reach
   for its own demo imagery:

   ```json
   {
     "backgroundPresets": [
       "/custom/themes/your-org/assets/images/bg-1.jpg",
       "/custom/themes/your-org/assets/images/bg-2.jpg"
     ]
   }
   ```

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
no selectors with the canvas. Two named chains is the honest description; one
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

Because your customizations live in `custom/` directories that the upstream doesn't modify, merges should be conflict-free.

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

### If the doc gate fails on your own docs

`tests/docs-paths-resolvable.test.js` reads every doc that ships with the repo
and requires each cited path to resolve and each doc to be linked. A fork with
its own private doc tree (`docs/<your-tree>/`) will fail on every item in it.

Add the tree to one constant at the top of that test, rather than patching the
test's logic:

```js
const EXCLUDED_DOC_TREES = ['docs/plans/', 'docs/<your-tree>/'];
```

Upstream's own `docs/plans/` is already in that list. One line, and it survives
the next merge as an ordinary conflict on a data line instead of a patch you
re-defend every time.

## Deployment

Your fork deploys exactly like the OSS version:

```bash
docker compose up -d --build
```

Deckyard runs on PostgreSQL; the compose stack ships its own `postgres:16` and
applies pending migrations automatically at container start. If your fork still
holds decks in file storage, import them once with
`docker compose exec app npm run db:import` — see `docs/ops/self-hosting.md`.

Make sure your `.env` file on the server has:

- `DEFAULT_THEME=your-org` (your theme ID)
- Any API keys (OpenAI, ImageKit, etc.)

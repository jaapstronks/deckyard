# capture — deterministic docs screenshots

This folder regenerates documentation screenshots **without hand-work**: it seeds
known state via the REST API, drives the running dev server with Puppeteer, and
writes a PNG to the exact path the docs expect. It is **Phase 0** of the
screencast video factory — a screenshot is that same pipeline minus the video
step, so the recipe format here is designed to carry a later video recipe too.

The output lands in the sibling **deckyard-website** repo. A deckyard session
_writes_ the PNGs but does **not** commit them there (workspace rule); a
deckyard-website session commits them and fills the registry `recipe` field
(see the back-briefing).

## Run it

```bash
# terminal 1 — dev server with auto-login (BOTH env vars are required)
NODE_ENV=development AUTH_DEV_BYPASS=true npm run start

# terminal 2
npm run capture -- --list                 # show known recipes
npm run capture -- theme-editor-full      # one screenshot
npm run capture -- --all                  # every recipe
npm run capture -- editor-full --out /tmp/shots   # write elsewhere
```

Options: `--out <dir>` (output root; the recipe's `registryPath` is written
relative to it — default `../deckyard-website`), `--base <url>` (dev server,
default `http://localhost:4177`). Env equivalents: `CAPTURE_OUT_DIR`,
`CAPTURE_BASE_URL`.

The browser is the app's own `getPuppeteerBrowser()` (system Chrome/Chromium —
the same one the PDF/PNG exporters use). No extra dependency, no browser
download. Set `PUPPETEER_EXECUTABLE_PATH` if Chrome is in a non-standard place.

## Recipe format

One module per screenshot in `recipes/<id>.js`, default-exporting a plain object.
Add a screenshot by dropping a module and listing it in `recipes/index.js`.

```js
/** @type {import('../lib/recipe.js').Recipe} */
export default {
  id: 'theme-editor-full',                 // stable slug == registry id sans "shot-"
  output: 'theme-editor-full.png',         // output filename
  registryPath: 'public/images/screenshots/theme-editor-full.png', // exact docs path
  viewport: { width: 1440, height: 900, deviceScaleFactor: 2 },     // optional; this is the default
  fullPage: true,                          // whole scrollable page vs viewport clip

  async state(api) {                       // optional: seed deterministic data
    const deckId = await seedDeck(api, { title: '[capture] x', slides: [...] });
    return { deckId };                     // returned context is passed to navigate/action
  },

  navigate: (ctx) => `/app/${ctx.deckId}?slideId=${ctx.firstSlideId}`, // string or (ctx)=>string
  waitFor: '.app-shell.editor-shell',      // selector meaning "rendered"

  async action(page, ctx) {                // optional: pre-shot browser steps
    await page.click('button.slides-add-btn');
    await page.waitForSelector('.slide-type-modal', { visible: true });
  },
};
```

Field reference:

| field | required | purpose |
|-------|----------|---------|
| `id` | ✓ | Stable slug; matches the registry entry id without the `shot-` prefix. |
| `output` | ✓ | Output filename; must be the basename of `registryPath`. |
| `registryPath` | ✓ | Exact path from the website registry — the file docs reference. Sacred. |
| `navigate` | ✓ | Path (relative to base) to open, as a string or `(ctx) => string`. |
| `viewport` | | `{ width, height, deviceScaleFactor }`. Defaults to `1440×900 @2x`. |
| `fullPage` | | `true` captures the whole scrollable page. Default `false`. |
| `state` | | `async (api) => ctx`. Seed data via REST; return a context object. |
| `waitFor` | | CSS selector that signals the page finished rendering. |
| `action` | | `async (page, ctx)`. Clicks/hovers to reach the exact UI state. |
| `localStorage` | | `{ key: value }` seeded before app scripts run — suppress one-time hints/coach-marks for a clean shot. |
| `cleanup` | | `async (api, ctx)`. Optional teardown after the shot. |

### Why the recipe body lives here and not in the registry

The recipe needs **internal knowledge** — which API call seeds the state, which
route/`?slideId=` to hit, which selector to click — that belongs in deckyard, not
in the website's registry. So the registry's `recipe` field stays a **reference**,
not the body:

```jsonc
"recipe": {
  "id": "theme-editor-full",
  "module": "../deckyard/capture/recipes/theme-editor-full.js",
  "hash": "9f1c…"        // content hash of the recipe file → the recipe itself can go stale
}
```

`npm run capture -- --all` prints these reference blocks after a successful run.
The `hash` is a SHA-256 of the recipe source (first 16 hex chars): if the recipe
changes, the reference in the registry no longer matches and the screenshot is
flagged for review — the same drift mechanism the registry uses for source deps.

## Determinism conventions

- **Fixed viewport** `1440×900 @2x` unless a recipe overrides it.
- **Light color scheme + reduced motion** are forced on every page so captures
  don't depend on the host OS appearance or catch a mid-transition frame.
- **Fixed sample content** from `recipes/_sample-content.js` — one shared,
  PII-free deck so seeded shots are visually stable across runs and machines.
  Marketing shots use the richer `recipes/_marketing-deck.js` instead: same
  determinism rules, but bilingual (one deck, `i18n.versions` for `nl` and
  `en-GB`, so a recipe switches with `?lang=nl` / `?lang=en-GB`) and stocked
  with typed slides that have something to show — a funnel, a timeline, a poll
  whose seeded result is uneven (`MARKETING_POLL_VOTES`), and the follow-along
  invite.
- **Idempotent seeding** — seeded decks use the fixed `SAMPLE_DECK_TITLE` and
  are deleted-by-title before each seed, so re-runs stay clean. The title reads
  as a normal deck name (it shows in the editor title bar) rather than a
  debug marker. Only run captures against a throwaway dev instance.
- **Account settings are set, never inherited.** `uiLocale` and the profile's
  display name are *account* settings, so they survive from one recipe to the
  next inside a `--all` run — a shot that contains UI text and doesn't call
  `setUiLocale()` comes out in whatever language the previous recipe happened
  to leave behind. Every recipe with visible chrome pins both:
  - `setUiLocale()` for the chrome's language. Note `?lang=` cannot do this
    job: that is the *deck* language, and its English code is `en-GB` where the
    UI locale's is `en`.
  - `setDisplayName(api, CAPTURE_ACCOUNT_NAME)` for who the account is. The
    editor names the deck's owner beside the title, falling back to the local
    part of the address — which under `AUTH_DEV_BYPASS` is `dev@local`, so an
    unpinned run puts "Dev" in the frame.

## Marketing shots

`public/images/marketing/` is the second destination, driven by the shot list in
deckyard-website `planning/marketing-beeld.md`. Fourteen recipes, seven shots ×
two languages, in two groups:

| group | shots | shapes live in |
|---|---|---|
| home page | `editor-form`, `poll-live`, `join-screen` | `recipes/_marketing-shots.js` |
| `/features` | `presenter-view`, `comments`, `share-link-rules`, `ai-fills-fields` | `recipes/_features-shots.js` |

They share the docs harness but differ in four ways, each for a stated reason:

| | docs shots | marketing shots |
|---|---|---|
| viewport | 1440×900 @2x | **1280×800 @2x** → 2560×1600, the size the site's layout is built around. `share-link-rules` is 1280×1200 because the dialog is capped at 80vh and would otherwise be cut in half |
| theme | whatever `DEFAULT_THEME_ID` is | **pinned to `brand`** — a marketing image must not change colour the day the default does |
| content | `_sample-content.js` | `_marketing-deck.js` — typed slides with something to photograph |
| frame | whole viewport | four of the seven are **clipped** (`clip:`): `poll-live` / `join-screen` to the slide, because the presenter toolbar around them is a different shot; `share-link-rules` / `ai-fills-fields` to their dialog, because the editor behind it is not the subject |

Five mechanisms live in `lib/marketing.js` (and one in `lib/comments-seed.js`)
because a docs screenshot never needs them:

- **`seedBilingualDeck()`** writes the `i18n.versions` envelope, so `?lang=nl`
  and `?lang=en-GB` are two versions of one deck rather than two decks.
- **`startLiveSession()` + `seedPollVotes()`** — a poll has no votes outside a
  presentation session, so the editor preview always renders `Total: 0`. The
  votes go through the public vote route, one fresh device cookie each, and the
  helper then blocks until the server reports the expected tally rather than
  handing that race to the browser.
- **`rewriteJoinOrigin()`** puts `deckyard.eu` on the join screen. This is *not*
  `APP_URL`: the follow-invite slide builds its URL client-side from
  `location.origin`, which no server setting can reach. The human-readable URL
  is substituted after render; the QR is deliberately left encoding the capture
  instance, because a scannable code pointing at a deck nobody hosts would be
  worse than a decorative one. A genuinely scannable join shot has to be taken
  on a real deckyard.eu instance.
- **`stubTranslateFields()`** answers the slide-translation call from the deck
  instead of from a model. The fill-from-translation preview only renders once
  `/api/presentations/:id/translate/fields` responds, and a live call would need
  a provider key, cost money and return different words every run. The deck is
  already bilingual, so the other version of the slide *is* the translation:
  the request is intercepted and answered with it. Nothing on screen is
  invented; the model is simply not asked a question the deck already answers.
- **`seedCommentThreads()`** (in `lib/comments-seed.js`) is the one seeder that
  writes through storage rather than REST, and the reason is identity. The
  comments route takes its author from the *session* — as it should; a comments
  API that let the caller name someone else would be an impersonation hole —
  and the capture run has exactly one session, the dev bypass's. Over REST every
  comment in the shot is therefore by the same "Dev", which is not a picture of
  people working together. `createComment()` one layer down does take an author,
  so the recipe calls it the way `scripts/create-api-key.js` calls storage: load
  `.env`, initialize storage, write. It opens a second pool against the same
  database, so `closeCommentSeedStorage()` runs in the recipe's `cleanup` — an
  idle pool would keep the runner from exiting.

### Known limits

**The recipe hash covers the module graph, scoped to `capture/`.**
`hashRecipeGraph()` walks a recipe's imports with an ES module lexer and hashes
the sorted set of `{repo-relative path, contents}` it reaches — so a change in
`_marketing-shots.js`, `_features-shots.js`, `_marketing-deck.js` or
`_sample-content.js` moves the hash of every shot built on it, and the registry
flags them as stale.

The walk stops at the `capture/` boundary: an import of `shared/` or `server/`
is neither hashed nor followed. That boundary is the whole design. Unscoped, the
graph runs to ~122 modules through `lib/comments-seed.js`, and those directories
took 308 commits in the same 60 days `capture/` took 6 — every recipe would read
as stale nearly every day, and a gate that is always red gets ignored. The cost
is the one thing the boundary hides: change how a recipe *seeds* through
`server/storage/`, and the hash will not tell you.

Two further limits, both worth knowing before trusting a re-run:

- **The join screen's access code is per-session**, so it differs on every run.
  Everything else in these shots is deterministic — deliberately, including the
  presenter console's stopwatch, which the recipe stops and zeroes because a
  running clock would read differently in every capture.
- **`comments` needs the database, not just the dev server.** It is the only
  recipe that connects to Postgres itself (see `seedCommentThreads()` above), so
  it fails where the others would merely produce a thinner shot.

## Adding the next screenshot

1. Copy an existing `recipes/<id>.js` and adjust `state` / `navigate` /
   `waitFor` / `action`.
2. Use the registry entry's exact `id` (sans `shot-`) and `path`
   (`registryPath`). Find them in `../deckyard-website/docs-sync/registry.json`.
3. Add the module to `recipes/index.js`.
4. `npm run capture -- <id>` and eyeball the PNG.

## Extending to video (Phase 1)

The `state` + `navigate` + `action` + `viewport` fields already describe how to
reach a UI state deterministically. A video recipe reuses them and adds a capture
sequence (a scripted set of `action` steps recorded as WebM, later composed with
Remotion) instead of a single `screenshot()`. Same registry, same reference
mechanism — no rework.

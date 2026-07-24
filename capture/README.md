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
- **Idempotent seeding** — seeded decks use the fixed `SAMPLE_DECK_TITLE` and
  are deleted-by-title before each seed, so re-runs stay clean. The title reads
  as a normal deck name (it shows in the editor title bar) rather than a
  debug marker. Only run captures against a throwaway dev instance.

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

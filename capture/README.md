# capture — deterministic docs screenshots

This folder regenerates documentation artefacts **without hand-work**: it seeds
known state via the REST API, drives the running dev server with Puppeteer, and
writes either a PNG to the exact path the docs expect or a **video take** — a
4K WebM plus the event log a composition derives its camera from.

Both kinds are the same recipe format. A screenshot ends at `page.screenshot()`;
a take reuses the same `state` / `navigate` / `waitFor` / `action` to reach the
state the recording starts from, and adds a `record` block. See § Video
recipes.

The output lands in the sibling **deckyard-website** repo. A deckyard session
_writes_ the PNGs but does **not** commit them there (workspace rule); a
deckyard-website session commits them and fills the registry `recipe` field
(see the back-briefing).

## Run it

```bash
# terminal 1 — dev server with auto-login (BOTH env vars are required)
NODE_ENV=development AUTH_DEV_BYPASS=true npm run start

# terminal 2
npm run capture -- --list                 # show known recipes, both kinds
npm run capture -- theme-editor-full      # one screenshot
npm run capture -- --all                  # every screenshot recipe
npm run capture -- editor-full --out /tmp/shots   # write elsewhere

npm run capture -- --video form-drives-slide      # record one take
npm run capture -- --all --json           # the same run, reported as JSON
```

Options: `--out <dir>` (output root — default `../deckyard-website` for
screenshots, where the recipe's `registryPath` is written relative to it, and
`../deckyard-video` for takes), `--base <url>` (dev server, default
`http://localhost:4177`), `--video` (record `kind: 'video'` recipes instead of
taking shots), `--json` (report on stdout as JSON). Env equivalents:
`CAPTURE_OUT_DIR`, `CAPTURE_BASE_URL`.

`--json` exists because an automated caller has to know _which_ recipes came
out, not just how many: the refresh pipeline re-baselines only the ids it
captured, and a run where one recipe timed out must leave that entry's baseline
alone. Under `--json` stdout carries nothing but the report — progress, the
custom-type loader's warnings and the storage seeder's Postgres logs all move
to stderr — so it can be piped straight into a parser.

```jsonc
{
  "kind": "screenshot",
  "base": "http://localhost:4177",
  "results": [
    {
      "id": "editor-full",
      "ok": true,
      "recipeHash": "5d46…",
      "registryPath": "public/images/screenshots/editor-full.png",
    },
    {
      "id": "share-link-rules-nl",
      "ok": false,
      "recipeHash": "0a1b…",
      "error": "Waiting for selector … failed",
    },
  ],
  "summary": { "total": 17, "ok": 16, "failed": 1 },
}
```

Paths in the report are relative to `--out`, not absolute: the report travels
from the host that captured to the repo that consumes it, and an absolute path
is the one field guaranteed to be wrong there. A take reports `take`, `events`,
`eventCount`, `durationMs` and `slipped` instead of `registryPath`.

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

| field          | required | purpose                                                                                                |
| -------------- | -------- | ------------------------------------------------------------------------------------------------------ |
| `id`           | ✓        | Stable slug; matches the registry entry id without the `shot-` prefix.                                 |
| `output`       | ✓        | Output filename; must be the basename of `registryPath`.                                               |
| `registryPath` | ✓        | Exact path from the website registry — the file docs reference. Sacred.                                |
| `navigate`     | ✓        | Path (relative to base) to open, as a string or `(ctx) => string`.                                     |
| `viewport`     |          | `{ width, height, deviceScaleFactor }`. Defaults to `1440×900 @2x`.                                    |
| `fullPage`     |          | `true` captures the whole scrollable page. Default `false`.                                            |
| `state`        |          | `async (api) => ctx`. Seed data via REST; return a context object.                                     |
| `waitFor`      |          | CSS selector that signals the page finished rendering.                                                 |
| `action`       |          | `async (page, ctx)`. Clicks/hovers to reach the exact UI state.                                        |
| `localStorage` |          | `{ key: value }` seeded before app scripts run — suppress one-time hints/coach-marks for a clean shot. |
| `cleanup`      |          | `async (api, ctx)`. Optional teardown after the shot.                                                  |

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

- **Fixed viewport** `1440×900 @2x` unless a recipe overrides it. Takes use
  `1280×720 @3x` — see § Video recipes.
- **Light color scheme** is forced on every page so captures don't depend on the
  host OS appearance.
- **Reduced motion is forced for screenshots and off for takes**, and that flip
  is a real weakening rather than a convenience. `reduce` is what keeps a
  screenshot from catching a mid-transition frame; for a clip it would switch
  off precisely the app animations the clip exists to show — the panel sliding
  in, the slide following the form. So a screenshot aims at pixel-identical and
  **a take only aims at "the same to a frame or two"**. Measured on the first
  take: two consecutive runs came out frame-aligned, mean SSIM 0.9992, worst
  frame 0.9974, and the residual is VP9 encoder noise on text edges rather than
  a time offset — the same comparison one frame apart scores 0.9772. The MP4s
  are not byte-identical and will not become so; the encoder is not
  deterministic. The preference follows the recipe's `kind` and nothing else
  (`resolveReducedMotion()`); it is deliberately not a per-recipe field.
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
  display name are _account_ settings, so they survive from one recipe to the
  next inside a `--all` run — a shot that contains UI text and doesn't call
  `setUiLocale()` comes out in whatever language the previous recipe happened
  to leave behind. Every recipe with visible chrome pins both:
  - `setUiLocale()` for the chrome's language. Note `?lang=` cannot do this
    job: that is the _deck_ language, and its English code is `en-GB` where the
    UI locale's is `en`.
  - `setDisplayName(api, CAPTURE_ACCOUNT_NAME)` for who the account is. The
    editor names the deck's owner beside the title, falling back to the local
    part of the address — which under `AUTH_DEV_BYPASS` is `dev@local.test`, so an
    unpinned run puts "Dev" in the frame.

## Marketing shots

`public/images/marketing/` is the second destination, driven by the shot list in
deckyard-website `planning/marketing-beeld.md`. Fourteen recipes, seven shots ×
two languages, in two groups:

| group       | shots                                                               | shapes live in                |
| ----------- | ------------------------------------------------------------------- | ----------------------------- |
| home page   | `editor-form`, `poll-live`, `join-screen`                           | `recipes/_marketing-shots.js` |
| `/features` | `presenter-view`, `comments`, `share-link-rules`, `ai-fills-fields` | `recipes/_features-shots.js`  |

They share the docs harness but differ in four ways, each for a stated reason:

|          | docs shots                     | marketing shots                                                                                                                                                                                                                                               |
| -------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| viewport | 1440×900 @2x                   | **1280×800 @2x** → 2560×1600, the size the site's layout is built around. `share-link-rules` is 1280×1200 because the dialog is capped at 80vh and would otherwise be cut in half                                                                             |
| theme    | whatever `DEFAULT_THEME_ID` is | **pinned to `brand`** — a marketing image must not change colour the day the default does                                                                                                                                                                     |
| content  | `_sample-content.js`           | `_marketing-deck.js` — typed slides with something to photograph                                                                                                                                                                                              |
| frame    | whole viewport                 | four of the seven are **clipped** (`clip:`): `poll-live` / `join-screen` to the slide, because the presenter toolbar around them is a different shot; `share-link-rules` / `ai-fills-fields` to their dialog, because the editor behind it is not the subject |

Five mechanisms live in `lib/marketing.js` (and one in `lib/comments-seed.js`)
because a docs screenshot never needs them:

- **`seedBilingualDeck()`** writes the `i18n.versions` envelope, so `?lang=nl`
  and `?lang=en-GB` are two versions of one deck rather than two decks.
- **`startLiveSession()` + `seedPollVotes()`** — a poll has no votes outside a
  presentation session, so the editor preview always renders `Total: 0`. The
  votes go through the public vote route, one fresh device cookie each, and the
  helper then blocks until the server reports the expected tally rather than
  handing that race to the browser.
- **`rewriteJoinOrigin()`** puts `deckyard.eu` on the join screen. This is _not_
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
  already bilingual, so the other version of the slide _is_ the translation:
  the request is intercepted and answered with it. Nothing on screen is
  invented; the model is simply not asked a question the deck already answers.
- **`seedCommentThreads()`** (in `lib/comments-seed.js`) is the one seeder that
  writes through storage rather than REST, and the reason is identity. The
  comments route takes its author from the _session_ — as it should; a comments
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
as stale nearly every day, and a gate that is always red gets ignored.

Two things the hash therefore cannot see. Both can change every screenshot
without moving a single hash:

- **What a recipe seeds and renders _through_.** Change `server/storage/` under
  `seedCommentThreads()`, or any app code the shot photographs, and the hash
  stays put. That is the boundary doing its job, but it is still a blind spot.
- **The harness that takes the shot.** `run.js`, `lib/browser.js` and
  `lib/recipe.js` itself — `openPage()`, `gotoStable()`, `settle()`, the clip
  and full-page logic — live _inside_ `capture/`, yet no recipe imports them.
  The dependency runs the other way: the runner imports the recipe. Rewrite
  `settle()` and every PNG changes while every hash holds.

So read the hash for what it is: "has this recipe, or a factory it is built on,
drifted?" — not "would a re-run produce the same image?".

Two further limits, both worth knowing before trusting a re-run:

- **The join screen's access code is per-session**, so the shots that show one
  pin it: `pinJoinCode()` substitutes a fixed code (and re-encodes the QR for
  the public `/go` page) after render, next to `rewriteJoinOrigin()`. Everything
  else in these shots is deterministic by the same kind of deliberate
  intervention — including the presenter console's stopwatch, which the recipe
  stops and zeroes because a running clock would read differently in every
  capture.
- **`comments` needs the database, not just the dev server.** It is the only
  recipe that connects to Postgres itself (see `seedCommentThreads()` above), so
  it fails where the others would merely produce a thinner shot.

### What two runs on one host actually produce

Measured 2026-08-28 on macOS, two consecutive `--all` runs against the same
server, compared byte-for-byte and then pixel-for-pixel. The row that used to
dominate this table — 8 shots differing in the access code and its QR — is gone
since `pinJoinCode()` landed; what is left is host-level rendering noise:

|                      | shots | what differs                                                                                                                                     |
| -------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| byte-identical       | 15    | includes all 8 that carry an access code: `join-screen-{nl,en}`, `poll-live-{nl,en}`, `presenter-view-{nl,en}`, `comments-{nl,en}`               |
| sub-perceptual noise | 2     | `editor-form-en` — 119 px, none differing by more than 1/255. `slide-type-picker-new` — 89 px scattered over icon and glyph edges, one at 34/255 |

So the honest claim is: **a screenshot is byte-reproducible except for
antialiasing jitter the host decides.** That jitter is not per-recipe and does
not stay put — the 2026-08-28 pre-pin run had it on `editor-full` (492 px) and
`editor-form-en`, this one on `editor-form-en` and `slide-type-picker-new`. On
`slide-type-picker-new` it is bistable rather than random: three consecutive
runs gave state A, B, A. It predates the pin (that recipe shows no join code at
all) and is tracked separately; a refresh gate has to tolerate it, which is a
different thing from tolerating a code that changes on every run.

Two runs also produced one failing recipe each, a different one each time
(pre-pin: `presenter-view-nl` and `share-link-rules-nl`; post-pin:
`presenter-view-en`, all selector timeouts on a live-session shot). Roughly 1 in
17, and it is why an automated re-baseline has to be scoped to the recipes that
actually came out: a run that re-baselines a recipe it could not capture is
recording a claim about an artifact that is one week older than it says it is.

## Adding the next screenshot

1. Copy an existing `recipes/<id>.js` and adjust `state` / `navigate` /
   `waitFor` / `action`.
2. Use the registry entry's exact `id` (sans `shot-`) and `path`
   (`registryPath`). Find them in `../deckyard-website/docs-sync/registry.json`.
3. Add the module to `recipes/index.js`.
4. `npm run capture -- <id>` and eyeball the PNG.

## Video recipes

A take is a screenshot recipe plus a `record` block. It reuses `state` /
`navigate` / `waitFor` / `action` unchanged — the recording starts where the
screenshot would have been taken — and drops `output` / `registryPath` / `clip` /
`fullPage`, which name one PNG in the website registry. The runner derives both
output paths from the id.

```js
import { VIDEO_VIEWPORT } from '../lib/record.js';

/** @type {import('../lib/recipe.js').VideoRecipe} */
export default {
  id: 'form-drives-slide',
  kind: 'video',
  viewport: VIDEO_VIEWPORT,

  state: shot.state, // reused from the shot this take layers on
  navigate: shot.navigate,
  waitFor: shot.waitFor,
  action: shot.action,

  record: {
    fps: 30,
    async sequence(rec) {
      await rec.hold(500);
      await rec.type(TITLE_FIELD, 'Van kraam tot vaste klant', {
        clear: true,
        label: 'titel',
      });
      await rec.hold(500);
      await rec.move(PREVIEW_HEADLINE, { label: 'slide' });
      await rec.hold(900);
    },
  },
};
```

Two takes exist, both layered on a marketing shot:

| take                 | claim                      | built on             |
| -------------------- | -------------------------- | -------------------- |
| `form-drives-slide`  | a slide is a form          | `editor-form-nl`     |
| `agent-fills-fields` | your agent builds the deck | `ai-fills-fields-nl` |

The first is a typing clip, the second a click clip, so between them the
recorder's whole vocabulary is exercised by something that ships.

`npm run capture -- --video form-drives-slide` writes two files under
`--out` (default `../deckyard-video`):

| file                       | what it is                                                  |
| -------------------------- | ----------------------------------------------------------- |
| `capture/takes/<id>.webm`  | the 4K master, VP9, no audio                                |
| `capture/events/<id>.json` | every step the sequence drove, with timings and coordinates |

They are two halves of one artefact: a take without its events is a video
nobody can derive a camera from.

### The recorder

`rec` is built in `lib/record.js` and logs every call:

| call                                  | what it does                                             |
| ------------------------------------- | -------------------------------------------------------- |
| `rec.hold(ms)`                        | holds still — the breath that makes an action legible    |
| `rec.move(sel, {label})`              | travels the pointer onto an element over `MOVE_MS`       |
| `rec.click(sel, {label})`             | travels, then clicks (logged as a `move` plus a `click`) |
| `rec.type(sel, text, {label, clear})` | clicks in and types at a fixed `TYPE_CHAR_MS`            |

An event is `{ t, tEnd, kind, x, y, selector, label }` with `t` in ms from the
**first recorded frame** — `page.screencast()` resolves only once CDP has
delivered that frame, so the clock starts where the video does. (The "~1 second
of white frames" that dogs Playwright's `recordVideo` comes from the opposite:
an encoder that starts at navigation.)

Three things the recorder does on purpose:

- **A `label` marks a zoom candidate.** The composition starts its move 200ms
  _before_ the labelled event, so the camera anticipates rather than follows.
  That lead is only possible because the cursor is a drawn layer — headless
  Chrome draws no cursor, and one burned into the pixels could not be moved in
  time.
- **Coordinates come from `boundingBox()`, never from pixel positions.** A
  restyle moves the button; the recipe still names the button, so the camera
  follows instead of quietly framing the wrong thing.
- **Every step is scheduled against an absolute deadline** measured from the
  first frame. `hold(400)` means "be at t=400ms", not "sleep 400ms", so a slow
  step is absorbed by the next wait instead of shifting the rest of the take.
  When a step overruns, the run prints a `schedule slipped` warning — a take
  that could not keep its own timing is not comparable with another run.

### Why a take needs a frame ticker

`page.screencast()` is fed by `Page.screencastFrame`, and **Chromium only emits
that event when the page composites a new frame.** A page that is changing —
a caret blinking, text being typed, a hover moving — emits them continuously; a
page that has settled emits none. So a change that lands while nothing else is
moving can be coalesced away, and because the page is then static, no later
frame ever replaces it: the take runs to full length, ends on a stale image,
and reports no error.

That is not a corner case, it is where clips put their payoff. The second take
opens its fill-preview modal 10ms after a click, at the start of a `hold` —
measured before the fix, it appeared in **zero** of the take's 134 frames while
`page.screenshot()` immediately afterwards showed it.

`recordTake()` therefore installs a 1×1 px element with a compositor-only
animation (`opacity`, on its own layer) for the duration of the screencast, and
removes it afterwards. It forces a frame every vsync, so any change is captured
within a frame of happening. One CSS pixel at ~1% alpha in the bottom-left
corner: present in the 4K master, invisible at any output resolution.

### The last hold is slack

The composition cuts a clip to a whole number of musical bars, so a take has to
be at least as long as the bars it is spec'd for (2 bars = 4s at 120 BPM). Write
the closing `rec.hold()` long enough to overshoot, and let the grid trim it —
the alternative is a clip that runs out of film mid-bar. Both current takes are
scripted a few hundred ms past their two bars.

### Why a take needs its own browser

`page.screenshot()` honours the emulated `deviceScaleFactor`; a screencast does
not. Puppeteer sizes the encoder from the host's _native_ pixel ratio, which is
1 in headless Chrome — so an emulated 3× viewport records at 1×, silently, with
no error and a video that looks fine until you zoom into it. The fix is
`--force-device-scale-factor`, a **launch** flag, so `lib/browser.js` launches a
second browser for recordings. It cannot go on the shared one: that is the app's
own export browser, and forcing 3× there would triple every exported PDF and PNG.

### Where the composition lives

`deckyard-video` (private) reads these two files and renders the MP4. It is a
separate repo for four reasons — Remotion is source-available rather than MIT,
the music is licensed, launch copy predates publication, and 4K masters do not
belong in an OSS repo's history. See `briefs/screencast-video-factory.md` § D4.

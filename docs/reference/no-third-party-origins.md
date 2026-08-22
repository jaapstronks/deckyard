# No third-party origins

A document Deckyard renders — an export, a published page, an embed, a preview,
a page it rasterises in headless Chrome — resolves everything it needs against
**this server** or carries it **inside itself**. It does not fetch code, styles
or fonts from someone else's host.

Three reasons, in the order they bite:

1. **Supply chain.** A `<script src="https://cdn…">` in a rendered page is a
   third party with arbitrary-code rights in every reader's browser (and, for
   the paths that go through Puppeteer, in the server's own headless Chrome). A
   vendored copy is pinned by `package-lock.json`, hashed in a manifest, and
   visible to `npm audit`.
2. **Version drift.** A CDN URL carries a version literal that no lockfile
   sees. Exports shipped Prism 1.29.0 / KaTeX 0.16.9 for months while the app
   shell had already moved to 1.30.0 / 0.18.4 — two KaTeX security releases
   apart — because the two spellings had nothing in common but intent.
3. **It has to work offline.** A downloaded `*.html` and a `page.setContent()`
   document have no origin. Anything relative in them resolves against nothing.

## How a document reaches the bytes

`server/utils/prism-katex.js` is the shape to copy. Its `mode` argument is the
whole design, and it has no default — only the caller knows which kind of
document it is building:

| `mode`      | For                                               | Emits                                                      |
| ----------- | ------------------------------------------------- | ---------------------------------------------------------- |
| `'linked'`  | pages this server serves (`/p/…`, embeds)         | `<link>`/`<script src="/client/vendor/…">`, browser-cached |
| `'inlined'` | downloads, `setContent()` documents, MCP previews | `<style>`/`<script>` bodies read from `client/vendor/`     |

Inlining is not free, so it is conditional: `detectPrismKatexNeeds()` reads the
**rendered slide markup** (not the deck model, so custom slide types come for
free) and a deck with neither code nor math carries nothing at all. A deck with
code carries Prism core plus the four base components plus only the language
packs it uses; a deck with math carries KaTeX **and its fontset**, base64'd into
the stylesheet — KaTeX's layout assumes its own glyph metrics, so a formula in a
fallback face is wrong, not merely different (decision D46, ~400 KB).

### Harness pages count too

The rule is not only about what a reader loads. `server/render/pdf-to-images.js`
parses an **uploaded** PDF inside the shared headless browser, and used to hand
that browser a hardcoded pdf.js from cdnjs — in the same process that renders
every deck, started with `--no-sandbox` unless `PUPPETEER_SANDBOX=true`, next to
a render path that inlines remote images through the SSRF guard precisely so no
user-supplied URL reaches Chrome. `pdfjs-dist` is a real dependency now and lives
in `client/vendor/pdfjs/`. Its harness is a `setContent()` document, so the two
files are read from disk and imported from **blob URLs** — the ES-module
equivalent of inlining, and the shape to copy for the next such page.

## Vendoring something new

`scripts/vendor-prism-katex.js` is the pattern:

1. Add the package as a real dependency, so `package-lock.json` pins it with an
   integrity hash.
2. Copy the dist files into `client/vendor/<name>/` and write a `manifest.json`
   recording the resolved version plus a sha256 per file. Never hand-edit a
   vendored file — `tests/vendor-manifests.test.js` verifies the hashes.
3. Add the script to `postinstall` in `package.json`, so a fresh clone boots
   offline and CI's `vendor-freshness` job can catch a stale copy. **A
   dependency bump of a vendored package needs a re-vendor commit in the same
   PR** — the browser loads the committed copy, not the one in `node_modules`.

`client/` is a shared public dir, so `/client/vendor/…` is served without a
route of its own.

## The carve-outs

These are decisions, not leftovers. Each is documented where it lives:

- **Fonts.** `fonts.googleapis.com` / `fonts.gstatic.com` for _externally
  managed_ fonts (Adobe, Monotype, Google-hosted) — see
  `docs/reference/font-management.md`. Curated and uploaded fonts are embedded.
- **Media playback seams.** Bunny's `player.js` and `hls.js` are injected
  **lazily by the runtime**, only once a reader actually plays a video that
  needs them (`ensureBunnyPlayerJs()`, `client/lib/slide-runtime/ensure-hls.js`).
  A deck without such a video fetches nothing. Vendoring hls.js is a live
  candidate, not a taken decision.
- **The Swagger UI shell** at `/api/v1/docs` loads swagger-ui-dist from
  jsDelivr. It is developer documentation, not a render path.

## The two gates

Both must stay green, and they fail differently on purpose:

| Gate                                   | Checks                                                                                                                                                                                                                   |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tests/no-third-party-origins.test.js` | **The source.** Greps every `.js` under `server/`, `client/` (minus `client/vendor/`) and `shared/` for an asset-CDN URL, against an allowlist that carries a reason per entry. Fails the day a new offender is written. |
| `tests/export-third-party-cdn.test.js` | **The output.** Builds every path in the render-path register (`server/render-paths.js`) from a deck with a code block and a formula, and asserts each document names no host outside a small allowlist.                 |

The output gate used to build two of the nine paths — the two that already
respected the rule — while print, PDF, PNG and the single-slide render each
pulled fourteen files from jsDelivr per export. Reading the path list from the
register is what keeps "add a tenth render path" and "forget the rule in the
tenth render path" from being the same commit.

The app shell has its own two: `tests/app-shell-third-party-cdn.test.js` and
`tests/app-shell-self-hosted-dompurify.test.js`.

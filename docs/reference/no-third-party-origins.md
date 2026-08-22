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

- **Fonts.** `fonts.googleapis.com` / `fonts.gstatic.com` (Google),
  `use.typekit.net` (Adobe) and `fast.fonts.net` (Monotype) for _externally
  managed_ fonts — see `docs/reference/font-management.md` and
  `buildExternalFontLinks` in `server/utils/theme-builder.js`. Curated and
  uploaded fonts are embedded.
- **Media playback seams.** Bunny's `player.js` and `hls.js` are injected
  **lazily by the runtime**, only once a reader actually plays a video that
  needs them (`ensureBunnyPlayerJs()`, `client/lib/slide-runtime/ensure-hls.js`).
  A deck without such a video fetches nothing. Vendoring hls.js is a live
  candidate, not a taken decision.
- **The Swagger UI shell** at `/api/v1/docs` loads swagger-ui-dist from
  jsDelivr. It is developer documentation, not a render path.

## The policy: telling the browser, not just the test suite

Both gates below are ours, and both are advisory where it counts. A host that
reaches a reader through a route no gate models — a compromised dependency,
authored slide markup, a runtime that grows a loader — loads and executes
exactly as before. So every render path also carries a
**Content-Security-Policy**, assembled once in
[`server/utils/document-csp.js`](../../server/utils/document-csp.js) and emitted
by `buildDocumentHead()` right after `<meta charset>`, before anything that can
load (D45(b)).

It is a **host allowlist for code and styles, not an XSS defence.** Every path
inlines its own runtime — a download has no origin to link against — so
`script-src` and `style-src` carry `'unsafe-inline'`, and two paths still have
an inline `on*=` handler that no hash or nonce could cover. What the policy does
refuse is `<script src="https://…">` pointing at any host not on the list, which
is reason 1 above.

Content-shaped directives stay permissive on purpose. A deck legitimately
references an image, a video, an HLS manifest or an embedded page (the embed
slide type frames any HTTPS URL) on a host Deckyard never sees, and
`embedSlideImages` inlines only what it can reach — so `img-src`, `media-src`,
`connect-src` and `frame-src` allow `https:` (a framed page runs cross-origin,
in its own browsing context), while `default-src` is `'none'` so any _new_
kind of fetch fails closed. `object-src`, `base-uri` and `form-action` are
locked down and used by nothing.

`THIRD_PARTY_ORIGINS` in that module is the same set of hosts the two gates
allow, which is the point of writing it there: vendoring hls.js deletes one
entry and narrows the policy in the same commit, instead of the policy and the
allowlists drifting the way the CDN spellings and the app shell's did.

**Three directives are unavailable in `<meta>` form** and are omitted rather
than emitted as protection that is not there: `frame-ancestors` (a question
about the response, and for the embed the answer is deliberately "anyone"),
`report-uri` (a download has nowhere to report to) and `sandbox` (wrong here
regardless — the paths need scripts and same-origin). The served surfaces set
their own headers, and `frame-ancestors` belongs there.

## The three gates

All must stay green, and they fail differently on purpose:

| Gate                                   | Checks                                                                                                                                                                                                                   |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tests/no-third-party-origins.test.js` | **The source.** Greps every `.js` under `server/`, `client/` (minus `client/vendor/`) and `shared/` for an asset-CDN URL, against an allowlist that carries a reason per entry. Fails the day a new offender is written. |
| `tests/export-third-party-cdn.test.js` | **The output.** Builds every path in the render-path register (`server/render-paths.js`) from a deck with a code block and a formula, and asserts each document names no host outside a small allowlist.                 |
| `tests/export-csp.test.js`             | **The policy.** Every path emits it, before anything loadable, identically; the code directives name exactly the declared origins and no wildcard; the omitted directives carry a reason.                                |

The output gate strips the policy meta before reading hosts: a policy names
every origin a document _may_ reach, and permitting is the opposite of fetching.
The same reason puts `server/utils/document-csp.js` on the source gate's
allowlist — it spells `cdn.jsdelivr.net` in order to permit hls.js.

**What no gate can check** is that the policy does not break a real export: a
string assertion passes just as happily against a policy that blocks the slide
runtime. That was verified by hand when it landed — all nine paths opened in a
browser with zero violations, the standalone export opened from `file://`
(the origin-less case) rendering fully, and PDF/PNG bytes identical to the
pre-CSP build. Re-run that when the policy changes.

The output gate used to build two of the nine paths — the two that already
respected the rule — while print, PDF, PNG and the single-slide render each
pulled fourteen files from jsDelivr per export. Reading the path list from the
register is what keeps "add a tenth render path" and "forget the rule in the
tenth render path" from being the same commit.

The app shell has its own two: `tests/app-shell-third-party-cdn.test.js` and
`tests/app-shell-self-hosted-dompurify.test.js`.

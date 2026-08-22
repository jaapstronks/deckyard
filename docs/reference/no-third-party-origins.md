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
- **Bunny's `player.js`** is injected **lazily by the runtime**, only once a
  reader actually plays a Bunny-hosted video (`ensureBunnyPlayerJs()`). A deck
  without such a video fetches nothing, and unlike a library this is a _service_
  seam — the script talks to Bunny's own player API, so there is nothing to
  vendor. **hls.js used to sit beside it and no longer does**: it is an ordinary
  pinnable library, so D51(a) vendored it (`scripts/vendor-hls.js`,
  `client/vendor/hls/`). `ensure-hls.js` is still lazy; it just loads from this
  server, and `cdn.jsdelivr.net` left `script-src` in the same commit.
- **The Swagger UI shell** at `/api/v1/docs` loads swagger-ui-dist from
  jsDelivr. It is developer documentation, not a render path.

## A published deck and an embed are first-party-only

`/p/…` and `/embed/…` talk to **this server and nobody else**, beyond the
carve-outs above. That is the rule, not a consequence of the current code.

External analytics is therefore an **app-shell feature**: the operator's own
surface, where the operator is the visitor. It used to be injected into the
published page and the embed as well, behind `ANALYTICS_INCLUDE_EMBEDS` /
`ANALYTICS_INCLUDE_EXPORTS`; the document CSP those pages carry has blocked
every such tag since the policy landed, and D56 (2026-08-22) settled that the
block is the **wanted** end state rather than a bug. The injection and both
gates are gone; `analyticsHeadHtml()` has one caller left, the shell.

The trade is deliberate and it costs something: an operator who wants their own
Plausible on their own published decks cannot have it. Three things decided it.
A published deck is where _strangers_ land, and unlike the shell there is no
consent seam left on it (D47/D50). Widening the policy could not be done at the
header alone — a browser enforces every policy it is given, so the document meta
would have to widen too, and that meta is shared with seven render paths that
must not get the widening. And the surface is already measured: the inline
`/api/track/*` tracker (`server/analytics/tracking-script.js`) is first-party,
covered by `connect-src 'self'`, and has a retention policy and a GDPR erase
route — which no third-party tag on that page would have.

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
allow, which is the point of writing it there. Vendoring hls.js is the worked
example: one entry left the list, `script-src` narrowed to
`assets.mediadelivery.net` alone, and both gate allowlists shed their entries —
all in one commit, instead of the policy and the allowlists drifting the way the
CDN spellings and the app shell's did.

**Three directives are unavailable in `<meta>` form** and are omitted rather
than emitted as protection that is not there: `frame-ancestors` (a question
about the response, and for the embed the answer is deliberately "anyone"),
`report-uri` (a download has nowhere to report to) and `sandbox` (wrong here
regardless — the paths need scripts and same-origin).

### The served surfaces also send a header (D53(i))

`/p/…` and `/embed/…` are surfaces this server hands back over HTTP, so they
_can_ set a header — and since D53(i) they do, via
`buildDocumentCspHeader({ frameAncestors })`. It is the same policy the
document already carries as a meta, plus the one directive a meta is specified
to ignore. **The gain is consistency, not coverage**: every directive the meta
can express was already in force on those documents.

`frameAncestors` is a required argument, because the two callers want opposite
answers and neither is a safe default for the other:

| Surface    | `frame-ancestors` | `X-Frame-Options` (security-headers.js) |
| ---------- | ----------------- | --------------------------------------- |
| `/p/…`     | `'none'`          | `DENY`                                  |
| `/embed/…` | `*`               | omitted, on purpose                     |
| app shell  | `'none'`          | `DENY`                                  |

**The two columns must agree.** Where a browser understands both,
`frame-ancestors` wins, so a looser CSP value would widen framing on modern
browsers while the older header still denied it elsewhere — a change of
behaviour wearing a consistency change's clothes. `tests/served-surface-csp-header.test.js`
pins the pair.

### The app shell sends one too (D53(ii))

The shell — `/`, the auth pages, the editor and presenter routes, the
share-link viewer — is the surface the session cookie lives on, and it
carried no policy at all until B124. It is served, never downloaded or
`setContent()`-ed, so it needs no meta form: the header from
`buildAppShellCspHeader()` is its only carrier, set by `serveShellHtml()` on
every shell 200.

The policy is the **document policy plus the analytics origins** — not a
second policy source. External analytics is an app-surface feature whose tag
loads from an operator-chosen origin the static list cannot know, so
`script-src` extends with `analyticsScriptOrigins()` from
`server/analytics/head.js`: the same provider walk that emits the head HTML
also reports the origins, and a provider that is refused (invalid id, bad
URL) contributes neither. Nothing else widens — the editor reaches the same
third-party set a rendered document does (the font seam for theme previews,
Bunny's player.js for video slides), and the collab WebSocket rides
`connect-src 'self'`, which matches same-origin `ws`/`wss` per CSP3
(verified in Chromium, Firefox and WebKit).

**`'unsafe-inline'` is the recorded answer to the B124 design question**, for
the same reason the render paths carry it: this policy is a host allowlist,
not an inline-XSS defence. A nonce is unattainable on this surface — the
analytics escape hatch (`ANALYTICS_HEAD_HTML`) injects operator HTML the
server cannot rewrite, and a single nonce in `script-src` makes browsers
_ignore_ `'unsafe-inline'`, so a partial nonce breaks every un-nonced
fragment rather than merely not covering it. Inline-injection defence stays
where it already lives: escaping discipline plus DOMPurify
(`docs/reference/html-escaping.md`).

## The five gates

All must stay green, and they fail differently on purpose:

| Gate                                      | Checks                                                                                                                                                                                                                                      |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/no-third-party-origins.test.js`    | **The source.** Greps every `.js` under `server/`, `client/` (minus `client/vendor/`) and `shared/` for an asset-CDN URL, against an allowlist that carries a reason per entry. Fails the day a new offender is written.                    |
| `tests/export-third-party-cdn.test.js`    | **The output.** Builds every path in the render-path register (`server/render-paths.js`) from a deck with a code block and a formula, and asserts each document names no host outside a small allowlist.                                    |
| `tests/export-csp.test.js`                | **The policy.** Every path emits it, before anything loadable, identically; the code directives name exactly the declared origins and no wildcard; the omitted directives carry a reason.                                                   |
| `tests/served-surface-csp-header.test.js` | **The header.** `/p/…` and `/embed/…` send the same policy as a response header plus `frame-ancestors`, and that value agrees with the `X-Frame-Options` the same response carries.                                                         |
| `tests/app-shell-csp-header.test.js`      | **The shell.** The app-shell header is the document policy plus the analytics origins and `frame-ancestors 'none'`, the origins are a projection of the emitted analytics HTML, and both shell routes serve through the CSP-bearing writer. |

The output gate strips the policy meta before reading hosts: a policy names
every origin a document _may_ reach, and permitting is the opposite of fetching.
That is why `server/utils/document-csp.js` was on the source gate's allowlist
while `script-src` still named jsDelivr; with hls.js vendored, neither the entry
nor the origin is left.

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

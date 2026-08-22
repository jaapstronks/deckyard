/**
 * The render-path Content-Security-Policy: the no-third-party-origins rule,
 * stated to the browser instead of only to the test suite.
 *
 * `docs/reference/no-third-party-origins.md` says a document Deckyard renders
 * resolves everything against this server or carries it inside itself. Two
 * gates hold that: `tests/no-third-party-origins.test.js` greps the source,
 * `tests/export-third-party-cdn.test.js` reads the built documents. Both are
 * ours. Neither says anything to the machine that actually runs the document —
 * so a host that reaches a reader's browser through a path no gate models
 * (a compromised dependency, authored slide markup, a runtime that grows a new
 * loader) loads and executes exactly as before. This module is the third
 * statement, addressed to the browser, and it is the only one that can refuse.
 *
 * ## What it is, and what it is not
 *
 * It is a **host allowlist for code and styles**, not an XSS defence. Every
 * render path inlines its own runtime — a deck download has no origin to link
 * against — so `script-src` and `style-src` must carry `'unsafe-inline'`, and
 * an attacker who can already write `<script>` into a document is not stopped
 * by that list. What the list does stop is `<script src="https://…">` pointing
 * anywhere Deckyard has not decided on, which is reason 1 in the doc: a remote
 * script has arbitrary-code rights in every reader's browser, and — for the
 * paths that go through Puppeteer — in the server's own headless Chrome.
 *
 * Content-shaped directives stay permissive on purpose. A deck legitimately
 * references an image, a video, an HLS manifest or an embedded page (the
 * embed slide type frames any HTTPS URL) on any host the author chooses, and
 * `embedSlideImages` inlines only what it can reach. Narrowing
 * `img-src`/`media-src`/`connect-src`/`frame-src` would break real decks to
 * guard bytes that cannot execute in this document's context — a framed page
 * runs cross-origin, in its own browsing context.
 *
 * ## One list, two gates
 *
 * `THIRD_PARTY_ORIGINS` below is the same set of hosts
 * `tests/no-third-party-origins.test.js` allows in the source and
 * `tests/export-third-party-cdn.test.js` allows in the output — that is the
 * point of writing it here rather than as a policy string in a template.
 * Vendoring hls.js was exactly that: one entry left this list and the policy
 * narrowed with it (D51(a)), instead of the allowlist and the policy drifting
 * apart the way the CDN spellings and the app shell's did (B102).
 *
 * @module server/utils/document-csp
 */

/**
 * Third-party origins a rendered document may reach, and which directive each
 * one feeds. Every entry is a decision recorded in
 * `docs/reference/no-third-party-origins.md` § The carve-outs.
 *
 * @type {ReadonlyArray<{origin: string, directives: string[], reason: string}>}
 */
export const THIRD_PARTY_ORIGINS = Object.freeze([
  {
    origin: 'https://fonts.googleapis.com',
    directives: ['style-src'],
    reason:
      'the font seam: an externally managed font (Adobe, Monotype, Google) ' +
      'links its stylesheet here. Curated and uploaded fonts are embedded, so ' +
      'a deck that names no managed font emits nothing for this origin. ' +
      'docs/reference/font-management.md',
  },
  {
    origin: 'https://fonts.gstatic.com',
    directives: ['font-src'],
    reason: 'the file host behind fonts.googleapis.com — same font seam',
  },
  {
    origin: 'https://use.typekit.net',
    directives: ['style-src', 'font-src'],
    reason:
      'the same font seam, Adobe half: a managed font with source "adobe" ' +
      'links `use.typekit.net/<projectId>.css`, and the font files behind it ' +
      'ride on the same origin (server/utils/theme-builder.js, ' +
      'buildExternalFontLinks).',
  },
  {
    origin: 'https://fast.fonts.net',
    directives: ['script-src', 'style-src', 'font-src'],
    reason:
      'the same font seam, Monotype half: a managed font with source ' +
      '"monotype" loads `fast.fonts.net/jsapi/<projectId>.js`, which pulls ' +
      'its stylesheet and font files from the same origin ' +
      '(server/utils/theme-builder.js, buildExternalFontLinks).',
  },
  {
    origin: 'https://assets.mediadelivery.net',
    directives: ['script-src'],
    reason:
      "Bunny's player.js, injected lazily by the runtime only once a reader " +
      'plays a video slide that needs it (`ensureBunnyPlayerJs`). A deck ' +
      'without such a video fetches nothing.',
  },
]);

/**
 * Directives that a `<meta http-equiv>` policy cannot carry, and why each is
 * accepted as missing rather than worked around.
 *
 * A render path has nowhere to put a response header: `export/html` is
 * downloaded, four paths are handed to `page.setContent()`, and the MCP
 * previews are strings returned over stdio. The meta form is what those
 * documents can carry, so the three header-only directives are simply out of
 * reach here — the served surfaces (`/p/…`, embeds) set their own headers, and
 * that is where `frame-ancestors` belongs.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const HEADER_ONLY_DIRECTIVES = Object.freeze({
  'frame-ancestors':
    'ignored in meta form by specification. It answers "who may frame this ' +
    'document", which is a question about the response, not the document — ' +
    'and for the embed path the answer is deliberately "anyone".',
  'report-uri':
    'ignored in meta form. A downloaded deck and a setContent() page have no ' +
    'origin to report to, so there would be nowhere to send a violation.',
  sandbox:
    'ignored in meta form, and wrong here regardless: the render paths need ' +
    'scripts, same-origin and — for video slides — popups.',
});

/**
 * Origins allowed for one directive, in the order they were declared.
 *
 * @param {string} directive
 * @returns {string[]}
 */
function originsFor(directive) {
  return THIRD_PARTY_ORIGINS.filter((entry) =>
    entry.directives.includes(directive),
  ).map((entry) => entry.origin);
}

/**
 * The policy, as `{ directive: [source, …] }`.
 *
 * Kept structured rather than as a string so the gate can assert per directive
 * — "script-src names exactly the declared script origins" is a claim about a
 * list, and re-parsing a policy string to make it is how a test ends up
 * asserting its own regex.
 *
 * @returns {Record<string, string[]>}
 */
export function documentCspDirectives() {
  return {
    // Nothing loads unless a directive below says so. Every fetch kind a
    // render path actually makes is enumerated; anything new fails closed,
    // which is the behaviour that makes this worth emitting at all.
    'default-src': ["'none'"],

    // The point of the whole policy. `'unsafe-inline'` is unavoidable — the
    // paths inline their runtime, and two of them still carry an inline
    // `on*=` handler, which no hash or nonce can cover — but the host list is
    // exact, so a remote script from anywhere undeclared does not run.
    'script-src': ["'self'", "'unsafe-inline'", ...originsFor('script-src')],

    // Same shape: inline `<style>` blocks and `style=""` attributes are how a
    // slide is positioned on the stage.
    'style-src': ["'self'", "'unsafe-inline'", ...originsFor('style-src')],

    // `data:` covers the KaTeX fontset, which is base64'd into the stylesheet
    // when a deck carries math (D46).
    'font-src': ["'self'", 'data:', ...originsFor('font-src')],

    // Content, not code. A deck references images and video the author chose,
    // on hosts Deckyard never sees; `embedSlideImages` inlines what it can
    // reach and the rest stays remote. Narrowing these breaks real decks to
    // guard bytes that cannot execute.
    'img-src': ["'self'", 'data:', 'blob:', 'https:'],
    'media-src': ["'self'", 'data:', 'blob:', 'https:'],

    // `'self'` is the lead-capture POST to /api/leads on a published deck.
    // `https:` is the HLS manifest a stream fetches from wherever it lives.
    'connect-src': ["'self'", 'https:'],

    // Content too, not code: a framed document runs in its own cross-origin
    // browsing context and cannot touch this one. The embed slide type frames
    // any HTTPS URL the author chooses (Figma, Miro, a dashboard —
    // shared/slide-types/types/embed-slide.js normalizes to https-only), so
    // pinning this to the three video providers would break a legitimate
    // slide on every render path.
    'frame-src': ["'self'", 'https:'],

    // Free hardening, none of it used by any path: no plugins, no <base>
    // rewriting every relative URL in the document, and a form that posts
    // anywhere but back to this server.
    'object-src': ["'none'"],
    'base-uri': ["'none'"],
    'form-action': ["'self'"],
  };
}

/**
 * The policy as one header/meta value.
 *
 * @returns {string}
 */
export function buildDocumentCsp() {
  return Object.entries(documentCspDirectives())
    .map(([directive, sources]) => `${directive} ${sources.join(' ')}`)
    .join('; ');
}

/**
 * The `<meta>` tag a render path carries.
 *
 * It must precede every resource-loading tag in the `<head>` to take effect,
 * which is why `buildDocumentHead()` emits it immediately after `<meta charset>`
 * rather than accepting it as one more entry in `options.head`.
 *
 * @returns {string}
 */
export function documentCspMeta() {
  return `<meta http-equiv="Content-Security-Policy" content="${buildDocumentCsp()}" />`;
}

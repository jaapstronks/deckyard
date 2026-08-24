/**
 * Head assets — the one sanctioned way to put a `<style>`, `<link rel=stylesheet>`
 * or `<script>` into `document.head`.
 *
 * The recipe (create the tag, set one or two properties, dedupe on an `id`,
 * append to the head) stood written **five times** across the client: the two
 * font-preview surfaces, the font editor's Google panel, the theme's generated
 * `@font-face` / slide-background rules, and the three lazy vendor loaders. It
 * was also the bulk of what kept `document.createElement` alive in a codebase
 * whose first frontend rule is `h()` — see the `no-restricted-syntax` gate in
 * `eslint.config.js` (B150).
 *
 * The copies had drifted where it mattered: the id that makes the dedupe work.
 * The same Google font was requested under `gf-preview-<slug>` by two modules
 * and `google-font-preview-<slug>` by a third, so the "already in the DOM?"
 * check quietly missed and the browser fetched the stylesheet twice. Ids are
 * derived here now (see `client/lib/theme/font-assets.js` for the font ones),
 * which is what makes them agree by construction.
 *
 * **Shape.** External assets load asynchronously and return a promise; inline
 * CSS is there the moment the tag is appended and returns nothing. Callers that
 * only want the asset present (a font preview) ignore the promise — the cached
 * copy always carries a rejection handler, so an ignored failure never becomes
 * an unhandled rejection.
 */

import { h } from '../dom.js';

/** @type {Map<string, Promise<void>>} one promise per element id, for load-awaiting assets */
const pending = new Map();

/**
 * Attach load/error listeners to an external asset element and cache the
 * resulting promise under `id`.
 *
 * @param {string} id
 * @param {HTMLElement} el an element already in, or about to enter, the head
 * @param {string} what human-readable asset name for the rejection message
 * @param {boolean} append whether the element still needs appending
 * @returns {Promise<void>}
 */
function trackLoad(id, el, what, append) {
  const p = new Promise((resolve, reject) => {
    el.addEventListener('load', () => resolve(), { once: true });
    el.addEventListener(
      'error',
      () => reject(new Error(`Failed to load ${what}`)),
      {
        once: true,
      },
    );
    if (append) document.head.append(el);
  });
  pending.set(id, p);
  // The cache entry is always handled, so a caller that ignores the promise
  // (font previews do) cannot produce an unhandled rejection. A caller that
  // awaits still sees the rejection — this attaches a handler, it does not
  // swallow one.
  p.catch(() => {});
  return p;
}

/**
 * Ensure a `<style id>` with the given CSS is present in the head.
 * Idempotent per id: an existing tag is left exactly as it is.
 *
 * @param {object} opts
 * @param {string} opts.id element id, the dedupe key
 * @param {string} opts.css stylesheet text
 * @returns {HTMLStyleElement|null} the tag, or null when there was nothing to inject
 */
export function ensureStyle({ id, css }) {
  if (!id || !css) return null;
  const existing = document.getElementById(id);
  if (existing) return /** @type {HTMLStyleElement} */ (existing);
  const style = h('style', { id, text: css });
  document.head.append(style);
  return /** @type {HTMLStyleElement} */ (style);
}

/**
 * Ensure a `<link rel="stylesheet" id>` for the given href is present in the head.
 * Idempotent per id; the returned promise settles when the sheet has loaded.
 *
 * @param {object} opts
 * @param {string} opts.id element id, the dedupe key
 * @param {string} opts.href stylesheet URL
 * @returns {Promise<void>} resolves on load, rejects on error
 */
export function ensureStylesheet({ id, href }) {
  if (!id || !href) return Promise.resolve();
  const cached = pending.get(id);
  if (cached) return cached;
  const existing = document.getElementById(id);
  if (existing) return trackLoad(id, existing, href, false);
  const link = h('link', { id, rel: 'stylesheet', href });
  return trackLoad(id, link, href, true);
}

/**
 * Ensure a `<script id>` for the given src is present in the head.
 * Idempotent per id; the returned promise settles when the script has loaded.
 *
 * Callers that need the global the script defines check for it themselves
 * before calling — a tag appended by an earlier page state may already have
 * finished loading, and there is no load event left to wait for.
 *
 * @param {object} opts
 * @param {string} opts.id element id, the dedupe key
 * @param {string} opts.src script URL
 * @param {boolean} [opts.async=false] set the `async` attribute
 * @returns {Promise<void>} resolves on load, rejects on error
 */
export function ensureScript({ id, src, async = false }) {
  if (!id || !src) return Promise.resolve();
  const cached = pending.get(id);
  if (cached) return cached;
  const existing = document.getElementById(id);
  if (existing) return trackLoad(id, existing, src, false);
  const script = h('script', { id, src, async });
  return trackLoad(id, script, src, true);
}

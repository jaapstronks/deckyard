/**
 * Lazy loader for the vendored hls.js.
 *
 * Still lazy — a deck with no HLS stream fetches nothing — but the script comes
 * from this server (`client/vendor/hls/`, written by `scripts/vendor-hls.js` at
 * postinstall), not from jsDelivr. That is what let the `cdn.jsdelivr.net`
 * entry leave `THIRD_PARTY_ORIGINS`, so the render-path CSP's `script-src` no
 * longer holds a hole open for a library most decks never touch (D51(a)).
 *
 * Injection and the promise cache are ensureScript() from
 * client/lib/dom/head-assets.js, the same as ensureBunnyPlayerJs() in
 * slide-render.js.
 */

import { ensureScript } from '../dom/head-assets.js';

export function ensureHlsJs() {
  // A tag from an earlier page state may already have finished loading, in
  // which case there is no load event left to wait for — the global is the
  // only reliable "already there" signal.
  if (globalThis.Hls) return Promise.resolve();
  return ensureScript({
    id: 'hls-js',
    src: '/client/vendor/hls/hls.min.js',
    async: true,
  });
}

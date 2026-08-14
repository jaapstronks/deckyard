/**
 * Blob download helper — the one sanctioned way to save a Blob to disk.
 *
 * Three views used to hand-roll the same objectURL + `<a download>` + click +
 * revoke dance with small drifts (detached vs. attached anchor, immediate vs.
 * delayed revoke). This is the canonical form; a gate test
 * (`tests/no-direct-object-url.test.js`) keeps new direct
 * `URL.createObjectURL` call sites out of `client/` beyond this module.
 */

import { h } from '../dom.js';

/**
 * Save a blob to disk via a transient anchor. Filename derivation stays with
 * the caller.
 *
 * @param {Blob} blob
 * @param {string} filename suggested name for the saved file
 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  try {
    const a = h('a', { href: url, download: filename });
    document.body.append(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

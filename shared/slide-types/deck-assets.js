/**
 * Deck asset references — enumeration, rewriting, and content-addressing.
 *
 * A stored/portable deck refers to its images by local upload URL
 * (`/uploads/<name>-<uuid>.<ext>`). To make a deck self-contained (the `.deck`
 * bundle, move 2) those refs are collected, the bytes are content-addressed by
 * hash, and the deck's refs are rewritten to bundle refs (`assets/<hash>.<ext>`)
 * with the human name kept only in the manifest — a separate name layer so hash
 * churn never leaks into the readable structure.
 *
 * This module is pure (no fs/crypto): it walks/rewrites the JSON and formats
 * the content-addressed refs. The server side (server/export/deck-bundle.js)
 * reads bytes, hashes them, and builds/reads the ZIP.
 */

const UPLOADS_PREFIX = '/uploads/';
const BUNDLE_PREFIX = 'assets/';

/**
 * Is `v` a local upload asset reference (`/uploads/<file>`)? Path-traversal
 * shapes are rejected so a ref can't escape the uploads directory.
 * @param {unknown} v
 * @returns {boolean}
 */
export function isUploadRef(v) {
  return (
    typeof v === 'string' &&
    v.startsWith(UPLOADS_PREFIX) &&
    v.length > UPLOADS_PREFIX.length &&
    !v.includes('..') &&
    !v.slice(UPLOADS_PREFIX.length).includes('/')
  );
}

/**
 * Is `v` a `.deck` bundle asset reference (`assets/<hash>.<ext>`)? These are the
 * content-addressed refs that live inside a bundle's `deck.json`; on import they
 * are rewritten back to `/uploads/` refs. Path-traversal shapes are rejected.
 * @param {unknown} v
 * @returns {boolean}
 */
export function isBundleRef(v) {
  return (
    typeof v === 'string' &&
    v.startsWith(BUNDLE_PREFIX) &&
    v.length > BUNDLE_PREFIX.length &&
    !v.includes('..') &&
    !v.slice(BUNDLE_PREFIX.length).includes('/')
  );
}

/**
 * Deep-walk a JSON value, calling `visit` for every string. Objects and arrays
 * are traversed; other primitives are ignored.
 * @param {unknown} value
 * @param {(s: string) => void} visit
 */
function walkStrings(value, visit) {
  if (typeof value === 'string') {
    visit(value);
  } else if (Array.isArray(value)) {
    for (const v of value) walkStrings(v, visit);
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value)) walkStrings(v, visit);
  }
}

/**
 * Collect the unique local upload refs a deck (or presentation) references,
 * in first-seen order. Walks every slide's content deeply, so it is robust to
 * new/legacy field keys (any `/uploads/...` string is found).
 * @param {{ slides?: Array<{ content?: object }> }} deck
 * @returns {string[]}
 */
export function collectAssetRefs(deck) {
  const seen = new Set();
  const slides = Array.isArray(deck?.slides) ? deck.slides : [];
  for (const slide of slides) {
    walkStrings(slide?.content, (s) => {
      if (isUploadRef(s)) seen.add(s);
    });
  }
  return [...seen];
}

/**
 * Deep-clone a JSON value, replacing any ref matched by `isRef` with
 * `mapFn(ref)`. When `mapFn` returns a falsy value the original ref is kept.
 * Non-matching strings and other values are copied unchanged.
 * @param {unknown} value
 * @param {(s: string) => boolean} isRef
 * @param {(ref: string) => string|undefined|null} mapFn
 * @returns {unknown}
 */
function mapValue(value, isRef, mapFn) {
  if (typeof value === 'string') {
    if (isRef(value)) {
      const mapped = mapFn(value);
      return mapped || value;
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => mapValue(v, isRef, mapFn));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = mapValue(v, isRef, mapFn);
    return out;
  }
  return value;
}

/**
 * Return a new deck with every slide's content ref matched by `isRef` rewritten
 * via `mapFn`. The input is not mutated. Shared by both rewrite directions.
 * @template {{ slides?: Array<{ content?: object }> }} T
 * @param {T} deck
 * @param {(s: string) => boolean} isRef
 * @param {(ref: string) => string|undefined|null} mapFn
 * @returns {T}
 */
function rewriteRefs(deck, isRef, mapFn) {
  if (!deck || typeof deck !== 'object') return deck;
  const slides = Array.isArray(deck.slides)
    ? deck.slides.map((slide) => ({
        ...slide,
        content: mapValue(slide?.content ?? {}, isRef, mapFn),
      }))
    : deck.slides;
  return { ...deck, slides };
}

/**
 * Return a new deck with every slide's upload refs rewritten via `mapFn`
 * (e.g. `/uploads/x.png` -> `assets/<hash>.png`). The input is not mutated.
 * Used on export (the bundle builder).
 * @template {{ slides?: Array<{ content?: object }> }} T
 * @param {T} deck
 * @param {(ref: string) => string|undefined|null} mapFn
 * @returns {T}
 */
export function rewriteAssetRefs(deck, mapFn) {
  return rewriteRefs(deck, isUploadRef, mapFn);
}

/**
 * Return a new deck with every slide's bundle refs rewritten via `mapFn`
 * (e.g. `assets/<hash>.png` -> `/uploads/x.png`). The input is not mutated.
 * The inverse of `rewriteAssetRefs`; used on import (re-hydrating a bundle).
 * @template {{ slides?: Array<{ content?: object }> }} T
 * @param {T} deck
 * @param {(ref: string) => string|undefined|null} mapFn
 * @returns {T}
 */
export function rewriteBundleRefs(deck, mapFn) {
  return rewriteRefs(deck, isBundleRef, mapFn);
}

/**
 * The content-addressed bundle ref for an asset: `assets/<hash>[.<ext>]`.
 * (Browser-safe string formatting; the hashing itself is done server-side.)
 * @param {string} hashHex - lowercase hex sha-256
 * @param {string} [ext] - extension without a dot (png, jpg, …)
 * @returns {string}
 */
export function assetRefForHash(hashHex, ext = '') {
  const clean = String(hashHex || '').toLowerCase();
  const dotExt = ext ? `.${String(ext).replace(/^\./, '')}` : '';
  return `assets/${clean}${dotExt}`;
}

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
 *
 * **One walk, two questions.** Both exports that enumerate a deck's images ask
 * the same structural question — "which strings in this deck name a file?" —
 * and differ only in which class of file they may act on:
 *
 * - `collectAssetRefs` (the `.deck` bundle) takes the refs it *owns*: local
 *   uploads, the only class it can content-address and rewrite so the bundle
 *   stays portable to another installation.
 * - `collectServedAssetRefs` (the bulk export / backup) takes every path *this*
 *   installation serves — uploads plus the fork's `/assets/` and `/custom/…`
 *   trees, which is where a theme's `backgroundPresets` live once they are
 *   baked into a slide's `slideBgImage`.
 *
 * The uploads rule is written once and the wider class is defined on top of it,
 * so the first set is a subset of the second by construction. Remote `http(s)`
 * URLs are deliberately in neither: a bare string cannot say whether it is an
 * image or a link target (a call-to-action `url` is not an asset), and a remote
 * URL is still valid after a restore — it stays a URL in the deck JSON.
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
 * The non-upload path prefixes this installation serves as static files: the
 * fork's shared content (`/custom/assets/`) and per-theme assets
 * (`/custom/themes/<id>/assets/`), plus the built-in `/assets/` tree. Unlike
 * `/uploads/` these are nested trees, so a nested path is legitimate here.
 */
const SERVED_PREFIXES = ['/assets/', '/custom/assets/', '/custom/themes/'];

/**
 * Is `v` a reference to a file *this* installation serves — an upload, or one
 * of the fork/theme asset trees? The superset of `isUploadRef`, defined on top
 * of it so the uploads rule has exactly one spelling. Path-traversal shapes are
 * rejected; the caller still resolves against its own root.
 *
 * A theme's `backgroundPresets` are documented to point at any of these (see
 * docs/developer/themes.md) and are baked into `content.slideBgImage` when a
 * slide is created, so a deck genuinely carries non-upload local refs.
 * @param {unknown} v
 * @returns {boolean}
 */
export function isServedAssetRef(v) {
  if (isUploadRef(v)) return true;
  return (
    typeof v === 'string' &&
    !v.includes('..') &&
    SERVED_PREFIXES.some((p) => v.startsWith(p) && v.length > p.length)
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
 * Collect the unique refs matched by `isRef` across every slide's content, in
 * first-seen order. The walk is deep and key-agnostic, so it is robust to new,
 * nested and legacy field keys — a ref is recognised by its own shape, never by
 * the name of the field it sits in.
 * @param {{ slides?: Array<{ content?: object }> }} deck
 * @param {(s: string) => boolean} isRef
 * @returns {string[]}
 */
function collectRefs(deck, isRef) {
  const seen = new Set();
  const slides = Array.isArray(deck?.slides) ? deck.slides : [];
  for (const slide of slides) {
    walkStrings(slide?.content, (s) => {
      if (isRef(s)) seen.add(s);
    });
  }
  return [...seen];
}

/**
 * Collect the unique local upload refs a deck (or presentation) references, in
 * first-seen order — the assets a `.deck` bundle owns and content-addresses.
 * @param {{ slides?: Array<{ content?: object }> }} deck
 * @returns {string[]}
 */
export function collectAssetRefs(deck) {
  return collectRefs(deck, isUploadRef);
}

/**
 * Collect every ref a deck makes to a file this installation serves — uploads
 * plus the fork/theme asset trees — in first-seen order. A superset of
 * `collectAssetRefs`; used by the bulk export, which backs up *this* install
 * rather than producing something portable.
 * @param {{ slides?: Array<{ content?: object }> }} deck
 * @returns {string[]}
 */
export function collectServedAssetRefs(deck) {
  return collectRefs(deck, isServedAssetRef);
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
    for (const [k, v] of Object.entries(value))
      out[k] = mapValue(v, isRef, mapFn);
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

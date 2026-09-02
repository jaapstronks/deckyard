/**
 * Shared flatten helper for the pluggable image picker.
 *
 * The picker seam (`picker-provider.js`) yields a normalized, provider-agnostic
 * `PickedImage`. Every call site persists that pick onto the flat
 * `slide.content` storage model in exactly the same way, so the flattening
 * lives here rather than being re-implemented per field. Generalizes the older
 * `applyAltFromLibraryItem` / `applyAltFromImageKitPick` split from
 * `fields/images/alt-utils.js`.
 *
 * URL placement is intentionally NOT handled here: single-image fields store a
 * string at `content[key]`, multi-image fields push into an array, and the
 * inline popover mutates an item object. Each call site owns its URL write and
 * delegates the rest (alt buffers, caption, provider id) to this helper.
 */

import { getSupportedLangs } from '../../../lib/format/i18n.js';

/**
 * @typedef {import('./picker-provider.js').PickedImage} PickedImage
 */

/**
 * Seed alt text from a normalized pick into every language buffer the deck has.
 *
 * The alt text describes the *image*, so picking a new one invalidates every
 * language's alt at once — the write target is the whole subset
 * (`getSupportedLangs()` plus the active language, which a deck may hold
 * outside the subset), not a pair. Two provider shapes collapse here:
 * - `picked.alts` (a per-language map, e.g. the native library) wins: each
 *   buffer takes its own language's entry, empty where the map has none.
 * - otherwise `picked.alt` (a single seed, e.g. ImageKit's altSeed) fills every
 *   buffer as a translation baseline.
 *
 * The setter is a no-op for a language this deck has no version of, so naming
 * the subset costs nothing where the versions do not exist.
 *
 * `sourceLang` is the version this deck's active language is translated FROM
 * (`translationSourceFor`). It was called `otherLang` and fed by the bilingual
 * "the other one of two" helper, which had no answer at all for a deck whose
 * active version is German — so nothing was seeded (B182 fase 5).
 *
 * @param {Object} opts
 * @param {PickedImage} opts.picked
 * @param {string} opts.activeLang
 * @param {string|null} [opts.sourceLang]
 * @param {(lang: string, alt: string) => void} opts.setAltForLang - language-scoped setter
 */
export function applyAltFromPick({
  picked,
  activeLang,
  sourceLang,
  setAltForLang,
}) {
  if (typeof setAltForLang !== 'function' || !picked) return;

  const targets = new Set(getSupportedLangs());
  if (activeLang) targets.add(activeLang);
  if (sourceLang) targets.add(sourceLang);

  const alts =
    picked.alts && typeof picked.alts === 'object' ? picked.alts : null;
  if (alts) {
    for (const lang of targets) setAltForLang(lang, alts[lang] || '');
    return;
  }

  const seed = typeof picked.alt === 'string' ? picked.alt : '';
  if (!seed) return;
  for (const lang of targets) setAltForLang(lang, seed);
}

/**
 * Apply the non-alt metadata of a normalized pick onto a plain content object:
 * an opaque provider file id (under a caller-chosen key) and, when the field
 * opted into it, a resolved caption/credit string.
 *
 * @param {Object} opts
 * @param {PickedImage} opts.picked
 * @param {Object} opts.content - the object to mutate (e.g. `slide.content` or an item)
 * @param {string} [opts.providerIdKey] - where to store `picked.providerId` (e.g. 'imagekitFileId')
 * @param {boolean} [opts.allowCaption] - whether this field accepts a caption/credit
 */
export function applyPickMeta({
  picked,
  content,
  providerIdKey,
  allowCaption = false,
} = {}) {
  if (!picked || !content || typeof content !== 'object') return;

  // Keep the opaque provider id in lock-step with the URL: a provider that
  // supplies one (ImageKit) sets it; any other pick (native library, S3) clears
  // it, so a native URL never carries a dangling ImageKit file id.
  if (providerIdKey) {
    if (picked.providerId) content[providerIdKey] = picked.providerId;
    else delete content[providerIdKey];
  }

  if (
    allowCaption &&
    typeof picked.caption === 'string' &&
    picked.caption.trim() &&
    typeof content.caption === 'string' &&
    !content.caption.trim()
  ) {
    content.caption = picked.caption.trim();
  }
}

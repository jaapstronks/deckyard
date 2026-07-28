/**
 * Sample content for the slide-type picker's preview thumbnails: rich example
 * content that shows what each type looks like filled in, not empty.
 *
 * This file no longer *holds* the samples. Every core type declares its own as
 * `sample` in `shared/slide-types/types/<name>/authoring.js`, and the map below
 * is derived from the aggregator in shared/slide-types/authoring.js — the same
 * A7.1 seam move that already pulled the picker glyphs out of
 * slide-type-schematics.js (#448). A sample is a fact about a slide type, so
 * adding or retiring a type touches the type's own directory and nothing here.
 * See docs/reference/slide-type-directory.md.
 *
 * The four `SAMPLE_IMAGE*` module consts are gone: each type now inlines the
 * placeholder picsum URL it needs. The seeds are meaningless ids and an
 * authoring.js is self-contained plain data, so a shared const would only force
 * an import against that principle or the same literal duplicated anyway —
 * gallery-slide and logo-wall-slide already inlined theirs. The one seed the old
 * module shared between image-text-slide and team-cards-slide (`slide-picker`)
 * was an incidental collision, not a semantic link; both keep the exact URL.
 */

import { SLIDE_TYPE_AUTHORING } from '../../../shared/slide-types/authoring.js';

/**
 * Sample content per slide type, derived from each type's `authoring.js`.
 * Kept exported and keyed by type name because getSampleContent() below reads it
 * by name, exactly as the old hand-written map was read.
 * @type {Record<string, Object>}
 */
export const SLIDE_TYPE_SAMPLE_CONTENT = Object.fromEntries(
  Object.entries(SLIDE_TYPE_AUTHORING)
    .filter(([, authoring]) => authoring?.sample !== undefined)
    .map(([type, authoring]) => [type, authoring.sample])
);

/**
 * Get sample content for a slide type, merging with defaults if needed.
 * Checks the slide type definition for sampleContent first, then falls back to
 * the per-type samples derived from each type's authoring.js.
 * @param {string} type - The slide type
 * @param {object} SLIDE_TYPES - The slide type definitions
 * @param {object} [theme] - Optional theme object for theme-specific sample content
 * @returns {object} Sample content
 */
export function getSampleContent(type, SLIDE_TYPES, theme) {
  const def = SLIDE_TYPES?.[type];
  const defaults = def?.defaults || def?.defaultsByLang?.['en-GB'] || {};

  // Check for sampleContent in the slide type definition first (for custom slide types)
  // Then fall back to the per-type samples derived from authoring.js (core types)
  const sample = def?.sampleContent || SLIDE_TYPE_SAMPLE_CONTENT[type];

  // Merge defaults with sample content (sample takes precedence)
  const content = {
    ...defaults,
    ...(sample || {}),
  };

  // For embed-slide, use theme's sampleEmbedUrl if provided. The field is
  // `embedUrl` (the earlier `url` key never matched, so the override was dead).
  // The picker now renders embed as a static mockup, so this only matters if a
  // non-picker caller renders the sample.
  if (type === 'embed-slide' && theme?.sampleEmbedUrl) {
    content.embedUrl = theme.sampleEmbedUrl;
  }

  return content;
}
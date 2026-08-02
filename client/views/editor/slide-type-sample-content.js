/**
 * Sample content for the slide-type picker's preview thumbnails: rich example
 * content that shows what each type looks like filled in, not empty.
 *
 * This file holds neither the samples nor the lookup any more. Every core type
 * declares its own as `sample` in `shared/slide-types/types/<name>/authoring.js`,
 * and the lookup lives in the facet module beside the declarations
 * (shared/slide-types/authoring-companions.js) because the server performs the
 * same one when it serves /api/slide-types. What is left here is the editor's
 * part: merging the example over `defaults` and the theme's embed override.
 *
 * The four `SAMPLE_IMAGE*` module consts are gone: each type now inlines the
 * placeholder picsum URL it needs. The seeds are meaningless ids and an
 * authoring.js is self-contained plain data, so a shared const would only force
 * an import against that principle or the same literal duplicated anyway —
 * gallery-slide and logo-wall-slide already inlined theirs. The one seed the old
 * module shared between image-text-slide and team-cards-slide (`slide-picker`)
 * was an incidental collision, not a semantic link; both keep the exact URL.
 */

import { slideTypeSample } from '../../../shared/slide-types/authoring-companions.js';

/**
 * Get sample content for a slide type, merging with defaults if needed.
 * The example itself comes from slideTypeSample(): the definition's own
 * `sampleContent` first (a fork type's, which now reaches the editor over
 * /api/slide-types), then core's per-type sample.
 * @param {string} type - The slide type
 * @param {object} SLIDE_TYPES - The slide type definitions
 * @param {object} [theme] - Optional theme object for theme-specific sample content
 * @returns {object} Sample content
 */
export function getSampleContent(type, SLIDE_TYPES, theme) {
  const def = SLIDE_TYPES?.[type];
  const defaults = def?.defaults || def?.defaultsByLang?.['en-GB'] || {};

  // Merge defaults with sample content (sample takes precedence)
  const content = {
    ...defaults,
    ...(slideTypeSample(type, def) || {}),
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

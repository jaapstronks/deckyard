/**
 * Which pictures a published deck puts on the open web without a name (D137).
 *
 * One answer for two readers: the server's publish gate refuses a deck with
 * any (`server/services/publish-alt-check.js`), and the editor of a deck that
 * is already published keeps a warning up while there are any (B331, D164).
 * Both call {@link findUnnamedImages}, so the refusal and the warning cannot
 * disagree about what counts. What counts is decided one level down, in the
 * projection's own alt ladder (`imagesMissingAlt`).
 *
 * @module shared/unnamed-images
 */

import { getSlideType } from './slide-types/registry.js';
import { imagesMissingAlt } from './slide-types/semantic-projection.js';
import { isSlideVisibleIn } from './slide-visibility.js';
import { existingVersionLangs, pickVersion } from './i18n-progress.js';

/**
 * One picture without a name.
 *
 * @typedef {Object} UnnamedImage
 * @property {string|null} lang - the language version it is in, `null` for a
 *   deck without versions
 * @property {number} slideIndex - 0-based position in that version's slides
 * @property {string} slideId
 * @property {string} field - the top-level field key
 * @property {number} [itemIndex] - for a picture in an item
 * @property {string} [itemField] - the item's image sub-field
 */

/**
 * Every picture a publish of `pres` would put on the open web without a name:
 * each language version, only the slides a published page shows (not hidden
 * from publishing, not live-only), each resolved against `slideTypes` so an
 * organisation's own types are checked by their own declarations.
 *
 * @param {object} pres
 * @param {Record<string, object>} slideTypes - the merged registry
 * @returns {UnnamedImage[]}
 */
export function findUnnamedImages(pres, slideTypes) {
  const langs = existingVersionLangs(pres);
  const out = [];
  for (const lang of langs.length ? langs : [null]) {
    const { slides } = pickVersion(pres, lang);
    slides.forEach((slide, slideIndex) => {
      if (!slide || typeof slide !== 'object') return;
      if (!isSlideVisibleIn(slide, 'published')) return;
      const def = getSlideType(slide.type, slideTypes);
      if (!def || def.liveOnly === true) return;
      for (const hit of imagesMissingAlt(slide, def)) {
        out.push({
          lang,
          slideIndex,
          slideId: typeof slide.id === 'string' ? slide.id : '',
          ...hit,
        });
      }
    });
  }
  return out;
}

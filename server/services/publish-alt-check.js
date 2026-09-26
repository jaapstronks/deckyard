/**
 * The publish gate for pictures without a name (D137).
 *
 * A published deck is the reader too (`/p/<id>-<slug>/reader`), and a picture
 * that means something but has no text reads there as nothing at all. So
 * publishing refuses a deck with such a picture, on every surface that
 * publishes: the check runs inside {@link publishPresentation}'s flow, not in
 * the editor, so an agent on the v1 API meets the same refusal as the Publish
 * button.
 *
 * What counts is decided in one place, the projection's own alt ladder
 * (`imagesMissingAlt` in `shared/slide-types/semantic-projection.js`), so the
 * gate can never disagree with the document it guards. The way out is the
 * alt text, a name the type declares (`nameKey`), or `imageRole: 'decorative'`
 * where the type offers it; in author markup, the `<img>`'s own `alt`
 * attribute (`alt=""` for decorative).
 *
 * @module server/services/publish-alt-check
 */

import { getSlideType } from '../../shared/slide-types/registry.js';
import { imagesMissingAlt } from '../../shared/slide-types/semantic-projection.js';
import { isSlideVisibleIn } from '../../shared/slide-visibility.js';
import {
  existingVersionLangs,
  pickVersion,
} from '../../shared/i18n-progress.js';
import { UnprocessableError } from '../utils/errors.js';

/**
 * One picture that publishing refuses.
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

/**
 * Refuse the publish when {@link findUnnamedImages} finds anything.
 *
 * The `missing_alt` refusal carries the first picture in `details` — which
 * version, which slide, which field and item — and how many there are in all
 * (`count`), so the editor can point at the one to fix and say how much is
 * left. The message says the same in English for API callers.
 *
 * @param {object} pres
 * @param {Record<string, object>} slideTypes
 * @throws {UnprocessableError} `missing_alt`, 422
 */
export function assertImagesNamed(pres, slideTypes) {
  const missing = findUnnamedImages(pres, slideTypes);
  if (!missing.length) return;
  const [first] = missing;
  const where =
    typeof first.itemIndex === 'number'
      ? `"${first.field}" item ${first.itemIndex + 1} ("${first.itemField}")`
      : `"${first.field}"`;
  const version = first.lang ? ` (${first.lang})` : '';
  const more =
    missing.length > 1 ? ` ${missing.length - 1} more need one too.` : '';
  const err = new UnprocessableError(
    `Slide ${first.slideIndex + 1}${version} has an image without alt text in ${where}. ` +
      `Add alt text, or mark the image decorative, before publishing.${more}`,
    { ...first, count: missing.length },
  );
  err.code = 'missing_alt';
  throw err;
}

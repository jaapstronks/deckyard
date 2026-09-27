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
 * Which pictures count is answered in `shared/unnamed-images.js`, on top of
 * the projection's own alt ladder (`imagesMissingAlt`), so the gate can never
 * disagree with the document it guards, nor with the editor's warning on a
 * deck that is already live (B331). The way out is the
 * alt text, a name the type declares (`nameKey`), or `imageRole: 'decorative'`
 * where the type offers it; in author markup, the `<img>`'s own `alt`
 * attribute (`alt=""` for decorative).
 *
 * @module server/services/publish-alt-check
 */

import { findUnnamedImages } from '../../shared/unnamed-images.js';
import { UnprocessableError } from '../utils/errors.js';

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

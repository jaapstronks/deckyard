/**
 * The publish gate for incomplete slides (B590).
 *
 * A slide whose essential picture is still empty is left out of every output
 * (`shared/incomplete-slides.js`, through the visibility seam), so a published
 * page would silently miss it. Publishing says so instead of hiding it: the
 * check runs inside {@link publishPresentation}'s flow, beside the alt check
 * (`publish-alt-check.js`), so an agent on the v1 API meets the same refusal
 * as the Publish button. The way out is a picture, or removing the slide.
 *
 * @module server/services/publish-complete-check
 */

import { findIncompleteSlides } from '../../shared/incomplete-slides.js';
import { getSlideVisibility } from '../../shared/slide-visibility.js';
import { isLiveOnlySlideType } from '../../shared/slide-types/live-session.js';
import { UnprocessableError } from '../utils/errors.js';

/**
 * The 1-based numbers of the slides a publish of `pres` would leave out for
 * being incomplete: only slides the published page would otherwise show (not
 * hidden from publishing, not live-only), in any language version.
 *
 * @param {object} pres
 * @param {Record<string, object>} slideTypes - the merged registry
 * @returns {number[]} ascending, without duplicates
 */
export function incompletePublishedSlideNumbers(pres, slideTypes) {
  const found = findIncompleteSlides(pres, slideTypes, {
    include: (slide) =>
      !getSlideVisibility(slide).hideInPublished &&
      !isLiveOnlySlideType(slide.type, slideTypes),
  });
  return [...new Set(found.map((hit) => hit.slideIndex + 1))].sort(
    (a, b) => a - b,
  );
}

/**
 * Refuse the publish when {@link incompletePublishedSlideNumbers} finds any.
 *
 * The `incomplete_slides` refusal carries the slide numbers in `details`
 * (`slides`), so the editor can name them; the message says the same in
 * English for API callers.
 *
 * @param {object} pres
 * @param {Record<string, object>} slideTypes
 * @throws {UnprocessableError} `incomplete_slides`, 422
 */
export function assertSlidesComplete(pres, slideTypes) {
  const slides = incompletePublishedSlideNumbers(pres, slideTypes);
  if (!slides.length) return;
  const which =
    slides.length === 1
      ? `Slide ${slides[0]} still has an empty image`
      : `Slides ${slides.join(', ')} still have an empty image`;
  // The code is set below, so the class default would name the payload; the
  // register checks it under `incomplete_slides` at serialization, as it does
  // `missing_alt`'s.
  const details = { slides };
  const err = new UnprocessableError(
    `${which}. Choose an image or delete the slide before publishing.`,
    details,
  );
  err.code = 'incomplete_slides';
  throw err;
}

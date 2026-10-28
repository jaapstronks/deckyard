/**
 * Which slides are not finished yet: a slide whose `essential` picture is
 * still empty (B590).
 *
 * An empty essential field is what the editor shows as "something goes here"
 * (D211, `docs/reference/essential-fields.md`). For a picture that empty state
 * is a grey frame, and a grey frame in a presentation, an export or a
 * published page is never what anyone meant. So such a slide is *incomplete*:
 * the editor and its author see it, every output leaves it out. That is the
 * one form of "a picture goes here": derived from the content, with no flag,
 * marker or visibility trick stored beside it, so filling the picture by any
 * route finishes the slide.
 *
 * Only pictures count. An empty essential text field is a sober slide, not a
 * broken one, and stays out of this rule.
 *
 * The rule is asked through the visibility seam (`isSlideVisibleIn` in
 * `shared/slide-visibility.js`), so every output that filters by context
 * leaves the slide out without a filter of its own. {@link findIncompleteSlides}
 * answers the editor's notice and the publish gate from the same predicate.
 *
 * @module shared/incomplete-slides
 */

import { getSlideType } from './slide-types/registry.js';
import { isFieldVisible } from './slide-types/field-visibility.js';
import { labelableKeys } from './slide-types/field-definitions.js';
import { existingVersionLangs, pickVersion } from './i18n-progress.js';

const filled = (value) => typeof value === 'string' && value.trim() !== '';

/** A field the slide draws: not hidden, and its `visibleWhen` holds. */
function drawn(field, content, defaults) {
  return !!field && !field.hidden && isFieldVisible(field, content, defaults);
}

/**
 * The picture an `items` list is made of, or `null` when its items are more
 * than a picture. An item is a picture when it has one image sub-field and
 * every string that could name it is that picture's own alt or caption (the
 * sibling spelling the alt ladder reads: `alt`/`caption`, or
 * `<key>Alt`/`<key>Caption`). A gallery and an image set are lists of
 * pictures; a logo carries the organisation's name and a team card a person,
 * so those items are not, and an empty photo there is the type's own business.
 *
 * @param {Object} field - an `items` field
 * @returns {Object|null} the image sub-field
 */
function pictureOf(field) {
  const subs = Array.isArray(field.itemFields) ? field.itemFields : [];
  const images = subs.filter((sub) => sub?.type === 'image' && !sub.hidden);
  if (images.length !== 1) return null;
  const [image] = images;
  const own = new Set([
    'alt',
    'caption',
    `${image.key}Alt`,
    `${image.key}Caption`,
  ]);
  return [...labelableKeys(subs)].every((key) => own.has(key)) ? image : null;
}

/**
 * Where `slide` still lacks its essential picture: an `image` field declared
 * `essential` that is empty, or an essential list of pictures whose first
 * entry is missing or empty (for a list, `essential` means its first entry,
 * D211). Fields the slide does not draw do not count. The first such field
 * answers; it is what "Choose image" fills.
 *
 * A type that does not resolve in `slideTypes` has no missing picture: there
 * is no declaration to ask.
 *
 * @param {Object} slide
 * @param {Record<string, Object>} [slideTypes] - the deck organization's
 *   merged registry; core when omitted
 * @returns {{ field: Object, picture: Object|null }|null} the field, and for
 *   a list the image sub-field of its first item (`null` for an image field)
 */
export function missingPicture(slide, slideTypes) {
  if (!slide || typeof slide !== 'object') return null;
  const def = getSlideType(slide.type, slideTypes || undefined);
  if (!def || !Array.isArray(def.fields)) return null;
  const content =
    slide.content && typeof slide.content === 'object' ? slide.content : {};
  const defaults =
    def.defaults && typeof def.defaults === 'object' ? def.defaults : {};
  for (const field of def.fields) {
    if (!field?.essential || !drawn(field, content, defaults)) continue;
    if (field.type === 'image') {
      if (!filled(content[field.key])) return { field, picture: null };
      continue;
    }
    if (field.type !== 'items') continue;
    const picture = pictureOf(field);
    if (!picture) continue;
    const first = Array.isArray(content[field.key])
      ? content[field.key][0]
      : null;
    if (!filled(first?.[picture.key])) return { field, picture };
  }
  return null;
}

/**
 * Whether `slide` still has an empty essential picture
 * ({@link missingPicture}).
 *
 * @param {Object} slide
 * @param {Record<string, Object>} [slideTypes] - the deck organization's
 *   merged registry; core when omitted
 * @returns {boolean}
 */
export function isSlideIncomplete(slide, slideTypes) {
  return missingPicture(slide, slideTypes) !== null;
}

/**
 * The slides an output would show but leaves out because they are
 * incomplete: what the editor names before presenting or exporting, and what
 * publishing refuses. Every language version is read, as the alt check reads
 * them (`shared/unnamed-images.js`), so a picture missing in one translation
 * is found too; a deck without versions is read from `slides`.
 *
 * @param {Object} pres
 * @param {Record<string, Object>} [slideTypes] - the merged registry
 * @param {Object} [options]
 * @param {(slide: Object) => boolean} [options.include] - which slides the
 *   output would show apart from this rule (its visibility flags, live-only)
 * @returns {Array<{ lang: string|null, slideIndex: number, slideId: string }>}
 *   `slideIndex` is 0-based in that version's slides
 */
export function findIncompleteSlides(
  pres,
  slideTypes,
  { include = () => true } = {},
) {
  const langs = existingVersionLangs(pres);
  const out = [];
  for (const lang of langs.length ? langs : [null]) {
    const { slides } = pickVersion(pres, lang);
    slides.forEach((slide, slideIndex) => {
      if (!slide || typeof slide !== 'object' || !include(slide)) return;
      if (!isSlideIncomplete(slide, slideTypes)) return;
      out.push({
        lang,
        slideIndex,
        slideId: typeof slide.id === 'string' ? slide.id : '',
      });
    });
  }
  return out;
}

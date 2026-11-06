/**
 * What a model may put in a field the viewer's browser loads (DY-811).
 *
 * An image field, a slide background, an embed and a video load without a
 * click, on every surface, for every viewer. A URL the model wrote there
 * leaves the building with whatever the model put in its query. So a model's
 * answer keeps, in such a field, only what the slides it was given already
 * held there, or a value that names no other host: a path this installation
 * serves, a bare video id in the library the installation configured.
 * Everything else is emptied, and the slide says so in `_aiWarnings`.
 *
 * Which fields those are is the type's declaration, never a field name: an
 * `image` field, and any field that declares `mediaRef` (the string is a
 * reference to media, not document text).
 *
 * A slide that loses a reference its type requires (an embed without its
 * page, a video without its source) cannot be stored as that type: a new deck
 * refuses it. {@link dropForeignMedia} names those slides and the path leaves
 * them out with {@link leaveOut}, which says so on a slide that stays.
 *
 * The rule judges what the slide will use, never a nearby spelling of it:
 *
 * - the value as every renderer reads it, through `mediaValue()` in
 *   `shared/slide-types/helpers.js` (a trimmed string; JavaScript's trim takes
 *   Unicode white space the URL parser leaves standing). Anything else in a
 *   media field is no media the slide can use, and is emptied;
 * - the slide as a read yields it. Every read runs the deck through
 *   `migratePresentation()`, whose steps move legacy keys into media fields
 *   (`bgImage` into `slideBgImage`, numbered `logo3Image` slots into
 *   `logos[]`, a flat quote portrait into `quotes[]`, ...). A key the type
 *   does not declare would pass the rule and land in a media field on the next
 *   read, so the rule folds the slides first and judges the result.
 *
 * Every path that turns a model's answer into slide content passes it through
 * {@link dropForeignMedia}, after the slides are composed, so the fields are
 * read off the canonical type. `tests/ai-model-media.test.js` holds the list
 * of paths and fails on a call to the transport it does not know, and renders
 * every media field of every type with every hostile form it knows.
 */

import { mediaValue } from '../../../shared/slide-types/helpers.js';
import { resolveSlideTypeName } from '../../../shared/slide-types/registry.js';
import { migratePresentation } from '../../../shared/slide-types/schema-version.js';

/** Two bases, because `https:host` is a path under https and a host under http. */
const BASES = ['https://installation.invalid/', 'http://installation.invalid/'];
const OWN_HOST = 'installation.invalid';

const IMAGE_WARNING =
  'The generated slide named a remote image that was not copied; the image field was left empty.';
const MEDIA_WARNING =
  'The generated slide named an embed or video the slides did not already hold; the field was left empty.';
export const LEFT_OUT_WARNING =
  'A generated slide next to this one was left out: it was built around an embed or video the slides did not already hold. Add that slide yourself.';

/**
 * Whether a browser on this installation would fetch the value from another
 * host. Parsed the way the browser parses it, so `/\host`, `https:/host`,
 * a tab inside the scheme and a userinfo prefix read as what they load.
 *
 * @param {string} value
 * @returns {boolean}
 */
export function loadsFromAnotherHost(value) {
  return BASES.some((base) => {
    let url;
    try {
      url = new URL(value, base);
    } catch {
      // The browser cannot resolve it either, so it loads nothing.
      return false;
    }
    return url.host !== '' && url.host !== OWN_HOST;
  });
}

/** A field whose value the viewer's browser loads without a click. */
function isMediaField(field) {
  return field?.type === 'image' || Boolean(field?.mediaRef);
}

/**
 * Every declared media field of a slide's content that holds a value,
 * `items` entries included. The value is what is stored, string or not; read
 * it with `mediaValue()`.
 *
 * @param {object} content
 * @param {object[]} fields - the slide type's field declarations
 * @returns {Generator<{ holder: object, key: string, value: unknown, field: object }>}
 */
export function* mediaFields(content, fields) {
  for (const field of fields) {
    const value = content[field.key];
    if (isMediaField(field) && value != null) {
      yield { holder: content, key: field.key, value, field };
    } else if (field.type === 'items' && Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === 'object') {
          yield* mediaFields(item, field.itemFields || []);
        }
      }
    }
  }
}

/** Every string anywhere in a value, as if each were an image field. */
function* everyString(holder) {
  for (const [key, value] of Object.entries(holder)) {
    if (typeof value === 'string') {
      yield { holder, key, value, field: { type: 'image' } };
    } else if (value && typeof value === 'object') {
      yield* everyString(value);
    }
  }
}

/**
 * The media fields of one slide. A type the map does not know has no
 * declaration to read, so every string in its content counts as one.
 */
function slideMediaFields(slide, slideTypes) {
  const type = resolveSlideTypeName(slide.type, slideTypes) || slide.type;
  const def = Object.hasOwn(slideTypes, type) ? slideTypes[type] : null;
  return def
    ? mediaFields(slide.content, def.fields || [])
    : everyString(slide.content);
}

/**
 * What the given slides hold in their media fields: the values a model that
 * was shown these slides may hand back. On a provider with absolute URLs a
 * copied image reads as remote, and so does an embed the author chose
 * (DY-793).
 *
 * @param {Array<{ type?: string, content?: object }>|null} slides
 * @param {Record<string, object>} slideTypes - the merged slide-type map
 * @returns {Set<string>} to pass as `keep` to {@link dropForeignMedia}
 */
export function mediaInSlides(slides, slideTypes) {
  const held = new Set();
  for (const slide of Array.isArray(slides) ? slides : []) {
    if (!slide?.content || typeof slide.content !== 'object') continue;
    for (const { value } of slideMediaFields(slide, slideTypes)) {
      const used = mediaValue(value);
      if (used) held.add(used);
    }
  }
  return held;
}

/**
 * Whether a media field's stored value has to go: it is not a string, or the
 * string as the slide uses it loads from another host and is not held.
 */
function isForeign(value, keep) {
  if (typeof value !== 'string') return true;
  const used = mediaValue(value);
  return !keep.has(used) && loadsFromAnotherHost(used);
}

/**
 * Fold the slides the way every read does, in place, so the rule sees the
 * keys a read will render. The steps edit slides in place (a type rename and
 * a new `content` object included), so the caller's slide objects are the
 * folded ones. A step that hands back other slide objects would leave the
 * rule judging the unfolded originals, so that throws instead of passing
 * them (fail-closed).
 */
function foldAsRead(slides) {
  const folded = migratePresentation({ slides: [...slides] }).slides;
  const same =
    Array.isArray(folded) &&
    folded.length === slides.length &&
    folded.every((slide, i) => slide === slides[i]);
  if (!same) {
    throw new Error(
      'dropForeignMedia: a migration step replaced a slide object; fold in place or judge its result',
    );
  }
}

/**
 * Empty every media field a model filled with a URL on another host that
 * the given slides did not hold, or with anything that is not a string. Folds
 * the slides first, as a read does ({@link foldAsRead}). Mutates the slides
 * and appends to their `_aiWarnings`.
 *
 * @param {Array<{ type?: string, content?: object, _aiWarnings?: string[] }>} slides
 * @param {object} opts
 * @param {Record<string, object>} opts.slideTypes - the merged slide-type map
 * @param {Set<string>} [opts.keep] - from {@link mediaInSlides}
 * @returns {Set<object>} the slides that lost a field their type requires;
 *   they cannot be stored, so the caller leaves them out ({@link leaveOut})
 */
export function dropForeignMedia(
  slides,
  { slideTypes, keep = new Set() } = {},
) {
  if (!slideTypes || typeof slideTypes !== 'object') {
    throw new TypeError('dropForeignMedia: pass the slide-type map');
  }
  const unusable = new Set();
  if (!Array.isArray(slides)) return unusable;
  foldAsRead(slides.filter((slide) => slide && typeof slide === 'object'));
  for (const slide of slides) {
    if (!slide?.content || typeof slide.content !== 'object') continue;
    const warnings = [];
    for (const found of slideMediaFields(slide, slideTypes)) {
      const { holder, key, value, field } = found;
      if (!isForeign(value, keep)) continue;
      holder[key] = '';
      warnings.push(field.type === 'image' ? IMAGE_WARNING : MEDIA_WARNING);
      if (field.required) unusable.add(slide);
    }
    if (warnings.length) {
      slide._aiWarnings = [...(slide._aiWarnings || []), ...warnings];
    }
  }
  return unusable;
}

/**
 * The slides without the ones {@link dropForeignMedia} named. The notice
 * rides on the slide before the first gap, or the first slide that stays, the
 * way the deck-level balance warning rides on a content slide.
 *
 * @template {{ _aiWarnings?: string[] }} T
 * @param {T[]} slides
 * @param {Set<object>} unusable
 * @returns {T[]} `slides` itself when nothing is left out
 */
export function leaveOut(slides, unusable) {
  const gap = slides.findIndex((slide) => unusable.has(slide));
  if (gap < 0) return slides;
  const kept = slides.filter((slide) => !unusable.has(slide));
  const onto = slides[gap - 1] || kept[0];
  if (onto) {
    onto._aiWarnings = [...(onto._aiWarnings || []), LEFT_OUT_WARNING];
  }
  return kept;
}

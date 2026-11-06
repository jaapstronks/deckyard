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
 * Two things load without being a media field, and the same call holds them
 * to the same rule (DY-863):
 *
 * - **Text a renderer turns into a load.** A type from the database writes a
 *   field into its markup as it is (`{{raw body}}`), or into an attribute
 *   (`<img src="{{esc photo}}">`); a fork's own type may do the same. The
 *   sanitizer keeps `<img src="https://…">`, for every writer. So the rule
 *   renders each slide the way a viewer gets it and reads what the markup
 *   asks a browser to load ({@link loadSurfaces}); a text the model wrote
 *   that adds such a load is emptied. A text the given slides already held,
 *   in the same field of the same type, stays: that load was a person's.
 * - **A field the type keeps from the model** (`ai: false`, such as the
 *   Bunny library of a video). The catalog does not offer it; an answer that
 *   fills it anyway keeps only what the given slides held there, or the
 *   type's default, which is the installation's.
 *
 * Every path that turns a model's answer into slide content passes it through
 * {@link dropForeignMedia}, after the slides are composed, so the fields are
 * read off the canonical type. `tests/ai-model-media.test.js` holds the list
 * of paths and fails on a call to the transport it does not know, and renders
 * every media field of every type with every hostile form it knows.
 */

import { JSDOM } from 'jsdom';
import { initSanitizer, sanitizerReady } from '../../../shared/sanitize.js';
import {
  MEDIA_OWN_HOST,
  mediaValue,
  resolveMediaUrl,
} from '../../../shared/slide-types/helpers.js';
import { renderSlideHtml } from '../../../shared/slide-types/presentation.js';
import { resolveSlideTypeName } from '../../../shared/slide-types/registry.js';
import { migratePresentation } from '../../../shared/slide-types/schema-version.js';

const IMAGE_WARNING =
  'The generated slide named a remote image that was not copied; the image field was left empty.';
const MEDIA_WARNING =
  'The generated slide named an embed or video the slides did not already hold; the field was left empty.';
const MARKUP_WARNING =
  'The generated slide wrote text that would make the slide load something from another host; that text was left empty.';
const WITHHELD_WARNING =
  'The generated slide filled a field that is left to people (such as a video library or a transcript); it was reset.';
export const LEFT_OUT_WARNING =
  'A generated slide next to this one was left out: it was built around an embed or video the slides did not already hold. Add that slide yourself.';

/**
 * Whether a browser on this installation would fetch the value from another
 * host. Parsed the way the browser parses it, so `/\host`, `https:/host`,
 * a tab inside the scheme and a userinfo prefix read as what they load.
 *
 * A value the URL parser refuses counts as another host: a CSS `url()` loads
 * it anyway, from the host it names (see `resolveMediaUrl()`). A bare video
 * id, a path this installation serves and a `data:` value all parse, so they
 * stay.
 *
 * @param {string} value
 * @returns {boolean}
 */
export function loadsFromAnotherHost(value) {
  const urls = resolveMediaUrl(value);
  return (
    !urls || urls.some((url) => url.host !== '' && url.host !== MEDIA_OWN_HOST)
  );
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

/** The registry key a slide's type resolves to, and its declaration. */
function slideType(slide, slideTypes) {
  const type = resolveSlideTypeName(slide.type, slideTypes) || slide.type;
  return {
    type,
    def: Object.hasOwn(slideTypes, type) ? slideTypes[type] : null,
  };
}

/**
 * The media fields of one slide. A type the map does not know has no
 * declaration to read, so every string in its content counts as one.
 */
function slideMediaFields(slide, slideTypes) {
  const { def } = slideType(slide, slideTypes);
  return def
    ? mediaFields(slide.content, def.fields || [])
    : everyString(slide.content);
}

/**
 * Every value in a slide's content that is not an object or an array, with
 * its path of keys (array positions left out, so `members.name` is every
 * member's name).
 *
 * @returns {Generator<{ holder: object, key: string, value: unknown, path: string }>}
 */
function* contentLeaves(holder, prefix = '') {
  for (const [key, value] of Object.entries(holder)) {
    const path = Array.isArray(holder)
      ? prefix
      : prefix
        ? `${prefix}.${key}`
        : key;
    if (value && typeof value === 'object') {
      yield* contentLeaves(value, path);
    } else if (value != null) {
      yield { holder, key, value, path };
    }
  }
}

/** How a value is held: the same field of the same type. */
function heldKey(type, path, value) {
  return `${type}\u0000${path}\u0000${String(value)}`;
}

/**
 * What the given slides hold: the values a model that was shown these slides
 * may hand back.
 *
 * - `media`: what their media fields use. On a provider with absolute URLs a
 *   copied image reads as remote, and so does an embed the author chose
 *   (DY-793).
 * - `fields`: every other value, by type and field. A person's markup that
 *   loads a picture from a partner's site stays when the model hands it back
 *   in the same field; moved into another field or another type, it is the
 *   model's.
 *
 * @param {Array<{ type?: string, content?: object }>|null} slides
 * @param {Record<string, object>} slideTypes - the merged slide-type map
 * @returns {{ media: Set<string>, fields: Set<string> }} to pass as `keep` to
 *   {@link dropForeignMedia}
 */
export function heldInSlides(slides, slideTypes) {
  const held = { media: new Set(), fields: new Set() };
  for (const slide of Array.isArray(slides) ? slides : []) {
    if (!slide?.content || typeof slide.content !== 'object') continue;
    for (const { value } of slideMediaFields(slide, slideTypes)) {
      const used = mediaValue(value);
      if (used) held.media.add(used);
    }
    const { type } = slideType(slide, slideTypes);
    for (const { path, value } of contentLeaves(slide.content)) {
      held.fields.add(heldKey(type, path, value));
    }
  }
  return held;
}

/** Nothing held: what a path without given slides passes. */
const NOTHING_HELD = Object.freeze({
  media: new Set(),
  fields: new Set(),
});

/**
 * Whether a media field's stored value has to go: it is not a string, or the
 * string as the slide uses it loads from another host and is not held.
 */
function isForeign(value, held) {
  if (typeof value !== 'string') return true;
  const used = mediaValue(value);
  return !held.has(used) && loadsFromAnotherHost(used);
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

// ── Fields the type keeps from the model ────────────────────────────────────

/**
 * Every field a type declares `ai: false` that holds a value, `items` entries
 * included, with its path as {@link contentLeaves} spells it.
 */
function* withheldFields(content, fields, prefix = '') {
  for (const field of fields) {
    if (!Object.hasOwn(content, field.key)) continue;
    const value = content[field.key];
    const path = prefix ? `${prefix}.${field.key}` : field.key;
    if (field.ai === false) {
      yield { holder: content, key: field.key, value, path, top: !prefix };
    } else if (field.type === 'items' && Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === 'object') {
          yield* withheldFields(item, field.itemFields || [], path);
        }
      }
    }
  }
}

/**
 * Put back the default in every `ai: false` field the model filled with a
 * value the given slides did not hold there. The default of a top-level field
 * is the type's (with this installation's configuration in it, B653); an
 * `items` entry has none, so its key goes.
 *
 * @returns {Map<object, Set<string>>} every `ai: false` field, as `holder` →
 *   keys, so the render rule leaves them alone (they hold what was held or
 *   the installation's default)
 */
function resetWithheld(slide, type, def, keep, warnings) {
  const withheld = new Map();
  for (const found of withheldFields(slide.content, def.fields || [])) {
    const { holder, key, value, path, top } = found;
    const standard = top ? def.defaults?.[key] : undefined;
    const keys = withheld.get(holder) || new Set();
    keys.add(key);
    withheld.set(holder, keys);
    if (isSameValue(value, standard)) continue;
    if (isPrimitive(value) && keep.fields.has(heldKey(type, path, value))) {
      continue;
    }
    if (standard === undefined) delete holder[key];
    else holder[key] = structuredClone(standard);
    warnings.push(WITHHELD_WARNING);
  }
  return withheld;
}

function isPrimitive(value) {
  return value == null || typeof value !== 'object';
}

function isSameValue(a, b) {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

// ── What a render loads ─────────────────────────────────────────────────────

const PARSER = new JSDOM('').window.document;

// The render runs the slide sanitizer. Every importer gets it running, so no
// path judges the escaped fallback. Where it cannot start (a test that fakes
// a browser without DOMPurify), dropForeignMedia refuses to run.
await initSanitizer().catch(() => {
  // Ignorable here: sanitizerReady() stays false and the rule refuses.
});

/**
 * Attributes that never make a browser fetch anything: names, labels and
 * layout numbers. Every attribute not listed is read for an address.
 */
const INERT_ATTRIBUTES = new Set([
  'abbr',
  'alt',
  'class',
  'colspan',
  'datetime',
  'dir',
  'headers',
  'height',
  'hidden',
  'id',
  'lang',
  'preserveaspectratio',
  'reversed',
  'role',
  'rowspan',
  'scope',
  'span',
  'start',
  'tabindex',
  'title',
  'viewbox',
  'width',
]);

/** Elements whose `href` is a link: it loads on a click, never on render. */
const LINK_ELEMENTS = new Set(['a', 'area']);

/**
 * CSS functions that load nothing: arithmetic, colours, gradients, shapes,
 * transforms and filters. Any other function counts as a load, `url()`,
 * `image-set()`, `image()`, `src()` and `cross-fade()` among them, and so
 * does one this list does not know.
 */
const INERT_CSS_FUNCTIONS = new Set(
  [
    'abs calc clamp max min mod rem round sign sqrt pow hypot exp log',
    'sin cos tan asin acos atan atan2 var env',
    'rgb rgba hsl hsla hwb lab lch oklab oklch color color-mix light-dark',
    'linear-gradient radial-gradient conic-gradient',
    'repeating-linear-gradient repeating-radial-gradient repeating-conic-gradient',
    'circle ellipse inset polygon rect xywh',
    'matrix matrix3d perspective rotate rotate3d rotatex rotatey rotatez',
    'scale scale3d scalex scaley scalez skew skewx skewy',
    'translate translate3d translatex translatey translatez',
    'blur brightness contrast drop-shadow grayscale hue-rotate invert',
    'opacity saturate sepia cubic-bezier steps linear',
    'minmax repeat fit-content counter counters',
  ]
    .join(' ')
    .split(' '),
);

/**
 * Whether a value read as CSS may load something. An escape or a comment
 * can hide a function name, so either counts; otherwise every `(` is read
 * with the name in front of it (ASCII case-insensitive, as CSS compares
 * function names), and a name {@link INERT_CSS_FUNCTIONS} does not hold
 * counts. Without a `(` CSS loads nothing: every load is a function, and an
 * `@import` cannot stand in an attribute.
 */
function cssMayLoad(value) {
  if (value.includes('\\') || value.includes('/*')) return true;
  for (let i = value.indexOf('('); i >= 0; i = value.indexOf('(', i + 1)) {
    let start = i;
    while (start > 0 && /[\w-]|[^\x00-\x7f]/.test(value[start - 1])) {
      start -= 1;
    }
    const name = value
      .slice(start, i)
      .replace(/[A-Z]/g, (c) => c.toLowerCase());
    if (!INERT_CSS_FUNCTIONS.has(name)) return true;
  }
  return false;
}

/**
 * Whether an attribute may make a browser load from another host: its value
 * as an address, each word of it as one (a `srcset` is a list, so is a
 * `data-*` value a runtime reads), or its value as CSS.
 */
function attributeMayLoad(element, name, value) {
  if (INERT_ATTRIBUTES.has(name)) return false;
  if (name.startsWith('aria-') || name.startsWith('xmlns')) return false;
  if (
    (name === 'href' || name === 'xlink:href') &&
    LINK_ELEMENTS.has(element.localName)
  ) {
    return false;
  }
  if (cssMayLoad(value)) return true;
  return [value, ...value.split(/[\s,]+/)].some(
    (word) => word !== '' && loadsFromAnotherHost(word),
  );
}

/**
 * What rendered markup asks a browser to load from another host, as a count
 * per element, attribute and value. Read through an HTML parser, so every
 * character reference is decoded the way the browser decodes it.
 *
 * @param {string} html
 * @returns {Map<string, number>}
 */
export function loadSurfaces(html) {
  const template = PARSER.createElement('template');
  template.innerHTML = html;
  const surfaces = new Map();
  const visit = (root) => {
    for (const element of root.querySelectorAll('*')) {
      for (const { name, value } of element.attributes) {
        const lower = name.toLowerCase();
        if (!attributeMayLoad(element, lower, value)) continue;
        const surface = `${element.localName} ${lower}=${value}`;
        surfaces.set(surface, (surfaces.get(surface) || 0) + 1);
      }
      if (element.localName === 'template') visit(element.content);
    }
  };
  visit(template.content);
  return surfaces;
}

/**
 * The loads `surfaces` has that `base` does not: how many, and which, as one
 * string to compare.
 */
function addedLoads(surfaces, base) {
  let count = 0;
  const which = [];
  for (const [surface, n] of surfaces) {
    const more = n - (base.get(surface) || 0);
    if (more > 0) {
      count += more;
      which.push(`${more}\u0000${surface}`);
    }
  }
  return { count, which: which.sort().join('\u0001') };
}

/** The slide as a viewer gets it, read for loads. */
function slideLoads(slide, type, slideTypes) {
  // No deck language: the rule judges one slide, and what a render loads does
  // not change with the language of its copy.
  return loadSurfaces(
    renderSlideHtml({ ...slide, type }, { slideTypes, lang: null }),
  );
}

/**
 * Whether a leaf is a choice among the options its field declares: the model
 * picked one, it wrote nothing. Read off the top-level declaration.
 */
function isDeclaredOption(def, path, value) {
  const field = (def.fields || []).find((f) => f.key === path);
  return (
    Array.isArray(field?.options) &&
    field.options.some((option) =>
      option && typeof option === 'object'
        ? option.value === value
        : option === value,
    )
  );
}

/**
 * Empty every value the model wrote that makes the rendered slide load
 * something from another host its render without them does not.
 *
 * The values judged are the slide's leaves outside its media fields (judged
 * by their own rule), outside its `ai: false` fields (reset by theirs), that
 * are not a declared option and that the given slides did not hold in the
 * same field. The render with all of them empty is the base: what the type,
 * the installation and the held values load. While the slide loads more than
 * that, the first value whose emptying lowers the count is emptied. When no
 * single one does (an address split over two values), every value whose
 * emptying changes what the slide loads is emptied, and if the slide still
 * loads more than the base, all of them are. A render that throws empties
 * them all.
 */
function emptyLoadingText(slide, type, def, { keep, skip, slideTypes }) {
  const judged = [];
  for (const leaf of contentLeaves(slide.content)) {
    const { holder, key, value, path } = leaf;
    if (skip.get(holder)?.has(key)) continue;
    if (keep.fields.has(heldKey(type, path, value))) continue;
    if (!path.includes('.') && isDeclaredOption(def, path, value)) continue;
    judged.push(leaf);
  }
  if (!judged.length) return [];
  const empty = (leaf) => {
    if (typeof leaf.value === 'string') leaf.holder[leaf.key] = '';
    else delete leaf.holder[leaf.key];
  };
  const restore = (leaf) => {
    leaf.holder[leaf.key] = leaf.value;
  };
  try {
    judged.forEach(empty);
    const base = slideLoads(slide, type, slideTypes);
    judged.forEach(restore);
    const added = () => addedLoads(slideLoads(slide, type, slideTypes), base);
    const emptied = [];
    const left = [...judged];
    let now = added();
    while (now.count > 0) {
      const at = left.findIndex((leaf) => {
        empty(leaf);
        const after = added();
        if (after.count < now.count) {
          now = after;
          return true;
        }
        restore(leaf);
        return false;
      });
      if (at >= 0) {
        emptied.push(...left.splice(at, 1));
        continue;
      }
      for (const leaf of [...left]) {
        empty(leaf);
        const after = added();
        if (after.which !== now.which) {
          now = after;
          emptied.push(...left.splice(left.indexOf(leaf), 1));
        } else restore(leaf);
      }
      if (now.count > 0) {
        left.forEach(empty);
        emptied.push(...left);
      }
      break;
    }
    return emptied;
  } catch {
    judged.forEach(empty);
    return judged;
  }
}

// ── The rule ────────────────────────────────────────────────────────────────

/**
 * Hold a model's answer to what its slides may load. Mutates the slides and
 * appends to their `_aiWarnings`:
 *
 * 1. every media field filled with a URL on another host that the given
 *    slides did not hold, or with anything that is not a string, is emptied;
 * 2. every `ai: false` field filled with a value the given slides did not
 *    hold there gets the type's default back;
 * 3. every other value the model wrote that makes the rendered slide load
 *    from another host is emptied ({@link emptyLoadingText}).
 *
 * Folds the slides first, as a read does ({@link foldAsRead}). The render
 * runs the slide sanitizer, so without it this throws rather than judge the
 * escaped fallback, which loads nothing a viewer's browser would not.
 *
 * @param {Array<{ type?: string, content?: object, _aiWarnings?: string[] }>} slides
 * @param {object} opts
 * @param {Record<string, object>} opts.slideTypes - the merged slide-type map
 * @param {{ media: Set<string>, fields: Set<string> }} [opts.keep] - from
 *   {@link heldInSlides}
 * @returns {Set<object>} the slides that lost a field their type requires;
 *   they cannot be stored, so the caller leaves them out ({@link leaveOut})
 */
export function dropForeignMedia(
  slides,
  { slideTypes, keep = NOTHING_HELD } = {},
) {
  if (!slideTypes || typeof slideTypes !== 'object') {
    throw new TypeError('dropForeignMedia: pass the slide-type map');
  }
  if (!(keep?.media instanceof Set) || !(keep?.fields instanceof Set)) {
    throw new TypeError('dropForeignMedia: pass `keep` from heldInSlides()');
  }
  const unusable = new Set();
  if (!Array.isArray(slides)) return unusable;
  if (!sanitizerReady()) {
    throw new Error(
      'dropForeignMedia: the slide sanitizer is not initialized (initSanitizer())',
    );
  }
  foldAsRead(slides.filter((slide) => slide && typeof slide === 'object'));
  for (const slide of slides) {
    if (!slide?.content || typeof slide.content !== 'object') continue;
    const warnings = [];
    const skip = new Map();
    for (const found of slideMediaFields(slide, slideTypes)) {
      const { holder, key, value, field } = found;
      skip.set(holder, (skip.get(holder) || new Set()).add(key));
      if (!isForeign(value, keep.media)) continue;
      holder[key] = '';
      warnings.push(field.type === 'image' ? IMAGE_WARNING : MEDIA_WARNING);
      if (field.required) unusable.add(slide);
    }
    const { type, def } = slideType(slide, slideTypes);
    if (def) {
      for (const [holder, keys] of resetWithheld(
        slide,
        type,
        def,
        keep,
        warnings,
      )) {
        const known = skip.get(holder) || new Set();
        for (const key of keys) known.add(key);
        skip.set(holder, known);
      }
      const emptied = emptyLoadingText(slide, type, def, {
        keep,
        skip,
        slideTypes,
      });
      if (emptied.length) warnings.push(MARKUP_WARNING);
      for (const { holder, path } of emptied) {
        const field = (def.fields || []).find((f) => f.key === path);
        if (holder === slide.content && field?.required) unusable.add(slide);
      }
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

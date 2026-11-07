/**
 * What a model may put in a field the viewer's browser loads (DY-811).
 *
 * An image field, a slide background, an embed and a video load without a
 * click, on every surface, for every viewer. A URL the model wrote there
 * leaves the building with whatever the model put in its query. So a model's
 * answer keeps, in such a field, only what the slides it was given already
 * held there, or a value that names no other host: a path this installation
 * serves, a bare video id in the library the installation configured.
 * Everything else is emptied, and the slide says so in `_aiWarnings`. So is
 * a value the model wrote that holds more than the characters of one address
 * (a comma, a quote, `<`, white space): where a template puts it, in a CSS
 * `url()`, a `srcset` or `{{raw}}` markup, it could read as a second one.
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
 *   The render read is the server's (parse5 under jsdom, with DOMPurify),
 *   and that is what a viewer gets: a database type and a fork type always
 *   render on the server. The browser's sanitizer keeps some markup the
 *   server's drops (the content of a `<select>`), so a type that rendered a
 *   model's text in the browser would need a judgment of its own.
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
import { valueAtPath } from '../../../shared/slide-types/text-fields.js';

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
function* contentLeaves(holder, prefix = '', skipped = () => false) {
  for (const [key, value] of Object.entries(holder)) {
    if (skipped(holder, key)) continue;
    const path = Array.isArray(holder)
      ? prefix
      : prefix
        ? `${prefix}.${key}`
        : key;
    if (value && typeof value === 'object') {
      yield* contentLeaves(value, path, skipped);
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
 * A value as JSON with the keys of every object in order, so the same list
 * handed back with its keys in another order reads the same.
 */
function sortedJson(value) {
  return JSON.stringify(value, (_, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((key) => [key, v[key]]),
        )
      : v,
  );
}

/**
 * How a whole `ai: false` field is held, a list included: its value as JSON
 * ({@link sortedJson}), marked so no string a leaf holds spells the same key.
 */
function heldWholeKey(type, path, value) {
  return heldKey(type, path, `\u0001${sortedJson(value)}`);
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
    const { type, def } = slideType(slide, slideTypes);
    for (const { path, value } of contentLeaves(slide.content)) {
      held.fields.add(heldKey(type, path, value));
    }
    for (const { path, value } of withheldFields(
      slide.content,
      def?.fields || [],
    )) {
      held.fields.add(heldWholeKey(type, path, value));
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
  return !held.has(used) && (loadsFromAnotherHost(used) || !isOneAddress(used));
}

/**
 * Whether a value the model wrote reads as one address wherever a template
 * may put it (DY-863). A type from the database or a fork may write its media
 * field into a CSS `url()`, a `srcset`, an attribute without quotes or, with
 * `{{raw}}`, into the markup itself (`url('{{esc photo}}')`,
 * `srcset="{{esc photo}} 2x"`, `src={{raw photo}}`). A list of characters to
 * refuse keeps missing a reading there: a `srcset` skips a leading comma
 * before its next candidate, and `{{raw}}` decodes `&#32;` into the space
 * that splits one. So the value is checked for what it may hold:
 *
 * - a `data:` value that is an image (`data:image/…`), of base64 and
 *   percent-encoded characters (a comma or a colon in it stays inside the
 *   one address: a `srcset` candidate ends at white space only). Any other
 *   `data:` value is not an image, and in a field the template loads it is a
 *   document or a stream of its own (an HLS playlist Chrome plays) (DY-868);
 * - otherwise characters a URL carries unencoded and no template reads as a
 *   boundary: letters, digits, `-._~/%?=#:+`. No comma, quote, parenthesis,
 *   backslash, `&`, `<`, `>`, `;`, white space or control character.
 *
 * A path this installation serves, a bare video id and an absolute URL on
 * this host fit; a value that needs more is written by a person, or held.
 */
function isOneAddress(value) {
  if (/^data:/i.test(value)) {
    return /^data:image\/[A-Za-z0-9+/=;,.%_:-]*$/i.test(value);
  }
  return /^[A-Za-z0-9\-._~/%?=#:+]*$/.test(value);
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
    if (keep.fields.has(heldWholeKey(type, path, value))) continue;
    if (standard === undefined) delete holder[key];
    else holder[key] = structuredClone(standard);
    warnings.push(WITHHELD_WARNING);
  }
  return withheld;
}

function isSameValue(a, b) {
  return a === b || sortedJson(a) === sortedJson(b);
}

// ── What a render loads ─────────────────────────────────────────────────────

const PARSER = new JSDOM('').window.document;

// The render runs the slide sanitizer. Every importer gets it running, so no
// path judges the escaped fallback. Where it cannot start (a test that fakes
// a browser without DOMPurify), dropForeignMedia refuses to run.
let sanitizerFailure = null;
await initSanitizer().catch((err) => {
  sanitizerFailure = err;
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
 * Attributes only a runtime reads, that load nothing whatever they hold.
 * `data-math` is a formula KaTeX renders without `trust`, in the editor
 * (`client/lib/slide-runtime/slide-render.js`) and on the export page
 * (`server/utils/prism-katex.js`), so `\href`, `\includegraphics` and
 * `\url` in it render as text and fetch nothing (measured in Chrome, review
 * of DY-863); `tests/ai-model-media.test.js` fails when a KaTeX call passes
 * `trust`. Read word for word as an address, a formula would count: `\\c`
 * (a line break in LaTeX) parses as `//c`.
 */
const RUNTIME_INERT_ATTRIBUTES = new Set(['data-math']);

const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';

/**
 * Whether a browser reads an attribute as CSS: `style` on any element, and
 * the presentation attributes of SVG (`fill`, `mask`, `filter`, ...), which
 * are every other attribute an SVG or MathML element may carry here. An HTML
 * attribute is never CSS: `data-math="f(x)"` is a formula, not a function.
 */
function readsAsCss(element, name) {
  return name === 'style' || element.namespaceURI !== HTML_NAMESPACE;
}

/**
 * Whether an attribute may make a browser load from another host: its value
 * as an address, each word of it as one (a `srcset` is a list, so is a
 * `data-*` value a runtime reads), or, where the browser reads it as CSS
 * ({@link readsAsCss}), its value as CSS.
 */
function attributeMayLoad(element, name, value) {
  if (INERT_ATTRIBUTES.has(name) || RUNTIME_INERT_ATTRIBUTES.has(name)) {
    return false;
  }
  if (name.startsWith('aria-') || name.startsWith('xmlns')) return false;
  if (
    (name === 'href' || name === 'xlink:href') &&
    LINK_ELEMENTS.has(element.localName)
  ) {
    return false;
  }
  if (readsAsCss(element, name) && cssMayLoad(value)) return true;
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

/** The slide as a viewer gets it. */
function renderForLoads(slide, type, slideTypes) {
  // No deck language: the rule judges one slide, and what a render loads does
  // not change with the language of its copy.
  return renderSlideHtml({ ...slide, type }, { slideTypes, lang: null });
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
 * How many characters the search for the values that load may render per
 * call, all slides together (DY-863). One render costs the slide's size in
 * time, and its heap stays until the call returns: the slide sanitizer walks
 * its document with a NodeIterator, which jsdom holds through a WeakRef, and
 * a WeakRef keeps its target until the synchronous job ends. So the budget
 * counts the work, not the values. A render is charged its length plus
 * {@link RENDER_CHARGE}, the cost of a document whatever it holds. Measured
 * on dev, the densest markup (`<b>x</b>`) costs about 1.3 µs and 270 bytes of
 * heap per character rendered, so the budget stays near 0.5 s and 100 MB.
 */
export const MAX_SEARCH_CHARS = 384 * 1024;

/** What one render costs beyond its length, in characters. */
const RENDER_CHARGE = 512;

/**
 * Empty every value the model wrote that makes the rendered slide load
 * something from another host its render without them does not.
 *
 * The values judged are the slide's leaves outside its media fields (judged
 * by their own rule), outside its `ai: false` fields (reset by theirs), that
 * are not a declared option, not empty, and that the given slides did not
 * hold in the same field. The search itself is {@link revertWhatLoads}, with
 * empty as the value a judged leaf falls back to.
 */
function emptyLoadingText(
  slide,
  type,
  def,
  { keep, skip, slideTypes, budget },
) {
  const judged = [];
  const held = [];
  const skipped = (holder, key) => Boolean(skip.get(holder)?.has(key));
  for (const leaf of contentLeaves(slide.content, '', skipped)) {
    const { value, path } = leaf;
    if (!path.includes('.') && isDeclaredOption(def, path, value)) continue;
    const fallback = typeof value === 'string' ? '' : undefined;
    if (keep.fields.has(heldKey(type, path, value)))
      held.push({ ...leaf, fallback });
    else if (value !== '') judged.push({ ...leaf, fallback });
  }
  return revertWhatLoads(judged, held, {
    render: () => renderForLoads(slide, type, slideTypes),
    budget,
  });
}

/**
 * Put back the fallback of every judged leaf that makes the render load
 * something from another host the render with all of them at their fallback
 * does not. A leaf is `{ holder, key, value, fallback }`; a fallback of
 * `undefined` removes the key.
 *
 * The render with every judged leaf at its fallback is the base: what the
 * type, the installation and the held values load. The slide as written is
 * rendered once; when it loads no more than the base, every value stays.
 *
 * Otherwise a search halves the values: a group is rendered with only its
 * own values in, the held ones at their fallback too, so a render costs the
 * group rather than the slide. A group that loads nothing more than that bare
 * render keeps its values; one that does is halved, down to the single value,
 * which goes. A group the budget ({@link MAX_SEARCH_CHARS}) cannot pay for
 * any more goes as well. One value that loads among 248 costs about sixteen
 * small renders.
 *
 * Then the slide is rendered as it will be kept, the held values and the
 * values that passed together: when that loads no more than the base, it is
 * the answer, otherwise (values that only load together, across groups)
 * every judged value falls back. So does every one when a render throws.
 *
 * @param {Array<{ holder: object, key: string|number, value: unknown, fallback: unknown }>} judged
 * @param {Array<{ holder: object, key: string|number, value: unknown, fallback: unknown }>} held
 * @param {{ render: () => string, budget: { left: number } }} opts
 * @returns {object[]} the judged leaves that were put back to their fallback
 */
function revertWhatLoads(judged, held, { render, budget }) {
  if (!judged.length) return [];
  const fall = (leaf) => {
    if (leaf.fallback === undefined) delete leaf.holder[leaf.key];
    else leaf.holder[leaf.key] = leaf.fallback;
  };
  const restore = (leaf) => {
    leaf.holder[leaf.key] = leaf.value;
  };
  const loads = () => loadSurfaces(render());
  const charged = () => {
    const html = render();
    budget.left -= html.length + RENDER_CHARGE;
    return loadSurfaces(html);
  };
  const fallAll = () => {
    held.forEach(restore);
    judged.forEach(fall);
    return judged;
  };
  try {
    const written = loads();
    if (written.size === 0) return [];
    judged.forEach(fall);
    const base = loads();
    judged.forEach(restore);
    if (addedLoads(written, base).count === 0) return [];
    if (judged.length === 1) return fallAll();

    judged.forEach(fall);
    held.forEach(fall);
    const bare = charged();
    const passed = [];
    const search = (group) => {
      if (budget.left <= 0) return;
      group.forEach(restore);
      const adds = addedLoads(charged(), bare).count > 0;
      group.forEach(fall);
      if (!adds) passed.push(...group);
      else if (group.length > 1) halve(group);
    };
    const halve = (group) => {
      const middle = Math.ceil(group.length / 2);
      search(group.slice(0, middle));
      search(group.slice(middle));
    };
    halve(judged);

    held.forEach(restore);
    passed.forEach(restore);
    if (passed.length && addedLoads(loads(), base).count > 0) return fallAll();
    const kept = new Set(passed);
    return judged.filter((leaf) => !kept.has(leaf));
  } catch {
    return fallAll();
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
      `dropForeignMedia: the slide sanitizer is not initialized (initSanitizer()${sanitizerFailure ? `: ${sanitizerFailure.message}` : ''})`,
    );
  }
  foldAsRead(slides.filter((slide) => slide && typeof slide === 'object'));
  const budget = { left: MAX_SEARCH_CHARS };
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
        budget,
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

// ── A translation ───────────────────────────────────────────────────────────

/** A slide folded the way a read folds it, as a copy, and its type. */
function foldedCopy(slide, slideTypes) {
  const [folded] = migratePresentation({
    slides: [structuredClone(slide)],
  }).slides;
  return { folded, type: slideType(folded, slideTypes).type };
}

/**
 * Hold a translation to what its source loads (DY-868): a text the model
 * translated may not make the slide load from another host what the slide
 * with the source text in that place does not. Mutates the translated slides.
 *
 * A translation is the model's answer turned into slide content, but the
 * {@link dropForeignMedia} reading of "held" does not fit it: a translated
 * sentence is a different string from its source, so it is never held, and
 * a person's markup that the translation carries over (an `<img>` from a
 * partner's site in a text a database type renders as markup) would go. So
 * the comparison is the render, and what a judged text falls back to is the
 * source text in the same place ({@link revertWhatLoads}): the slide then
 * loads what its source loaded, the version stays complete, and the field
 * reads as the same as its source in the translation view, which is where a
 * person sees that it was not translated.
 *
 * Only the texts the model wrote are judged: what the target already held (a
 * person's own text in that language, the machine values a version carries)
 * stays as it is and counts in the base. Media fields and `ai: false` fields
 * need no rule of their own here: the translation offers and accepts the
 * declared text fields of the organization's types only, so it never writes
 * a media field, and an `ai: false` text is a person's prose translated,
 * judged by the render like every other text.
 *
 * @param {Array<{ slide: object, source: object|null|undefined, paths: Array<Array<string|number>> }>} translations
 *   per translated slide: the slide, the slide it was translated from, and
 *   the content paths whose text the model wrote
 * @param {object} opts
 * @param {Record<string, object>} opts.slideTypes - the merged slide-type map
 * @returns {Array<{ slide: object, path: Array<string|number> }>} the texts
 *   put back to their source
 */
export function holdTranslationToSource(translations, { slideTypes } = {}) {
  if (!slideTypes || typeof slideTypes !== 'object') {
    throw new TypeError('holdTranslationToSource: pass the slide-type map');
  }
  if (!sanitizerReady()) {
    throw new Error(
      `holdTranslationToSource: the slide sanitizer is not initialized (initSanitizer()${sanitizerFailure ? `: ${sanitizerFailure.message}` : ''})`,
    );
  }
  const budget = { left: MAX_SEARCH_CHARS };
  const reverted = [];
  for (const { slide, source, paths } of translations || []) {
    if (!slide?.content || typeof slide.content !== 'object') continue;
    const judged = [];
    for (const path of paths || []) {
      if (!Array.isArray(path) || !path.length) continue;
      const holder = valueAtPath(slide.content, path.slice(0, -1));
      const key = path.at(-1);
      const value = holder && typeof holder === 'object' ? holder[key] : null;
      if (typeof value !== 'string' || value === '') continue;
      const before = valueAtPath(source?.content, path);
      const fallback = typeof before === 'string' ? before : '';
      if (value === fallback) continue;
      judged.push({ holder, key, value, fallback, path });
    }
    const render = () => {
      const { folded, type } = foldedCopy(slide, slideTypes);
      return renderForLoads(folded, type, slideTypes);
    };
    for (const leaf of revertWhatLoads(judged, [], { render, budget })) {
      reverted.push({ slide, path: leaf.path });
    }
  }
  return reverted;
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

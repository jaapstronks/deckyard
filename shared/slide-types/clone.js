/**
 * The `rekeyOnClone` declaration: which content keys are bound to *this* slide
 * instance and have to be re-derived when the slide is copied.
 *
 * Copying a slide is a routine the editor performs from five places
 * (duplicate from the slide list, duplicate from the form's ⋯ menu, paste from
 * the paste bar, paste with Ctrl+V, insert from the slide library). Every one
 * of them carried the same two `if (type === …)` lines by hand:
 *
 *   if (copy.type === 'poll-slide') copy.content.pollId = newId();
 *   if (copy.type === 'follow-invite-slide') copy.content.presentationId = …;
 *
 * Two names per copy is below the three-name threshold of the name-branching
 * gate (tests/helpers/slide-type-name-branching.js), so five copies of one fact
 * stayed invisible to it — and they had already drifted: the ⋯ menu's duplicate
 * rekeyed the poll but not the follow-invite, and the library insert wrote the
 * same knowledge a third way (delete-then-set rather than set).
 *
 * So the type declares it instead. A fork type that carries an id of its own
 * says so in its own definition and every copy path honours it, which is the
 * route-4 shape: the editor implements a closed vocabulary, the type declares
 * against it.
 *
 * ## The vocabulary
 *
 * The declaration is a `{ contentKey: source }` map, where `source` names where
 * the clone's value comes from — deliberately a closed set, because the clone
 * helper has to be able to produce it without asking the type for code:
 *
 * - `fresh-id` — a newly generated unique id. For keys that identify the slide
 *   instance to a subsystem outside the deck (`pollId` addresses the
 *   interaction state a live session collects), where two slides sharing one
 *   value means two slides sharing one set of answers.
 * - `presentation-id` — the id of the presentation the clone lands in. For keys
 *   that cache a fact about the surrounding deck (`presentationId` on the
 *   follow-invite slide, which the QR code is built from), where a copy into
 *   another deck would otherwise keep pointing at the old one.
 *
 * A key whose source is not in the vocabulary is ignored rather than applied:
 * same rule as `field-editors.js`, so a fork cannot land a source the clone
 * helper has no way to satisfy.
 *
 * ## The seam
 *
 * The declaration is JSON-safe and travels on `GET /api/slide-types`, because
 * the editor holds that response and not the registry — the aggregator-seam
 * rule of docs/reference/slide-type-directory.md. Without the wire half a fork
 * type's declaration would be read from a map the browser never receives.
 *
 * @see client/lib/slide-authoring/clone-slides.js — the one consumer.
 */

/**
 * Where a rekeyed value comes from. Closed: the clone helper produces these.
 * @type {Readonly<Record<string, string>>}
 */
export const CLONE_REKEY_SOURCES = Object.freeze({
  /** A newly generated unique id, unique to the clone. */
  'fresh-id': 'A newly generated unique id.',
  /** The id of the presentation the clone lands in. */
  'presentation-id': 'The id of the presentation the clone lands in.',
});

/** @type {ReadonlyArray<string>} */
export const CLONE_REKEY_SOURCE_NAMES = Object.freeze(
  Object.keys(CLONE_REKEY_SOURCES),
);

/**
 * Whether a value names a declared rekey source.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isCloneRekeySource(value) {
  return typeof value === 'string' && Object.hasOwn(CLONE_REKEY_SOURCES, value);
}

/**
 * A slide type's `rekeyOnClone` declaration, keys with an unknown source
 * dropped. `{}` when the type declares none — the common case.
 *
 * @param {{rekeyOnClone?: unknown}|null|undefined} def - a slide-type
 *   definition (registry entry, or the `/api/slide-types` metadata)
 * @returns {Record<string, string>}
 */
export function slideRekeyOnClone(def) {
  const declared = def?.rekeyOnClone;
  if (!declared || typeof declared !== 'object' || Array.isArray(declared)) {
    return {};
  }
  const out = {};
  for (const [key, source] of Object.entries(declared)) {
    if (typeof key === 'string' && key && isCloneRekeySource(source)) {
      out[key] = source;
    }
  }
  return out;
}

/**
 * Apply a type's `rekeyOnClone` declaration to a freshly cloned slide, in
 * place.
 *
 * Writes `content` when the type declares anything and the slide has none, so a
 * clone of a slide with a stripped content object still gets its instance keys
 * (the library-insert path builds content by merge and can reach here with an
 * empty object).
 *
 * @param {{type?: string, content?: Object}} slide - the clone, mutated
 * @param {Object} opts
 * @param {Object|null} [opts.def] - the declaring slide-type definition
 * @param {string} [opts.presentationId] - id of the deck the clone lands in
 * @param {() => string} opts.newId - generator for `fresh-id` sources
 * @returns {string[]} the content keys that were rewritten
 */
export function applyCloneRekey(slide, { def, presentationId = '', newId }) {
  const rekey = slideRekeyOnClone(def);
  const keys = Object.keys(rekey);
  if (!keys.length || !slide) return [];
  if (!slide.content || typeof slide.content !== 'object') slide.content = {};
  const written = [];
  for (const key of keys) {
    switch (rekey[key]) {
      case 'fresh-id':
        slide.content[key] = newId();
        break;
      case 'presentation-id':
        slide.content[key] = presentationId || '';
        break;
      default:
        // Unreachable while the vocabulary has two values, and the reason this
        // is a switch rather than an if/else: a third source added to
        // CLONE_REKEY_SOURCES without a case here must skip the key, not write
        // the wrong one into it.
        continue;
    }
    written.push(key);
  }
  return written;
}

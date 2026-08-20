/**
 * The `instanceKeys` declaration: which content keys are bound to *this* slide
 * instance rather than to its text, and where their value comes from.
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
 * says so in its own definition and every path that writes a slide honours it,
 * which is the route-4 shape: the editor implements a closed vocabulary, the
 * type declares against it.
 *
 * ## The vocabulary
 *
 * The declaration is a `{ contentKey: source }` map, where `source` names where
 * the value comes from — deliberately a closed set, because the helpers here
 * have to be able to produce it without asking the type for code:
 *
 * - `fresh-id` — a newly generated unique id. For keys that identify the slide
 *   instance to a subsystem outside the deck (`pollId` addresses the
 *   interaction state a live session collects), where two slides sharing one
 *   value means two slides sharing one set of answers.
 * - `presentation-id` — the id of the presentation the slide lives in. For keys
 *   that cache a fact about the surrounding deck (`presentationId` on the
 *   follow-invite slide, which the QR code is built from), where a copy into
 *   another deck would otherwise keep pointing at the old one.
 *
 * A key whose source is not in the vocabulary is ignored rather than applied:
 * same rule as `field-editors.js`, so a fork cannot land a source the helpers
 * have no way to satisfy.
 *
 * ## Two moments, one declaration
 *
 * A slide's instance keys are written at two different moments, and the *source*
 * — not the type name — says how each moment must write them:
 *
 * - **On copy** ({@link applyInstanceKeyRekey}): every declared key is
 *   overwritten. The copy is a new instance, so whatever the original held is
 *   by definition not the copy's.
 * - **On save** ({@link applyInstanceKeyDefaults}): a `fresh-id` key is filled
 *   only when it is missing, because the value *is* the address of state kept
 *   outside the deck — reminting it on an ordinary save would abandon the
 *   answers already collected under it. A `presentation-id` key is re-derived
 *   every time, because it is a cache of something the writer knows for certain
 *   and any other value is stale.
 *
 * That split used to be spelled out by hand at the two save seams
 * (`normalizeSlides` minted a missing `poll-slide.pollId`;
 * `normalizeFollowInviteSlides` set `presentationId`), which put the same
 * knowledge on a third and fourth name-branching site. Both now read the
 * declaration (A7.23).
 *
 * ## The seam
 *
 * The declaration is JSON-safe and travels on `GET /api/slide-types`, because
 * the editor holds that response and not the registry — the aggregator-seam
 * rule of docs/reference/slide-type-directory.md. Without the wire half a fork
 * type's declaration would be read from a map the browser never receives.
 *
 * @see client/lib/slide-authoring/clone-slides.js — the editor's copy paths.
 * @see server/storage/presentations/crud/rekey-new-deck.js — new decks.
 * @see server/storage/presentations/slides.js — the write seam.
 */

/**
 * Where an instance key's value comes from. Closed: the helpers here produce
 * these.
 * @type {Readonly<Record<string, string>>}
 */
export const INSTANCE_KEY_SOURCES = Object.freeze({
  /** A newly generated unique id, unique to this slide instance. */
  'fresh-id': 'A newly generated unique id.',
  /** The id of the presentation the slide lives in. */
  'presentation-id': 'The id of the presentation the slide lives in.',
});

/** @type {ReadonlyArray<string>} */
export const INSTANCE_KEY_SOURCE_NAMES = Object.freeze(
  Object.keys(INSTANCE_KEY_SOURCES),
);

/**
 * Whether a value names a declared instance-key source.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isInstanceKeySource(value) {
  return (
    typeof value === 'string' && Object.hasOwn(INSTANCE_KEY_SOURCES, value)
  );
}

/**
 * A slide type's `instanceKeys` declaration, keys with an unknown source
 * dropped. `{}` when the type declares none — the common case.
 *
 * @param {{instanceKeys?: unknown}|null|undefined} def - a slide-type
 *   definition (registry entry, or the `/api/slide-types` metadata)
 * @returns {Record<string, string>}
 */
export function slideInstanceKeys(def) {
  const declared = def?.instanceKeys;
  if (!declared || typeof declared !== 'object' || Array.isArray(declared)) {
    return {};
  }
  const out = {};
  for (const [key, source] of Object.entries(declared)) {
    if (typeof key === 'string' && key && isInstanceKeySource(source)) {
      out[key] = source;
    }
  }
  return out;
}

/**
 * The slide's content object, created when the slide has none.
 *
 * Writing `content` matters when the type declares anything: a clone of a slide
 * with a stripped content object still has to get its instance keys (the
 * library-insert path builds content by merge and can reach here with an empty
 * object).
 *
 * @param {{content?: Object}} slide - mutated when it has no content
 * @returns {Object}
 */
function contentOf(slide) {
  if (!slide.content || typeof slide.content !== 'object') slide.content = {};
  return slide.content;
}

/**
 * Apply a type's `instanceKeys` declaration to a freshly copied slide, in
 * place: **every** declared key is overwritten, because the copy is a new
 * instance.
 *
 * @param {{type?: string, content?: Object}} slide - the copy, mutated
 * @param {Object} opts
 * @param {Object|null} [opts.def] - the declaring slide-type definition
 * @param {string} [opts.presentationId] - id of the deck the copy lands in
 * @param {() => string} opts.newId - generator for `fresh-id` sources
 * @returns {string[]} the content keys that were rewritten
 */
export function applyInstanceKeyRekey(
  slide,
  { def, presentationId = '', newId },
) {
  const keys = slideInstanceKeys(def);
  const names = Object.keys(keys);
  if (!names.length || !slide) return [];
  const content = contentOf(slide);
  const written = [];
  for (const key of names) {
    switch (keys[key]) {
      case 'fresh-id':
        content[key] = newId();
        break;
      case 'presentation-id':
        content[key] = presentationId || '';
        break;
      default:
        // Unreachable while the vocabulary has two values, and the reason this
        // is a switch rather than an if/else: a third source added to
        // INSTANCE_KEY_SOURCES without a case here must skip the key, not write
        // the wrong one into it.
        continue;
    }
    written.push(key);
  }
  return written;
}

/**
 * Apply a type's `instanceKeys` declaration to a slide that is being *saved*
 * rather than copied, in place. Per-source rules (rationale in the module
 * header):
 *
 * - `fresh-id` — minted only when the key holds no non-empty string. An
 *   existing id is the address of state kept outside the deck and survives.
 * - `presentation-id` — re-derived from `presentationId`, always. Skipped
 *   entirely when the caller supplies none: a writer that does not know which
 *   deck it is writing cannot refresh a cache of that deck's id, and must not
 *   blank it either.
 *
 * @param {{type?: string, content?: Object}} slide - the slide, mutated
 * @param {Object} opts
 * @param {Object|null} [opts.def] - the declaring slide-type definition
 * @param {string} [opts.presentationId] - id of the deck being written
 * @param {() => string} opts.newId - generator for `fresh-id` sources
 * @returns {string[]} the content keys that were written
 */
export function applyInstanceKeyDefaults(
  slide,
  { def, presentationId = '', newId },
) {
  const keys = slideInstanceKeys(def);
  const names = Object.keys(keys);
  if (!names.length || !slide) return [];
  const deckId = String(presentationId || '').trim();
  const written = [];
  for (const key of names) {
    switch (keys[key]) {
      case 'fresh-id': {
        const current = slide.content?.[key];
        const kept = typeof current === 'string' ? current.trim() : '';
        contentOf(slide)[key] = kept || newId();
        break;
      }
      case 'presentation-id': {
        if (!deckId) continue;
        contentOf(slide)[key] = deckId;
        break;
      }
      default:
        // Same reasoning as applyInstanceKeyRekey: an unhandled source skips
        // the key rather than writing something the type did not ask for.
        continue;
    }
    written.push(key);
  }
  return written;
}

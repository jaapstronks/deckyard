/**
 * The `configDefaults` declaration: which of a type's default content values
 * belong to *this installation* rather than to core, and which piece of
 * configuration each one comes from.
 *
 * ## Why there has to be a route at all
 *
 * A slide type's `defaults` are written in core, so they can only name things
 * core owns. `video-slide` broke that twice over: its default `source` was one
 * fork's Bunny video UUID and its default `bunnyLibraryId` that fork's library
 * number, so a new video slide in any other instance played from a stranger's
 * account. B650 took both out, which was right and left a hole: an instance
 * that *does* own a Bunny library had no way to say "every new video slide
 * starts in mine". The two obvious patches are both wrong. A fallback inside
 * `renderHtml` puts infrastructure in the render, where it is re-decided on
 * every paint and lost the moment the slide is exported by another path. An
 * env read in `shared/` cannot work at all: these modules also run in the
 * browser, so only the server-side paths would honour it and a PPTX would
 * resolve a UUID the slide itself refuses to play.
 *
 * So configuration seeds the **authoring default**, once, where a slide comes
 * into being. The slide stores the value like any other content, and from then
 * on every surface — canvas, presenter, reader, the four export paths — reads
 * the same content key it already read. No reader learns anything new.
 *
 * ## The vocabulary
 *
 * The declaration is a `{ contentKey: source }` map, the same shape as
 * `instanceKeys` and for the same reason: the type says *what* it wants, the
 * seam knows *how* to get it. `source` names a piece of installation
 * configuration from a closed set, because a type cannot hand over code and an
 * open set would let a fork name an env var core never reads:
 *
 * - `bunny-library-id` — the Bunny Stream video library this installation
 *   uploads to (`BUNNY_LIBRARY_ID`). A bare Bunny video UUID needs one to
 *   embed; a pasted play or embed URL names its own and needs none.
 *
 * A key whose source is not in the vocabulary is ignored rather than applied —
 * same rule as `field-editors.js` and `instance-keys.js`.
 *
 * ## Where it is applied
 *
 * On the **type map**, not at the call site: {@link withConfiguredDefaults}
 * folds configuration into the `defaults` (and every `defaultsByLang` variant)
 * of the types that declare it. Every path that creates a slide already takes
 * its map from the one seam that builds it for that surface — the server's
 * `buildMergedSlideTypes()` and the `/api/slide-types` response the editor
 * holds — so a configured default reaches all eight `newSlide()` callers, the
 * type converter and the agent catalog without any of them being handed a
 * second argument. The env half lives in `server/config/slide-defaults.js`;
 * nothing in `shared/` reads `process.env`.
 *
 * A key the instance has not configured keeps the type's own default. An
 * unconfigured install is therefore byte-identical to one without this module.
 *
 * @see server/config/slide-defaults.js — the env half and its two callers.
 * @see shared/slide-types/instance-keys.js — the same declaration shape for
 *   keys bound to the slide instance rather than to the installation.
 */

/**
 * Where a configured default's value comes from. Closed: `instanceSlideDefaults()`
 * in `server/config/slide-defaults.js` produces exactly these.
 * @type {Readonly<Record<string, string>>}
 */
export const CONFIG_DEFAULT_SOURCES = Object.freeze({
  /** This installation's Bunny Stream video library id (`BUNNY_LIBRARY_ID`). */
  'bunny-library-id': "This installation's Bunny Stream video library id.",
});

/** @type {ReadonlyArray<string>} */
export const CONFIG_DEFAULT_SOURCE_NAMES = Object.freeze(
  Object.keys(CONFIG_DEFAULT_SOURCES),
);

/**
 * Whether a value names a declared configuration source.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isConfigDefaultSource(value) {
  return (
    typeof value === 'string' && Object.hasOwn(CONFIG_DEFAULT_SOURCES, value)
  );
}

/**
 * A slide type's `configDefaults` declaration, keys with an unknown source
 * dropped. `{}` when the type declares none — the common case.
 *
 * @param {{configDefaults?: unknown}|null|undefined} def - a slide-type
 *   definition (registry entry, or the `/api/slide-types` metadata)
 * @returns {Record<string, string>}
 */
export function slideConfigDefaults(def) {
  const declared = def?.configDefaults;
  if (!declared || typeof declared !== 'object' || Array.isArray(declared)) {
    return {};
  }
  const out = {};
  for (const [key, source] of Object.entries(declared)) {
    if (typeof key === 'string' && key && isConfigDefaultSource(source)) {
      out[key] = source;
    }
  }
  return out;
}

/**
 * The configuration, with everything this installation left unset dropped.
 * `null` when it configured nothing a type could ask for, which is the fast
 * path: {@link withConfiguredDefaults} then hands the map straight back.
 *
 * Only non-empty strings count. A blank value is "not configured" rather than
 * "configured as empty", because that is what an unset env var reads as and a
 * type's own default is the better answer.
 *
 * @param {Record<string, unknown>|null|undefined} config
 * @returns {Record<string, string>|null}
 */
function configuredValues(config) {
  if (!config || typeof config !== 'object') return null;
  const out = {};
  for (const source of CONFIG_DEFAULT_SOURCE_NAMES) {
    const value = config[source];
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (trimmed) out[source] = trimmed;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Write a type's configured defaults into one defaults map, in place.
 *
 * Only keys the type declares *and* the installation configured are touched;
 * everything else keeps the type's own value.
 *
 * @param {Object} defaults - a defaults map, mutated
 * @param {Object|null|undefined} def - the declaring slide-type definition
 * @param {Record<string, unknown>|null|undefined} config - the installation's
 *   configuration, keyed by source name
 * @returns {string[]} the content keys that were written
 */
export function applyConfigDefaults(defaults, def, config) {
  if (!defaults || typeof defaults !== 'object') return [];
  const values = configuredValues(config);
  if (!values) return [];
  const declared = slideConfigDefaults(def);
  const written = [];
  for (const [key, source] of Object.entries(declared)) {
    if (!Object.hasOwn(values, source)) continue;
    defaults[key] = values[source];
    written.push(key);
  }
  return written;
}

/**
 * The slide-type map a surface should hand out: the same types, with the
 * installation's configuration folded into the defaults of the ones that
 * declare it.
 *
 * Copy-on-write, and shallow by design. The map, the touched definitions and
 * their defaults maps are cloned; `fields`, `renderHtml` and every other facet
 * stay the very same objects, because this is the registry every render and
 * every validation resolves against and a deep clone would both cost and
 * silently fork the identities other modules compare. A type that declares
 * nothing, or an installation that configured nothing, gets the input map back
 * unchanged.
 *
 * `defaultsByLang` variants are written too: a per-language map is a complete
 * variant of `defaults` (see `type-defaults.js`), so a configured key missing
 * from one would be lost for exactly the decks that have that language.
 *
 * @param {Record<string, Object>|null|undefined} slideTypes - a slide-type map
 * @param {Record<string, unknown>|null|undefined} config - the installation's
 *   configuration, keyed by source name
 * @returns {Record<string, Object>|null|undefined} the map to use
 */
export function withConfiguredDefaults(slideTypes, config) {
  if (!slideTypes || typeof slideTypes !== 'object') return slideTypes;
  const values = configuredValues(config);
  if (!values) return slideTypes;

  let out = null;
  for (const [name, def] of Object.entries(slideTypes)) {
    const declared = slideConfigDefaults(def);
    const keys = Object.keys(declared).filter((key) =>
      Object.hasOwn(values, declared[key]),
    );
    if (!keys.length) continue;

    const next = { ...def };
    next.defaults = { ...(def.defaults || {}) };
    applyConfigDefaults(next.defaults, def, values);
    if (def.defaultsByLang && typeof def.defaultsByLang === 'object') {
      next.defaultsByLang = {};
      for (const [lang, map] of Object.entries(def.defaultsByLang)) {
        if (!map || typeof map !== 'object') {
          next.defaultsByLang[lang] = map;
          continue;
        }
        next.defaultsByLang[lang] = { ...map };
        applyConfigDefaults(next.defaultsByLang[lang], def, values);
      }
    }
    out = out || { ...slideTypes };
    out[name] = next;
  }
  return out || slideTypes;
}

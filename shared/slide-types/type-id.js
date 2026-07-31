/**
 * Slide-type identity: a reverse-DNS id, with `namespace/name` and the bare
 * name as the older spellings that stay valid forever.
 *
 * Historically a slide type was a bare string (`"title-slide"`) used both as
 * the registry key and as `slide.type` on stored decks. That leaves no room to
 * tell a fork's `title-slide` apart from core's, and a custom type could
 * silently shadow a core one. This module carries a structured identity WITHOUT
 * breaking the bare-string storage format. Three spellings name the same type:
 *
 * - A **bare name** (`"title-slide"`) parses to the CORE namespace. Existing
 *   decks and every `SLIDE_TYPES[slide.type]` lookup keep working untouched.
 * - A **qualified id** (`"acme/hero"`, `"acme/hero@2"`) names a namespace and an
 *   optional version, so a deck can record which definition it targets and a
 *   fork can declare its own types without colliding with core.
 * - A **reverse-DNS id** (`"eu.deckyard.slide.title"`) is the CANONICAL form,
 *   and the one {@link formatCanonicalId} emits.
 *
 * ## Why reverse-DNS is canonical
 *
 * Because whoever owns the domain may define the type. `acme/hero` and
 * `nl.ciiic.slide.hero` are both bare strings until a second fork exists; after
 * that the first is a collision waiting to happen and the second cannot be one.
 * That makes conflicts structurally impossible instead of socially managed,
 * which is the same reason atproto's Lexicon uses NSIDs — and taking the
 * convention is free, while retrofitting it onto a published format is not.
 *
 * ## Why the `-slide` suffix comes off
 *
 * `slide` is already in the authority (`eu.deckyard.slide`). In a registry where
 * every entry is a slide, the suffix is redundancy paid for once per type. The
 * canonical name therefore drops it — `eu.deckyard.slide.title`, not
 * `…slide.title-slide`.
 *
 * **Storage does not move.** `slides[].type` keeps the historical bare key, so
 * there is no migration and no deck to rewrite; the suffix rule is a fact about
 * which keys the registry happens to have, which is why resolving a canonical
 * name back to a registry key lives in `registry.js`
 * (`resolveSlideTypeName()`) and not here. This module stays purely
 * grammatical.
 *
 * The grammar is intentionally small and kebab-cased so ids are URL- and
 * filename-safe:
 *
 *   type-id   := ( nsid | [ namespace "/" ] name ) [ "@" version ]
 *   nsid      := authority "." name       (so at least three segments)
 *   authority := segment ( "." segment )+
 *   namespace := authority | segment
 *   name      := segment
 *   segment   := [a-z0-9] [a-z0-9-]*
 *   version   := [0-9A-Za-z] [0-9A-Za-z.\-]*      (semver-ish, but permissive)
 *
 * A two-segment `a.b` is deliberately NOT an id: an authority needs at least two
 * labels, so there is never a question of whether the dot separates authority
 * from name or one authority label from another.
 */

/** The namespace every bare / core slide-type name resolves to. */
export const CORE_NAMESPACE = 'core';

/**
 * The reverse-DNS authority core types are published under. Parsing normalizes
 * it to {@link CORE_NAMESPACE}, so `eu.deckyard.slide.title`, `core/title` and
 * `title-slide` are one identity with three spellings.
 */
export const CORE_AUTHORITY = 'eu.deckyard.slide';

/**
 * The suffix every core registry key historically carries. Kept as a constant
 * because two things need the same string: dropping it to form the canonical
 * name, and putting it back to find the registry key again.
 */
export const SLIDE_NAME_SUFFIX = '-slide';

/** The grammar's productions as pattern sources, so there is one copy of each. */
const SEGMENT_SRC = '[a-z0-9][a-z0-9-]*';
const AUTHORITY_SRC = `${SEGMENT_SRC}(?:\\.${SEGMENT_SRC})+`;
const NSID_SRC = `${AUTHORITY_SRC}\\.${SEGMENT_SRC}`;
const NAMESPACE_SRC = `(?:${AUTHORITY_SRC}|${SEGMENT_SRC})`;
const VERSION_SRC = '[0-9A-Za-z][0-9A-Za-z.-]*';

const SEGMENT_RE = new RegExp(`^${SEGMENT_SRC}$`);
const NAMESPACE_RE = new RegExp(`^${NAMESPACE_SRC}$`);
const VERSION_RE = new RegExp(`^${VERSION_SRC}$`);

/**
 * The whole grammar as a single JSON-Schema-compatible `pattern`, for the
 * published deck schema's `slide.type`.
 *
 * It exists so the schema can describe the *shape* of a type reference instead
 * of enumerating the names this install happens to have. An `enum` of registry
 * keys made every deck carrying a fork type or an org type invalid against our
 * own published schema, while the same spec promises leniency and leaves
 * `additionalProperties` open everywhere else — the most closed rule in an
 * otherwise open format. Deriving the pattern here rather than writing a second
 * regex in `json-schema.js` keeps the published contract and the parser that
 * enforces it on one source — which is also why widening the grammar to
 * reverse-DNS ids widened the published pattern in the same edit.
 *
 * @type {string}
 */
export const TYPE_ID_PATTERN =
  `^(?:${NSID_SRC}|(?:${NAMESPACE_SRC}/)?${SEGMENT_SRC})(?:@${VERSION_SRC})?$`;

/**
 * @typedef {object} TypeId
 * @property {string} namespace - e.g. "core" or a fork namespace.
 * @property {string} name - the type's local name (the bare storage key).
 * @property {string|null} version - optional version label, or null.
 */

/**
 * Parse a slide-type reference into its structured identity.
 *
 * Accepts a bare name (→ core namespace), a reverse-DNS id, a `namespace/name`,
 * or either qualified form with `@version`. Whitespace is trimmed. Throws a
 * TypeError on a malformed reference so callers fail loudly rather than
 * mis-resolving.
 *
 * The core authority is folded back to {@link CORE_NAMESPACE}, so
 * `eu.deckyard.slide.title` and `core/title` parse to the same identity — the
 * point of the canonical form is a second spelling, not a second type.
 *
 * @param {string} ref - e.g. "title-slide", "eu.deckyard.slide.title",
 *   "acme/hero", "acme/hero@2".
 * @returns {TypeId}
 */
export function parseTypeId(ref) {
  const raw = String(ref == null ? '' : ref).trim();
  if (!raw) {
    throw new TypeError('parseTypeId: empty slide-type reference');
  }

  let rest = raw;
  let version = null;
  const at = rest.indexOf('@');
  if (at !== -1) {
    version = rest.slice(at + 1);
    rest = rest.slice(0, at);
    if (!VERSION_RE.test(version)) {
      throw new TypeError(`parseTypeId: invalid version in "${raw}"`);
    }
  }

  let namespace = CORE_NAMESPACE;
  let name = rest;
  const slash = rest.indexOf('/');
  if (slash !== -1) {
    if (slash !== rest.lastIndexOf('/')) {
      throw new TypeError(`parseTypeId: too many "/" in "${raw}"`);
    }
    namespace = rest.slice(0, slash);
    name = rest.slice(slash + 1);
  } else if (rest.includes('.')) {
    // Reverse-DNS: the last label is the name, everything before it is the
    // authority. An authority needs at least two labels, so `a.b` is not an id.
    const dot = rest.lastIndexOf('.');
    namespace = rest.slice(0, dot);
    name = rest.slice(dot + 1);
    if (!namespace.includes('.')) {
      throw new TypeError(
        `parseTypeId: "${raw}" is not a reverse-DNS id (an authority needs at ` +
          `least two labels, e.g. "${CORE_AUTHORITY}.title")`
      );
    }
  }

  if (!NAMESPACE_RE.test(namespace)) {
    throw new TypeError(`parseTypeId: invalid namespace in "${raw}"`);
  }
  if (!SEGMENT_RE.test(name)) {
    throw new TypeError(`parseTypeId: invalid name in "${raw}"`);
  }

  return {
    namespace: namespace === CORE_AUTHORITY ? CORE_NAMESPACE : namespace,
    name,
    version,
  };
}

/**
 * Like {@link parseTypeId} but returns null instead of throwing.
 * @param {string} ref
 * @returns {TypeId|null}
 */
export function tryParseTypeId(ref) {
  try {
    return parseTypeId(ref);
  } catch {
    return null;
  }
}

/**
 * Format a structured identity back to `namespace/name[@version]` — the slash
 * spelling. Always explicit about the namespace (core included) so the string is
 * unambiguous. Use {@link formatCanonicalId} for the canonical reverse-DNS form
 * and {@link toStorageType} for the bare back-compat key.
 *
 * @param {TypeId} id
 * @returns {string}
 */
export function formatTypeId(id) {
  const namespace = id?.namespace || CORE_NAMESPACE;
  const name = id?.name || '';
  if (!NAMESPACE_RE.test(namespace) || !SEGMENT_RE.test(name)) {
    throw new TypeError('formatTypeId: invalid namespace or name');
  }
  const base = `${namespace}/${name}`;
  return id?.version ? `${base}@${id.version}` : base;
}

/**
 * Format a structured identity in the CANONICAL spelling: reverse-DNS when the
 * declarant has an authority, the slash form when it only has a bare namespace.
 *
 * Core ids take the core authority and drop the historical `-slide` suffix
 * (`{core, title-slide}` → `eu.deckyard.slide.title`). A fork that declares a
 * dotted authority gets the same treatment minus the suffix rule, which is a
 * fact about core's own key history and none of a fork's business
 * (`{nl.ciiic.slide, hero}` → `nl.ciiic.slide.hero`). A fork that declares only
 * a single-label namespace has no authority to build an id from, so it keeps the
 * slash form (`{acme, hero}` → `acme/hero`).
 *
 * @param {TypeId} id
 * @returns {string}
 */
export function formatCanonicalId(id) {
  const namespace = id?.namespace || CORE_NAMESPACE;
  const core = namespace === CORE_NAMESPACE;
  const authority = core ? CORE_AUTHORITY : namespace;
  if (!core && !authority.includes('.')) return formatTypeId(id);

  const name = core ? canonicalTypeName(id?.name) : id?.name || '';
  if (!NAMESPACE_RE.test(authority) || !SEGMENT_RE.test(name)) {
    throw new TypeError('formatCanonicalId: invalid namespace or name');
  }
  const base = `${authority}.${name}`;
  return id?.version ? `${base}@${id.version}` : base;
}

/**
 * The canonical (suffix-free) spelling of a core type name:
 * `title-slide` → `title`. Idempotent, and a no-op for a name that never had
 * the suffix.
 *
 * @param {string} name
 * @returns {string}
 */
export function canonicalTypeName(name) {
  const s = typeof name === 'string' ? name : '';
  if (!s.endsWith(SLIDE_NAME_SUFFIX)) return s;
  const stripped = s.slice(0, -SLIDE_NAME_SUFFIX.length);
  // `-slide` itself is not a suffix on an empty name.
  return stripped || s;
}

/** @param {TypeId} id */
export function isCoreNamespace(id) {
  return (id?.namespace || CORE_NAMESPACE) === CORE_NAMESPACE;
}

/**
 * The bare storage projection of a reference: the local `name`, dropping the
 * core namespace and version. A non-core namespace is preserved as
 * `namespace/name` (there is no bare form for a fork type).
 *
 * This is the *grammatical* projection and it does not consult the registry, so
 * a canonical core name comes back suffix-free (`eu.deckyard.slide.title` →
 * `title`) even though the registry key is `title-slide`. To land on an actual
 * registry key — which is what a slide's `type` field holds — use
 * `resolveSlideTypeName()` from `./registry.js`: which keys carry the suffix is
 * a registry fact, not a grammar one.
 *
 * @param {string|TypeId} ref
 * @returns {string}
 */
export function toStorageType(ref) {
  const id = typeof ref === 'string' ? parseTypeId(ref) : ref;
  return isCoreNamespace(id) ? id.name : `${id.namespace}/${id.name}`;
}

/**
 * True when two references name the same type, IGNORING version (identity is
 * namespace + name; version is a compatibility hint, not a different type) and
 * ignoring which of the three core spellings each side used.
 *
 * Core names are compared suffix-free, so `title-slide`, `core/title` and
 * `eu.deckyard.slide.title` are one type. That is safe exactly as long as no two
 * core types differ only by the suffix;
 * `tests/slide-type-registry-identity.test.js` holds the registry to it. Fork names are compared verbatim — the suffix rule
 * is about core's own key history, not about anyone else's naming.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function sameType(a, b) {
  const pa = tryParseTypeId(a);
  const pb = tryParseTypeId(b);
  if (!pa || !pb) return false;
  if (pa.namespace !== pb.namespace) return false;
  if (!isCoreNamespace(pa)) return pa.name === pb.name;
  return canonicalTypeName(pa.name) === canonicalTypeName(pb.name);
}

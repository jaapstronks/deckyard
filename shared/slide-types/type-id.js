/**
 * Slide-type identity: `namespace/name[@version]`.
 *
 * Historically a slide type was a bare string (`"title-slide"`) used both as
 * the registry key and as `slide.type` on stored decks. That leaves no room to
 * tell a fork's `title-slide` apart from core's, and a custom type could
 * silently shadow a core one. This module introduces a structured identity
 * WITHOUT breaking the bare-string storage format:
 *
 * - A bare name (`"title-slide"`) parses to the CORE namespace. Existing decks
 *   and every `SLIDE_TYPES[slide.type]` lookup keep working untouched.
 * - A qualified id (`"acme/hero"`, `"acme/hero@2"`) names a non-core namespace
 *   and an optional version, so a deck can record which definition it targets
 *   and a fork can declare its own types without colliding with core.
 *
 * The grammar is intentionally small and kebab-cased so ids are URL- and
 * filename-safe:
 *
 *   type-id   := [ namespace "/" ] name [ "@" version ]
 *   namespace := segment
 *   name      := segment
 *   segment   := [a-z0-9] [a-z0-9-]*
 *   version   := [0-9A-Za-z] [0-9A-Za-z.\-]*      (semver-ish, but permissive)
 */

/** The namespace every bare / core slide-type name resolves to. */
export const CORE_NAMESPACE = 'core';

const SEGMENT_RE = /^[a-z0-9][a-z0-9-]*$/;
const VERSION_RE = /^[0-9A-Za-z][0-9A-Za-z.\-]*$/;

/**
 * @typedef {object} TypeId
 * @property {string} namespace - e.g. "core" or a fork namespace.
 * @property {string} name - the type's local name (the bare storage key).
 * @property {string|null} version - optional version label, or null.
 */

/**
 * Parse a slide-type reference into its structured identity.
 *
 * Accepts a bare name (→ core namespace), a `namespace/name`, or a
 * `namespace/name@version`. Whitespace is trimmed. Throws a TypeError on a
 * malformed reference so callers fail loudly rather than mis-resolving.
 *
 * @param {string} ref - e.g. "title-slide", "acme/hero", "acme/hero@2".
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
    namespace = rest.slice(0, slash);
    name = rest.slice(slash + 1);
  }

  if (rest.indexOf('/') !== rest.lastIndexOf('/')) {
    throw new TypeError(`parseTypeId: too many "/" in "${raw}"`);
  }
  if (!SEGMENT_RE.test(namespace)) {
    throw new TypeError(`parseTypeId: invalid namespace in "${raw}"`);
  }
  if (!SEGMENT_RE.test(name)) {
    throw new TypeError(`parseTypeId: invalid name in "${raw}"`);
  }

  return { namespace, name, version };
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
 * Format a structured identity back to canonical `namespace/name[@version]`.
 * Always explicit about the namespace (core included) so the string is
 * unambiguous; use {@link toStorageType} when you need the bare back-compat key.
 *
 * @param {TypeId} id
 * @returns {string}
 */
export function formatTypeId(id) {
  const namespace = id?.namespace || CORE_NAMESPACE;
  const name = id?.name || '';
  if (!SEGMENT_RE.test(namespace) || !SEGMENT_RE.test(name)) {
    throw new TypeError('formatTypeId: invalid namespace or name');
  }
  const base = `${namespace}/${name}`;
  return id?.version ? `${base}@${id.version}` : base;
}

/** @param {TypeId} id */
export function isCoreNamespace(id) {
  return (id?.namespace || CORE_NAMESPACE) === CORE_NAMESPACE;
}

/**
 * The bare storage key for a reference: the local `name`, dropping the core
 * namespace and version so existing `slide.type` lookups keep resolving. A
 * non-core namespace is preserved as `namespace/name` (there is no bare form
 * for a fork type). This is what a slide's `type` field should hold.
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
 * namespace + name; version is a compatibility hint, not a different type).
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function sameType(a, b) {
  const pa = tryParseTypeId(a);
  const pb = tryParseTypeId(b);
  if (!pa || !pb) return false;
  return pa.namespace === pb.namespace && pa.name === pb.name;
}

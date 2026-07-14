/**
 * Helpers for reading/writing slide content by "field path" and for resolving a
 * field's schema metadata.
 *
 * A field path is either a plain key (`"title"`) or a dotted items path
 * (`"items.0.title"`). Paths are the same strings emitted by renderers as
 * `data-inline-field`.
 */

/**
 * Read a value from a content object by field path.
 * @param {Object} content
 * @param {string} path
 * @returns {*}
 */
export function getByPath(content, path) {
  if (!content || !path) return undefined;
  let cur = content;
  for (const part of String(path).split('.')) {
    if (cur == null) return undefined;
    cur = cur[part];
  }
  return cur;
}

/**
 * Write a value into a content object by field path, creating intermediate
 * arrays/objects as needed (numeric segments create arrays).
 * @param {Object} content
 * @param {string} path
 * @param {*} value
 */
export function setByPath(content, path, value) {
  if (!content || !path) return;
  const parts = String(path).split('.');
  let cur = content;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    const nextIsIndex = /^\d+$/.test(parts[i + 1]);
    if (cur[key] == null) cur[key] = nextIsIndex ? [] : {};
    cur = cur[key];
  }
  cur[parts[parts.length - 1]] = value;
}

/**
 * Resolve the schema field definition for a given path within a slide type.
 * Supports both top-level fields and per-item fields (`items.N.sub`).
 * @param {Object} slideDef - SLIDE_TYPES[type]
 * @param {string} path
 * @returns {Object} field definition (or {} if unknown)
 */
export function fieldMetaForPath(slideDef, path) {
  const fields = slideDef?.fields || [];
  const parts = String(path).split('.');
  // Walk `list.N.sub[.M.subsub...]` through nested itemFields (e.g.
  // text-blocks' rows.0.blocks.1.title).
  let meta = fields.find((f) => f.key === parts[0]) || {};
  for (let i = 1; i < parts.length - 1; i += 2) {
    const itemFields = meta?.itemFields || [];
    meta = itemFields.find((f) => f.key === parts[i + 1]) || {};
  }
  return meta;
}

/**
 * Whether a value counts as "empty" for the purpose of showing a ghost
 * affordance (blank strings, null, undefined).
 * @param {*} value
 * @returns {boolean}
 */
export function isEmptyValue(value) {
  if (value == null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

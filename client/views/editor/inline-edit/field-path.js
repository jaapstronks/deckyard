/**
 * Helpers for reading/writing slide content by "field path" and for resolving a
 * field's schema metadata.
 *
 * A field path is either a plain key (`"title"`) or a dotted items path
 * (`"items.0.title"`). Paths are the same strings emitted by renderers as
 * `data-inline-field`.
 */

import { t } from '../../../lib/ui-i18n.js';

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
 * The name a field goes by on the canvas — on a ghost chip ("+ Caption"), in a
 * clear button's title and as the markdown modal's field label.
 *
 * It reads the field's own `labelKey`, the key the registry stamps on every
 * field (shared/ui-i18n-keys.js) and the one the inspector already renders
 * from. One field, one name, wherever it is shown.
 *
 * It used to look the name up under `editor.inline.field.<last path segment>`
 * — a second key scheme for the same concept, with **zero** entries in all
 * twelve locales, so every chip fell through to `meta.label`, the English
 * schema label. On a Dutch canvas "+ Caption" stood next to "+ Rij toevoegen"
 * (B395). The scheme could not have worked as written either: it keyed on the
 * last path segment, so one `title` entry would have had to serve
 * `comparison-slide`'s "Title", `team-cards-slide`'s and a text-blocks row's.
 *
 * A path the schema does not know (`fieldMetaForPath` answers `{}`) carries no
 * key, so it names itself with its last path segment rather than asking `t()`
 * for the empty string.
 *
 * @param {string} path - field path, e.g. `subheading` or `items.0.text`
 * @param {Object} [meta] - the field definition, from `fieldMetaForPath`
 * @returns {string}
 */
export function fieldLabel(path, meta) {
  const fallback = meta?.label || String(path).split('.').pop();
  return meta?.labelKey ? t(meta.labelKey, fallback) : fallback;
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

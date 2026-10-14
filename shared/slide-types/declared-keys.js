/**
 * The content keys a slide type declares: the one answer to "is this key part
 * of the type's content, or a stranger?" (B257 B2, D121).
 *
 * A type makes four declarations about its top-level content, and a key named
 * by any of them belongs to the slide:
 *
 * - `fields[]` — the authored keys, plus the global slide fields
 *   (`GLOBAL_SLIDE_FIELD_KEYS`, `compose.js`) every slide may carry. Those are
 *   named here rather than read off the composed definition, because a
 *   custom type built from a DB record (`toRuntimeSlideType()`) is not
 *   composed and still renders the shared background layer.
 * - `instanceKeys` — the keys bound to the slide instance rather than to its
 *   text (`pollId`); no field, because nothing but the creating code writes
 *   them (`instance-keys.js`).
 * - `textStyles` — on a type that offers text styling, its styling map
 *   (`text-styles.js`).
 * - `DERIVED_SLIDE_CONTENT_KEYS` — the contrast verdict stored next to
 *   `slideBgImage`, on every type (`compose.js`, B628).
 *
 * Before this module the predicate lived inline in strict validation
 * (`server/utils/ai/schemas/content-schema.js`), while the deck import let every
 * other key through "forward-compatible" - which is what kept each retired key
 * alive in every deck that once carried it. Both now read this list: strict
 * refuses a key outside it (`unknown_field`, an agent is told), the import
 * drops it (a deck from outside is normalised). Two actions, one predicate.
 *
 * Top level only. Item keys (`itemFields`) are a per-field declaration and are
 * read where the items are.
 */

import {
  DERIVED_SLIDE_CONTENT_KEYS,
  GLOBAL_SLIDE_FIELD_KEYS,
} from './compose.js';
import { slideInstanceKeys } from './instance-keys.js';
import { textStyleOffers } from './text-styles.js';

const CACHE = new WeakMap();

/**
 * The top-level content keys a slide-type definition declares.
 * Cached per definition object; a definition is not mutated after
 * registration.
 *
 * @param {Object|null|undefined} def - a slide-type definition
 * @returns {ReadonlySet<string>}
 */
export function declaredContentKeys(def) {
  if (!def || typeof def !== 'object') return new Set();
  const cached = CACHE.get(def);
  if (cached) return cached;
  const keys = new Set();
  for (const field of Array.isArray(def.fields) ? def.fields : []) {
    if (typeof field?.key === 'string' && field.key) keys.add(field.key);
  }
  for (const key of GLOBAL_SLIDE_FIELD_KEYS) keys.add(key);
  for (const key of Object.keys(slideInstanceKeys(def))) keys.add(key);
  if (textStyleOffers(def).size) keys.add('textStyles');
  for (const key of DERIVED_SLIDE_CONTENT_KEYS) keys.add(key);
  CACHE.set(def, keys);
  return keys;
}

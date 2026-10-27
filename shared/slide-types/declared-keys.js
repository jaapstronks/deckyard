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
 * alive in every deck that once carried it. Every surface now reads this list:
 * a write refuses a key outside it (`unknown_field`, strict and
 * `validateSlideFields` alike), the import drops it (a deck from outside is
 * normalised), and migration 102 stripped what stored decks still carried
 * (D359, D360).
 *
 * The same module answers the two narrower questions a published contract
 * asks of a declared field, so the three audiences share one vocabulary
 * (D359; the table is `docs/reference/slide-type-companions.md` § Which keys
 * each surface names):
 *
 * - strict validation and the import: every declared key
 *   (`declaredContentKeys`);
 * - the published JSON Schema: the fields that are not `hidden`
 *   (`isPublishedField`);
 * - the agent catalogue: the fields that are neither `hidden` nor `ai: false`
 *   (`isAgentField`).
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
 * The content keys a slide may carry that no field of the type declares:
 * its `instanceKeys`, its `textStyles` map when it offers text styling, and
 * the derived background-contrast keys every slide may carry. All three are
 * machine values, one per deck: nothing but code writes them, and none is
 * prose.
 *
 * The part of `declaredContentKeys` that a field walk cannot see, exported so
 * the text-field spec declares the same keys rather than a copy of the list
 * (`text-fields.js`, B818). A missing definition (an unknown type) still
 * yields the derived keys: the contrast verdict is written on any slide with
 * a background image, whatever its type.
 *
 * @param {Object|null|undefined} def - a slide-type definition
 * @returns {string[]}
 */
export function nonFieldContentKeys(def) {
  const keys = [];
  if (def && typeof def === 'object') {
    keys.push(...Object.keys(slideInstanceKeys(def)));
    if (textStyleOffers(def).size) keys.push('textStyles');
  }
  keys.push(...DERIVED_SLIDE_CONTENT_KEYS);
  return keys;
}

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
  for (const key of nonFieldContentKeys(def)) keys.add(key);
  CACHE.set(def, keys);
  return keys;
}

/**
 * The content keys of `content` its type does not declare, in content order.
 * The one answer every write surface refuses on and migration 102 stripped
 * on; an unknown type declares nothing it could be held to, so it yields none.
 *
 * @param {Object|null|undefined} def - a slide-type definition
 * @param {unknown} content - a slide's `content`
 * @returns {string[]}
 */
export function undeclaredContentKeys(def, content) {
  if (!def || !content || typeof content !== 'object') return [];
  const declared = declaredContentKeys(def);
  return Object.keys(content).filter((key) => !declared.has(key));
}

/**
 * Whether a field belongs in the published contract (`/api/v1/schema/*`).
 *
 * `hidden` marks carried data beside a structured field: it is declared, so a
 * slide may carry it, but publishing it under `properties` would state it as
 * the contract, which is the opposite of what `hidden` means. `ai: false` is
 * not part of this test: that flag withholds a live field from agents for
 * editorial reasons (`video-slide.watchUrl` points at a landing page only a
 * human knows exists), and an author still fills it.
 *
 * @param {any} field - a field definition from `fields[]`
 * @returns {boolean}
 */
export function isPublishedField(field) {
  return field?.hidden !== true;
}

/**
 * Whether a field is offered to agents (`get_slide_types`, the agent
 * catalogue): a published field the type has not withheld with `ai: false`.
 * The default is offered: a field an author may fill is a field an agent may
 * fill, and withholding one is a decision somebody writes down.
 *
 * @param {any} field - a field definition from `fields[]`
 * @returns {boolean}
 */
export function isAgentField(field) {
  return isPublishedField(field) && field?.ai !== false;
}

/**
 * Where each field of a slide type can be edited, and which fields have no
 * home but the bulk "All text" modal.
 *
 * WHY THIS EXISTS
 * The bulk modal renders every surfaced field by construction, so it is the
 * fallback home of everything. A field *relies* on it exactly when nothing else
 * claims it: not the canvas (`inline.formText`, a `data-inline-field` the
 * renderer emits, the descriptor's element knobs, the Layout chip), not the
 * inspector keep-list and not an element tab. That is the parity invariant of
 * B450: every field has a home outside "All text".
 *
 * The derivation used to live in `scripts/lib/slide-type-doc-tables.js`, where
 * it fed the editing-surface tables and the core guard in
 * `tests/slide-type-docs.test.js`. Both only see core. A fork type declares
 * the same three companions on its own definition (`inline`, `inspectorKeeps`,
 * `elementTab`), so the definition validator asks this module the same
 * question about it and warns (B600). Runtime code may not import from
 * `scripts/`, hence this address.
 *
 * It reads only what it is handed: no aggregator import, because the
 * validator runs at boot on the registry path and the inline-edit aggregator
 * is editor payload (see `inline-edit.js`). The one effect beyond reading is a
 * call to the definition's own `renderHtml` on sample items, to see which item
 * fields the canvas edits.
 */

import { resolveTypeDefaults } from './type-defaults.js';

/**
 * Field keys the shared Background/Accessibility surfaces own, on every type.
 * They have a home on every type, so no derivation here counts them. Mirrors
 * `isBackgroundFieldKey()` + the a11y pair routed by `editor-form/index.js`.
 */
const SHARED_SURFACE_KEYS = new Set([
  'background',
  'bgCustomColor',
  'slideBgImage',
  'slideBgFit',
  'slideBgFocusX',
  'slideBgFocusY',
  'slideBgOverlay',
  'slideBgText',
  'slideLogo',
  'a11yTitle',
  'a11ySummary',
]);

/** Placeholders for the numeric positions in a condensed key family. */
const FAMILY_PLACEHOLDERS = ['{n}', '{m}', '{p}'];

/**
 * The family pattern of a key: each run of digits replaced by a positional
 * placeholder. `col2Block3Body` → `col{n}Block{m}Body`.
 * @param {string} key
 * @returns {string}
 */
export function familyPattern(key) {
  let i = 0;
  return key.replace(/\d+/g, () => FAMILY_PLACEHOLDERS[i++] ?? '{x}');
}

/**
 * The schema fields that reach an editing surface at all: `hidden` fields are
 * carried data and `deprecated` ones are legacy mirrors, and `editor-form/index.js`
 * renders neither. Shared Background/Accessibility keys are dropped here too:
 * every type homes them in the same two sections.
 *
 * @param {Object} def - composed slide-type definition
 * @returns {string[]} field keys, in schema order
 */
function surfacedFieldKeys(def) {
  return (def?.fields || [])
    .filter((f) => f && !f.hidden)
    .map((f) => String(f.key))
    .filter((k) => !SHARED_SURFACE_KEYS.has(k));
}

/**
 * Content keys the descriptor claims as ELEMENT properties rather than form
 * fields: the flat media keys the popover writes, and the ImageRef axes the
 * "This image" card renders off the same declaration (focus / fit / bleed).
 *
 * They are named with a `{n}` token in flat mode (`col{n}Image`), and in array
 * mode they name *item* keys instead. Rather than branch on that, every
 * candidate is matched against the type's own schema by family pattern: an item
 * key like `focusX` simply is not a top-level field and drops out.
 *
 * @param {Object|null} d - inline descriptor
 * @param {Object} def - composed slide-type definition
 * @returns {Set<string>} matching top-level schema keys
 */
function descriptorElementKeys(d, def) {
  const candidates = [];
  if (d?.media && !d.media.list) {
    candidates.push(d.media.imageField, d.media.altField);
    for (const extra of d.media.extraFields || []) candidates.push(extra.key);
  }
  candidates.push(
    d?.focus?.xField,
    d?.focus?.yField,
    d?.fit?.field,
    d?.bleed?.field,
  );
  const wanted = new Set(candidates.filter(Boolean).map(String));
  const out = new Set();
  for (const f of def?.fields || []) {
    const key = String(f.key);
    if (
      wanted.has(key) ||
      wanted.has(familyPattern(key).replace(/\{m\}|\{p\}/g, '{n}'))
    ) {
      out.add(key);
    }
  }
  return out;
}

/**
 * Content keys whose canonical control is the canvas **Layout chip**, not a
 * form field: the keys a declared layout variant writes, and the alignment key
 * of a declared field group.
 *
 * Both are type-definition declarations (`layoutVariants`, `fieldGroups`), which
 * is what makes "chip-only" checkable instead of a convention. `tests/
 * field-group-adoption.test.js` asserts the other half — that an alignment key
 * is never *also* an inspector keep.
 *
 * @param {Object} def - composed slide-type definition
 * @returns {Set<string>}
 */
function layoutChipKeys(def) {
  const out = new Set();
  for (const variant of def?.layoutVariants || []) {
    for (const key of Object.keys(variant?.set || {})) out.add(key);
  }
  for (const group of def?.fieldGroups || []) {
    if (group?.alignKey) out.add(String(group.alignKey));
  }
  return out;
}

/**
 * Collections whose items the canvas adds and removes: the `cards` list (the
 * + / × / grip affordances) and a list-mode `media` list (an empty slot is
 * filled by picking its image; the "This image" card deletes it). Such a list
 * is homed as a list; its item fields are measured one by one in
 * {@link itemOnlyHomePaths}.
 *
 * @param {Object|null} d - inline descriptor
 * @returns {string[]}
 */
function canvasCollectionKeys(d) {
  return [d?.cards?.field, d?.media?.list].filter(Boolean).map(String);
}

/** A sample value per item-field type, so the renderer draws the element. */
function sampleItemValue(f) {
  if (f.type === 'enum') {
    // The second option: a first option is often the "none" default that a
    // renderer draws nothing for (text-blocks' arrow).
    const opts = Array.isArray(f.options) ? f.options : [];
    const opt = opts[1] ?? opts[0];
    return opt && typeof opt === 'object' ? opt.value : opt;
  }
  if (f.type === 'boolean') return true;
  if (f.type === 'number') return 3;
  if (f.type === 'image') return 'https://example.com/sample.png';
  if (f.type === 'url') return 'https://example.com';
  return 'Sample';
}

/** Three items with every (nested) item field filled. */
function sampleItems(itemFields) {
  return Array.from({ length: 3 }, () => {
    const item = {};
    for (const f of itemFields || []) {
      if (!f) continue;
      item[f.key] = Array.isArray(f.itemFields)
        ? sampleItems(f.itemFields)
        : sampleItemValue(f);
    }
    return item;
  });
}

/**
 * The item paths the canvas edits directly: every `data-inline-field` (text)
 * and `data-inline-icon` (icon picker) the type's own renderer emits for a
 * slide whose collections are filled in full, with the indices dropped
 * (`rows.0.blocks.1.body` → `rows.blocks.body`).
 *
 * Read off a render rather than a declaration because the renderer IS the
 * declaration here: the inline layer edits exactly the elements that carry the
 * attribute, and nothing else says which item fields those are.
 *
 * @param {Object} def - composed slide-type definition
 * @returns {Set<string>}
 */
function canvasItemPaths(def) {
  const lists = (def?.fields || []).filter(
    (f) => f && !f.hidden && Array.isArray(f.itemFields),
  );
  if (!lists.length || typeof def.renderHtml !== 'function') return new Set();
  const content = resolveTypeDefaults(def, 'en');
  for (const list of lists) content[list.key] = sampleItems(list.itemFields);
  const html = String(
    def.renderHtml(content, { content }, { lang: 'en', mode: 'edit' }) || '',
  );
  const out = new Set();
  for (const m of html.matchAll(/data-inline-(?:field|icon)="([^"]+)"/g)) {
    out.add(m[1].replace(/\.\d+(?=\.|$)/g, ''));
  }
  return out;
}

/**
 * Item paths a declaration claims for a surface other than the bulk modal:
 *
 * - `itemGhosts` and a nested level's `cards.child.ghosts` (canvas chips that
 *   restore a cleared item field);
 * - `cards.child.field`, the nested collection the canvas adds to and removes
 *   from (its own subfields are measured separately);
 * - the list-mode `media` declaration: the item's image, alt text, extra
 *   fields and the ImageRef axes (focus / fit / bleed) the "This image" card
 *   renders;
 * - an `elementTab.card` with `fields`: the item settings the "This card" tab
 *   renders for the selected item.
 *
 * @param {Object|null} d - inline descriptor
 * @param {Object|null} tab - the type's element-tab declaration
 * @returns {Set<string>}
 */
function declaredItemPaths(d, tab) {
  const out = new Set();
  for (const g of d?.itemGhosts || []) out.add(`${g.list}.${g.field}`);
  const child = d?.cards?.child;
  if (child?.field) {
    const childPath = `${d.cards.field}.${child.field}`;
    out.add(childPath);
    for (const g of child.ghosts || []) out.add(`${childPath}.${g.field}`);
  }
  const media = d?.media;
  if (media?.list) {
    const keys = [
      media.imageField,
      media.altField,
      ...(media.extraFields || []).map((f) => f.key),
      d.focus?.xField,
      d.focus?.yField,
      d.fit?.field,
      d.bleed?.field,
    ];
    for (const k of keys.filter(Boolean)) out.add(`${media.list}.${k}`);
  }
  const card = tab?.card;
  if (typeof card?.list === 'string' && Array.isArray(card.fields)) {
    for (const k of card.fields) out.add(`${card.list}.${k}`);
  }
  return out;
}

/**
 * The item fields of a type's collections that rely on the bulk modal alone,
 * as dotted paths (`rows.arrow`, `rows.blocks.title`).
 *
 * The list-level derivation (`bulkOnly`) counts a collection as homed once the
 * list itself is claimed, which is how text-blocks' row arrows and colours hid
 * (B450). This one walks `itemFields`: a subfield is homed when the canvas
 * edits it ({@link canvasItemPaths}), a declaration claims it
 * ({@link declaredItemPaths}), or its whole list is an inspector keep (the
 * inspector then renders the full collection editor). A numbered family
 * (`c1…c10` table cells) is homed as a family: the canvas draws only the
 * columns in use, and one drawn member proves the others.
 *
 * @param {Object} def - composed slide-type definition
 * @param {Object|null} d - inline descriptor
 * @param {string[]|null} keeps - inspector keep-list
 * @param {Object|null} tab - element-tab declaration
 * @returns {string[]} in schema order
 */
function itemOnlyHomePaths(def, d, keeps, tab) {
  const claimed = new Set([
    ...canvasItemPaths(def),
    ...declaredItemPaths(d, tab),
  ]);
  const claimedFamilies = new Set([...claimed].map(familyPattern));
  const keepSet = new Set(keeps || []);
  const out = [];
  const walk = (fields, prefix) => {
    for (const f of fields || []) {
      if (!f || f.hidden) continue;
      const path = `${prefix}.${f.key}`;
      if (!claimed.has(path) && !claimedFamilies.has(familyPattern(path))) {
        out.push(path);
      }
      if (Array.isArray(f.itemFields)) walk(f.itemFields, path);
    }
  };
  for (const f of def?.fields || []) {
    if (!f || f.hidden || !Array.isArray(f.itemFields)) continue;
    if (keepSet.has(String(f.key))) continue;
    walk(f.itemFields, String(f.key));
  }
  return out;
}

/**
 * The fields of one slide type whose only editing home is the bulk modal.
 *
 * The declarations are passed in rather than looked up, so the caller decides
 * whose answer counts: the doc tables hand in core's aggregator entries, the
 * definition validator hands in what a fork definition declares itself.
 *
 * A `null` keep-list means nobody narrowed the inspector, which then keeps
 * every field the canvas text does not cover (`getInspectorKeepKeys()` in
 * `client/views/editor/editor-form/inspector-form.js`); that fallback is
 * applied here, so an un-narrowed type has no gaps at the inspector's level.
 *
 * @param {Object} def - slide-type definition (`fields[]`, `renderHtml`,
 *   `layoutVariants`, `fieldGroups`)
 * @param {object} [declared]
 * @param {Object|null} [declared.descriptor] - inline-edit descriptor
 * @param {string[]|null} [declared.keeps] - inspector keep-list
 * @param {Object|null} [declared.tab] - element-tab declaration
 * @returns {{bulkOnly: string[], itemBulkOnly: string[]}} top-level keys and
 *   dotted item paths (`rows.arrow`), in schema order
 */
export function bulkOnlyFields(
  def,
  { descriptor = null, keeps = null, tab = null } = {},
) {
  const formText = Array.isArray(descriptor?.formText)
    ? descriptor.formText
    : [];
  const effectiveKeeps = Array.isArray(keeps)
    ? keeps
    : surfacedFieldKeys(def).filter((k) => !formText.includes(k));
  const covered = new Set([
    ...formText,
    ...effectiveKeeps,
    ...descriptorElementKeys(descriptor, def),
    ...layoutChipKeys(def),
    ...canvasCollectionKeys(descriptor),
  ]);
  return {
    bulkOnly: surfacedFieldKeys(def).filter((k) => !covered.has(k)),
    itemBulkOnly: itemOnlyHomePaths(def, descriptor, effectiveKeeps, tab),
  };
}

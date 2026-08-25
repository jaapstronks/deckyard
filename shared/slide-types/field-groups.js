/**
 * Field GROUPS — which fields on a slide type move together as one visual block.
 *
 * The second affordance axis, next to the text ROLE in text-roles.js. The two
 * answer different questions and must not be folded into one vocabulary:
 *
 *   role   "what kind of text is this?"      intrinsic, reusable across types,
 *                                            a closed vocabulary of six.
 *   group  "which other fields on THIS type  extrinsic, type-local, an
 *           does this one move with?"        arbitrary set per type.
 *
 * Why the axis exists at all: "alignment" is two effects wearing one name — the
 * `text-align` INSIDE a box, and the placement of that box within its
 * container. The first is a property of the field. The second is only
 * well-defined for the whole group: a title, subtitle and meta line are one
 * visual block, and letting each pick its own box placement is not freedom but
 * a way to knock the slide out of true. Measured on the title slide at a
 * 1600px render, the title box sits 184px left of the slide centre and the
 * subtitle box 344px — so setting BOTH to `center` still leaves them centred on
 * axes 160px apart.
 *
 * So: a field that declares a `group` hands its alignment to that group. The
 * group's value lives in a plain content field (`alignKey`), which makes it a
 * normal, undoable content edit and lets the existing `layoutVariants` layout
 * switcher be its editing surface — no second mechanism (see
 * layout-variants.js).
 *
 * Declaration lives on the slide-type definition, JSON-safe so forks that
 * override a type by name bring their own grouping:
 *
 *   fields: [
 *     { key: 'title',      group: 'title-block', ... },
 *     { key: 'subheading', group: 'title-block', ... },
 *     { key: 'titleBlockAlign', type: 'enum', options: ['left', 'center'] },
 *   ],
 *   fieldGroups: [
 *     { id: 'title-block', alignKey: 'titleBlockAlign',
 *       align: ['left', 'center'], defaultAlign: 'left', alignClass: 'is-align' },
 *   ],
 *
 * The renderer emits `<alignClass>-<value>` on the slide root for any
 * non-default value (`is-align-center`), and the type's CSS moves the whole
 * block from that one class. `quote-slide` already did exactly this by hand;
 * this module is that pattern made declarative.
 */

import { resolveFieldDef } from './field-lookup.js';

/** Alignment vocabulary a group may offer (mirrors TEXT_ALIGN_VALUES). */
const GROUP_ALIGN_VALUES = ['left', 'center', 'right'];

/**
 * Default offer for a text block: left or centred. Right is deliberately out —
 * a right-aligned title block is not a layout we want to hand people, and it is
 * the one value that produced a broken slide in the deck history (a centred
 * title next to a right-aligned subtitle). Same call ROLE_AFFORDANCES.quote
 * already makes.
 */
const DEFAULT_BLOCK_ALIGN = ['left', 'center'];

/** Fallback when a group declares no `defaultAlign`. */
const DEFAULT_GROUP_ALIGN = 'left';

/** Fallback root-class prefix when a group declares no `alignClass`. */
const DEFAULT_ALIGN_CLASS = 'is-align';

/**
 * Declare an alignment group, its content field and its layout tiles in one
 * go — the three always travel together, and a type that hand-rolled them
 * could silently let the enum options drift from the group's offered values
 * (which `tests/field-groups.test.js` asserts against).
 *
 * Returns the three pieces a type spreads into its definition:
 *
 *   const G = alignGroup('title-block', 'titleBlockAlign');
 *   export default {
 *     fieldGroups: [G.group],
 *     fields: [ { key: 'title', group: G.group.id, ... }, G.field ],
 *     layoutVariants: G.variants,
 *   };
 *
 * @param {string} id - group id, referenced by each member field's `group`
 * @param {string} alignKey - content field that stores the block's alignment
 * @param {Object} [opts]
 * @param {string} [opts.label] - admin label for the enum field
 * @param {string[]} [opts.align] - offered values (default left/centre)
 * @param {string} [opts.alignClass] - root-class prefix (default `is-align`)
 * @param {string} [opts.schematicKind] - archetype the layout tiles draw
 * @returns {{group: Object, field: Object, variants: Array<Object>}}
 */
export function alignGroup(id, alignKey, opts = {}) {
  const align =
    Array.isArray(opts.align) && opts.align.length
      ? opts.align
      : [...DEFAULT_BLOCK_ALIGN];
  const group = {
    id,
    alignKey,
    align,
    defaultAlign: align[0],
    alignClass: opts.alignClass || DEFAULT_ALIGN_CLASS,
  };
  // One tile per offered value. Deliberately NOT an inspector keep (see
  // inspector-form.js): the toolbar "Layout" chip is the block's only control,
  // the convention the structural `layout` enums already follow. The bulk-edit
  // modal does render the enum, so the two surfaces read their copy from the
  // same `editor.layoutVariant.block*` key — one text, one key, no per-type
  // mint of the raw `left`/`center` token (B145).
  const TILE = {
    left: {
      id: 'block-left',
      labelKey: 'editor.layoutVariant.blockLeft',
      label: 'Left',
    },
    center: {
      id: 'block-center',
      labelKey: 'editor.layoutVariant.blockCenter',
      label: 'Centred',
    },
    right: {
      id: 'block-right',
      labelKey: 'editor.layoutVariant.blockRight',
      label: 'Right',
    },
  };
  const field = {
    key: alignKey,
    label: opts.label || 'Block alignment',
    type: 'enum',
    required: false,
    options: align.map((value) =>
      TILE[value]
        ? { value, label: TILE[value].label, labelKey: TILE[value].labelKey }
        : value,
    ),
  };
  const variants = align.map((value) => ({
    ...TILE[value],
    set: { [alignKey]: value },
    schematic: { kind: opts.schematicKind || 'title', align: value },
  }));
  return { group, field, variants };
}

/**
 * The groups a slide type declares, or [] when it declares none.
 * @param {Object} def - slide-type definition (SLIDE_TYPES[type])
 * @returns {Array<Object>}
 */
export function getFieldGroups(def) {
  return Array.isArray(def?.fieldGroups) ? def.fieldGroups : [];
}

/**
 * One declared group by id, or null.
 * @param {Object} def
 * @param {string} groupId
 * @returns {Object|null}
 */
export function getFieldGroup(def, groupId) {
  if (!groupId) return null;
  return getFieldGroups(def).find((g) => g && g.id === groupId) || null;
}

/**
 * The group id a field key belongs to, or null when it stands on its own.
 * @param {Array<Object>} fields - a slide type's `fields` array
 * @param {string} key - the field key from `data-inline-field`
 * @returns {string|null}
 */
export function fieldGroupId(fields, key) {
  const field = resolveFieldDef(fields, key);
  const group =
    field && typeof field.group === 'string' ? field.group.trim() : '';
  return group || null;
}

/**
 * The alignment values a group offers, defaulting to the full vocabulary.
 * Junk and unknown values are dropped rather than trusted, so a fork cannot
 * declare an option the CSS has no rule for.
 *
 * Takes the GROUP object, not (def, id): a slide type's renderHtml only gets
 * `(content, slide, ctx)`, so it holds its own group constant and would have
 * to fabricate a fake definition to call a def-shaped API. Callers that start
 * from a definition go through `getFieldGroup(def, id)` first.
 *
 * @param {Object} group - one entry of a type's `fieldGroups`
 * @returns {string[]}
 */
export function groupAlignValues(group) {
  if (!group) return [];
  const declared = Array.isArray(group.align) ? group.align : null;
  if (!declared) return [...GROUP_ALIGN_VALUES];
  const clean = declared.filter((v) => GROUP_ALIGN_VALUES.includes(v));
  return clean.length ? clean : [...GROUP_ALIGN_VALUES];
}

/**
 * The value a group falls back to: its declared default when that is on offer,
 * else the first offered value.
 * @param {Object} group
 * @returns {string}
 */
function groupDefaultAlign(group) {
  const values = groupAlignValues(group);
  if (!values.length) return DEFAULT_GROUP_ALIGN;
  return values.includes(group?.defaultAlign) ? group.defaultAlign : values[0];
}

/**
 * A group's effective alignment for a slide's content: the stored value when
 * it is one the group offers, else the group's default. Total — never throws,
 * always returns a value from the offered set.
 * @param {Object} group
 * @param {Object} content - slide content
 * @returns {string}
 */
export function resolveGroupAlign(group, content) {
  if (!group) return DEFAULT_GROUP_ALIGN;
  const values = groupAlignValues(group);
  const key = typeof group.alignKey === 'string' ? group.alignKey : '';
  const stored = key ? content?.[key] : null;
  return values.includes(stored) ? stored : groupDefaultAlign(group);
}

/**
 * The root class a group's alignment contributes, or '' for the default value
 * (so an untouched slide's markup is byte-identical to before this model).
 * @param {Object} group
 * @param {Object} content
 * @returns {string}
 */
export function groupAlignClass(group, content) {
  if (!group) return '';
  const value = resolveGroupAlign(group, content);
  if (value === groupDefaultAlign(group)) return '';
  const prefix =
    typeof group.alignClass === 'string' && group.alignClass.trim()
      ? group.alignClass.trim()
      : DEFAULT_ALIGN_CLASS;
  return `${prefix}-${value}`;
}

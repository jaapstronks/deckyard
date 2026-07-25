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

/** Fallback when a group declares no `defaultAlign`. */
const DEFAULT_GROUP_ALIGN = 'left';

/** Fallback root-class prefix when a group declares no `alignClass`. */
const DEFAULT_ALIGN_CLASS = 'is-align';

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
  const group = field && typeof field.group === 'string' ? field.group.trim() : '';
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

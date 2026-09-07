/**
 * The rules a `fields[]` array must follow — one walk, both surfaces.
 *
 * A slide type declares its shape as `fields[]` (and, one level down,
 * `itemFields[]`). Two surfaces used to check that array, and they had drifted:
 *
 * - `custom-field-definitions.js` checks the portable `fields[]` a **database**
 *   type carries, so the Settings > Slide Types builder can refuse a Save and
 *   point at the offending row;
 * - `validate-definition.js` checks the `fields[]` of a **file-JS** type at
 *   boot, so a fork learns about a typo'd `type` in the log instead of in front
 *   of an audience.
 *
 * Same structure rules, two implementations. The measured differences were not
 * design: the DB walk accepted an `enum` whose `options` normalize to nothing
 * while the boot walk refused it; the boot walk accepted an `items` field with
 * an empty `itemFields` array while the DB walk refused it; the boot walk
 * stopped one level down, so `text-blocks-slide`'s `rows[].blocks[]` sub-fields
 * were never checked at all. This module is the single walk both now run.
 *
 * ## What legitimately differs, and how it is expressed
 *
 * Four things, all in the {@link FieldProfile} the caller passes:
 *
 * - **`fieldTypes`** — a DB type is authored through a form and may use only
 *   the six types that form has a control for; a file-JS type may use the whole
 *   `FIELD_TYPES` registry.
 * - **`maxFields`** — a DB definition is a stored row edited in a form, so it
 *   is bounded; hand-written source is not (`text-blocks-slide` declares 61).
 * - **`labelSeverity`** — the inspector falls back to `field.key` when a label
 *   is missing, so the type still renders and a file-JS type only *degrades*.
 *   For a DB type the label is the one human name the builder writes, and its
 *   form requires it, so a definition without one is refused.
 * - **`globalFieldKeys`** — the keys the registry injects into every type. Known
 *   only to the file-JS side (`registry.js` reaches this module mid-evaluation,
 *   so it is passed in rather than imported).
 *
 * ## One finding shape, two ways of naming a place
 *
 * Every finding carries both coordinates *and* both renderings of where it
 * sits: `path` (`fields[2].itemFields[0]`) for a developer reading a boot log,
 * and `name` (`"Rows" › "Kind"`) for a person reading an inline error beside
 * the row they are editing. The audience differs, the finding does not — so
 * neither surface needs a rule of its own to decide what went wrong.
 *
 * The two callers read the same findings differently, which is the whole point:
 * the DB side takes the first `error` and shows it beside one control; the boot
 * side renders all of them, errors and warnings, into the log.
 *
 * @see docs/developer/slide-types.md
 * @module shared/slide-types/field-definitions
 */

import { enumOptionValues } from './field-types.js';

/**
 * @typedef {object} FieldProfile
 * @property {string[]} fieldTypes - The `type` values this surface accepts.
 * @property {number|null} [maxFields] - Upper bound on the length of `fields[]`
 *   and of each `itemFields[]`, or null for no bound.
 * @property {'error'|'warning'} [labelSeverity] - How loud a missing `label`
 *   is. Defaults to `warning`.
 * @property {string[]} [globalFieldKeys] - Keys the registry injects into every
 *   type: they are valid `mediaRef.linkKey` targets, and a field that reuses
 *   one shadows it.
 */

/**
 * @typedef {object} FieldFinding
 * @property {string} code - Machine code; see {@link describeFieldFinding}.
 * @property {'error'|'warning'} severity
 * @property {string} path - Structural location, e.g. `fields[2].itemFields[0]`
 *   or `fields[2].itemFields` for a finding about a list rather than a field.
 * @property {string} name - Human location, e.g. `"Rows" › "Kind"`.
 * @property {number|null} index - Index in the top-level `fields[]`, or null
 *   for a finding about that array itself.
 * @property {number|null} itemIndex - Index within that field's `itemFields[]`
 *   when the finding is nested, else null. Levels below the second saturate
 *   here: only the builder reads these coordinates, and it renders two.
 * @property {string} key - The field's key, or `''` when it has none.
 * @property {object} [detail] - Code-specific data the message interpolates.
 */

/** True for a string with at least one non-space character. */
function isNonEmpty(v) {
  return typeof v === 'string' && v.trim() !== '';
}

/** True for a non-array object. */
function isPlainObject(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Name a field the way the person authoring it would: its label, else its key,
 * else its position.
 * @param {unknown} field
 * @param {number} index
 * @returns {string}
 */
function fieldName(field, index) {
  const label = typeof field?.label === 'string' ? field.label.trim() : '';
  if (label) return `"${label}"`;
  const key = typeof field?.key === 'string' ? field.key.trim() : '';
  if (key) return `"${key}"`;
  return `field ${index + 1}`;
}

/**
 * The sub-field keys of an `items` field that could serve as an item heading:
 * the readable strings. Mirrors what `renderItemBlock` in semantic-projection
 * will actually pick from, so an `itemLabelField` naming anything else is a
 * declaration that cannot be honoured.
 * @param {unknown[]} itemFields
 * @returns {Set<string>}
 */
function headableKeys(itemFields) {
  return new Set(
    (Array.isArray(itemFields) ? itemFields : [])
      .filter(
        (sub) => sub?.type === 'string' && !sub.hidden && !sub.presentational,
      )
      .map((sub) => sub.key)
      .filter(isNonEmpty),
  );
}

/**
 * Walk a `fields[]` array and report everything wrong with it.
 *
 * Structure only: nothing here reads a slide's content, and nothing here
 * decides what a caller does with a finding. `itemFields[]` are walked with the
 * same rules at every depth, so a nested repeater is checked like a top-level
 * one.
 *
 * @param {unknown} fields - The array to check.
 * @param {FieldProfile} profile
 * @returns {{findings: FieldFinding[], keys: string[]}} the findings in the
 *   order they were met, and the top-level keys the array declares (whatever
 *   their type), for a caller that has cross-field checks of its own.
 */
export function walkFieldDefinitions(fields, profile) {
  const fieldTypes = Array.isArray(profile?.fieldTypes)
    ? profile.fieldTypes
    : [];
  const maxFields =
    typeof profile?.maxFields === 'number' ? profile.maxFields : null;
  const labelSeverity =
    profile?.labelSeverity === 'error' ? 'error' : 'warning';
  const globalFieldKeys = new Set(
    Array.isArray(profile?.globalFieldKeys) ? profile.globalFieldKeys : [],
  );

  const findings = [];
  const topKeys = [];

  /**
   * @param {unknown} list - the array at this level
   * @param {object} at - `{path, name, index, itemIndex, depth}` of this level
   */
  const walkLevel = (list, at) => {
    const add = (code, severity, where, detail) => {
      findings.push({
        code,
        severity,
        path: where.path,
        name: where.name,
        index: where.index,
        itemIndex: where.itemIndex,
        key: where.key ?? '',
        ...(detail ? { detail } : {}),
      });
    };

    if (!Array.isArray(list)) {
      add('not_an_array', 'error', {
        path: at.path,
        name: at.name ? `${at.name} › the field list` : 'the field list',
        index: at.index,
        itemIndex: at.itemIndex,
      });
      return [];
    }
    if (maxFields !== null && list.length > maxFields) {
      add(
        'too_many',
        'error',
        {
          path: at.path,
          name: at.name ? `${at.name} › the field list` : 'the field list',
          index: at.index,
          itemIndex: at.itemIndex,
        },
        { max: maxFields },
      );
    }

    const keys = new Set();
    // Fields whose `mediaRef.linkKey` names a sibling: checked once this level
    // is fully known, since a declaration may point forwards.
    const linkRefs = [];

    list.forEach((field, i) => {
      const name = fieldName(field, i);
      const where = {
        path: `${at.path}[${i}]`,
        name: at.name ? `${at.name} › ${name}` : name,
        // Only the first two levels have coordinates the builder can render;
        // deeper ones report the row that contains them.
        index: at.depth === 0 ? i : at.index,
        itemIndex: at.depth === 0 ? null : at.depth === 1 ? i : at.itemIndex,
        key: isNonEmpty(field?.key) ? field.key.trim() : '',
      };
      const at2 = (code, severity, detail) =>
        add(code, severity, where, detail);

      if (!isPlainObject(field)) {
        at2('not_an_object', 'error');
        return;
      }

      const key = where.key;
      if (!key) {
        at2('missing_key', 'error');
      } else {
        if (keys.has(key)) at2('duplicate_key', 'error');
        keys.add(key);
        if (at.depth === 0) {
          topKeys.push(key);
          if (globalFieldKeys.has(key))
            at2('shadows_global', 'warning', { key });
        }
      }

      if (!isNonEmpty(field.label)) at2('missing_label', labelSeverity);

      const type = typeof field.type === 'string' ? field.type.trim() : '';
      if (!type) {
        at2('missing_type', 'error');
        return;
      }
      if (!fieldTypes.includes(type)) {
        at2('unknown_type', 'error', { type: field.type, offered: fieldTypes });
        return;
      }

      if (type === 'enum') {
        if (enumOptionValues(field).length === 0) {
          at2('enum_without_options', 'error');
        }
      }

      if (type === 'items') {
        if (!Array.isArray(field.itemFields) || field.itemFields.length === 0) {
          at2('items_without_item_fields', 'error');
        } else {
          walkLevel(field.itemFields, {
            path: `${where.path}.itemFields`,
            name: where.name,
            index: where.index,
            itemIndex: where.itemIndex,
            depth: at.depth + 1,
          });
        }
        if (
          field.itemLabelField !== undefined &&
          field.itemLabelField !== null
        ) {
          const headable = headableKeys(field.itemFields);
          if (
            !isNonEmpty(field.itemLabelField) ||
            !headable.has(field.itemLabelField)
          ) {
            at2('item_label_field_unknown', 'warning', {
              declared: field.itemLabelField,
              headable: [...headable],
            });
          }
        }
      }

      if (field.mediaRef !== undefined && field.mediaRef !== null) {
        if (!isPlainObject(field.mediaRef)) {
          at2('media_ref_not_an_object', 'warning');
        } else {
          if (type !== 'string')
            at2('media_ref_wrong_type', 'warning', { type });
          if (!isNonEmpty(field.mediaRef.label)) {
            at2('media_ref_without_label', 'warning');
          }
          const linkKey = field.mediaRef.linkKey;
          if (linkKey !== undefined && linkKey !== null) {
            linkRefs.push({ where, linkKey });
          }
        }
      }

      if (
        field.foldUnofferedTo !== undefined &&
        field.foldUnofferedTo !== null
      ) {
        if (type !== 'enum') {
          at2('fold_target_not_enum', 'warning', { type });
        } else {
          const offered = enumOptionValues(field);
          if (
            !isNonEmpty(field.foldUnofferedTo) ||
            !offered.includes(field.foldUnofferedTo)
          ) {
            at2('fold_target_not_offered', 'warning', {
              declared: field.foldUnofferedTo,
              offered,
            });
          }
        }
      }
    });

    // A `linkKey` names a field beside the one that declares it — a sibling at
    // this level, or (at the top) one of the keys the registry injects.
    const reachable =
      at.depth === 0 ? new Set([...keys, ...globalFieldKeys]) : keys;
    for (const { where, linkKey } of linkRefs) {
      if (!isNonEmpty(linkKey) || !reachable.has(linkKey)) {
        add('media_ref_link_key_unknown', 'warning', where, {
          declared: linkKey,
        });
      }
    }

    return [...keys];
  };

  walkLevel(fields, {
    path: 'fields',
    name: '',
    index: null,
    itemIndex: null,
    depth: 0,
  });

  return { findings, keys: topKeys };
}

/**
 * The English sentence for each code: `(where, finding) => string`. `where` is
 * supplied by the caller, because how a place is named is the audience's; the
 * sentence is not. A template may read the finding's `severity` where the two
 * surfaces genuinely draw a different consequence from the same fact.
 */
const FINDING_MESSAGES = {
  not_an_array: (where) => `${where} must be an array.`,
  too_many: (where, f) => `${where} may hold at most ${f?.detail?.max} fields.`,
  not_an_object: (where) => `${where} is not a field definition.`,
  missing_key: (where) => `${where} has no key.`,
  missing_label: (where, f) =>
    f?.severity === 'error'
      ? `${where} has no label.`
      : `${where} has no label, so the inspector shows its bare key instead.`,
  missing_type: (where) => `${where} has no type.`,
  unknown_type: (where, f) =>
    `${where} has type ${JSON.stringify(f?.detail?.type)} — the field types ` +
    `accepted here are: ${(f?.detail?.offered || []).join(', ')}.`,
  duplicate_key: (where) => `${where} reuses a key another field already has.`,
  shadows_global: (where, f) =>
    `${where} shadows the global slide field \`${f?.detail?.key}\`, so this ` +
    `type does not get the injected one — rename it unless the override is ` +
    `deliberate.`,
  enum_without_options: (where) =>
    `${where} is an enum with no usable options — add at least one, as a ` +
    `string or as \`{ value, label }\`.`,
  items_without_item_fields: (where) =>
    `${where} is an items field with no \`itemFields\` — add at least one, so ` +
    `something describes the shape of an item.`,
  item_label_field_unknown: (where, f) =>
    `${where} declares \`itemLabelField\` ` +
    `${JSON.stringify(f?.detail?.declared)}, which is not a readable string ` +
    `sub-field of this item (${(f?.detail?.headable || []).join(', ') || 'none'}), ` +
    `so it is ignored and the item heading falls back to the first readable ` +
    `string.`,
  media_ref_not_an_object: (where) =>
    `${where} declares \`mediaRef\` as something other than an object ` +
    `(\`{ label, linkKey }\`), so it is ignored and the field projects as ` +
    `plain text.`,
  media_ref_wrong_type: (where, f) =>
    `${where} declares \`mediaRef\` on a \`${f?.detail?.type}\` field, but a ` +
    `media reference is a string — the stand-in replaces whatever that type ` +
    `would otherwise project.`,
  media_ref_without_label: (where) =>
    `${where} has no \`mediaRef.label\`, so the reader names the stand-in ` +
    `"Media" instead of what this field actually references.`,
  media_ref_link_key_unknown: (where, f) =>
    `${where} declares \`mediaRef.linkKey\` ` +
    `${JSON.stringify(f?.detail?.declared)}, which does not name a field ` +
    `beside it, so the stand-in falls back to linking the reference itself.`,
  fold_target_not_enum: (where, f) =>
    `${where} declares \`foldUnofferedTo\` on a \`${f?.detail?.type}\` ` +
    `field, but only an \`enum\` has options a stored value can fall outside ` +
    `of, so it is ignored.`,
  fold_target_not_offered: (where, f) =>
    `${where} declares \`foldUnofferedTo\` ` +
    `${JSON.stringify(f?.detail?.declared)}, which is not one of its own ` +
    `options (${(f?.detail?.offered || []).join(', ') || 'none'}), so it would ` +
    `fold one unoffered value into another — the fold is skipped and stored ` +
    `values are kept as they are.`,
};

/**
 * The English sentence for a finding. One table for both surfaces: the boot log
 * prints it, and the API answers with it. The builder maps `code` to translated
 * copy and falls back to this, so the two never disagree about what went wrong.
 *
 * @param {FieldFinding|null|undefined} finding
 * @param {string} [where] - How to name the place. Defaults to the finding's
 *   human `name`; pass `finding.path` (prefixed with the type name) for a log.
 * @returns {string}
 */
export function describeFieldFinding(finding, where) {
  const write = FINDING_MESSAGES[finding?.code];
  if (!write) return 'Invalid field definitions.';
  if (where) return write(where, finding);
  // The human name may open in lower case (`the field list`, `field 3`); the
  // sentence it starts is still a sentence.
  const sentence = write(finding?.name || 'a field', finding);
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

/** Every code {@link describeFieldFinding} knows a sentence for. */
export const FIELD_FINDING_CODES = Object.freeze(Object.keys(FINDING_MESSAGES));

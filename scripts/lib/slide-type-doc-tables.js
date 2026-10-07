/**
 * The per-type editing-surface tables, derived from the registry.
 *
 * WHY THIS EXISTS
 * Two reference docs carried a hand-maintained row per slide type:
 * `docs/reference/editor-inspector.md` (which surface homes each field) and
 * `docs/reference/wysiwyg-inline-editing.md` (what the canvas offers). Both were
 * written by walking the schema and the descriptors once, by hand, and both had
 * drifted: the inspector audit still listed `cardCount` for card-stack and
 * `imageFit`/`focusX/Y` for image-text (none of them keep-list keys any more),
 * and neither table knew about `titleBlockAlign` or `headerAlign`. A table that
 * restates a declaration is the same maintenance debt as the type counts that
 * `generate-slide-type-docs.js` already removed from prose — so both tables are
 * derived here and regenerated into marker regions in those docs.
 *
 * WHAT IS DERIVED AND WHAT IS NOT
 * Every cell is a projection of three declarations: the type's `fields[]`
 * schema, its inline-edit descriptor, and its `inspectorKeeps` list. The
 * *rationale* for a keep-list is not in these tables — it lives as JSDoc next to
 * the declaration in `shared/slide-types/types/<name>/inline-edit.js`, which is
 * where someone changing the list reads it. A per-row "Notes" column would be
 * that rationale's second, hand-kept copy, which is what this replaces.
 *
 * FORK-STABLE BY CONSTRUCTION
 * Schemas come from `CORE_SLIDE_TYPE_DEFS`, not `SLIDE_TYPES`, and the companion
 * maps are core-only aggregators. A fork's own types are absent and a fork that
 * overrides a core name does not change the output, so the byte-gate in
 * `tests/slide-type-docs.test.js` stays green on a fork checkout.
 */

import {
  CORE_SLIDE_TYPE_DEFS,
  CORE_SLIDE_TYPE_NAMES,
} from '../../shared/slide-types/registry.js';
import {
  SLIDE_TYPE_ELEMENT_TAB,
  SLIDE_TYPE_INLINE_EDIT,
  SLIDE_TYPE_INSPECTOR_KEEPS,
} from '../../shared/slide-types/inline-edit.js';
import {
  bulkOnlyFields,
  familyPattern,
} from '../../shared/slide-types/field-homes.js';
import { textStyleOffers } from '../../shared/slide-types/text-styles.js';

const NONE = '–';

/**
 * Collapse numbered key families to one entry, preserving order.
 *
 * `col1Title, col1Text, col2Title, col2Text` → `col{n}Title, col{n}Text`. A key
 * whose pattern has no sibling is left verbatim, so a lone key that merely
 * contains a digit (`a11yTitle`, `bunnyLibraryId`) is never disguised as a
 * family — the collapse has to earn itself with a second member.
 *
 * @param {string[]} keys
 * @returns {string[]}
 */
export function condenseKeys(keys) {
  const counts = new Map();
  for (const key of keys) {
    const p = familyPattern(key);
    counts.set(p, (counts.get(p) || 0) + 1);
  }
  const out = [];
  const seen = new Set();
  for (const key of keys) {
    const p = familyPattern(key);
    const label = counts.get(p) > 1 ? p : key;
    if (seen.has(label)) continue;
    seen.add(label);
    out.push(label);
  }
  return out;
}

/** Render a key list as inline code, or the em-less dash when empty. */
function codeList(keys) {
  const condensed = condenseKeys(keys);
  return condensed.length ? condensed.map((k) => `\`${k}\``).join(', ') : NONE;
}

/**
 * Every markdown-typed key a type owns, including nested item subfields, as the
 * dotted paths the inline layer uses (`rows.blocks.body`).
 * @param {Object} def
 * @returns {string[]}
 */
function markdownFieldKeys(def) {
  const out = [];
  const walk = (fields, prefix) => {
    for (const f of fields || []) {
      if (!f || f.hidden) continue;
      const path = prefix ? `${prefix}.${f.key}` : String(f.key);
      if (f.type === 'markdown') out.push(path);
      if (Array.isArray(f.itemFields)) walk(f.itemFields, path);
    }
  };
  walk(def?.fields, '');
  return out;
}

/**
 * One row's worth of facts about a type's editing surfaces.
 *
 * `bulkOnly` and `itemBulkOnly` are the interesting derivations: the fields
 * whose only home is the bulk "Edit all text" modal. They are computed by
 * `bulkOnlyFields()` in `shared/slide-types/field-homes.js`, which the
 * definition validator also asks about a fork type (B600); here it gets core's
 * aggregator entries.
 *
 * @param {string} type
 * @returns {{type: string, def: Object, descriptor: Object|null, keeps: string[]|null,
 *   formText: string[], bulkOnly: string[], itemBulkOnly: string[],
 *   markdown: string[]}}
 */
export function coverageFor(type) {
  const def = CORE_SLIDE_TYPE_DEFS[type] || {};
  const descriptor = SLIDE_TYPE_INLINE_EDIT[type] || null;
  const keeps = SLIDE_TYPE_INSPECTOR_KEEPS[type] || null;
  const tab = SLIDE_TYPE_ELEMENT_TAB[type] || null;
  return {
    type,
    def,
    descriptor,
    keeps,
    formText: Array.isArray(descriptor?.formText) ? descriptor.formText : [],
    ...bulkOnlyFields(def, { descriptor, keeps, tab }),
    markdown: markdownFieldKeys(def),
  };
}

/** @returns {ReturnType<typeof coverageFor>[]} one entry per core type, in registration order */
export function coverageRows() {
  return CORE_SLIDE_TYPE_NAMES.map(coverageFor);
}

/**
 * The ghost chips a type offers: slide-level fields plus per-item subfields,
 * the latter as `list.field` so the two are distinguishable in one column.
 * @param {Object|null} d - inline descriptor
 * @returns {string[]}
 */
function ghostKeys(d) {
  return [
    ...(d?.ghosts || []).map((g) => String(g.field)),
    ...(d?.itemGhosts || []).map((g) => `${g.list}.${g.field}`),
  ];
}

/**
 * The cards cell: which array the add/remove/reorder affordances write to, plus
 * the qualifiers that change what a reader can expect — a nested second level, a
 * fixed-size collection (no add/remove renders when `minItems === maxItems`),
 * and the dual-model guard that keeps affordances off a deck still using
 * numbered fields.
 *
 * @param {Object|null} d - inline descriptor
 * @param {Object} def - composed slide-type definition
 * @returns {string}
 */
function cardsCell(d, def) {
  const cards = d?.cards;
  if (!cards) return NONE;
  const field = String(cards.field);
  const notes = [];
  if (cards.child?.field) notes.push(`two-level → \`${cards.child.field}\``);
  const schema = (def?.fields || []).find((f) => f.key === field);
  if (
    schema &&
    schema.minItems != null &&
    schema.minItems === schema.maxItems
  ) {
    notes.push(`fixed ${schema.minItems}`);
  }
  if (cards.reorder === false) notes.push('no reorder');
  return `\`${field}\`${notes.length ? ` (${notes.join('; ')})` : ''}`;
}

/**
 * The media/other cell: the non-text affordances the canvas layer adds.
 * @param {Object|null} d - inline descriptor
 * @returns {string}
 */
function mediaCell(d) {
  if (!d) return NONE;
  const parts = [];
  if (d.media)
    parts.push(
      d.media.list ? `media \`${d.media.list}[]\`` : 'media (flat keys)',
    );
  if (d.icons) parts.push('icons');
  if (d.focus) parts.push('focus drag');
  if (d.fit) parts.push('fit toggle');
  if (d.ensure) parts.push('ensure (legacy → array)');
  for (const [kind, cfg] of Object.entries(d.convert || {})) {
    const verb = kind === 'addMedia' ? '+image' : '−image';
    parts.push(`convert ${verb} → \`${cfg.toType}\``);
  }
  return parts.length ? parts.join('; ') : NONE;
}

/**
 * A type's text-style offers as table entries: the field a reader recognises
 * (`quotes[].quote`, a set by its members) and what it offers at which scope.
 * Derived from the same `textStyleOffers()` the renderer, the inspector and
 * the write path read, so the docs cannot list an offer the type does not
 * make (B464).
 * @param {Object} def
 * @returns {{field: string, props: string[], scope: string}[]}
 */
function textStyleOfferEntries(def) {
  return [...textStyleOffers(def).values()].map((o) => ({
    field:
      o.scope === 'set'
        ? o.members.map((m) => `\`${m}\``).join(' + ')
        : `\`${o.key.replaceAll('.*.', '[].')}\``,
    props: o.props,
    scope: { field: 'this field', items: 'every item', set: 'the set' }[
      o.scope
    ],
  }));
}

/** The text-style cell of the coverage table. */
function textStyleCell(def) {
  const entries = textStyleOfferEntries(def);
  return entries.length
    ? entries
        .map(
          (e) =>
            `${e.field}: ${e.props.join(', ')}${e.scope === 'this field' ? '' : ` (${e.scope})`}`,
        )
        .join('; ')
    : NONE;
}

/** Markdown table rows share this shape; keeps the two renderers honest. */
function table(header, rows) {
  return [
    `| ${header.join(' | ')} |`,
    `|${header.map(() => '---').join('|')}|`,
    ...rows,
  ];
}

/**
 * The per-type coverage audit for `docs/reference/editor-inspector.md`: where
 * each field of each type is edited.
 * @returns {string}
 */
export function renderCoverageTable() {
  const rows = coverageRows().map((r) => {
    const keeps =
      r.keeps === null
        ? '*(no declaration — conservative fallback)*'
        : codeList(r.keeps);
    const onlyHome = codeList([...r.bulkOnly, ...r.itemBulkOnly]);
    return `| \`${r.type}\` | ${codeList(r.formText)} | ${onlyHome} | ${keeps} | ${textStyleCell(r.def)} |`;
  });
  return table(
    [
      'Type',
      'Canvas (wysiwyg)',
      'Bulk modal (only home)',
      'Inspector keeps',
      'Text style offer',
    ],
    rows,
  ).join('\n');
}

/**
 * The canvas-affordance table for `docs/reference/wysiwyg-inline-editing.md`:
 * what the inline layer offers per type.
 * @returns {string}
 */
export function renderCanvasTable() {
  const rows = coverageRows().map((r) => {
    const cells = r.descriptor
      ? [
          codeList(r.formText),
          codeList(ghostKeys(r.descriptor)),
          cardsCell(r.descriptor, r.def),
          codeList(r.markdown),
          mediaCell(r.descriptor),
        ]
      : ['*no descriptor*', NONE, NONE, codeList(r.markdown), NONE];
    return `| \`${r.type}\` | ${cells.join(' | ')} |`;
  });
  return table(
    ['Type', 'Inline text', 'Ghosts', 'Cards', 'Markdown', 'Media / other'],
    rows,
  ).join('\n');
}

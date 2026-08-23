/**
 * Semantic projection of a slide's content.
 *
 * This is the "reflowable document" view of the model: a separate projection
 * that turns a slide's content into accessible, JS-optional HTML (headings,
 * paragraphs, lists, figures, tables) instead of the fixed 1600x900 canvas the
 * presenter renders. It is driven by the declared field vocabulary
 * (field-types.js) rather than per-type render code, so every slide type — core
 * or custom — projects without bespoke handling and the projection can't drift
 * from the type definitions.
 *
 * The canvas view remains the presentation surface; this is the portable,
 * readable one (WCAG 1.4.10 reflow, real heading hierarchy, landmarks — the
 * document shell is added by the server wrapper in server/export/reader.js).
 *
 * ## This module is the reference reader
 *
 * `SLIDE_STRUCTURE_CONTRACTS` (structure.js) publishes, per `structure`, what a
 * reader that does not know the *type* may rely on — the normative half of the
 * conformance claim in `docs/reference/deck-conformance.md`. This projection is
 * the only reader we ship, so it is that contract's worked example and must
 * obey it: `tabular` becomes a real `<table>` (rows are the item array, columns
 * are the item keys), `dataset` decodes its payload to rows and names the
 * encoding it drops. It used to project both as bullet lists, which is the
 * cheapest possible way to make a published contract untrue.
 *
 * Two consequences worth stating:
 *  - **No per-type branch.** Everything the table/caption projection needs is
 *    declared on the field (`columnCountKey`, `headerRowKey`, `captionKey`,
 *    `encodingKeys`) and therefore travels through `/api/slide-types` to any
 *    other reader. A `if (type === 'table-slide')` here would be a rule only we
 *    can follow.
 *  - **`visibleWhen` is honoured.** A field the type itself declares inactive
 *    (a bar chart's legend labels, a pie chart's axis names) is not part of the
 *    slide's meaning; the editor and the canvas already skip it, and a third
 *    surface that disagreed was how dead values reached the reader as prose.
 */

import { markdownToSafeHtml } from '../markdown.js';
import { escapeHtml, pickAltText, normalizeUrl, safeHref } from './helpers.js';
import { slideStructure } from './structure.js';
import { isFieldVisible } from './field-visibility.js';

// Content keys that are presentation config, not readable content: the global
// per-slide background/logo/a11y-override fields. The a11y fields are surfaced
// deliberately (see below); the rest carry no document text.
const NON_CONTENT_GLOBAL_KEYS = new Set([
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

// Field types that hold no readable document content (they configure layout,
// colour, sizing — the theme/canvas owns their meaning).
const PRESENTATIONAL_FIELD_TYPES = new Set([
  'enum',
  'color',
  'number',
  'boolean',
]);

// Ordered fallback of common "title" content keys, mirroring the notes/label
// resolvers, used when a type has no explicit labelField.
const TITLE_CANDIDATE_KEYS = [
  'title',
  'heading',
  'subheading',
  'question',
  'prompt',
  'statement',
  'quote',
];

function str(v) {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * The heading text for a slide's <section>, plus which content key it came
 * from (so the body projection can avoid repeating it).
 *
 * Order: an explicit a11yTitle override, then the type's labelField, then the
 * common title candidates, then the type label / bare type as a last resort.
 *
 * @param {object} slide
 * @param {object} def - the resolved slide-type definition
 * @param {number} [index] - 0-based slide index, for the final fallback
 * @returns {{ text: string, key: string|null }}
 */
export function slideHeading(slide, def, index = 0) {
  const content =
    slide?.content && typeof slide.content === 'object' ? slide.content : {};
  const a11y = str(content.a11yTitle);
  if (a11y) return { text: a11y, key: null };

  const labelField = str(def?.labelField);
  if (labelField && str(content[labelField])) {
    return { text: str(content[labelField]), key: labelField };
  }
  for (const key of TITLE_CANDIDATE_KEYS) {
    if (str(content[key])) return { text: str(content[key]), key };
  }
  const label = str(def?.label);
  return { text: label || str(slide?.type) || `Slide ${index + 1}`, key: null };
}

/** Render one image as a <figure> with a resolved alt + optional caption. */
function renderFigure(src, { alt, decorative, caption }) {
  const url = normalizeUrl(src);
  if (!url) return '';
  const altAttr = decorative ? '' : escapeHtml(alt || '');
  const ariaHidden = decorative ? ' aria-hidden="true"' : '';
  const fig = caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : '';
  return `<figure class="reader-figure"><img src="${escapeHtml(url)}" alt="${altAttr}"${ariaHidden} loading="lazy" />${fig}</figure>`;
}

/**
 * Content keys an `image` field folds into its <figure> (alt/caption/role), so
 * they are not also rendered as standalone paragraphs.
 * @param {string} fieldKey
 * @returns {string[]}
 */
function imageSiblingKeys(fieldKey) {
  return [
    `${fieldKey}Alt`,
    'alt',
    `${fieldKey}Caption`,
    'caption',
    `${fieldKey}Role`,
    'imageRole',
  ];
}

/**
 * Resolve alt text / decorative state / caption for an image field, using the
 * sibling-key conventions (`alt`, `<key>Alt`, `imageRole`, `caption`).
 */
function resolveImageA11y(fieldKey, content, headingText) {
  const explicit =
    str(content[`${fieldKey}Alt`]) ||
    str(content.alt) ||
    str(content[`${fieldKey}Caption`]);
  const role = str(content[`${fieldKey}Role`]) || str(content.imageRole);
  const caption = str(content[`${fieldKey}Caption`]) || str(content.caption);
  const decorative = role === 'decorative';
  const alt = decorative
    ? ''
    : pickAltText({
        explicit,
        src: content[fieldKey],
        fallbacks: [caption, headingText],
      });
  return { alt, decorative, caption };
}

/**
 * Parse a simple CSV string into a semantic <table> (first row = header).
 * @param {string} csv
 * @param {string} [caption] - `<caption>` text; for a `dataset` payload this is
 *   the encoding the decoded rows no longer carry (see {@link encodingCaption}).
 */
function renderCsvTable(csv, caption = '') {
  const rows = String(csv || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => r.split(',').map((c) => c.trim()));
  if (!rows.length) return '';
  const [head, ...body] = rows;
  const cap = caption ? `<caption>${escapeHtml(caption)}</caption>` : '';
  const thead = `<thead><tr>${head
    .map((c) => `<th scope="col">${escapeHtml(c)}</th>`)
    .join('')}</tr></thead>`;
  const tbody = body.length
    ? `<tbody>${body
        .map(
          (r) =>
            `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`,
        )
        .join('')}</tbody>`
    : '';
  return `<table class="reader-table">${cap}${thead}${tbody}</table>`;
}

/**
 * The caption for a `dataset` payload: the sibling fields its `encodingKeys`
 * names, each as "<declared label>: <value>".
 *
 * The dataset contract tells a reader to decode the payload to rows and "lose
 * only the visual encoding" — which is only honest if the encoding is named
 * somewhere. It is built from the fields' own declared labels, so there is no
 * copy here to translate or to drift: a chart says "Chart type: bar. X label:
 * Year." because that is what its own schema calls those slots.
 *
 * Keys the type currently declares inactive (`visibleWhen`) are already gone by
 * the time this runs — a pie chart names no axes.
 *
 * @param {string[]} keys - the csv field's `encodingKeys`
 * @param {Map<string, object>} visibleByKey - visible fields, by key
 * @param {object} content
 * @returns {string}
 */
function encodingCaption(keys, visibleByKey, content) {
  const parts = [];
  for (const key of Array.isArray(keys) ? keys : []) {
    const field = visibleByKey.get(key);
    const value = str(content?.[key]);
    if (!field || !value) continue;
    const label = str(field.label) || key;
    parts.push(`${label}: ${value}`);
  }
  return parts.length ? `${parts.join('. ')}.` : '';
}

/**
 * Project a `tabular` type's row array as a real <table> — the shape its
 * structure contract promises ("read the item array as rows and each item's
 * keys as columns").
 *
 * Three optional declarations on the items field keep this free of per-type
 * knowledge, and travel to other readers through `/api/slide-types`:
 *  - `columnCountKey` — a sibling content key bounding how many of the declared
 *    `itemFields` are live columns, so cells beyond a shrunk table's width stay
 *    out of the reader exactly as they stay off the canvas.
 *  - `headerRowKey` — a sibling enum whose value `'off'` means the first row is
 *    data. Declaring the key at all means the type has a header row by default.
 *  - `captionKey` — a sibling string that becomes the `<caption>` (and is then
 *    consumed, so it does not also render as a loose paragraph).
 *
 * Without any of the three: every declared column, no header row, no caption.
 *
 * @param {object} field - the `items` field
 * @param {object} content
 * @param {object} defaults - the type's `defaults`, for unset sibling keys
 * @returns {string}
 */
function renderRowTable(field, content, defaults) {
  const rows = Array.isArray(content?.[field.key]) ? content[field.key] : [];
  if (!rows.length) return '';
  const declared = Array.isArray(field.itemFields)
    ? field.itemFields.filter((f) => f && !f.hidden)
    : [];
  if (!declared.length) return '';

  const countKey = str(field.columnCountKey);
  const rawCount = countKey
    ? Number.parseInt(str(content?.[countKey]) || str(defaults?.[countKey]), 10)
    : NaN;
  const columns = Number.isFinite(rawCount)
    ? declared.slice(0, Math.max(0, Math.min(rawCount, declared.length)))
    : declared;
  if (!columns.length) return '';

  const headerKey = str(field.headerRowKey);
  const headerValue = headerKey
    ? str(content?.[headerKey]) || str(defaults?.[headerKey]) || 'on'
    : '';
  const hasHeader = !!headerKey && headerValue !== 'off';

  const cell = (row, col, tag) => {
    const attr = tag === 'th' ? ' scope="col"' : '';
    return `<${tag}${attr}>${cellHtml(col, row)}</${tag}>`;
  };
  const bodyRows = hasHeader ? rows.slice(1) : rows;
  const thead = hasHeader
    ? `<thead><tr>${columns
        .map((col) => cell(rows[0], col, 'th'))
        .join('')}</tr></thead>`
    : '';
  const tbody = bodyRows.length
    ? `<tbody>${bodyRows
        .map(
          (row) =>
            `<tr>${columns.map((col) => cell(row, col, 'td')).join('')}</tr>`,
        )
        .join('')}</tbody>`
    : '';
  if (!thead && !tbody) return '';
  const captionText = str(content?.[str(field.captionKey)]);
  const cap = captionText
    ? `<caption>${escapeHtml(captionText)}</caption>`
    : '';
  return `<table class="reader-table">${cap}${thead}${tbody}</table>`;
}

/**
 * One table cell's inner HTML. A cell is phrasing content, so the block wrapper
 * the same field type gets elsewhere (`<p>`, `<pre>`) is wrong here: a string
 * cell is escaped text and a markdown cell keeps its inline rendering.
 * @param {{key: string, type?: string}} col
 * @param {object} row
 * @returns {string}
 */
function cellHtml(col, row) {
  const value = str(row?.[col.key]);
  if (!value) return '';
  return col.type === 'markdown'
    ? markdownToSafeHtml(value)
    : escapeHtml(value);
}

/**
 * Wrap projected item blocks in a list. A collection whose order carries
 * meaning (a sequence: timeline, process, steps) declares `ordered: true` on
 * its field and projects to an `<ol>`; a set whose order is incidental (cards,
 * columns) stays a `<ul>`. This is the count-/order-aware half of the
 * projection: the list element reflects what the type declares, never a guess.
 * @param {string[]} blocks - already-rendered `<li>` strings
 * @param {boolean} [ordered=false]
 * @returns {string}
 */
function renderItemList(blocks, ordered = false) {
  if (!blocks.length) return '';
  const tag = ordered ? 'ol' : 'ul';
  return `<${tag} class="reader-items">${blocks.join('')}</${tag}>`;
}

/**
 * Render one repeating-item (`items` field) as a small block: its first
 * non-empty string becomes an <h3>, the rest of its fields project by type.
 */
function renderItemBlock(item, itemFields) {
  if (!item || typeof item !== 'object' || !Array.isArray(itemFields))
    return '';
  const parts = [];
  let headingKey = null;
  const firstString = itemFields.find(
    (f) => f?.type === 'string' && !f.hidden && str(item[f.key]),
  );
  if (firstString) {
    headingKey = firstString.key;
    parts.push(`<h3>${escapeHtml(str(item[firstString.key]))}</h3>`);
  }
  for (const f of itemFields) {
    if (!f || f.key === headingKey || f.hidden) continue;
    parts.push(renderFieldValue(f, item, ''));
  }
  const inner = parts.filter(Boolean).join('\n');
  return inner ? `<li class="reader-item">${inner}</li>` : '';
}

/**
 * Project a single field's value to semantic HTML (no-op for empty or
 * presentational fields). `content` is the object the field lives in (slide
 * content, or one item object).
 */
function renderFieldValue(field, content, headingText) {
  if (!field || field.hidden) return '';
  if (NON_CONTENT_GLOBAL_KEYS.has(field.key)) return '';
  if (PRESENTATIONAL_FIELD_TYPES.has(field.type)) return '';

  const value = content?.[field.key];
  switch (field.type) {
    case 'string': {
      const v = str(value);
      return v ? `<p>${escapeHtml(v)}</p>` : '';
    }
    case 'markdown': {
      const v = str(value);
      return v ? markdownToSafeHtml(v) : '';
    }
    case 'code': {
      const v = str(value);
      return v
        ? `<pre class="reader-code"><code>${escapeHtml(v)}</code></pre>`
        : '';
    }
    case 'csv': {
      const v = str(value);
      return v ? renderCsvTable(v) : '';
    }
    case 'image': {
      const a11y = resolveImageA11y(field.key, content, headingText);
      return renderFigure(value, a11y);
    }
    case 'images': {
      if (!Array.isArray(value) || !value.length) return '';
      const figs = value
        .map((src, i) =>
          renderFigure(src, {
            alt: pickAltText({ src, fallbacks: [headingText] }),
            decorative: false,
            caption: '',
          }),
        )
        .filter(Boolean);
      return figs.length
        ? `<div class="reader-gallery">${figs.join('')}</div>`
        : '';
    }
    case 'items': {
      if (!Array.isArray(value) || !value.length) return '';
      // A `relationField` names a per-item key holding a typed relation to the
      // NEXT item (e.g. text-blocks' `arrow`: "down" ≈ leads-to). When any item
      // carries a relation, the collection is a causal/ordered sequence → the
      // list becomes an <ol> and each relating item gets a small relation
      // marker. `relationLabels` maps a stored value to its reader label; a
      // value without a label is treated as "no relation" (e.g. arrow "none").
      const relField =
        typeof field.relationField === 'string' ? field.relationField : null;
      const relLabels =
        field.relationLabels && typeof field.relationLabels === 'object'
          ? field.relationLabels
          : {};
      const relationOf = (item) => {
        if (!relField) return '';
        const v = str(item?.[relField]);
        return v && Object.prototype.hasOwnProperty.call(relLabels, v) ? v : '';
      };
      const hasRelations = !!relField && value.some((it) => relationOf(it));
      const blocks = value
        .map((item) => {
          const li = renderItemBlock(item, field.itemFields);
          if (!li) return '';
          const rel = relationOf(item);
          if (!rel) return li;
          const marker = `<p class="reader-relation" data-relation="${escapeHtml(
            rel,
          )}">${escapeHtml(relLabels[rel])}</p>`;
          return li.replace(/<\/li>\s*$/, `${marker}</li>`);
        })
        .filter(Boolean);
      return renderItemList(blocks, field.ordered === true || hasRelations);
    }
    case 'url': {
      const href = safeHref(value);
      if (!href) return '';
      return `<p><a href="${escapeHtml(href)}">${escapeHtml(href)}</a></p>`;
    }
    default:
      return '';
  }
}

/**
 * Does `key` name a slot field of `group` — i.e. `${prefix}${n}${suffix}` for
 * some slot number and one of the group's slot suffixes?
 * @param {{prefix:string, slotFields:string[]}} group
 * @param {string} key
 * @returns {boolean}
 */
function isRepeatingGroupSlotKey(group, key) {
  if (typeof key !== 'string' || !key.startsWith(group.prefix)) return false;
  const m = key.slice(group.prefix.length).match(/^(\d+)(.+)$/);
  return !!m && group.slotFields.includes(m[2]);
}

/**
 * Project a "flat repeating group" — a legacy family of numbered sibling fields
 * (`card1Title`, `card1Body`, `card2Title`, …) bounded by a declared count
 * field (`cardCount`) — the same way a real `items[]` field projects: one
 * grouped block per slot (a title `<h3>` + the slot's other fields), wrapped in
 * an ordered/unordered list.
 *
 * Bounded by the count, so stale content in slots beyond the count never leaks
 * into the reader (the canvas hides those slots; the projection must too), and
 * grouped per slot, so a card's title and body stay one unit instead of
 * floating apart as loose paragraphs. This is the migration bridge: once a type
 * moves its slots into a real `items[]` field, the group declaration is dropped
 * and the `items` branch already covers it.
 *
 * @param {{countKey:string, prefix:string, slotFields:string[], ordered?:boolean}} group
 * @param {object} content
 * @param {Array<{key:string,type?:string}>} fields - the type's declared fields
 * @returns {string}
 */
function projectRepeatingGroup(group, content, fields) {
  const { countKey, prefix, slotFields, ordered = false } = group;
  const fieldByKey = new Map(fields.map((f) => [f.key, f]));
  // Reuse the declared field TYPES of slot 1 so the projection stays
  // vocabulary-driven (title=string→<h3>, body=markdown→rich text, …).
  const itemFields = slotFields.map((suffix) => {
    const decl = fieldByKey.get(`${prefix}1${suffix}`);
    // Carry the declared `hidden` flag so a deprecated/hidden slot field (e.g.
    // a legacy numbered mirror field) is skipped by renderItemBlock rather than
    // surfacing in the reader.
    return { key: suffix, type: decl?.type || 'string', hidden: decl?.hidden };
  });
  // Upper bound: how many slots the schema actually declares.
  let maxSlots = 0;
  while (
    slotFields.some((s) => fieldByKey.has(`${prefix}${maxSlots + 1}${s}`))
  ) {
    maxSlots += 1;
  }
  const declared = Number.parseInt(str(content[countKey]), 10);
  const count = Number.isFinite(declared)
    ? Math.max(0, Math.min(declared, maxSlots))
    : maxSlots;
  const blocks = [];
  for (let n = 1; n <= count; n += 1) {
    const item = {};
    for (const suffix of slotFields)
      item[suffix] = content[`${prefix}${n}${suffix}`];
    const block = renderItemBlock(item, itemFields);
    if (block) blocks.push(block);
  }
  return renderItemList(blocks, ordered === true);
}

/**
 * Project a slide's readable content (everything UNDER its <section> heading)
 * to semantic HTML. The heading itself is produced by {@link slideHeading} and
 * emitted by the document wrapper.
 *
 * @param {object} slide
 * @param {object} def - the resolved slide-type definition
 * @param {{ headingKey?: string|null, headingText?: string }} [opts]
 * @returns {string} inner HTML for the slide section
 */
export function renderSlideBodySemanticHtml(
  slide,
  def,
  { headingKey = null, headingText = '' } = {},
) {
  const content =
    slide?.content && typeof slide.content === 'object' ? slide.content : {};
  const defaults =
    def?.defaults && typeof def.defaults === 'object' ? def.defaults : {};
  // A field the type declares inactive right now is not part of the slide's
  // meaning — the form and the canvas both skip it, and so does the reader.
  const fields = (Array.isArray(def?.fields) ? def.fields : []).filter((f) =>
    isFieldVisible(f, content, defaults),
  );
  const parts = [];

  const summary = str(content.a11ySummary);
  if (summary)
    parts.push(`<p class="reader-summary">${escapeHtml(summary)}</p>`);

  // An image field folds its sibling alt/caption/role keys INTO the <figure>,
  // so those sibling string fields must not also render as standalone
  // paragraphs. Pre-collect the keys an image field consumes.
  const consumed = new Set();
  for (const field of fields) {
    if (field?.type === 'image') {
      for (const k of imageSiblingKeys(field.key)) {
        if (k in content) consumed.add(k);
      }
    }
  }

  // Flat repeating groups (numbered card/row groups): project the whole group
  // at its count-field position and consume the count + every numbered slot field, so
  // they don't also render as a loose enum / duplicate paragraphs.
  const groups = Array.isArray(def?.repeatingGroups) ? def.repeatingGroups : [];
  const groupHtmlByAnchor = new Map();
  for (const group of groups) {
    if (
      !group ||
      typeof group.countKey !== 'string' ||
      typeof group.prefix !== 'string' ||
      !Array.isArray(group.slotFields)
    ) {
      continue;
    }
    consumed.add(group.countKey);
    for (const field of fields) {
      if (field && isRepeatingGroupSlotKey(group, field.key))
        consumed.add(field.key);
    }
    groupHtmlByAnchor.set(
      group.countKey,
      projectRepeatingGroup(group, content, fields),
    );
  }

  // The structure contract, where it asks for more than the field vocabulary
  // alone gives (structure.js / docs/reference/deck-conformance.md).
  const structure = slideStructure(def);
  const visibleByKey = new Map(fields.map((f) => [f.key, f]));
  const structuredHtmlByKey = new Map();
  for (const field of fields) {
    if (!field) continue;
    // `tabular`: the single item array is rows × columns, not a bullet list.
    if (structure === 'tabular' && field.type === 'items') {
      structuredHtmlByKey.set(
        field.key,
        renderRowTable(field, content, defaults),
      );
      const captionKey = str(field.captionKey);
      if (captionKey) consumed.add(captionKey);
      const countKey = str(field.columnCountKey);
      if (countKey) consumed.add(countKey);
      continue;
    }
    // `dataset`: decode the payload to rows and name the encoding that is lost.
    if (field.type === 'csv' && Array.isArray(field.encodingKeys)) {
      structuredHtmlByKey.set(
        field.key,
        renderCsvTable(
          content?.[field.key],
          encodingCaption(field.encodingKeys, visibleByKey, content),
        ),
      );
      for (const key of field.encodingKeys) consumed.add(key);
    }
  }

  for (const field of fields) {
    if (!field || field.key === headingKey) continue;
    if (groupHtmlByAnchor.has(field.key)) {
      parts.push(groupHtmlByAnchor.get(field.key));
      continue;
    }
    if (structuredHtmlByKey.has(field.key)) {
      parts.push(structuredHtmlByKey.get(field.key));
      continue;
    }
    if (consumed.has(field.key)) continue;
    parts.push(renderFieldValue(field, content, headingText));
  }
  return parts.filter(Boolean).join('\n');
}

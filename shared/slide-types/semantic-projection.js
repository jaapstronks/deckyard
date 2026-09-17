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
 *  - **`presentational: true` is honoured.** Some fields hold a *string* that is
 *    not document text: an icon name, a video library id, a JSON blob of zoom
 *    coordinates. The `type` alone cannot say so — they are all `string` — so
 *    the field says it, once, and every reader (ours and any other) gets the
 *    same answer instead of each guessing from the key name.
 *  - **`mediaRef` is honoured.** A third kind of string sits between those two:
 *    a reference to media the document cannot embed — a video source that is a
 *    URL on one slide and a bare provider id on the next. Dropping it loses the
 *    slide's whole content; printing it prints an id at the reader. So the
 *    field declares what it refers to and the projection renders a stand-in
 *    (D82). See {@link renderMediaRef}.
 *  - **`role` is honoured.** The field vocabulary says what shape a value has;
 *    the role says what the text *is*. A quote, the name under it and a source
 *    line are all `string`, and projecting on type alone made them three
 *    anonymous paragraphs. One table maps the role to its element (D128), see
 *    {@link renderTextField} and {@link renderBlocks}.
 *  - **The deck language is a parameter.** Some of what a slide says is not
 *    stored: a blank callout label reads as its kind ("Key insight"), a chart
 *    carries a one-sentence summary. Both come from the slide copy in the
 *    deck's language, so the caller passes `lang` (the reader resolves it once
 *    per document) and nothing here reads a language from anywhere else.
 */

import { markdownToSafeHtml, inlineMarkdownToSafeHtml } from '../markdown.js';
import {
  escapeHtml,
  pickAltText,
  normalizeUrl,
  safeHref,
  normalizeAuthoredUrl,
} from './helpers.js';
import { slideStructure } from './structure.js';
import { isFieldVisible, predicateHolds } from './field-visibility.js';
import {
  TEXT_ROLES,
  DEFAULT_TEXT_ROLE,
  DOCUMENT_ELEMENT_ROLES,
} from './text-roles.js';
import { semanticEnumAttrs } from './semantic-enums.js';
import { resolveItemDefaults } from './item-defaults.js';
import { optionDefaultText } from './option-default.js';
import {
  renderUnresolvedSlideSemanticHtml,
  unresolvedSlideHeading,
} from './unresolved.js';

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

/**
 * Does this field hold no readable document content?
 *
 * Two ways to be presentational, and they answer different questions. The
 * TYPE covers the fields whose whole vocabulary is configuration (an enum, a
 * colour, a number). The per-field `presentational: true` covers the ones the
 * type cannot: a `string` that stores an icon name, an infrastructure id or a
 * serialized coordinate list is a `string` like any other, so only the field
 * itself can say that its value is machine data rather than something a reader
 * should be read aloud.
 *
 * It is a projection-side declaration only: the field still renders in the
 * editor, still validates, and is still offered to agents unless it separately
 * says `ai: false`. "Not document text" is not the same claim as "not editable"
 * (`hidden`) or "not part of the contract" (`deprecated`).
 *
 * @param {{type?: string, presentational?: boolean}} field
 * @returns {boolean}
 */
function isPresentationalField(field) {
  return (
    field?.presentational === true ||
    PRESENTATIONAL_FIELD_TYPES.has(field?.type)
  );
}

function str(v) {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * The ` data-field="<key>"` marker every projected block carries (D132): the
 * field it came from, in the style of `data-relation` and `data-media`. A
 * reader otherwise cannot tell one `<p>` from the next, while the definition
 * already knows which is the source line and which the body. Classes stay
 * style hooks; this is the addressable name.
 * @param {string} key
 * @returns {string}
 */
function fieldAttr(key) {
  return ` data-field="${escapeHtml(key)}"`;
}

/**
 * The heading of a slide's reader `<section>`, and whether a reader sees it.
 *
 * The heading is a declaration, not a guess (D129). A type names its title with
 * `role: 'heading'` on exactly one field; when the slide fills that field, its
 * text is the section's visible `<h2>` and the field is consumed (`key`), so
 * the body does not repeat it.
 *
 * Everything else is a *name*, and a name is a hidden heading: every slide keeps
 * one `<h2>` for navigation (the H key, the table of contents, a PPTX title),
 * but a type label never shows as a document heading. The name is the slide's
 * `a11yTitle`, else the value of the type's `labelField` (the same field that
 * names the slide in the editor's slide list), else the type label as a last
 * resort. A hidden heading consumes nothing: a quote or a callout label named
 * this way still appears in the body, in its own role.
 *
 * `a11yTitle` is a name in both cases. On a hidden heading it is the text; on a
 * visible one it becomes the section's `aria-label` (`ariaLabel`) and the
 * author's title stays on screen.
 *
 * A slide whose type does not resolve has no declaration to read; it gets the
 * archived-slide placeholder's heading instead (see `unresolved.js`).
 *
 * The `labelField` value may be a `defaultFromOption` word (D130c): a callout
 * with no label is named by its kind, in the deck's language, not "Callout".
 *
 * @param {object} slide
 * @param {object|null|undefined} def - the resolved slide-type definition
 * @param {object} [opts]
 * @param {number} [opts.index] - 0-based slide index, for the final fallback
 * @param {string} [opts.lang] - the deck language
 * @returns {{ text: string, visible: boolean, key: string|null, ariaLabel: string }}
 */
export function slideHeading(slide, def, { index = 0, lang } = {}) {
  if (!def) return { ...unresolvedSlideHeading(slide), ariaLabel: '' };
  const content =
    slide?.content && typeof slide.content === 'object' ? slide.content : {};
  const a11y = str(content.a11yTitle);

  const fields = Array.isArray(def.fields) ? def.fields : [];
  const field = fields.find((f) => f?.role === 'heading' && !f.hidden);
  const title = field ? str(content[field.key]) : '';
  if (title) {
    return { text: title, visible: true, key: field.key, ariaLabel: a11y };
  }

  const labelKey = str(def.labelField);
  const labelDef = labelKey ? fields.find((f) => f?.key === labelKey) : null;
  const text =
    a11y ||
    str(content[labelKey]) ||
    optionDefaultText(labelDef, fields, content, def.defaults, lang) ||
    str(def.label) ||
    str(slide?.type) ||
    `Slide ${index + 1}`;
  return { text, visible: false, key: null, ariaLabel: '' };
}

/**
 * Render one image as a <figure> with a resolved alt + optional caption.
 * `attrs` is spliced into the start tag (the `data-field` marker).
 * `figcaption` is a ready `<figcaption>` from a `caption`-role field beside
 * the figure (see {@link renderBlocks}); it replaces the sibling-key caption,
 * which the block only hands over when there is none.
 */
function renderFigure(
  src,
  { alt, decorative, caption },
  attrs = '',
  figcaption = '',
) {
  const url = normalizeUrl(src);
  if (!url) return '';
  const altAttr = decorative ? '' : escapeHtml(alt || '');
  const ariaHidden = decorative ? ' aria-hidden="true"' : '';
  const fig =
    figcaption ||
    (caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : '');
  return `<figure class="reader-figure"${attrs}><img src="${escapeHtml(url)}" alt="${altAttr}"${ariaHidden} loading="lazy" />${fig}</figure>`;
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
 * The keys an object's `image` fields fold into their `<figure>` and that must
 * therefore not project a second time as loose text.
 *
 * Runs over slide content and over one item object alike: an item with an
 * `image` + `alt` pair is the same shape as a slide with one, so it earns the
 * same treatment. Before this ran per item, a team card's alt text was both the
 * figure's `alt` and the card's `<h3>` (it is the first string field declared),
 * and a gallery caption appeared under the picture *and* beside it.
 *
 * @param {Array<{key?: string, type?: string}>} fields - `fields[]` / `itemFields[]`
 * @param {object} obj - the object those fields describe
 * @returns {Set<string>}
 */
function imageConsumedKeys(fields, obj) {
  const consumed = new Set();
  for (const field of Array.isArray(fields) ? fields : []) {
    if (field?.type !== 'image') continue;
    for (const key of imageSiblingKeys(field.key)) {
      if (obj && key in obj) consumed.add(key);
    }
  }
  return consumed;
}

/**
 * Resolve alt text / decorative state / caption for an image field, using the
 * sibling-key conventions (`alt`, `<key>Alt`, `imageRole`, `caption`).
 * `nameText` is a last named fallback before the filename guess: the
 * `caption`-role text that captions this figure, which on a logo is the only
 * name the item has (B297 owns the ladder itself).
 */
function resolveImageA11y(fieldKey, content, headingText, nameText = '') {
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
        fallbacks: [caption, headingText, nameText],
      });
  return { alt, decorative, caption };
}

/**
 * Parse a simple CSV string into a semantic <table> (first row = header).
 * @param {string} csv
 * @param {string} [caption] - `<caption>` text; for a `dataset` payload this is
 *   the encoding the decoded rows no longer carry (see {@link encodingCaption}).
 * @param {string} [attrs] - spliced into the `<table>` start tag
 */
function renderCsvTable(csv, caption = '', attrs = '') {
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
  return `<table class="reader-table"${attrs}>${cap}${thead}${tbody}</table>`;
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
 * The sentence a `dataset` type says about its data, in the deck language: the
 * definition's `datasetSummary(content, { lang })`, or `''` for a type that
 * declares none. It is type code, like `renderHtml`, because what is worth
 * saying about a payload depends on what the payload encodes; the projection
 * only decides where it goes (the table's `<caption>`).
 * @param {object} def
 * @param {object} content
 * @param {string} [lang]
 * @returns {string}
 */
function datasetSummaryText(def, content, lang) {
  if (typeof def?.datasetSummary !== 'function') return '';
  return str(def.datasetSummary(content, { lang }));
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
 * One static declaration says what the first column *is*: `rowHeader: 'first'`
 * makes its body cells `<th scope="row">`. It is static because the canvas has
 * no switch for it — the table CSS styles column 1 as the label column on every
 * table — so a sibling enum would promise a choice no slide can make. The
 * corner cell of a header row stays the `<th scope="col">` it already is: it
 * heads that label column.
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
    ? field.itemFields.filter((f) => f && !f.hidden && !f.presentational)
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
  const firstIsRowHeader = field.rowHeader === 'first';

  const cell = (row, col, tag, scope = 'col') => {
    const attr = tag === 'th' ? ` scope="${scope}"` : '';
    return `<${tag}${attr}>${cellHtml(col, row)}</${tag}>`;
  };
  const bodyCell = (row, col, i) =>
    firstIsRowHeader && i === 0
      ? cell(row, col, 'th', 'row')
      : cell(row, col, 'td');
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
            `<tr>${columns.map((col, i) => bodyCell(row, col, i)).join('')}</tr>`,
        )
        .join('')}</tbody>`
    : '';
  if (!thead && !tbody) return '';
  const captionText = str(content?.[str(field.captionKey)]);
  const cap = captionText
    ? `<caption>${escapeHtml(captionText)}</caption>`
    : '';
  return `<table class="reader-table"${fieldAttr(field.key)}>${cap}${thead}${tbody}</table>`;
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
    ? inlineMarkdownToSafeHtml(value)
    : escapeHtml(value);
}

/**
 * Wrap projected item blocks in a list. A collection whose order carries
 * meaning (a sequence: timeline, process, steps) declares `ordered: true` on
 * its field and projects to an `<ol>`; a set whose order is incidental (cards,
 * columns) stays a `<ul>`. A collection whose order means something only in
 * one style declares `orderedWhen: { field, in }` instead — the `visibleWhen`
 * operator — so a list slide is an `<ol>` exactly where its canvas numbers the
 * items. This is the count-/order-aware half of the projection: the list
 * element reflects what the type declares, never a guess.
 * @param {string[]} blocks - already-rendered `<li>` strings
 * @param {boolean} [ordered=false]
 * @param {string} [attrs] - spliced into the list start tag
 * @returns {string}
 */
function renderItemList(blocks, ordered = false, attrs = '') {
  if (!blocks.length) return '';
  const tag = ordered ? 'ol' : 'ul';
  return `<${tag} class="reader-items"${attrs}>${blocks.join('')}</${tag}>`;
}

/**
 * The declared text role of a field, or the default (`prose`).
 * @param {{role?: string}} field
 * @returns {string}
 */
function textRole(field) {
  return TEXT_ROLES.includes(field?.role) ? field.role : DEFAULT_TEXT_ROLE;
}

/** Style hooks for the roles that stay a plain block with a class. */
const ROLE_CLASSES = { caption: 'reader-caption', label: 'reader-label' };

/**
 * Is this a text field the role table applies to?
 * @param {{type?: string}} field
 * @returns {boolean}
 */
function isTextField(field) {
  return field?.type === 'string' || field?.type === 'markdown';
}

/**
 * Project a `string` or `markdown` field through the role table (D128).
 *
 * One table, one element per role; a string is one `<p>`, a markdown value is
 * its own blocks in one wrapper, and the role decides the wrapper:
 *
 *   quote        `<blockquote data-field>` around the paragraph(s)
 *   caption      `<p class="reader-caption">` (or the figure's `<figcaption>`,
 *                when the block has one figure: {@link renderBlocks})
 *   label        `<p class="reader-label">`, the eyebrow; `<dfn>` around the
 *                text while its `termWhen` predicate holds
 *   attribution  a plain `<p>`, gathered into the block's one `<footer>` by
 *                {@link renderBlocks}
 *   prose, list-item, heading  a plain `<p>` (a filled heading field is the
 *                section's `<h2>` and never reaches this)
 *
 * `termWhen` is a `{ field, in }` predicate, the same one operator
 * `visibleWhen` reads, so a definition's term is a declaration and not a
 * branch on a type name. It marks an authored value only: a blank field that
 * stands in with its `defaultFromOption` word ("Definition") names no term.
 *
 * @param {object} field
 * @param {object} content - the object the field lives in
 * @param {object} [defaults] - that object's declared defaults
 * @param {object} [opts]
 * @param {boolean} [opts.figcaption] - render a `caption` as the
 *   `<figcaption>` of the figure beside it
 * @param {Array<object>} [opts.siblings] - every field beside this one, for
 *   `defaultFromOption`
 * @param {string} [opts.lang] - the deck language
 * @returns {string}
 */
function renderTextField(
  field,
  content,
  defaults,
  { figcaption = false, siblings, lang } = {},
) {
  const authored = str(content?.[field.key]);
  const v =
    authored || optionDefaultText(field, siblings, content, defaults, lang);
  if (!v) return '';
  const attrs = fieldAttr(field.key);
  const blocks = field.type === 'markdown';
  const html = blocks ? markdownToSafeHtml(v) : escapeHtml(v);
  const role = textRole(field);
  if (figcaption && role === 'caption') {
    return `<figcaption${attrs}>${html}</figcaption>`;
  }
  if (role === 'quote') {
    return `<blockquote${attrs}>${blocks ? html : `<p>${html}</p>`}</blockquote>`;
  }
  const cls = ROLE_CLASSES[role] ? ` class="${ROLE_CLASSES[role]}"` : '';
  if (blocks) return `<div${cls}${attrs}>${html}</div>`;
  const term =
    !!authored &&
    role === 'label' &&
    predicateHolds(field.termWhen, content, defaults);
  return `<p${cls}${attrs}>${term ? `<dfn>${html}</dfn>` : html}</p>`;
}

/**
 * The key of the one `image` field in a block that draws a figure and has no
 * caption of its own, or `''`. A `caption`-role field captions that figure; with
 * none or several figures there is nothing unambiguous to caption.
 * @param {Array<object>} fields
 * @param {object} content
 * @returns {string}
 */
function soleUncaptionedFigureKey(fields, content) {
  const figures = fields.filter(
    (f) =>
      f?.type === 'image' &&
      !f.hidden &&
      !f.presentational &&
      normalizeUrl(content?.[f.key]),
  );
  if (figures.length !== 1) return '';
  const key = figures[0].key;
  const captioned = str(content?.[`${key}Caption`]) || str(content?.caption);
  return captioned ? '' : key;
}

/**
 * Render a block's fields in declared order, applying the two role rules that
 * reach past a single field (D128):
 *
 * - **attribution** — every filled `attribution` field of the block goes into
 *   one `<footer>`, at the place of the first, one `<p data-field>` per field.
 *   The footer sits beside the `<blockquote>`, never inside it, as WHATWG asks
 *   of a quotation's source. It carries no `data-field` of its own: it holds
 *   several fields, and the marker names one.
 * - **caption** — when the block draws exactly one figure without a caption
 *   of its own, the first filled `caption` field becomes that figure's
 *   `<figcaption data-field>` and is not repeated; otherwise it stays a
 *   `<p class="reader-caption">`.
 *
 * A "block" is one slide body or one item, so both run the same rules.
 *
 * @param {Array<object>} fields - the block's renderable fields, in order
 * @param {object} content - the object those fields describe
 * @param {object} opts
 * @param {object} [opts.defaults] - the block's declared defaults
 * @param {string} [opts.headingText] - alt fallback for a figure
 * @param {Map<string, string>} [opts.structured] - pre-rendered html by key
 * @param {Array<object>} [opts.siblings] - every field the block declares, for
 *   `defaultFromOption` (the `fields` list is already filtered)
 * @param {string} [opts.lang] - the deck language
 * @returns {string[]}
 */
function renderBlocks(
  fields,
  content,
  { defaults, headingText, structured, siblings, lang },
) {
  const figureKey = soleUncaptionedFigureKey(fields, content);
  const captionField = figureKey
    ? fields.find(
        (f) =>
          isTextField(f) &&
          !f.hidden &&
          textRole(f) === 'caption' &&
          str(content?.[f.key]),
      )
    : null;
  const figcaption = captionField
    ? renderTextField(captionField, content, defaults, {
        figcaption: true,
        siblings,
        lang,
      })
    : '';
  const parts = [];
  const footer = [];
  let footerAt = -1;
  for (const field of fields) {
    if (!field || field === captionField) continue;
    if (structured?.has(field.key)) {
      parts.push(structured.get(field.key));
      continue;
    }
    const html = renderFieldValue(field, content, {
      defaults,
      siblings,
      lang,
      headingText,
      figcaption: field.key === figureKey ? figcaption : '',
      nameText:
        field.key === figureKey ? str(content?.[captionField?.key]) : '',
    });
    if (!html) continue;
    if (isTextField(field) && textRole(field) === 'attribution') {
      if (footerAt < 0) {
        footerAt = parts.length;
        parts.push('');
      }
      footer.push(html);
      continue;
    }
    parts.push(html);
  }
  if (footerAt >= 0) parts[footerAt] = `<footer>${footer.join('\n')}</footer>`;
  return parts.filter(Boolean);
}

/**
 * Render one repeating-item (`items` field) as a small block: one of its
 * *readable* strings becomes an <h3>, the rest of its fields project by type.
 *
 * A heading heads something (D130): an item where nothing projects below that
 * string is the string itself, as the `<li>`'s text. A poll answer or a likert
 * step is one line, not a heading over nothing. It is derived per item, not
 * declared — a list item with a title and no text reads the same way.
 *
 * Which string is the heading is a declaration first and a default second. The
 * field may name it with `itemLabelField` — the mirror of the type's own
 * `labelField` — and a type whose first string is not its heading has to say
 * so: `kpi-metrics-slide` leads with `value`, so the default headed a metric
 * "1.2" and demoted "Reach" to a paragraph. Without a declaration the first
 * readable string stays the heading; that default is right for cards, and it
 * is a default, not a tolerated second spelling.
 *
 * "Readable" is doing real work in that sentence. A field the item's own image
 * consumes (`alt`, `caption`) and a field the type declares `presentational`
 * (an icon name) are both strings, and taking the first one regardless is how
 * cards ended up headed "rocket" and team members headed by their own alt text.
 * Both exclusions are declarations, not a list of key names to skip.
 *
 * @param {object} item - one entry of the field's array
 * @param {Array<object>} itemFields - the field's `itemFields[]`
 * @param {string} [itemLabelField] - declared heading sub-field, if any
 * @param {object} [itemDefaults] - the field's `itemDefaults` skeleton, the
 *   declared default an item's own `semantic` enum resolves through
 * @param {string} [lang] - the deck language
 */
function renderItemBlock(item, itemFields, itemLabelField, itemDefaults, lang) {
  if (!item || typeof item !== 'object' || !Array.isArray(itemFields))
    return '';
  const consumed = imageConsumedKeys(itemFields, item);
  let headingKey = null;
  let headingText = '';
  const headable = (f) =>
    f?.type === 'string' &&
    !f.hidden &&
    !f.presentational &&
    !DOCUMENT_ELEMENT_ROLES.has(textRole(f)) &&
    !consumed.has(f.key) &&
    str(item[f.key]);
  // A declared heading that is empty on *this* item falls through to the
  // default: an item with no label still deserves a heading, not a stray <p>.
  const declared = str(itemLabelField);
  const headingField =
    (declared && itemFields.find((f) => f?.key === declared && headable(f))) ||
    itemFields.find(headable);
  if (headingField) {
    headingKey = headingField.key;
    headingText = str(item[headingField.key]);
  }
  // The item's own heading is the alt fallback for its image — a card's name
  // describes its portrait far better than the filename guess does.
  const below = renderBlocks(
    itemFields.filter(
      (f) => f && f.key !== headingKey && !f.hidden && !consumed.has(f.key),
    ),
    item,
    { defaults: itemDefaults, headingText, siblings: itemFields, lang },
  ).filter(Boolean);
  // An item's own `semantic` enums (a matrix cell's tone) mark its <li>,
  // resolved through the items field's `itemDefaults` the way a top-level
  // enum resolves through the type's `defaults`: one rule, and the canvas
  // (`.matrix-cell[data-tone]`) says the same for a cell without a tone.
  const attrs = semanticEnumAttrs(itemFields, item, itemDefaults);
  if (headingKey && !below.length) {
    // One field, one marker: the <li> is the block that emits it.
    return `<li class="reader-item"${fieldAttr(headingKey)}${attrs}>${escapeHtml(headingText)}</li>`;
  }
  const parts = headingKey
    ? [`<h3${fieldAttr(headingKey)}>${escapeHtml(headingText)}</h3>`, ...below]
    : below;
  const inner = parts.join('\n');
  return inner ? `<li class="reader-item"${attrs}>${inner}</li>` : '';
}

/**
 * Project a `mediaRef` field: a stand-in for media the document cannot embed.
 *
 * `source` on a video slide is the case that forced this. It is content, not
 * `presentational` — declaring it presentational would make the video vanish
 * from the reader entirely — but it is a *reference*, and half its accepted
 * values are a bare provider id. The projection printed the id verbatim
 * (`<p>3045cc09-605c-…</p>`), which is not something anyone can read, follow or
 * translate. D82 settles the shape: a link when a link can be resolved,
 * otherwise the media's name; an id is never text.
 *
 * The declaration carries both halves:
 *  - `label` — what to call the thing in a document ("Video"). Declared per
 *    field rather than derived from the type, because a slide may carry a video
 *    without *being* a video slide.
 *  - `linkKey` — an optional sibling holding the author's own link. It wins,
 *    for the same reason it is rung 0 of the PDF export's ladder
 *    (`server/export/video-watch-url.js`): a short, human-chosen URL is exactly
 *    what belongs in a document. The key is then consumed, so the link is the
 *    stand-in instead of a second loose paragraph beside it.
 *
 * There is deliberately **no provider parsing here**. "Is this string a link?"
 * is answered by the same allowlist every other projected link goes through, so
 * the reader gains no second ladder that could disagree with the export's about
 * what a video source is; naming the provider would have required one.
 *
 * The stand-in is named, and nothing else. Titling the link with the slide's
 * own heading was the first shape and read badly in the browser — the section
 * heading and the paragraph under it said the same words twice — so the medium
 * names itself and the heading directly above supplies the subject.
 *
 * @param {{key: string, mediaRef?: {label?: string, linkKey?: string}}} field
 * @param {object} content - the object the field lives in
 * @returns {string}
 */
function renderMediaRef(field, content) {
  const ref = field.mediaRef;
  // A malformed declaration still suppresses the raw value: the point of the
  // field saying "this is a reference" is that no reader prints the reference.
  const name = str(ref?.label) || 'Media';
  const linkKey = str(ref?.linkKey);
  const authored = linkKey ? normalizeAuthoredUrl(content?.[linkKey]) : '';
  const href = authored || safeHref(content?.[field.key]);
  if (!href && !str(content?.[field.key])) return '';
  const inner = href
    ? `<a href="${escapeHtml(href)}">${escapeHtml(name)}</a>`
    : escapeHtml(name);
  return `<p class="reader-media"${fieldAttr(field.key)} data-media="${escapeHtml(name)}">${inner}</p>`;
}

/**
 * Project a single field's value to semantic HTML (no-op for empty or
 * presentational fields). `content` is the object the field lives in (slide
 * content, or one item object).
 *
 * @param {object} field
 * @param {object} content
 * @param {object} [opts]
 * @param {object} [opts.defaults] - `content`'s declared defaults
 * @param {Array<object>} [opts.siblings] - the fields beside this one
 * @param {string} [opts.lang] - the deck language
 * @param {string} [opts.headingText] - alt fallback for an image
 * @param {string} [opts.figcaption] - a ready `<figcaption>` for an image
 * @param {string} [opts.nameText] - the caption text, a last alt fallback
 */
function renderFieldValue(
  field,
  content,
  {
    defaults,
    siblings,
    lang,
    headingText = '',
    figcaption = '',
    nameText = '',
  } = {},
) {
  if (!field || field.hidden) return '';
  if (NON_CONTENT_GLOBAL_KEYS.has(field.key)) return '';
  if (isPresentationalField(field)) return '';
  // Checked before the type switch: a `mediaRef` string never reaches the
  // plain-text branch, whatever the declaration around it looks like.
  if (field.mediaRef) return renderMediaRef(field, content);

  const value = content?.[field.key];
  const attrs = fieldAttr(field.key);
  switch (field.type) {
    case 'string':
    case 'markdown':
      // Markdown may be several blocks, so the field is one wrapper around
      // them: one marked element per field, whatever the author wrote. The
      // role decides which element (D128).
      return renderTextField(field, content, defaults, { siblings, lang });
    case 'code': {
      const v = str(value);
      return v
        ? `<pre class="reader-code"${attrs}><code>${escapeHtml(v)}</code></pre>`
        : '';
    }
    case 'csv': {
      const v = str(value);
      return v ? renderCsvTable(v, '', attrs) : '';
    }
    case 'image': {
      const a11y = resolveImageA11y(field.key, content, headingText, nameText);
      return renderFigure(value, a11y, attrs, figcaption);
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
        ? `<div class="reader-gallery"${attrs}>${figs.join('')}</div>`
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
          const li = renderItemBlock(
            item,
            field.itemFields,
            field.itemLabelField,
            resolveItemDefaults(field),
            lang,
          );
          if (!li) return '';
          const rel = relationOf(item);
          if (!rel) return li;
          const marker = `<p class="reader-relation"${fieldAttr(relField)} data-relation="${escapeHtml(
            rel,
          )}">${escapeHtml(relLabels[rel])}</p>`;
          return li.replace(/<\/li>\s*$/, `${marker}</li>`);
        })
        .filter(Boolean);
      const ordered =
        field.ordered === true ||
        predicateHolds(field.orderedWhen, content, defaults) === true ||
        hasRelations;
      return renderItemList(blocks, ordered, attrs);
    }
    case 'url': {
      const href = safeHref(value);
      if (!href) return '';
      return `<p${attrs}><a href="${escapeHtml(href)}">${escapeHtml(href)}</a></p>`;
    }
    default:
      return '';
  }
}

/**
 * Project a slide's readable content (everything UNDER its <section> heading)
 * to semantic HTML. The heading itself is produced by {@link slideHeading} and
 * emitted by {@link renderSlideSectionHtml}.
 *
 * @param {object} slide
 * @param {object} def - the resolved slide-type definition
 * @param {{ headingKey?: string|null, headingText?: string, lang?: string }} [opts]
 *   `lang` is the deck language, for the copy a slide shows without storing it
 * @returns {string} inner HTML for the slide section
 */
export function renderSlideBodySemanticHtml(
  slide,
  def,
  { headingKey = null, headingText = '', lang } = {},
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
    parts.push(
      `<p class="reader-summary"${fieldAttr('a11ySummary')}>${escapeHtml(summary)}</p>`,
    );

  // An image field folds its sibling alt/caption/role keys INTO the <figure>,
  // so those sibling string fields must not also render as standalone
  // paragraphs. Pre-collect the keys an image field consumes (the same pass
  // runs per item inside renderItemBlock).
  const consumed = imageConsumedKeys(fields, content);

  // The structure contract, where it asks for more than the field vocabulary
  // alone gives (structure.js / docs/reference/deck-conformance.md).
  const structure = slideStructure(def);
  const visibleByKey = new Map(fields.map((f) => [f.key, f]));
  const structuredHtmlByKey = new Map();
  for (const field of fields) {
    if (!field) continue;
    // A media stand-in absorbs the author's own link, so that sibling field
    // does not also render as a loose paragraph beside it.
    const mediaLinkKey = str(field.mediaRef?.linkKey);
    if (mediaLinkKey) consumed.add(mediaLinkKey);
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
    // `dataset`: decode the payload to rows, say what they show (the type's
    // own `datasetSummary`, the sentence its canvas gives assistive tech) and
    // name the encoding that is lost.
    if (field.type === 'csv' && Array.isArray(field.encodingKeys)) {
      const caption = [
        datasetSummaryText(def, content, lang),
        encodingCaption(field.encodingKeys, visibleByKey, content),
      ]
        .filter(Boolean)
        .join(' ');
      structuredHtmlByKey.set(
        field.key,
        renderCsvTable(content?.[field.key], caption, fieldAttr(field.key)),
      );
      for (const key of field.encodingKeys) consumed.add(key);
    }
  }

  parts.push(
    ...renderBlocks(
      fields.filter(
        (f) =>
          f &&
          f.key !== headingKey &&
          (structuredHtmlByKey.has(f.key) || !consumed.has(f.key)),
      ),
      content,
      {
        defaults,
        headingText,
        structured: structuredHtmlByKey,
        siblings: def?.fields,
        lang,
      },
    ),
  );
  return parts.filter(Boolean).join('\n');
}

/**
 * One slide as a reader `<section>`: the heading from {@link slideHeading}, the
 * body from {@link renderSlideBodySemanticHtml} (or the archived-slide
 * projection when the type does not resolve).
 *
 * Emitted here rather than by the document wrapper because half of what the
 * reader says about a slide lives in this element — whether its heading is
 * visible, what names the section, which type it is — and the reader fixture
 * has to pin all of it (`tests/fixtures/semantic-projection.json`).
 *
 * - A hidden heading is still an `<h2>`, visually hidden with
 *   `reader-sr-only`, so every section is reachable by heading navigation.
 * - The section is labelled by its `<h2>`, except when the author gave the
 *   slide an `a11yTitle` beside a visible title: that name is the section's
 *   `aria-label` and the title stays the heading.
 * - The section carries the full type name as `data-slide-type` and every
 *   top-level `semantic: true` enum as `data-<key>` (D132, D130b); the visible
 *   `<h2>` names its field with `data-field`, like every block in the body.
 * - The slide number is position, not text (D133): the document stylesheet
 *   counts sections with CSS counters, so no number is part of the heading's
 *   accessible name.
 *
 * @param {object} slide
 * @param {object|null|undefined} def - the resolved slide-type definition
 * @param {{ index?: number, lang?: string }} [opts] - 0-based position in the
 *   deck, and the deck language
 * @returns {string}
 */
export function renderSlideSectionHtml(slide, def, { index = 0, lang } = {}) {
  const n = index + 1;
  const heading = slideHeading(slide, def, { index, lang });
  const inner = def
    ? renderSlideBodySemanticHtml(slide, def, {
        headingKey: heading.key,
        headingText: heading.text,
        lang,
      })
    : renderUnresolvedSlideSemanticHtml(slide, { headingKey: heading.key });
  const titleId = `slide-${n}-title`;
  const label = heading.ariaLabel
    ? `aria-label="${escapeHtml(heading.ariaLabel)}"`
    : `aria-labelledby="${titleId}"`;
  // A visible heading is a consumed field and says which; a hidden one is a
  // name, not a field (D129b), so it carries no marker.
  const headingAttrs = heading.visible
    ? fieldAttr(heading.key)
    : ' class="reader-sr-only"';
  const content =
    slide?.content && typeof slide.content === 'object' ? slide.content : {};
  const enums = def ? semanticEnumAttrs(def.fields, content, def.defaults) : '';
  return [
    `<section id="slide-${n}" class="reader-slide" data-slide-type="${escapeHtml(str(slide?.type))}"${enums} ${label}>`,
    `<h2 id="${titleId}"${headingAttrs}>${escapeHtml(heading.text)}</h2>`,
    inner,
    '</section>',
  ]
    .filter(Boolean)
    .join('\n');
}

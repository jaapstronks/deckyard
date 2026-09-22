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
 *  - **Pairs stay pairs (D131).** A value that belongs to a sibling says so
 *    on the field — `unitKey`, `hrefKey`, `headingKey`, `duration` — and the
 *    projection joins the two and consumes the partner, the way an image
 *    consumes its alt. A type-level `scale` does the same for the two ends of
 *    a rating scale. See {@link pairedKeys}.
 *  - **`markup` is honoured.** A `code` field's value is source by default,
 *    and a reader shows source as source. A field that declares `markup: true`
 *    holds author HTML the canvas renders (custom-html), so the reader renders
 *    it too, through the same sanitizer the canvas uses, minus the author's
 *    `style` attributes (presentation, like the `css` field), and names a
 *    slide without a title by its first `h1..h3`. See {@link markupHeadingText}.
 *  - **The deck language is a parameter.** Some of what a slide says is not
 *    stored: a blank callout label reads as its kind ("Key insight"), a chart
 *    carries a one-sentence summary. Both come from the slide copy in the
 *    deck's language, so the caller passes `lang` (the reader resolves it once
 *    per document) and nothing here reads a language from anywhere else.
 */

import { markdownToSafeHtml, inlineMarkdownToSafeHtml } from '../markdown.js';
import {
  sanitizeSlideHtmlSync,
  slideHtmlHeadingTextSync,
} from '../sanitize.js';
import {
  escapeHtml,
  normalizeUrl,
  safeHref,
  normalizeAuthoredUrl,
  slideJumpTarget,
} from './helpers.js';
import { isEmailAddress } from './field-types.js';
import { durationSeconds, isoDuration, clockDuration } from './duration.js';
import { fillCopy, getSlideCopy } from './slide-copy.js';
import { slideStructure } from './structure.js';
import { isFieldVisible, predicateHolds } from './field-visibility.js';
import {
  TEXT_ROLES,
  DEFAULT_TEXT_ROLE,
  DOCUMENT_ELEMENT_ROLES,
} from './text-roles.js';
import { semanticEnumAttrs } from './semantic-enums.js';
import { resolveItemDefaults } from './item-defaults.js';
import { tabularColumnCount } from './tabular.js';
import { optionDefaultText, chosenOptionCopy } from './option-default.js';
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
 * A slide whose content is author markup is named by that markup's first
 * `h1..h3` before the type label (see {@link markupHeadingText}).
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
    markupHeadingText(fields, content) ||
    str(def.label) ||
    str(slide?.type) ||
    `Slide ${index + 1}`;
  return { text, visible: false, key: null, ariaLabel: '' };
}

/**
 * The name author markup gives itself: the text of the first `h1..h3` in the
 * first `markup: true` field that has one, read from the sanitized tree. It is
 * a name, not a title: the heading stays inside the markup where the author
 * put it, so the section's `<h2>` that carries this text is a hidden one.
 *
 * @param {Array<object>} fields - the type's declared fields
 * @param {object} content - the slide content
 * @returns {string}
 */
function markupHeadingText(fields, content) {
  for (const field of fields) {
    if (field?.type !== 'code' || field.markup !== true || field.hidden)
      continue;
    const text = slideHtmlHeadingTextSync(str(content?.[field.key]));
    if (text) return text;
  }
  return '';
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
    // A figure group — an `images` array or an items field of bare pictures —
    // reads its role and its one caption from the object that holds the set,
    // under the same sibling spellings an image field uses.
    if (
      field?.type !== 'image' &&
      field?.type !== 'images' &&
      !figureGroupImageField(field)
    )
      continue;
    for (const key of imageSiblingKeys(field.key)) {
      if (obj && key in obj) consumed.add(key);
    }
  }
  return consumed;
}

/**
 * The one `image` sub-field of an `items` field whose items are nothing but a
 * picture, or `null`.
 *
 * Such a field is a set of figures (an image set, a gallery), not a list of
 * cards: every readable sub-field is the image or one of its a11y siblings, so
 * an item has nothing to say beside its figure. It projects as one
 * `<figure role="group">` instead of a `<ul>` of one-figure items. Derived
 * from the declared sub-fields, like the item heading, so a fork type with the
 * same shape gets the same group without saying so.
 *
 * @param {object} field
 * @returns {object|null}
 */
function figureGroupImageField(field) {
  if (field?.type !== 'items' || !Array.isArray(field.itemFields)) return null;
  const readable = field.itemFields.filter(
    (f) => f && !f.hidden && !isPresentationalField(f),
  );
  const images = readable.filter((f) => f.type === 'image');
  if (images.length !== 1) return null;
  const siblings = new Set(imageSiblingKeys(images[0].key));
  return readable.every((f) => f === images[0] || siblings.has(f.key))
    ? images[0]
    : null;
}

/**
 * The sibling keys a block's pair declarations consume (D131): the unit a
 * value reads with (`unitKey`), the target a link text points at (`hrefKey`),
 * the title that heads a block (`headingKey`) and the seconds of a length
 * (`duration.secondsKey`). Each is said once, beside the field it belongs to,
 * so the partner never projects a second time as loose text.
 *
 * @param {Array<object>} fields - `fields[]` / `itemFields[]`
 * @returns {Set<string>}
 */
function pairedKeys(fields) {
  const consumed = new Set();
  for (const field of Array.isArray(fields) ? fields : []) {
    for (const key of [
      field?.unitKey,
      field?.hrefKey,
      field?.headingKey,
      field?.duration?.secondsKey,
    ]) {
      if (str(key)) consumed.add(key);
    }
  }
  return consumed;
}

/**
 * The `href` a `url` value becomes in the reader, and the text a slide jump
 * reads as.
 *
 * A web link goes through `safeHref`, the one allowlist every projected link
 * uses. A slide jump points at the reader's own anchors (`#slide-N`): `#N`
 * directly, `#slide:<id>` through the deck's slide order. A jump the document
 * cannot follow — an id that is not in it, a position past its end — is no
 * link at all.
 *
 * @param {unknown} value
 * @param {object} ctx
 * @param {string[]} [ctx.slideIds] - the ids of the document's slides, in order
 * @param {string} [ctx.lang] - the deck language
 * @returns {{ href: string, text: string }}
 */
function linkTarget(value, { slideIds, lang } = {}) {
  const jump = slideJumpTarget(value);
  if (!jump) {
    const href = safeHref(value);
    return { href, text: href };
  }
  const ids = Array.isArray(slideIds) ? slideIds : null;
  const n =
    'id' in jump
      ? (ids ? ids.indexOf(jump.id) : -1) + 1
      : !ids || jump.index <= ids.length
        ? jump.index
        : 0;
  if (!n) return { href: '', text: '' };
  return {
    href: `#slide-${n}`,
    text: fillCopy(getSlideCopy(lang).readerSlideLink, { n }),
  };
}

/**
 * A sibling a11y value of `key` in `obj`: `<key><Suffix>`, else the bare
 * `<suffix>` key (`imageAlt`, else `alt`).
 * @param {object|null|undefined} obj
 * @param {string} key
 * @param {'Alt'|'Caption'|'Role'} suffix
 * @param {string} bare
 * @returns {string}
 */
function imageSibling(obj, key, suffix, bare) {
  if (!obj || typeof obj !== 'object') return '';
  return str(obj[`${key}${suffix}`]) || str(obj[bare]);
}

/**
 * The reader's alt text, decorative state and caption for one image (D135).
 *
 * The alt ladder is the reader's own and shorter than the canvas's:
 *
 *   1. the explicit alt (`<key>Alt`, else `alt`);
 *   2. the name of what the picture shows — the sibling the field names with
 *      `nameKey` (a logo's organisation, the author beside a portrait), else,
 *      for an image inside an item, that item's heading (a team member's name);
 *   3. nothing.
 *
 * A caption is never the alt: it is the figure's `<figcaption>`, and using it
 * twice is how a gallery read "Project Alpha, Project Alpha". A filename is
 * never the alt either (conformance rule 7) — the canvas may still guess one,
 * the document does not. The slide's own heading is no name for a picture on
 * it; only an item's heading is.
 *
 * The role reads from the image's own object first and from `parent` — the
 * object holding the items field this image sits in, `parentKey` — second, so
 * an image set that is decorative as a whole hides every picture in it, as the
 * canvas does. A caption does not inherit: the parent's caption captions the
 * whole group ({@link renderFigureGroup}), never each picture again.
 *
 * `decorative` is the only way to an empty alt on purpose; an image that is not
 * decorative and resolves to `''` is what the publish check refuses
 * ({@link imagesMissingAlt}).
 *
 * @param {{key: string, nameKey?: string}} field - the `image` field
 * @param {object} content - the object the field lives in
 * @param {object} [opts]
 * @param {string} [opts.itemHeading] - the heading of the item holding it
 * @param {object} [opts.parent] - the object holding that item's field
 * @param {string} [opts.parentKey] - the key of that items field
 * @returns {{ alt: string, decorative: boolean, caption: string }}
 */
function resolveImageA11y(
  field,
  content,
  { itemHeading = '', parent = null, parentKey = '' } = {},
) {
  const key = field.key;
  const role =
    imageSibling(content, key, 'Role', 'imageRole') ||
    imageSibling(parent, parentKey, 'Role', 'imageRole');
  const decorative = role === 'decorative';
  const caption = imageSibling(content, key, 'Caption', 'caption');
  if (decorative) return { alt: '', decorative, caption };
  const named = str(field.nameKey) ? str(content?.[field.nameKey]) : '';
  const alt = imageSibling(content, key, 'Alt', 'alt') || named || itemHeading;
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

  // The width is the one the canvas draws (./tabular.js), so the reader and the
  // slide cannot disagree about how many columns a table has.
  const countKey = str(field.columnCountKey);
  const columns = countKey
    ? declared.slice(
        0,
        tabularColumnCount(content, {
          columnCountKey: countKey,
          maxCols: declared.length,
          defaults,
        }),
      )
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
 *   aside        `<aside data-field>` around the paragraph(s); with `kindKey`
 *                it carries `data-kind` and opens with the kind's word as a
 *                `<p class="reader-label">`, in the deck language
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
 *   `defaultFromOption` and `kindKey`
 * @param {string} [opts.lang] - the deck language
 * @param {string[]} [opts.slideIds] - the document's slide ids, for jumps
 * @returns {string}
 */
function renderTextField(
  field,
  content,
  defaults,
  { figcaption = false, siblings, lang, slideIds } = {},
) {
  const authored = str(content?.[field.key]);
  const v =
    authored || optionDefaultText(field, siblings, content, defaults, lang);
  if (!v) return '';
  const attrs = fieldAttr(field.key);
  const blocks = field.type === 'markdown';
  let html = blocks ? markdownToSafeHtml(v) : escapeHtml(v);
  if (!blocks) {
    // A value and its unit are one reading ("98%"): the canvas sets the two
    // spans side by side, so no space is invented here either.
    const unit = str(field.unitKey) ? str(content?.[field.unitKey]) : '';
    if (unit) html += escapeHtml(unit);
    // A link text without a target says nothing a reader can use, so the pair
    // projects as a link or not at all — as it does on the canvas.
    if (str(field.hrefKey)) {
      const { href } = linkTarget(content?.[field.hrefKey], { lang, slideIds });
      if (!href) return '';
      html = `<a href="${escapeHtml(href)}">${html}</a>`;
    }
  }
  const role = textRole(field);
  if (figcaption && role === 'caption') {
    return `<figcaption${attrs}>${html}</figcaption>`;
  }
  if (role === 'quote') {
    return `<blockquote${attrs}>${blocks ? html : `<p>${html}</p>`}</blockquote>`;
  }
  if (role === 'aside') {
    // The kind is the sibling enum's chosen option (`kindKey`): its value
    // travels as `data-kind`, its `copyKey` word is the eyebrow the canvas
    // shows too.
    const kind = chosenOptionCopy(
      field.kindKey,
      siblings,
      content,
      defaults,
      lang,
    );
    const kindAttr = kind.value ? ` data-kind="${escapeHtml(kind.value)}"` : '';
    const label = kind.word
      ? `<p class="reader-label">${escapeHtml(kind.word)}</p>`
      : '';
    return `<aside${attrs}${kindAttr}>${label}${blocks ? html : `<p>${html}</p>`}</aside>`;
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
 * - **headingKey** — a field that names its heading sibling gets that text as
 *   an `<h3 data-field>` directly above it (a `<p>` when the field itself is
 *   empty); the sibling is consumed by the caller ({@link pairedKeys}).
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
 * @param {string} [opts.itemHeading] - the heading of the item this block is,
 *   a figure's alt fallback; none for a slide body
 * @param {object} [opts.parent] - the object holding this item's field
 * @param {string} [opts.parentKey] - the key of that items field
 * @param {Map<string, string>} [opts.structured] - pre-rendered html by key
 * @param {Array<object>} [opts.siblings] - every field the block declares, for
 *   `defaultFromOption` (the `fields` list is already filtered)
 * @param {string} [opts.lang] - the deck language
 * @param {string[]} [opts.slideIds] - the document's slide ids, for jumps
 * @returns {string[]}
 */
function renderBlocks(
  fields,
  content,
  {
    defaults,
    itemHeading,
    parent,
    parentKey,
    structured,
    siblings,
    lang,
    slideIds,
  },
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
        slideIds,
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
      slideIds,
      itemHeading,
      parent,
      parentKey,
      figcaption: field.key === figureKey ? figcaption : '',
    });
    // A block headed by a sibling (`headingKey`) is that heading and the
    // block; a heading over nothing is just its text.
    const heading = str(field.headingKey)
      ? str(content?.[field.headingKey])
      : '';
    if (heading) {
      const attr = fieldAttr(field.headingKey);
      parts.push(
        html
          ? `<h3${attr}>${escapeHtml(heading)}</h3>`
          : `<p${attr}>${escapeHtml(heading)}</p>`,
      );
    }
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
 * The keys an item's own declarations consume: its images' a11y siblings and
 * the partners its pair declarations name.
 * @param {Array<object>} itemFields
 * @param {object} item
 * @returns {Set<string>}
 */
function itemConsumedKeys(itemFields, item) {
  const consumed = imageConsumedKeys(itemFields, item);
  for (const key of pairedKeys(itemFields)) consumed.add(key);
  return consumed;
}

/**
 * The heading of one item: the declared `itemLabelField` when this item fills
 * it, else its first readable string (see {@link renderItemBlock} for why each
 * exclusion is there). Shared with the publish check, which has to name a
 * picture the way the reader does.
 *
 * @param {object} item
 * @param {Array<object>} itemFields
 * @param {string} [itemLabelField]
 * @param {Set<string>} [consumed] - {@link itemConsumedKeys}, when known
 * @returns {{ key: string|null, text: string }}
 */
function itemHeading(
  item,
  itemFields,
  itemLabelField,
  consumed = itemConsumedKeys(itemFields, item),
) {
  const headable = (f) =>
    f?.type === 'string' &&
    !f.hidden &&
    !f.presentational &&
    !str(f.hrefKey) &&
    !DOCUMENT_ELEMENT_ROLES.has(textRole(f)) &&
    !consumed.has(f.key) &&
    str(item[f.key]);
  // A declared heading that is empty on *this* item falls through to the
  // default: an item with no label still deserves a heading, not a stray <p>.
  const declared = str(itemLabelField);
  const field =
    (declared && itemFields.find((f) => f?.key === declared && headable(f))) ||
    itemFields.find(headable);
  return field
    ? { key: field.key, text: str(item[field.key]) }
    : { key: null, text: '' };
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
 * A link text (`hrefKey`) is no heading either: an action button's label is the
 * link, not a title over it. All three exclusions are declarations, not a list
 * of key names to skip.
 *
 * @param {object} item - one entry of the field's array
 * @param {Array<object>} itemFields - the field's `itemFields[]`
 * @param {string} [itemLabelField] - declared heading sub-field, if any
 * @param {object} [itemDefaults] - the field's `itemDefaults` skeleton, the
 *   declared default an item's own `semantic` enum resolves through
 * @param {object} [ctx]
 * @param {string} [ctx.lang] - the deck language
 * @param {string[]} [ctx.slideIds] - the document's slide ids, for jumps
 * @param {object} [ctx.parent] - the object holding the items field
 * @param {string} [ctx.parentKey] - the key of that items field
 */
function renderItemBlock(
  item,
  itemFields,
  itemLabelField,
  itemDefaults,
  { lang, slideIds, parent, parentKey } = {},
) {
  if (!item || typeof item !== 'object' || !Array.isArray(itemFields))
    return '';
  const consumed = itemConsumedKeys(itemFields, item);
  const { key: headingKey, text: headingText } = itemHeading(
    item,
    itemFields,
    itemLabelField,
    consumed,
  );
  // The item's own heading is the alt fallback for its image — a card's name
  // describes its portrait when nothing names it more precisely.
  const below = renderBlocks(
    itemFields.filter(
      (f) => f && f.key !== headingKey && !f.hidden && !consumed.has(f.key),
    ),
    item,
    {
      defaults: itemDefaults,
      itemHeading: headingText,
      parent,
      parentKey,
      siblings: itemFields,
      lang,
      slideIds,
    },
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
 * Project a set of pictures as one `<figure role="group">` (D135): each picture
 * its own `<figure>` with its own caption, and the set's caption — the
 * `<key>Caption` / `caption` sibling of the set, in the object that holds it —
 * as the group's one `<figcaption>`. A set is one thing on the canvas with one
 * caption under it; a `<ul>` of one-picture items with a loose caption
 * paragraph beside it said it was a list of unrelated things.
 *
 * @param {string} key - the set's field key, for `data-field`
 * @param {Array<{src: unknown, a11y: {alt: string, decorative: boolean, caption: string}, attrs?: string}>} figures
 *   `attrs` is the picture's own `data-field`, when it has a field of its own
 * @param {object} content - the object holding the set
 * @returns {string}
 */
function renderFigureGroup(key, figures, content) {
  const figs = figures
    .map(({ src, a11y, attrs }) => renderFigure(src, a11y, attrs))
    .filter(Boolean);
  if (!figs.length) return '';
  const captionKey = str(content?.[`${key}Caption`])
    ? `${key}Caption`
    : 'caption';
  const caption = str(content?.[captionKey]);
  const figcaption = caption
    ? `<figcaption${fieldAttr(captionKey)}>${escapeHtml(caption)}</figcaption>`
    : '';
  return `<figure class="reader-gallery" role="group"${fieldAttr(key)}>${figs.join('')}${figcaption}</figure>`;
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
 * Project a `duration` field: the minutes it holds and the seconds its
 * `secondsKey` sibling holds, as one `<time>` (D131). The length is resolved by
 * the same rule the canvas counts down from (`duration.js`), so the reader
 * states the timer the audience sees.
 *
 * @param {object} field - the minutes field, declaring `duration`
 * @param {object} content
 * @param {{defaults?: object, siblings?: Array<object>}} opts
 * @returns {string}
 */
function renderDuration(field, content, { defaults, siblings }) {
  const seconds = durationSeconds(field, siblings, content, defaults);
  if (!seconds) return '';
  return `<p${fieldAttr(field.key)}><time datetime="${isoDuration(seconds)}">${clockDuration(seconds)}</time></p>`;
}

/**
 * Project a type's `scale`: the two ends of a rating scale as a `<dl>`, each
 * end's number the term and its label the description. The scale is a
 * declaration on the type because the canvas draws its ticks from the same
 * `min`/`max`, so the numbers the reader names are the ones the slide shows.
 *
 * @param {{min: number, max: number, minLabelKey?: string, maxLabelKey?: string}} scale
 * @param {object} content
 * @returns {string}
 */
function renderScale(scale, content) {
  const ends = [
    [scale.min, scale.minLabelKey],
    [scale.max, scale.maxLabelKey],
  ]
    .map(([n, key]) => {
      const label = str(key) ? str(content?.[key]) : '';
      return label
        ? `<div class="reader-field"><dt>${escapeHtml(String(n))}</dt><dd${fieldAttr(key)}>${escapeHtml(label)}</dd></div>`
        : '';
    })
    .join('');
  return ends ? `<dl class="reader-fields">${ends}</dl>` : '';
}

/**
 * The type's `scale`, when it declares a usable one.
 * @param {object} def
 * @returns {{min: number, max: number, minLabelKey?: string, maxLabelKey?: string}|null}
 */
function declaredScale(def) {
  const scale = def?.scale;
  if (!scale || typeof scale !== 'object') return null;
  if (!Number.isFinite(scale.min) || !Number.isFinite(scale.max)) return null;
  return scale;
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
 * @param {string[]} [opts.slideIds] - the document's slide ids, for jumps
 * @param {string} [opts.itemHeading] - the heading of the item `content` is
 * @param {object} [opts.parent] - the object holding that item's field
 * @param {string} [opts.parentKey] - the key of that items field
 * @param {string} [opts.figcaption] - a ready `<figcaption>` for an image
 */
function renderFieldValue(
  field,
  content,
  {
    defaults,
    siblings,
    lang,
    slideIds,
    itemHeading = '',
    parent = null,
    parentKey = '',
    figcaption = '',
  } = {},
) {
  if (!field || field.hidden) return '';
  if (NON_CONTENT_GLOBAL_KEYS.has(field.key)) return '';
  // A number is configuration, unless it declares that it is a length.
  if (field.duration && field.type === 'number' && !field.presentational) {
    return renderDuration(field, content, { defaults, siblings });
  }
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
      return renderTextField(field, content, defaults, {
        siblings,
        lang,
        slideIds,
      });
    case 'code': {
      const v = str(value);
      if (!v) return '';
      // Author markup the canvas renders is content, not source: the reader
      // renders it through the canvas's own sanitizer, as one wrapper that
      // names the field (D145: no surgery on sanitizer output). Author CSS is
      // presentation, in the `css` field and in a `style` attribute alike, so
      // the projection asks for the tree without it (D151).
      if (field.markup === true) {
        const html = sanitizeSlideHtmlSync(v, { presentation: false });
        return html ? `<div${attrs}>${html}</div>` : '';
      }
      return `<pre class="reader-code"${attrs}><code>${escapeHtml(v)}</code></pre>`;
    }
    case 'csv': {
      const v = str(value);
      return v ? renderCsvTable(v, '', attrs) : '';
    }
    case 'image': {
      const a11y = resolveImageA11y(field, content, {
        itemHeading,
        parent,
        parentKey,
      });
      return renderFigure(value, a11y, attrs, figcaption);
    }
    case 'images': {
      // URLs only, so nothing names a picture: the alt is empty, and a type
      // whose pictures need one declares `items` instead (field-types.js).
      if (!Array.isArray(value)) return '';
      const decorative =
        imageSibling(content, field.key, 'Role', 'imageRole') === 'decorative';
      return renderFigureGroup(
        field.key,
        value.map((src) => ({
          src,
          a11y: { alt: '', decorative, caption: '' },
        })),
        content,
      );
    }
    case 'items': {
      if (!Array.isArray(value) || !value.length) return '';
      const groupImage = figureGroupImageField(field);
      if (groupImage) {
        return renderFigureGroup(
          field.key,
          value.map((item) => ({
            src: item?.[groupImage.key],
            attrs: fieldAttr(groupImage.key),
            a11y: resolveImageA11y(groupImage, item || {}, {
              parent: content,
              parentKey: field.key,
            }),
          })),
          content,
        );
      }
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
            { lang, slideIds, parent: content, parentKey: field.key },
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
      const { href, text } = linkTarget(value, { slideIds, lang });
      if (!href) return '';
      return `<p${attrs}><a href="${escapeHtml(href)}">${escapeHtml(text)}</a></p>`;
    }
    case 'email': {
      const address = str(value);
      if (!isEmailAddress(address)) return '';
      return `<p${attrs}><a href="mailto:${escapeHtml(address)}">${escapeHtml(address)}</a></p>`;
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
 * @param {{ headingKey?: string|null, lang?: string, slideIds?: string[] }} [opts]
 *   `lang` is the deck language, for the copy a slide shows without storing it;
 *   `slideIds` the document's slide ids in order, so a slide jump can link
 * @returns {string} inner HTML for the slide section
 */
export function renderSlideBodySemanticHtml(
  slide,
  def,
  { headingKey = null, lang, slideIds } = {},
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
  for (const key of pairedKeys(fields)) consumed.add(key);

  // The structure contract, where it asks for more than the field vocabulary
  // alone gives (structure.js / docs/reference/deck-conformance.md).
  const structure = slideStructure(def);
  const visibleByKey = new Map(fields.map((f) => [f.key, f]));
  const structuredHtmlByKey = new Map();
  // `scale`: the two end labels are one `<dl>`, placed where the first of them
  // is declared.
  const scale = declaredScale(def);
  if (scale) {
    const ends = [scale.minLabelKey, scale.maxLabelKey].filter((k) => str(k));
    const first = fields.find((f) => ends.includes(f?.key));
    if (first) structuredHtmlByKey.set(first.key, renderScale(scale, content));
    for (const key of ends) consumed.add(key);
  }
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
        structured: structuredHtmlByKey,
        siblings: def?.fields,
        lang,
        slideIds,
      },
    ),
  );
  return parts.filter(Boolean).join('\n');
}

/**
 * The pictures on a slide that mean something and that the reader could name
 * with nothing: not decorative, and empty at the end of the alt ladder
 * ({@link resolveImageA11y}). Publishing refuses a deck with any (D137).
 *
 * It walks the declarations, not a list of types: every `image` field the
 * reader would draw, at the top of the slide and inside each item, the way the
 * projection finds them — the same visibility, the same presentational and
 * global-config exclusions, the same item heading as a name. A check that
 * answered differently from the document it guards would refuse decks that
 * read fine and publish decks that do not. `images` (a URL array) carries no
 * alt per picture and is outside the check; a type whose pictures need a
 * name declares `items`.
 *
 * @param {object} slide
 * @param {object|null|undefined} def - the resolved slide-type definition
 * @returns {Array<{ field: string, itemIndex?: number, itemField?: string }>}
 *   `field` is the top-level key; for a picture in an item, `itemIndex` and
 *   `itemField` say which one
 */
export function imagesMissingAlt(slide, def) {
  if (!def) return [];
  const content =
    slide?.content && typeof slide.content === 'object' ? slide.content : {};
  const defaults =
    def.defaults && typeof def.defaults === 'object' ? def.defaults : {};
  const drawn = (field) =>
    !!field &&
    !field.hidden &&
    !isPresentationalField(field) &&
    !NON_CONTENT_GLOBAL_KEYS.has(field.key);
  const unnamed = (field, obj, opts) => {
    if (field.type !== 'image' || !normalizeUrl(obj?.[field.key])) return false;
    const { alt, decorative } = resolveImageA11y(field, obj, opts);
    return !decorative && !alt;
  };
  const missing = [];
  for (const field of Array.isArray(def.fields) ? def.fields : []) {
    if (!drawn(field) || !isFieldVisible(field, content, defaults)) continue;
    if (unnamed(field, content)) missing.push({ field: field.key });
    const items = content[field.key];
    if (field.type !== 'items' || !Array.isArray(items)) continue;
    const itemFields = Array.isArray(field.itemFields) ? field.itemFields : [];
    items.forEach((item, itemIndex) => {
      if (!item || typeof item !== 'object') return;
      const opts = {
        itemHeading: itemHeading(item, itemFields, field.itemLabelField).text,
        parent: content,
        parentKey: field.key,
      };
      for (const sub of itemFields) {
        if (drawn(sub) && unnamed(sub, item, opts)) {
          missing.push({ field: field.key, itemIndex, itemField: sub.key });
        }
      }
    });
  }
  return missing;
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
 * @param {{ index?: number, lang?: string, slideIds?: string[] }} [opts] -
 *   0-based position in the deck, the deck language, and the ids of the
 *   document's slides in order (for links that jump to a slide)
 * @returns {string}
 */
export function renderSlideSectionHtml(
  slide,
  def,
  { index = 0, lang, slideIds } = {},
) {
  const n = index + 1;
  const heading = slideHeading(slide, def, { index, lang });
  const inner = def
    ? renderSlideBodySemanticHtml(slide, def, {
        headingKey: heading.key,
        lang,
        slideIds,
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

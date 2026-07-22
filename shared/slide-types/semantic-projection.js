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
 */

import { markdownToSafeHtml } from '../markdown.js';
import { escapeHtml, pickAltText, normalizeUrl, safeHref } from './helpers.js';

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
  const content = slide?.content && typeof slide.content === 'object' ? slide.content : {};
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
  const fig = caption
    ? `<figcaption>${escapeHtml(caption)}</figcaption>`
    : '';
  return `<figure class="reader-figure"><img src="${escapeHtml(url)}" alt="${altAttr}"${ariaHidden} loading="lazy" />${fig}</figure>`;
}

/**
 * Content keys an `image` field folds into its <figure> (alt/caption/role), so
 * they are not also rendered as standalone paragraphs.
 * @param {string} fieldKey
 * @returns {string[]}
 */
function imageSiblingKeys(fieldKey) {
  return [`${fieldKey}Alt`, 'alt', `${fieldKey}Caption`, 'caption', `${fieldKey}Role`, 'imageRole'];
}

/**
 * Resolve alt text / decorative state / caption for an image field, using the
 * sibling-key conventions (`alt`, `<key>Alt`, `imageRole`, `caption`).
 */
function resolveImageA11y(fieldKey, content, headingText) {
  const explicit =
    str(content[`${fieldKey}Alt`]) || str(content.alt) || str(content[`${fieldKey}Caption`]);
  const role =
    str(content[`${fieldKey}Role`]) || str(content.imageRole);
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

/** Parse a simple CSV string into a semantic <table> (first row = header). */
function renderCsvTable(csv) {
  const rows = String(csv || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => r.split(',').map((c) => c.trim()));
  if (!rows.length) return '';
  const [head, ...body] = rows;
  const thead = `<thead><tr>${head
    .map((c) => `<th scope="col">${escapeHtml(c)}</th>`)
    .join('')}</tr></thead>`;
  const tbody = body.length
    ? `<tbody>${body
        .map(
          (r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`
        )
        .join('')}</tbody>`
    : '';
  return `<table class="reader-table">${thead}${tbody}</table>`;
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
  if (!item || typeof item !== 'object' || !Array.isArray(itemFields)) return '';
  const parts = [];
  let headingKey = null;
  const firstString = itemFields.find(
    (f) => f?.type === 'string' && !f.hidden && str(item[f.key])
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
      return v ? `<pre class="reader-code"><code>${escapeHtml(v)}</code></pre>` : '';
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
          })
        )
        .filter(Boolean);
      return figs.length ? `<div class="reader-gallery">${figs.join('')}</div>` : '';
    }
    case 'items': {
      if (!Array.isArray(value) || !value.length) return '';
      const blocks = value
        .map((item) => renderItemBlock(item, field.itemFields))
        .filter(Boolean);
      return renderItemList(blocks, field.ordered === true);
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
    // card-stack's card{n}Label) is skipped by renderItemBlock rather than
    // surfacing in the reader.
    return { key: suffix, type: decl?.type || 'string', hidden: decl?.hidden };
  });
  // Upper bound: how many slots the schema actually declares.
  let maxSlots = 0;
  while (slotFields.some((s) => fieldByKey.has(`${prefix}${maxSlots + 1}${s}`))) {
    maxSlots += 1;
  }
  const declared = Number.parseInt(str(content[countKey]), 10);
  const count = Number.isFinite(declared)
    ? Math.max(0, Math.min(declared, maxSlots))
    : maxSlots;
  const blocks = [];
  for (let n = 1; n <= count; n += 1) {
    const item = {};
    for (const suffix of slotFields) item[suffix] = content[`${prefix}${n}${suffix}`];
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
export function renderSlideBodySemanticHtml(slide, def, { headingKey = null, headingText = '' } = {}) {
  const content = slide?.content && typeof slide.content === 'object' ? slide.content : {};
  const fields = Array.isArray(def?.fields) ? def.fields : [];
  const parts = [];

  const summary = str(content.a11ySummary);
  if (summary) parts.push(`<p class="reader-summary">${escapeHtml(summary)}</p>`);

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

  // Flat repeating groups (card-stack etc.): project the whole group at its
  // count-field position and consume the count + every numbered slot field, so
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
      if (field && isRepeatingGroupSlotKey(group, field.key)) consumed.add(field.key);
    }
    groupHtmlByAnchor.set(group.countKey, projectRepeatingGroup(group, content, fields));
  }

  for (const field of fields) {
    if (!field || field.key === headingKey) continue;
    if (groupHtmlByAnchor.has(field.key)) {
      parts.push(groupHtmlByAnchor.get(field.key));
      continue;
    }
    if (consumed.has(field.key)) continue;
    parts.push(renderFieldValue(field, content, headingText));
  }
  return parts.filter(Boolean).join('\n');
}

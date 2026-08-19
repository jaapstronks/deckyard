/**
 * The render contract for a slide whose type does not resolve.
 *
 * A deck outlives the code that rendered it. When a core type is removed (or a
 * deck arrives from a fork that has a type this install doesn't), the stored
 * slide keeps its `type` string and its content, and every render surface has
 * to do *something* with it. That something used to be a bare "Unknown slide
 * type" box: it named nothing, showed nothing, exported nothing. Acceptable
 * while the only removed types had zero decks; wrong as a general promise, and
 * the blocker for removing a type people actually used.
 *
 * The promise this module makes instead, on every surface:
 *
 * 1. **Name the type.** The author sees exactly which type is missing.
 * 2. **Say why, when the answer is known.** `getRemovedSlideType()` separates
 *    "deliberately removed on date X, use Y instead" from "no idea what this
 *    is" — the distinction the generic fallback could not make.
 * 3. **Keep the content visible.** Every stored field is rendered as readable
 *    text, so nothing is silently dropped and the author can move it by hand.
 * 4. **Stay a slide, not an error.** It renders, exports, prints and reads as
 *    an archived slide: calm, in-flow, no error styling. A deck with one of
 *    these is a deck with an old slide in it, not a broken deck.
 *
 * The canvas placeholder is *bounded* (a fixed 1600x900 frame cannot grow) and
 * says how much it left out; the reader projection is *complete*, because a
 * reflowable document has room. The reader is therefore the recovery surface:
 * whatever the canvas truncates is readable there in full.
 *
 * @see docs/reference/slide-type-removal.md
 * @see ./removed.js — the tombstone record this reads.
 */

import { escapeHtml } from './helpers.js';
import { getRemovedSlideType } from './removed.js';
import { SLIDE_TYPES } from './registry.js';

/**
 * Content keys that configure presentation rather than carry content: the
 * global per-slide background/logo fields and the text-style override map.
 * Dumping them would bury the actual text under layout plumbing.
 */
const NON_CONTENT_KEYS = new Set([
  'slideBgImage',
  'slideBgFit',
  'slideBgFocusX',
  'slideBgFocusY',
  'slideBgOverlay',
  'slideBgText',
  'slideLogo',
  'background',
  'bgCustomColor',
  'textStyles',
]);

/** Ordered fallback of common "title" keys, mirroring the semantic projection. */
const TITLE_CANDIDATE_KEYS = [
  'title',
  'heading',
  'a11yTitle',
  'subheading',
  'question',
  'prompt',
  'statement',
  'quote',
];

/** How many content entries the fixed-size canvas placeholder shows. */
const CANVAS_ENTRY_LIMIT = 6;
/** How long a single value may be on the canvas before it is elided. */
const CANVAS_VALUE_LIMIT = 160;

function str(v) {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * `col1Title` -> `Col 1 title`. The stored key is all we have without a type
 * definition, so it is shown honestly rather than dressed up as a real label.
 *
 * @param {string} key
 * @returns {string}
 */
function humanizeKey(key) {
  const spaced = String(key)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
  if (!spaced) return String(key);
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

/**
 * One stored value as plain lines of text. Scalars become one line; arrays and
 * objects are flattened one level (`Title: …`) so a repeating group's slots
 * stay readable instead of collapsing into `[object Object]`.
 *
 * @param {unknown} value
 * @returns {string[]}
 */
function valueLines(value) {
  if (value == null) return [];
  if (typeof value === 'string') return value.trim() ? [value.trim()] : [];
  if (typeof value === 'number' || typeof value === 'boolean') {
    return [String(value)];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => valueLines(entry));
  }
  if (typeof value === 'object') {
    return Object.entries(value)
      .map(([k, v]) => {
        const inner = valueLines(v);
        return inner.length ? `${humanizeKey(k)}: ${inner.join(' — ')}` : '';
      })
      .filter(Boolean);
  }
  return [];
}

/**
 * Every readable field of a slide's stored content, as `{ key, label, lines }`.
 * Type-definition free by necessity: the type is gone, so the content's own
 * keys are the only vocabulary left.
 *
 * @param {object} content
 * @returns {Array<{key: string, label: string, lines: string[]}>}
 */
export function unresolvedContentEntries(content) {
  const src = content && typeof content === 'object' ? content : {};
  const entries = [];
  for (const [key, value] of Object.entries(src)) {
    if (NON_CONTENT_KEYS.has(key)) continue;
    const lines = valueLines(value);
    if (!lines.length) continue;
    entries.push({ key, label: humanizeKey(key), lines });
  }
  return entries;
}

/**
 * What is known about a type that did not resolve.
 *
 * `state` is the whole point of the tombstone record: `removed` means the
 * project deliberately retired the type and can say when, why and what to use
 * instead; `unknown` means the name belongs to nothing this install knows (a
 * fork's custom type, a typo, a deck from the future).
 *
 * @param {string} type
 * @returns {{
 *   type: string,
 *   state: 'removed'|'unknown',
 *   removed: string,
 *   reason: string,
 *   successor: string|null,
 *   successorLabel: string
 * }}
 */
export function describeUnresolvedType(type) {
  const name = str(type);
  const record = getRemovedSlideType(name);
  if (!record) {
    return {
      type: name,
      state: 'unknown',
      removed: '',
      reason: '',
      successor: null,
      successorLabel: '',
    };
  }
  const successor = str(record.successor) || null;
  return {
    type: name,
    state: 'removed',
    removed: str(record.removed),
    reason: str(record.reason),
    successor,
    successorLabel: successor
      ? str(SLIDE_TYPES[successor]?.label) || successor
      : '',
  };
}

/**
 * The one-or-two sentence explanation, as plain text (no markup), so the canvas
 * placeholder, the reader projection and the import placeholder all say the
 * same thing.
 *
 * @param {ReturnType<typeof describeUnresolvedType>} info
 * @returns {string[]}
 */
export function unresolvedNotes(info) {
  const name = info.type || '(missing type)';
  if (info.state !== 'removed') {
    return [
      `This slide uses the type "${name}", which this Deckyard does not have.`,
      'Its stored content is shown below so nothing is lost.',
    ];
  }
  const when = info.removed ? ` (${info.removed})` : '';
  const first = `The "${name}" slide type was removed from Deckyard${when}.`;
  const second = info.successor
    ? `Rebuild this slide as a "${info.successorLabel}" slide; its stored content is shown below.`
    : 'There is no replacement type; its stored content is shown below so nothing is lost.';
  return [first, second];
}

/**
 * Heading for the placeholder: the slide's own title if it stored one, so an
 * archived slide still reads as itself in a thumbnail strip and an outline.
 *
 * Returns the source key too, so the content list can skip it — repeating the
 * title as a field row is noise, not preservation.
 *
 * @param {object} content
 * @param {ReturnType<typeof describeUnresolvedType>} info
 * @returns {{text: string, key: string|null}}
 */
function placeholderHeading(content, info) {
  const src = content && typeof content === 'object' ? content : {};
  for (const key of TITLE_CANDIDATE_KEYS) {
    const v = str(src[key]);
    if (v) return { text: v, key };
  }
  return {
    text: info.state === 'removed' ? 'Archived slide' : 'Unavailable slide',
    key: null,
  };
}

function truncate(text, max) {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/**
 * The canvas placeholder: what a removed or unknown type looks like in the
 * editor, the presenter, an image/PDF export and an embed.
 *
 * Deliberately bounded — a slide frame does not scroll, so it shows the first
 * few fields and says how many it withheld, pointing at the reader view for the
 * rest. Everything is escaped: this renders content that no live type
 * definition has validated.
 *
 * @param {object} slide - the stored slide (`{type, content}`)
 * @returns {string} slide markup
 */
export function renderUnresolvedSlideHtml(slide) {
  const content =
    slide?.content && typeof slide.content === 'object' ? slide.content : {};
  const info = describeUnresolvedType(slide?.type);
  const heading = placeholderHeading(content, info);
  const notes = unresolvedNotes(info)
    .map((line) => `<p class="unresolved-note">${escapeHtml(line)}</p>`)
    .join('');

  // The field promoted to the heading is not repeated as a row.
  const entries = unresolvedContentEntries(content).filter(
    (e) => e.key !== heading.key,
  );
  const shown = entries.slice(0, CANVAS_ENTRY_LIMIT);
  const hidden = entries.length - shown.length;
  const rows = shown
    .map(
      (entry) => `<div class="unresolved-row">
            <dt>${escapeHtml(entry.label)}</dt>
            <dd>${escapeHtml(truncate(entry.lines.join(' · '), CANVAS_VALUE_LIMIT))}</dd>
          </div>`,
    )
    .join('');
  const list = rows ? `<dl class="unresolved-content">${rows}</dl>` : '';
  const more =
    hidden > 0
      ? `<p class="unresolved-more">${escapeHtml(
          `+${hidden} more field${hidden === 1 ? '' : 's'} — open the reader view for the full content.`,
        )}</p>`
      : '';

  return `
      <div class="slide slide-unresolved" data-slide-type="${escapeHtml(info.type)}" data-unresolved-state="${escapeHtml(info.state)}">
        <div class="slide-inner">
          <p class="unresolved-kicker">${info.state === 'removed' ? 'Archived slide type' : 'Unavailable slide type'}</p>
          <div class="heading">${escapeHtml(heading.text)}</div>
          ${notes}
          ${list}
          ${more}
        </div>
      </div>
    `;
}

/**
 * The reader/reflow projection: the same promise as a reflowable document.
 *
 * This is the complete surface — no entry limit, no elision — because the
 * reader is where an author recovers content the canvas could not fit. Emitted
 * in place of the "no readable content" note the reader used to show for an
 * unresolvable slide.
 *
 * @param {object} slide
 * @param {{headingKey?: string|null}} [opts] - the content key already used as
 *   the section heading, so it is not repeated in the body.
 * @returns {string} inner HTML for the reader's <section>
 */
export function renderUnresolvedSlideSemanticHtml(
  slide,
  { headingKey = null } = {},
) {
  const content =
    slide?.content && typeof slide.content === 'object' ? slide.content : {};
  const info = describeUnresolvedType(slide?.type);
  const notes = unresolvedNotes(info)
    .map((line) => `<p class="reader-archived">${escapeHtml(line)}</p>`)
    .join('\n');

  const rows = unresolvedContentEntries(content)
    .filter((entry) => entry.key !== headingKey)
    .map(
      (entry) => `<div class="reader-field">
          <dt>${escapeHtml(entry.label)}</dt>
          <dd>${entry.lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('')}</dd>
        </div>`,
    )
    .join('\n');

  return rows ? `${notes}\n<dl class="reader-fields">${rows}</dl>` : notes;
}

/**
 * The same content as markdown, for the one surface that has to store text
 * rather than render it: deck import, which turns an unresolvable slide into a
 * real `content-slide` so the imported deck stays editable and saveable.
 *
 * @param {object} slide
 * @returns {{title: string, body: string}}
 */
export function unresolvedSlideAsMarkdown(slide) {
  const content =
    slide?.content && typeof slide.content === 'object' ? slide.content : {};
  const info = describeUnresolvedType(slide?.type);
  const lines = unresolvedNotes(info).slice();
  const entries = unresolvedContentEntries(content);
  if (entries.length) {
    lines.push('');
    for (const entry of entries) {
      lines.push(`**${entry.label}**`);
      for (const line of entry.lines) lines.push(line);
      lines.push('');
    }
  }
  const heading = placeholderHeading(content, info);
  return {
    title: heading.text,
    body: lines.join('\n').trim(),
  };
}

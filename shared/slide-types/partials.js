/**
 * Reusable inline elements shared by core and fork slide types.
 *
 * WHY THIS FILE EXISTS
 * The same three small elements were re-inlined per type, each with its own
 * class name and its own CSS rule: an eyebrow above a heading
 * (`.sfi-card-kicker`), a status chip (`.badge`), and a coloured run inside a
 * line (`.kpi-delta`). A forker writing a fourth type had nothing to compose,
 * so the only way to get a badge was to invent a fourth spelling of one.
 *
 * The CSS half of this library was already shipped — `00-patterns.css` has
 * declared itself "reusable component patterns used across multiple slide
 * types" since before the split — but it had no JS half, so **nothing rendered
 * its classes** and every type went and inlined its own anyway. This module is
 * that missing half: the partials emit the classes, `00-patterns.css` styles
 * them, and a type composes rather than re-spells.
 *
 * THE SHAPE OF A PARTIAL (all three follow `cardLinkOverlayHtml` /
 * `renderSubheadingHtml` in helpers.js, which is where the pattern was proven):
 *
 * - **Pure string in, HTML string out**, `''` for empty input — so a type drops
 *   the call straight into its template literal with no branch of its own.
 * - **`field` opts into inline editing.** Pass a `data-inline-field` path and
 *   the element becomes click-to-editable with zero extra work; a core type
 *   adds the matching descriptor entry, a fork type expresses it in its JSON
 *   `inline` property. No core file has to change for a fork's partial to be
 *   editable.
 * - **Every text value goes through `escapeHtml`.** A partial is never a hole
 *   in the escaping contract (docs/reference/html-escaping.md).
 *
 * NOT HERE: call-to-action buttons. `renderActionsHtml()` in `actions-field.js`
 * already is that partial — `.slide-action` with a primary/secondary/outline
 * vocabulary, paired with `ACTIONS_FIELD`, rendered by content-slide and
 * image-text-slide. A second CTA spelling beside it would be the drift this
 * library exists to remove.
 */

import { escapeHtml, nonEmpty } from './helpers.js';

/**
 * The tone vocabulary, shared by every partial that carries colour.
 *
 * `default` is the element's own base treatment — a filled emphasis band for a
 * badge, the inherited text colour for a highlight — and emits no modifier
 * class. The other six are the semantic status ROLES from `00-tokens.css`
 * (`--slide-color-{positive,danger,caution,informative,neutral,helpful}`), the
 * same family `callout-slide`'s five variants read. They are named for the
 * MEANING, so a partial never mints a colour of its own and a theme never has
 * to learn a slide type's name to restyle one
 * (docs/reference/slide-roles.md § Semantic status is a role, not a type family).
 *
 * @type {readonly string[]}
 */
export const PARTIAL_TONES = Object.freeze([
  'default',
  'positive',
  'danger',
  'caution',
  'informative',
  'neutral',
  'helpful',
]);

/**
 * The modifier class for a tone, or `''` for the base treatment.
 *
 * An unknown tone falls back to the base rather than emitting a class no
 * stylesheet defines — an invalid tone should look plain, not unstyled. A fork
 * passing a typo gets the default chip instead of an uncoloured one, and
 * `validateSlideTypeDefinition` is where a wrong vocabulary gets reported.
 *
 * @param {string} base - the partial's base class, e.g. `slide-badge`
 * @param {unknown} tone - a value from {@link PARTIAL_TONES}
 * @returns {string} ` slide-badge--danger`, or ''
 */
function toneClass(base, tone) {
  const t = typeof tone === 'string' ? tone.trim() : '';
  if (!t || t === 'default' || !PARTIAL_TONES.includes(t)) return '';
  return ` ${base}--${t}`;
}

/** The `data-inline-field` attribute for a field path, or '' for none. */
function inlineFieldAttr(field) {
  const f = nonEmpty(field);
  return f ? ` data-inline-field="${escapeHtml(f)}"` : '';
}

/**
 * An eyebrow: the small standing label above a heading.
 *
 * Caption scale, uppercase, tracked and muted — the treatment core already
 * spells twice by hand (`callout-slide`'s eyebrow, the unresolved-slide
 * placeholder) and the one `--slide-font-size-label` is documented for
 * ("kickers, eyebrows, axis labels", 00-tokens.css).
 *
 * @param {unknown} text - the label; empty or whitespace yields ''
 * @param {Object} [options]
 * @param {string|null} [options.field] - `data-inline-field` path, to make it
 *   click-to-editable on the canvas.
 * @param {string|null} [options.morphRole] - `data-morph-role` value, so morph
 *   transitions can target it across slides.
 * @returns {string} HTML string, or '' when there is nothing to label
 */
export function eyebrowHtml(text, { field = null, morphRole = null } = {}) {
  const label = nonEmpty(text);
  if (!label) return '';
  const morphAttr = morphRole
    ? ` data-morph-role="${escapeHtml(morphRole)}"`
    : '';
  return `<p class="slide-eyebrow"${morphAttr}${inlineFieldAttr(field)} dir="auto">${escapeHtml(label)}</p>`;
}

/**
 * A badge: a short status or label chip.
 *
 * The base chip fills itself with the `emphasis` role
 * (`--slide-emphasis` / `--slide-on-emphasis`) — the accent-fed pair a type
 * emphasises with, which is contrast-guaranteed by the theme colour contract
 * on any ground. A tone swaps that fill for one of the semantic status roles.
 *
 * @param {unknown} text - the chip's text; empty or whitespace yields ''
 * @param {Object} [options]
 * @param {string|null} [options.field] - `data-inline-field` path.
 * @param {string} [options.tone] - one of {@link PARTIAL_TONES}.
 * @returns {string} HTML string, or ''
 */
export function badgeHtml(text, { field = null, tone = 'default' } = {}) {
  const label = nonEmpty(text);
  if (!label) return '';
  const cls = `slide-badge${toneClass('slide-badge', tone)}`;
  return `<span class="${cls}"${inlineFieldAttr(field)} dir="auto">${escapeHtml(label)}</span>`;
}

/**
 * A highlight: a coloured run inside a line.
 *
 * Colour only — no weight, no background — because a highlight sits inside
 * running text and anything heavier competes with the line it is part of. The
 * colour comes from `--slide-tone`, which a type may rebind locally when its
 * highlight has to read against something other than the slide (the KPI tile
 * does exactly that, so a delta stays legible on every tile fill).
 *
 * @param {unknown} text - the run; empty or whitespace yields ''
 * @param {Object} [options]
 * @param {string} [options.tone] - one of {@link PARTIAL_TONES}.
 * @returns {string} HTML string, or ''
 */
export function highlightHtml(text, { tone = 'default' } = {}) {
  const run = nonEmpty(text);
  if (!run) return '';
  const cls = `slide-highlight${toneClass('slide-highlight', tone)}`;
  return `<span class="${cls}" dir="auto">${escapeHtml(run)}</span>`;
}

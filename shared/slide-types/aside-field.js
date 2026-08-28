/**
 * The ASIDE INSET — a contrast block *within* a content slide.
 *
 * The second half of the admonition family. `callout-slide` is the whole-slide
 * move: a warning that gets its own beat in the deck, contrasting against the
 * slides before and after it. This is the other one — the small note, tip or
 * warning that comments on the body it sits beside without earning a slide of
 * its own, contrasting *spatially* the way a callout in a document does.
 *
 * It is a shared FIELD PAIR rather than a type, because the thing it belongs
 * to is another slide. Three host types spread it today (`content-slide`,
 * `list-slide`, `image-text-slide`) and a fourth would cost one line plus the
 * `renderAsideHtml()` call.
 *
 * ## Why two flat fields instead of one `aside: { variant, text }`
 *
 * The editorial brief sketched the aside as a nested object. It is a pair of
 * flat fields instead, because `field.type` is a **closed vocabulary**
 * (`field-types.js`) with no `object` in it, and minting one for a single
 * two-property field would have meant a new entry in the type registry, a new
 * branch in JSON-Schema generation, a new branch in the editor's field
 * renderer, a new validator and a new docs row — a change to the field SYSTEM,
 * smuggled in under a slide-type feature.
 *
 * The pair is not a workaround for that; it is the form the codebase already
 * has for exactly this shape. `ON_CLOSE_FIELD` + `ON_CLOSE_TARGET_FIELD` in
 * `helpers.js` is one choice enum plus one field that only means anything for
 * some of its values, declared as two fields and joined by `visibleWhen`. So
 * is this: `asideVariant` is the choice — including "no aside", which is what
 * makes the second control appear at all — and `asideText` is what the inset
 * says. Everything else follows for free: the editor renders both from the
 * generic form loop with no per-type code, `asideText` is a `markdown` field
 * so the text-field vocabulary (`text-fields.js`) picks it up as translatable
 * without being told, and there is no half-empty `{ variant }` object to prune
 * on save, because there is no object.
 *
 * ## What it promises the decks that already exist
 *
 * `renderAsideHtml()` returns `''` unless a host slide names a kind AND has
 * something to say, so every deck written before this field existed renders
 * byte for byte what it always did. `tests/aside-inset.test.js` asserts that
 * per host type rather than trusting it.
 */

import { escapeHtml, nonEmpty } from './helpers.js';
import { markdownToSafeHtml } from '../markdown.js';
import { iconUrl } from '../icon-names.js';
import { sharedOption } from '../ui-i18n-keys.js';
import { eyebrowHtml } from './partials.js';
import { getSlideCopy } from './slide-copy.js';
import {
  ADMONITION_META,
  QUIET_ADMONITION_VARIANTS,
  resolveAdmonitionVariant,
} from './admonitions.js';

/**
 * The value that means "this slide has no aside".
 *
 * An explicit member of the enum rather than an empty option, because it is a
 * real choice an author makes and unmakes — and because it is the driver of
 * the text field's `visibleWhen`, which reads exact values and so needs a word
 * for "off". Same shape as `chart-slide`'s `pieLabels: none`.
 */
export const ASIDE_NONE = 'none';

/** The kinds an inset may take: the quiet three. */
export const ASIDE_VARIANTS = QUIET_ADMONITION_VARIANTS;

/**
 * The kind of aside, or `none`.
 *
 * Type-independent copy, so its strings live under `editor.slideField.*` (D60)
 * — three host types spreading a per-type key would mint three copies of the
 * same five words and hand every translator the same job three times.
 */
export const ASIDE_VARIANT_FIELD = {
  key: 'asideVariant',
  label: 'Aside',
  labelKey: 'editor.slideField.asideVariant.label',
  type: 'enum',
  required: false,
  options: [
    sharedOption('editor.slideField.asideVariant.option.none', 'none', 'None'),
    sharedOption('editor.slideField.asideVariant.option.note', 'note', 'Note'),
    sharedOption('editor.slideField.asideVariant.option.tip', 'tip', 'Tip'),
    sharedOption(
      'editor.slideField.asideVariant.option.warning',
      'warning',
      'Warning',
    ),
  ],
};

/**
 * What the inset says.
 *
 * Capped well below `callout-slide`'s 600: an inset that runs longer than a
 * short paragraph is competing with the body it annotates, and at that length
 * the idea has outgrown the margin and wants its own slide. The cap is the
 * affordance, exactly as it is on the callout.
 */
export const ASIDE_TEXT_FIELD = {
  key: 'asideText',
  label: 'Aside text',
  labelKey: 'editor.slideField.asideText.label',
  type: 'markdown',
  required: false,
  maxLength: 300,
  visibleWhen: { field: 'asideVariant', in: [...ASIDE_VARIANTS] },
};

/**
 * The pair, in the order a host spreads it: choose the kind, then say the
 * thing. Exported as one list so a host cannot spread half of it.
 */
export const ASIDE_FIELDS = Object.freeze([
  ASIDE_VARIANT_FIELD,
  ASIDE_TEXT_FIELD,
]);

/**
 * The stored shape of "no aside", for a host type's `defaults` blocks.
 *
 * Spread rather than left absent: every other optional field on these types
 * (`onCloseTarget: ''`, `actions: []`) states its empty value, and a default
 * the form can read is what keeps the second control hidden on a brand-new
 * slide instead of appearing for a heartbeat.
 */
export const ASIDE_DEFAULTS = Object.freeze({
  asideVariant: ASIDE_NONE,
  asideText: '',
});

/**
 * The kind of aside a slide carries, or `''` when it carries none.
 *
 * Unknown values resolve to `none` rather than to a kind: an inset the author
 * never asked for is worse than no inset, and a class no stylesheet defines
 * would render an unstyled box.
 *
 * @param {Object} [content] - slide content
 * @returns {string} one of {@link ASIDE_VARIANTS}, or ''
 */
export function asideVariant(content) {
  const v = resolveAdmonitionVariant(
    content?.asideVariant,
    ASIDE_VARIANTS,
    ASIDE_NONE,
  );
  return v === ASIDE_NONE ? '' : v;
}

/**
 * The inset's markup, or `''` when this slide has no aside.
 *
 * Empty for a slide that names no kind and for one that names a kind but says
 * nothing — an empty box is a promise with no content behind it, and a slide
 * mid-edit should not sprout one. That is also what makes the field free for
 * existing decks: no key, no markup, no diff.
 *
 * The element is a real `<aside>`. The content is tangentially related to the
 * body around it, which is precisely what the element means (HTML §4.3.5), and
 * it is the only part of the treatment that survives into a reader view or a
 * plain-text export.
 *
 * @param {Object} [content] - slide content
 * @param {Object} [ctx] - render context; `ctx.lang` is the deck language
 * @returns {string} HTML string, or ''
 */
export function renderAsideHtml(content, ctx) {
  const variant = asideVariant(content);
  if (!variant) return '';
  const text = nonEmpty(content?.asideText);
  if (!text) return '';

  const { icon, copyKey } = ADMONITION_META[variant];
  const word = getSlideCopy(ctx?.lang)[copyKey];

  // Tinted by the container `color` through a CSS mask rather than an <img>:
  // an <img>-loaded SVG is an isolated document and never inherits the host
  // colour, so `currentColor` inside it falls back to the OS default. Same
  // seam as callout-slide and icon-card-grid. `iconUrl` only ever returns a
  // vetted /client/vendor/lucide-icons/<name>.svg, so it is safe inside url().
  const iconSrc = iconUrl(icon);

  // The eyebrow comes from the partials library rather than a fourth spelling
  // of an uppercase tracked label — it already reads `--slide-tone`, which the
  // variant class below sets, so the word takes the kind's colour for free.
  return `
      <aside class="slide-aside slide-aside--${variant}">
        <div class="slide-aside-head">
          <span class="slide-aside-icon" aria-hidden="true" style="--slide-aside-icon-url:url(${escapeHtml(iconSrc)})"></span>
          ${eyebrowHtml(word)}
        </div>
        <div class="slide-aside-body" data-inline-field="asideText" data-inline-kind="markdown" dir="auto">${markdownToSafeHtml(text)}</div>
      </aside>
    `;
}

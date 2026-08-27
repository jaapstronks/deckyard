/**
 * callout-slide — the renderer.
 *
 * A whole slide that IS the key insight / warning / definition / note / tip.
 * In a document a callout earns its meaning by *spatial* contrast with the
 * prose beside it; a deck has a second axis a document lacks — *temporal*
 * contrast against the slides before and after — and this type is that move.
 * (The within-slide inset is a separate, later shape; see the editorial
 * slide-types brief.)
 *
 * The structure is the same for all five variants, so one stylesheet and one
 * inline-edit descriptor cover the family. Only three things vary, and all
 * three are derived from `variants.js`: the root modifier class, the icon and
 * the eyebrow fallback copy.
 */

import { bgClass, escapeHtml } from '../../helpers.js';
import { markdownToSafeHtml } from '../../../markdown.js';
import { getSlideCopy } from '../../slide-copy.js';
import { iconUrl } from '../../../icon-names.js';
import { calloutMeta, calloutVariant } from './variants.js';

/**
 * Body size band, from how much body there is.
 *
 * A callout is a full slide holding one idea, so a one-line takeaway should
 * fill it rather than float in the top third — and the 600-character maximum
 * still has to fit without clipping. One fixed size cannot do both, so the
 * type ships three, chosen by length exactly the way quote-slide chooses its
 * scale from the quote.
 *
 * The two boundaries are the points where the body would gain a fourth line at
 * the size above them. MEASURED, not estimated: the real renderer plus the real
 * slide CSS in headless Chrome at 1600x900 on the default theme, sweeping body
 * length with a source line present, reading back the rendered line count and
 * how much of the slide's inner box the panel takes:
 *
 *   - `lg` (52px): 110 characters is 3 lines, panel 355px of the 772px box;
 *   - `md` (44px): 210 characters is 5 lines, panel 432px;
 *   - `sm` (34px): the 600-character field maximum is 11 lines, panel 616px —
 *     still 78px clear of the box, which is the tightest case the type has.
 *
 * So no legal body clips, and the shortest ones still get the largest type.
 *
 * @param {string} body - the raw markdown body
 * @returns {'lg'|'md'|'sm'}
 */
export function calloutBodyBand(body) {
  const len = typeof body === 'string' ? body.trim().length : 0;
  if (len <= 110) return 'lg';
  if (len <= 210) return 'md';
  return 'sm';
}

/**
 * @param {Object} content - slide content
 * @param {Object} [_slide] - the slide record (unused; the type is pure content)
 * @param {Object} [ctx] - render context; `ctx.lang` is the deck language
 * @returns {string}
 */
export default function renderHtml(content, _slide, ctx) {
  const variant = calloutVariant(content?.variant);
  const { icon, copyKey } = calloutMeta(variant);
  const copy = getSlideCopy(ctx?.lang);
  const bg = bgClass(content?.background);

  // The eyebrow is never empty: an unlabelled callout still has to announce
  // which promise it is making, and the per-variant fallback says it in the
  // deck's language. An author who sets `label` overrides it — for a
  // definition that is usually the term itself.
  const authored =
    typeof content?.label === 'string' ? content.label.trim() : '';
  const label = authored || copy[copyKey];

  // A definition names a term, so the term is a real `<dfn>`. Note the element
  // wraps the TERM, not the explanation: `<dfn>` marks the word being defined
  // and its containing block is the definition (HTML §4.5.8). Putting it round
  // the body would assert the opposite of what the slide says.
  const labelTag = variant === 'definition' ? 'dfn' : 'span';

  // Tinted by the container `color` through a CSS mask rather than an <img>:
  // an <img>-loaded SVG is an isolated document and never inherits the host
  // colour, so `currentColor` inside it falls back to the OS default. Same
  // reasoning (and same seam) as icon-card-grid. `iconUrl` only ever returns a
  // vetted /client/vendor/lucide-icons/<name>.svg, so it is safe inside url().
  const iconSrc = iconUrl(icon);

  const band = calloutBodyBand(content?.body);
  const source =
    typeof content?.source === 'string' ? content.source.trim() : '';
  const sourceHtml = source
    ? `<p class="callout-source" data-inline-field="source" dir="auto">${escapeHtml(source)}</p>`
    : '';

  return `
      <div class="slide slide-callout slide-callout--${variant} is-body-${band} ${bg}">
        <div class="slide-inner">
          <div class="callout-panel">
            <p class="callout-eyebrow">
              <span class="callout-icon" aria-hidden="true" style="--callout-icon-url:url(${escapeHtml(iconSrc)})"></span>
              <${labelTag} class="callout-label" data-morph-role="title" data-inline-field="label" dir="auto">${escapeHtml(label)}</${labelTag}>
            </p>
            <div class="callout-body" data-morph-role="body" data-inline-field="body" data-inline-kind="markdown" dir="auto">${markdownToSafeHtml(content?.body || '')}</div>
            ${sourceHtml}
          </div>
        </div>
      </div>
    `;
}

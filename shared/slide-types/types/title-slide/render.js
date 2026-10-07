/**
 * title-slide — the renderer, split in two halves a fork can compose (D270).
 *
 * `resolveTitleView(content, slide, ctx)` decides every value the slide shows:
 * background, the legacy background image, the logo for this surface, the
 * texts, the theme's vertical layout, the logo corner, the root modifiers.
 * `renderTitleView(view)` turns those values into the `tsu-*` markup and does
 * nothing else. Core's `renderHtml` is the two in a row.
 *
 * The split exists for a fork that wants core's title layout with its own
 * values (another logo per background, an extra modifier, its own root class).
 * Before it, the only way to get the `tsu-*` structure was to copy this
 * renderer and keep the copy in step by hand; the fork's copy broke silently
 * twice. Now it calls `resolveTitleView`, adjusts the view, and passes it to
 * `renderTitleView`, through the stable address `shared/slide-types/core-layouts.js`
 * — never by importing this file, which is an internal path.
 *
 * The markup lives here once. Every string in the view is escaped by
 * `renderTitleView`, so a fork never escapes and never writes a `tsu-` class.
 */

import { bgClass, escapeHtml } from '../../helpers.js';
import { resolveSlideBgImage } from '../../legacy-bg-image.js';
import {
  TITLE_LAYOUTS,
  DEFAULT_TITLE_LAYOUT,
} from '../../../theme-config-schema.js';
import { groupAlignClass } from '../../field-groups.js';
import { resolveThemeLogo } from '../../../theme-logo.js';
import { TITLE_BLOCK } from './title-block.js';
import { textSizeScale } from '../../text-styles.js';

/**
 * Font scale for the cover's title and subtitle, chosen from how much text the
 * block carries — the quoteFontScale pattern: short covers keep the full 5xl
 * hero size, full ones step down so the block still fits the frame. One scale
 * for title AND subtitle, so the hierarchy between them never shifts.
 *
 * Deterministic (character count, no DOM measurement), so the server, both
 * export paths and every thumbnail agree. The title dominates the block's
 * height — at 5xl it wraps around 24 characters a line where the 2xl subtitle
 * wraps ~42 — so subtitle and meta enter the ramp at less than half weight.
 *
 * The floor is 0.8: exactly one type step (5xl → 4xl), the cover's size
 * before it had its own step. Measured across six themes × three
 * `titleLayout`s, the fullest legal block (120-char title, 160-char subtitle
 * and meta) overflowed the frame at scale 1 and fits at the floor — at
 * `textScale` 1 and 1.1 both.
 *
 * The author's S/M/L on title and subtitle (B464, `--tf-size-scale` on each
 * element) composes on top of this scale. A larger step takes more room: a
 * wrapped block's height grows with its length times the square of its font
 * scale (more lines, each taller), so each field enters the ramp weighted by
 * its step squared. Past the fullest default block that ramp has no room left,
 * so the scale shrinks until the block's weighted area is back at the floor's
 * budget (`HI × MIN²`): an L title still renders larger than an M one, and the
 * fullest legal block still fits. Lengths count up to each field's maxLength,
 * so a hostile payload clamps like the fullest legal one.
 *
 * @param {Object} content - the slide's content (title/subheading/meta and
 *   the `textStyles` sizes of title and subheading)
 * @returns {number} multiplier for --slide-text-5xl / --slide-text-2xl
 */
export function coverFontScale(content) {
  const len = (s, max) =>
    typeof s === 'string' ? Math.min(max, s.trim().length) : 0;
  const step = (key) => textSizeScale(content?.textStyles?.[key]?.size) ** 2;
  const weighted =
    len(content?.title, 120) * step('title') +
    0.4 *
      (len(content?.subheading, 160) * step('subheading') +
        len(content?.meta, 160));
  // Ramp: at/below LO nothing shrinks (a typical cover — 40-char title,
  // 80-char subtitle — stays clear of it), at/above HI the floor applies
  // (HI = the fullest legal block: 120 + 0.4 * (160 + 160)).
  const LO = 100;
  const HI = 248;
  const MIN = 0.8;
  const t = Math.max(0, Math.min(1, (weighted - LO) / (HI - LO)));
  const ramp = 1 - (1 - MIN) * t;
  // Only an L override can push `weighted` past HI; there the area budget
  // binds instead of the ramp. Below HI it is always the looser of the two.
  const fit = weighted > HI ? Math.sqrt((HI * MIN * MIN) / weighted) : 1;
  return Math.round(Math.min(ramp, fit) * 1000) / 1000;
}

/**
 * Everything a title slide shows, as values. A fork sets values here and
 * nothing else; the markup and its classes are `renderTitleView`'s.
 *
 * @typedef {Object} TitleView
 * @property {string} background - background key (`lime`, `mist` or a theme
 *   background id); mapped to its `slide-bg-*` class by `bgClass()`
 * @property {string[]} classes - further root classes, appended after core's
 *   own in this order. Core puts the title-block alignment class here when it
 *   is not the default; a fork adds its own root class and modifiers.
 * @property {Record<string, string|number>} styleVars - custom properties set
 *   on the root (core: `--cover-scale`)
 * @property {{ src: string, alt: string } | null} bgImage - the legacy
 *   per-type background image (`<img class="slide-bg">` plus `has-bg` on the
 *   root), drawn only for un-migrated decks; an empty `alt` renders it
 *   decorative. `null` when the shared background layer paints the image or
 *   there is none.
 * @property {{ src: string, alt: string }} logo - the logo for this slide
 * @property {string} title
 * @property {string} subheading - blank omits the line
 * @property {string} meta - blank omits the line
 * @property {'bottom' | 'center' | 'top'} titleLayout - the vertical posture
 *   (the theme's `titleLayout`)
 * @property {'left' | 'right'} logoCorner
 */

/** @param {unknown} s */
const hasText = (s) => typeof s === 'string' && s.trim() !== '';

/**
 * Resolve a title slide's content against the render context into a view.
 *
 * @param {Object} content - the slide's content
 * @param {Object} [_slide] - the slide (unused; the renderHtml signature)
 * @param {Object} [ctx] - render context; reads `ctx.theme`
 * @returns {TitleView}
 */
export function resolveTitleView(content, _slide, ctx) {
  // Read authority: canonical `slideBgImage` (drawn by the shared
  // .slide-bg-layer, injectSlideBackground) wins → legacy `bgImage`/`bgAlt`
  // → none. The bespoke `<img class="slide-bg">` + `.has-bg` treatment is
  // drawn ONLY for un-migrated decks (source === 'legacy'); when canonical,
  // the shared layer already paints it and readability comes from
  // slideBgText/overlay — so we must draw nothing to avoid a double image.
  const resolvedBg = resolveSlideBgImage(content);
  const bgImage =
    resolvedBg.source === 'legacy' && resolvedBg.image
      ? { src: resolvedBg.image, alt: resolvedBg.alt || '' }
      : null;
  const theme = ctx?.theme && typeof ctx.theme === 'object' ? ctx.theme : null;
  // Layout is theme-driven, not per-field: the theme's `titleLayout` token
  // (bottom | center | top) maps to a `.tsu-layout-*` class. Unknown/absent
  // → the default. The scrim direction follows this class in CSS, so it sits
  // on the text side automatically.
  const titleLayout = TITLE_LAYOUTS.includes(theme?.titleLayout)
    ? theme.titleLayout
    : DEFAULT_TITLE_LAYOUT;
  // Horizontal placement of the title block (author-owned, one class for the
  // whole group). None for the default, so untouched decks render exactly
  // the markup they did before the group model.
  const alignClass = groupAlignClass(TITLE_BLOCK.group, content);
  return {
    background: content?.background || 'lime',
    classes: alignClass ? [alignClass] : [],
    styleVars: { '--cover-scale': coverFontScale(content) },
    bgImage,
    // Title slide can use a separate smaller logo (titleLogo) or fall back to
    // the main one, and takes the variant that is visible on the surface this
    // slide renders on when the theme ships a mark per pole.
    logo: {
      src: resolveThemeLogo(theme, content, { title: true }),
      alt: String(
        theme?.assets?.titleLogoAlt || theme?.assets?.logoAlt || 'Logo',
      ),
    },
    title: String(content?.title || ''),
    subheading: hasText(content?.subheading) ? content.subheading : '',
    meta: hasText(content?.meta) ? content.meta : '',
    titleLayout,
    logoCorner: content?.logoCorner === 'left' ? 'left' : 'right',
  };
}

/**
 * The title slide's markup for a view. Pure: every string from the view is
 * escaped here, so the caller never escapes.
 *
 * @param {TitleView} view
 * @returns {string}
 */
export function renderTitleView(view) {
  const rootClass = [
    'slide',
    'slide-title',
    bgClass(view.background),
    ...(view.bgImage ? ['has-bg'] : []),
    `tsu-layout-${view.titleLayout}`,
    view.logoCorner === 'left' ? 'is-logo-left' : 'is-logo-right',
    ...(view.classes || []),
  ]
    .map(escapeHtml)
    .join(' ');
  const vars = Object.entries(view.styleVars || {});
  const style = vars.length
    ? ` style="${vars.map(([k, v]) => `${escapeHtml(k)}:${escapeHtml(String(v))}`).join(';')}"`
    : '';
  const bgImgHtml = view.bgImage
    ? view.bgImage.alt
      ? `<img class="slide-bg" src="${escapeHtml(view.bgImage.src)}" alt="${escapeHtml(view.bgImage.alt)}" />`
      : `<img class="slide-bg" src="${escapeHtml(view.bgImage.src)}" alt="" aria-hidden="true" />`
    : '';
  const subtitle = hasText(view.subheading)
    ? `<p class="tsu-subtitle" data-morph-role="subtitle" data-inline-field="subheading" dir="auto">${escapeHtml(view.subheading)}</p>`
    : '';
  const meta = hasText(view.meta)
    ? `<p class="tsu-meta" data-morph-role="meta" data-inline-field="meta" dir="auto">${escapeHtml(view.meta)}</p>`
    : '';
  return `
        <div class="${rootClass}"${style}>
          <div class="slide-inner">
            ${bgImgHtml}
            <div class="tsu-overlay" aria-hidden="true"></div>
            <div class="tsu-logo" data-morph-role="logo">
              <img class="tsu-logo-img" src="${escapeHtml(view.logo?.src)}" alt="${escapeHtml(view.logo?.alt)}" />
            </div>
            <div class="tsu-content">
              <div class="tsu-primary">
                <h2 class="title" data-morph-role="title" data-inline-field="title" dir="auto">${escapeHtml(view.title)}</h2>
                ${subtitle}
              </div>
              ${meta}
            </div>
          </div>
        </div>
      `;
}

/**
 * Core's own render: resolve, then render.
 *
 * @param {Object} content
 * @param {Object} [slide]
 * @param {Object} [ctx]
 * @returns {string}
 */
export default function renderHtml(content, slide, ctx) {
  return renderTitleView(resolveTitleView(content, slide, ctx));
}

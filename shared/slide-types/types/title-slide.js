import {
  bgClass,
  escapeHtml,
  styleAttrFromVars,
  BACKGROUND_FIELD,
} from '../helpers.js';
import { resolveSlideBgImage } from '../legacy-bg-image.js';
import {
  TITLE_LAYOUTS,
  DEFAULT_TITLE_LAYOUT,
} from '../../theme-config-schema.js';
import { alignGroup, groupAlignClass } from '../field-groups.js';
import { resolveThemeLogo } from '../../theme-logo.js';

/**
 * Title, subtitle and meta are ONE visual block: they share a container and
 * read as a single unit, so their horizontal placement is a property of the
 * block and not of each field (see field-groups.js). The value lives in the
 * `titleBlockAlign` content field, which the toolbar "Layout" chip writes via
 * `layoutVariants` below; `renderHtml` turns a non-default value into
 * `is-align-center` on the slide root and the CSS moves the whole block.
 *
 * Two values, not three: a right-aligned title block is not a layout we want
 * to offer, and it is the one value that produced a broken slide in the deck
 * history (a centred title next to a right-aligned subtitle). Same reasoning
 * as ROLE_AFFORDANCES.quote, which also offers left/centre only.
 *
 * The VERTICAL axis stays the theme's (`titleLayout`: bottom | center | top).
 * Two axes, two owners: the theme sets the posture of a title slide, the
 * author composes this one.
 */
const TITLE_BLOCK = alignGroup('title-block', 'titleBlockAlign', {
  label: 'Title block alignment',
  labelKey: 'editor.slideField.titleBlockAlign.label',
});

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
 * @param {Object} content - the slide's content (title/subheading/meta)
 * @returns {number} multiplier for --slide-text-5xl / --slide-text-2xl
 */
export function coverFontScale(content) {
  const len = (s) => (typeof s === 'string' ? s.trim().length : 0);
  const weighted =
    len(content?.title) + 0.4 * (len(content?.subheading) + len(content?.meta));
  // Ramp: at/below LO nothing shrinks (a typical cover — 40-char title,
  // 80-char subtitle — stays clear of it), at/above HI the floor applies
  // (HI = the fullest legal block: 120 + 0.4 * (160 + 160)).
  const LO = 100;
  const HI = 248;
  const MIN = 0.8;
  const t = Math.max(0, Math.min(1, (weighted - LO) / (HI - LO)));
  return Math.round((1 - (1 - MIN) * t) * 1000) / 1000;
}

export default {
  structure: 'singleton',
  runtime: 'static',
  label: 'Title slide',
  fieldGroups: [TITLE_BLOCK.group],
  fields: [
    {
      key: 'title',
      label: 'Title',
      labelKey: 'editor.slideField.title.label',
      type: 'string',
      required: true,
      maxLength: 120,
      group: 'title-block',
    },
    {
      key: 'subheading',
      label: 'Subtitle',
      type: 'string',
      required: false,
      maxLength: 160,
      group: 'title-block',
    },
    {
      // One generic meta line (author · date · organisation). Rendered in the
      // theme's label typography (caption font, uppercase, letterspaced,
      // muted) so it reads as a distinct role from the prose subtitle.
      key: 'meta',
      label: 'Meta',
      type: 'string',
      required: false,
      maxLength: 160,
      group: 'title-block',
    },
    // Background image is the generic, type-agnostic `slideBgImage` field
    // (added by withGlobalSlideFields, rendered by injectSlideBackground). The
    // title type used to carry its own `bgImage`/`bgAlt` pair — now a read-only
    // render fallback for un-migrated decks, folded into `slideBgImage` on edit
    // (see ../legacy-bg-image.js).
    //
    // Background colour and logo corner are two compact controls that read as
    // one "chrome" choice, so they share a form row (see form-layout.js). The
    // colour itself renders in the shared Background section, which is why the
    // row usually carries the corner alone.
    { ...BACKGROUND_FIELD, formLayout: 'pair' },
    {
      key: 'logoCorner',
      label: 'Logo corner',
      type: 'enum',
      required: false,
      options: [
        { value: 'left', label: 'Left' },
        { value: 'right', label: 'Right' },
      ],
      formLayout: 'pair',
    },
    // Last, because it has no primary home in the form: the toolbar "Layout"
    // chip owns the title block's alignment (see field-groups.js), so the raw
    // enum is a fallback surface, not the control.
    TITLE_BLOCK.field,
  ],
  // Layout catalogue for the editor's layout switcher: the horizontal
  // placement of the title block. Declared on the definition (JSON-safe) so a
  // fork overriding this type by name controls its own set. Shape documented
  // in types/image-text-slide.js.
  layoutVariants: TITLE_BLOCK.variants,
  defaultsByLang: {
    nl: {
      title: 'Nieuwe titel',
      subheading: '',
      meta: '',
      background: 'lime',
      logoCorner: 'right',
      titleBlockAlign: 'left',
    },
    'en-GB': {
      title: 'New title',
      subheading: '',
      meta: '',
      background: 'lime',
      logoCorner: 'right',
      titleBlockAlign: 'left',
    },
  },
  // The language-less seed: what every path with no deck language clones.
  // Key-identical to the maps above; see `defaults` in validate-definition.js.
  // `titleBlockAlign` is listed so activeLayoutVariantId resolves the left tile
  // as active on decks authored before the field existed, instead of showing no
  // tile selected.
  defaults: {
    title: 'New title',
    subheading: '',
    meta: '',
    background: 'lime',
    logoCorner: 'right',
    titleBlockAlign: 'left',
  },
  renderHtml: (content, slide, ctx) => {
    const bg = bgClass(content?.background || 'lime');
    // Read authority: canonical `slideBgImage` (drawn by the shared
    // .slide-bg-layer, injectSlideBackground) wins → legacy `bgImage`/`bgAlt`
    // → none. The bespoke `<img class="slide-bg">` + `.has-bg` treatment is
    // drawn ONLY for un-migrated decks (source === 'legacy'); when canonical,
    // the shared layer already paints it and readability comes from
    // slideBgText/overlay — so we must draw nothing to avoid a double image.
    const resolvedBg = resolveSlideBgImage(content);
    const legacyBg = resolvedBg.source === 'legacy' ? resolvedBg.image : '';
    const bgAlt = resolvedBg.source === 'legacy' ? resolvedBg.alt : '';
    const bgImgHtml = legacyBg
      ? bgAlt
        ? `<img class="slide-bg" src="${escapeHtml(legacyBg)}" alt="${escapeHtml(bgAlt)}" />`
        : `<img class="slide-bg" src="${escapeHtml(
            legacyBg,
          )}" alt="" aria-hidden="true" />`
      : '';
    const subtitle =
      typeof content?.subheading === 'string' && content.subheading.trim()
        ? `<p class="tsu-subtitle" data-morph-role="subtitle" data-inline-field="subheading" dir="auto">${escapeHtml(content.subheading)}</p>`
        : '';
    const meta =
      typeof content?.meta === 'string' && content.meta.trim()
        ? `<p class="tsu-meta" data-morph-role="meta" data-inline-field="meta" dir="auto">${escapeHtml(content.meta)}</p>`
        : '';
    const theme =
      ctx?.theme && typeof ctx.theme === 'object' ? ctx.theme : null;
    // Title slide can use a separate smaller logo (titleLogo) or fall back to
    // the main one, and takes the variant that is visible on the surface this
    // slide renders on when the theme ships a mark per pole.
    const logoSrc = resolveThemeLogo(theme, content, { title: true });
    const logoAlt = String(
      theme?.assets?.titleLogoAlt || theme?.assets?.logoAlt || 'Logo',
    );
    const logoCorner =
      content?.logoCorner === 'left' || content?.logoCorner === 'right'
        ? content.logoCorner
        : 'right';
    // Layout is theme-driven, not per-field: the theme's `titleLayout` token
    // (bottom | center | top) maps to a `.tsu-layout-*` class. Unknown/absent
    // → the default. The scrim direction follows this class in CSS, so it sits
    // on the text side automatically.
    const titleLayout = TITLE_LAYOUTS.includes(theme?.titleLayout)
      ? theme.titleLayout
      : DEFAULT_TITLE_LAYOUT;
    // Horizontal placement of the title block (author-owned, one class for the
    // whole group). Empty for the default, so untouched decks render exactly
    // the markup they did before the group model.
    const alignClass = groupAlignClass(TITLE_BLOCK.group, content);
    const styleVars = { '--cover-scale': coverFontScale(content) };
    return `
        <div class="slide slide-title ${bg}${
          legacyBg ? ' has-bg' : ''
        } tsu-layout-${titleLayout} ${logoCorner === 'left' ? 'is-logo-left' : 'is-logo-right'}${
          alignClass ? ` ${alignClass}` : ''
        }"${styleAttrFromVars(styleVars)}>
          <div class="slide-inner">
            ${bgImgHtml}
            <div class="tsu-overlay" aria-hidden="true"></div>
            <div class="tsu-logo" data-morph-role="logo">
              <img class="tsu-logo-img" src="${escapeHtml(logoSrc)}" alt="${escapeHtml(logoAlt)}" />
            </div>
            <div class="tsu-content">
              <div class="tsu-primary">
                <h2 class="title" data-morph-role="title" data-inline-field="title" dir="auto">${escapeHtml(content?.title)}</h2>
                ${subtitle}
              </div>
              ${meta}
            </div>
          </div>
        </div>
      `;
  },
};

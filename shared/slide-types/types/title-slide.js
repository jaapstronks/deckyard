import { bgClass, esc, BACKGROUND_FIELD } from '../helpers.js';
import { resolveTitleSlideBackground } from '../title-slide-background.js';
import { TITLE_LAYOUTS, DEFAULT_TITLE_LAYOUT } from '../../theme-config-schema.js';
import { alignGroup, groupAlignClass } from '../field-groups.js';

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
});

export default {
  structure: 'singleton',
  label: 'Title slide',
  fieldGroups: [TITLE_BLOCK.group],
  fields: [
    {
      key: 'title',
      label: 'Title',
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
    TITLE_BLOCK.field,
    // Background image is the generic, type-agnostic `slideBgImage` field
    // (added by withGlobalSlideFields, rendered by injectSlideBackground). The
    // title type used to carry its own `bgImage`/`bgAlt` pair — now a read-only
    // render fallback for un-migrated decks, folded into `slideBgImage` on edit
    // (see title-slide-background.js).
    BACKGROUND_FIELD,
    {
      key: 'logoCorner',
      label: 'Logo corner',
      type: 'enum',
      required: false,
      options: ['left', 'right'],
    },
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
  // Back-compat fallback. `titleBlockAlign` is listed so activeLayoutVariantId
  // resolves the left tile as active on decks authored before the field
  // existed, instead of showing no tile selected.
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
    const resolvedBg = resolveTitleSlideBackground(content);
    const legacyBg = resolvedBg.source === 'legacy' ? resolvedBg.image : '';
    const bgAlt = resolvedBg.source === 'legacy' ? resolvedBg.alt : '';
    const bgImgHtml = legacyBg
      ? bgAlt
        ? `<img class="slide-bg" src="${esc(legacyBg)}" alt="${esc(bgAlt)}" />`
        : `<img class="slide-bg" src="${esc(
            legacyBg
          )}" alt="" aria-hidden="true" />`
      : '';
    const subtitle =
      typeof content?.subheading === 'string' && content.subheading.trim()
        ? `<p class="tsu-subtitle" data-morph-role="subtitle" data-inline-field="subheading" dir="auto">${esc(content.subheading)}</p>`
        : '';
    const meta =
      typeof content?.meta === 'string' && content.meta.trim()
        ? `<p class="tsu-meta" data-morph-role="meta" data-inline-field="meta" dir="auto">${esc(content.meta)}</p>`
        : '';
    const theme =
      ctx?.theme && typeof ctx.theme === 'object'
        ? ctx.theme
        : null;
    // Title slide can use a separate smaller logo (titleLogo) or fall back to main logo
    const logoSrc = String(
      theme?.assets?.titleLogo ||
        theme?.assets?.logo ||
        '/assets/images/logo.svg'
    );
    const logoAlt = String(
      theme?.assets?.titleLogoAlt ||
        theme?.assets?.logoAlt ||
        'Logo'
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
    return `
        <div class="slide slide-title-universal ${bg}${
          legacyBg ? ' has-bg' : ''
        } tsu-layout-${titleLayout} ${logoCorner === 'left' ? 'is-logo-left' : 'is-logo-right'}${
          alignClass ? ` ${alignClass}` : ''
        }">
          <div class="slide-inner">
            ${bgImgHtml}
            <div class="tsu-overlay" aria-hidden="true"></div>
            <div class="tsu-logo" data-morph-role="logo">
              <img class="tsu-logo-img" src="${esc(logoSrc)}" alt="${esc(logoAlt)}" />
            </div>
            <div class="tsu-content">
              <div class="tsu-primary">
                <h2 class="title" data-morph-role="title" data-inline-field="title" dir="auto">${esc(content?.title)}</h2>
                ${subtitle}
              </div>
              ${meta}
            </div>
          </div>
        </div>
      `;
  },
};

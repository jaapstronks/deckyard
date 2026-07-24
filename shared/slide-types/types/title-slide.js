import { bgClass, esc, BACKGROUND_FIELD } from '../helpers.js';
import { resolveTitleSlideBackground } from '../title-slide-background.js';
import { TITLE_LAYOUTS, DEFAULT_TITLE_LAYOUT } from '../../theme-config-schema.js';

export default {
  label: 'Title slide',
  fields: [
    {
      key: 'title',
      label: 'Title',
      type: 'string',
      required: true,
      maxLength: 120,
    },
    {
      key: 'subheading',
      label: 'Subtitle',
      type: 'string',
      required: false,
      maxLength: 160,
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
    },
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
  defaultsByLang: {
    nl: {
      title: 'Nieuwe titel',
      subheading: '',
      meta: '',
      background: 'lime',
      logoCorner: 'right',
    },
    'en-GB': {
      title: 'New title',
      subheading: '',
      meta: '',
      background: 'lime',
      logoCorner: 'right',
    },
  },
  // Back-compat fallback
  defaults: {
    title: 'New title',
    subheading: '',
    meta: '',
    background: 'lime',
    logoCorner: 'right',
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
    return `
        <div class="slide slide-title-universal ${bg}${
          legacyBg ? ' has-bg' : ''
        } tsu-layout-${titleLayout} ${logoCorner === 'left' ? 'is-logo-left' : 'is-logo-right'}">
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

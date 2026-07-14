import { bgClass, esc, BACKGROUND_FIELD } from '../helpers.js';

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
      label: 'Subheading',
      type: 'string',
      required: false,
      maxLength: 160,
    },
    {
      key: 'byline',
      label: 'Byline',
      type: 'string',
      required: false,
      maxLength: 160,
    },
    {
      key: 'attribution',
      label: 'Attribution',
      type: 'string',
      required: false,
      maxLength: 160,
    },
    {
      key: 'bgImage',
      label: 'Background image',
      type: 'image',
      required: false,
      presetSource: 'backgrounds',
    },
    {
      key: 'bgAlt',
      label: 'Background image alt text',
      type: 'string',
      required: false,
      maxLength: 180,
    },
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
      bgImage: '',
      bgAlt: '',
      byline: '',
      attribution: '',
      background: 'lime',
      logoCorner: 'right',
    },
    'en-GB': {
      title: 'New title',
      subheading: '',
      bgImage: '',
      bgAlt: '',
      byline: '',
      attribution: '',
      background: 'lime',
      logoCorner: 'right',
    },
  },
  // Back-compat fallback
  defaults: {
    title: 'New title',
    subheading: '',
    bgImage: '',
    bgAlt: '',
    byline: '',
    attribution: '',
    background: 'lime',
    logoCorner: 'right',
  },
  renderHtml: (content, slide, ctx) => {
    const bgImage =
      typeof content?.bgImage === 'string' ? content.bgImage.trim() : '';
    const bg = bgClass(content?.background || 'lime');
    const bgAlt =
      typeof content?.bgAlt === 'string' ? content.bgAlt.trim() : '';
    const bgImgHtml = bgImage
      ? bgAlt
        ? `<img class="slide-bg" src="${esc(bgImage)}" alt="${esc(bgAlt)}" />`
        : `<img class="slide-bg" src="${esc(
            bgImage
          )}" alt="" aria-hidden="true" />`
      : '';
    const subtitle =
      typeof content?.subheading === 'string' && content.subheading.trim()
        ? `<p class="subtitle" data-morph-role="subtitle" data-inline-field="subheading" dir="auto">${esc(content.subheading)}</p>`
        : '';
    const byline =
      typeof content?.byline === 'string' && content.byline.trim()
        ? `<p class="byline" data-morph-role="byline" data-inline-field="byline" dir="auto">${esc(content.byline)}</p>`
        : '';
    const attribution =
      typeof content?.attribution === 'string' && content.attribution.trim()
        ? `<p class="attribution" data-morph-role="attribution" data-inline-field="attribution" dir="auto">${esc(content.attribution)}</p>`
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
    return `
        <div class="slide slide-title-universal ${bg}${
          bgImage ? ' has-bg' : ''
        } ${logoCorner === 'left' ? 'is-logo-left' : 'is-logo-right'}">
          <div class="slide-inner">
            ${bgImgHtml}
            <div class="tsu-overlay" aria-hidden="true"></div>
            <div class="tsu-logo" data-morph-role="logo">
              <img class="tsu-logo-img" src="${esc(logoSrc)}" alt="${esc(logoAlt)}" />
            </div>
            <div class="tsu-content">
              <h1 class="title" data-morph-role="title" data-inline-field="title" dir="auto">${esc(content?.title)}</h1>
              <div class="tsu-meta">
                ${subtitle}
                ${byline}
                ${attribution}
              </div>
            </div>
          </div>
        </div>
      `;
  },
};

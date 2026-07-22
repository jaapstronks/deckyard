import { esc, pickAltText } from '../helpers.js';

export default {
  label: 'Partner split',
  // Archived 2026-07-21: rarely used and a generic placeholder-y layout (a
  // handful of stored decks still carry it — they keep rendering, see below).
  // Hidden from every insertion path (picker + AI) via
  // this flag — isInsertableSlideType returns false for deprecated types — but
  // the type stays REGISTERED so any stored/forked deck keeps rendering
  // unchanged (rendering never goes through the insertability gate). The
  // "two partner logos side by side" use case may return later as reusable
  // editorial components.
  deprecated: true,
  fields: [
    {
      key: 'logos',
      label: "Partnerlogo's (1–5)",
      type: 'images',
      required: true,
      maxItems: 5,
      presetSource: 'partnerlogos',
    },
    // Optional explicit alt text per logo (index-matched to logos[]).
    // NOTE: kept as simple string fields to avoid a breaking schema change.
    ...Array.from({ length: 5 }, (_v, idx) => {
      const i = idx + 1;
      return {
        key: `logo${i}Alt`,
        label: `Logo ${i} alt text`,
        type: 'string',
        required: false,
        maxLength: 180,
      };
    }),
    {
      key: 'bgImage',
      label: 'Background image (right)',
      type: 'image',
      required: false,
      presetSource: 'backgrounds',
    },
    {
      key: 'bgAlt',
      label: 'Background image alt text (optional)',
      type: 'string',
      required: false,
      maxLength: 180,
    },
    {
      key: 'label',
      label: 'Label',
      type: 'string',
      required: false,
      maxLength: 40,
    },
    {
      key: 'title',
      label: 'Title',
      type: 'string',
      required: true,
      maxLength: 140,
    },
    {
      key: 'subheading',
      label: 'Subheading',
      type: 'string',
      required: false,
      maxLength: 200,
    },
  ],
  defaults: {
    logos: ['/assets/images/logo-placeholder.svg'],
    // Empty by default: the editor offers the theme's own background presets
    // ("From this theme"). A hardcoded demo photo meant every partner-split
    // slide opened wearing Deckyard's stock imagery, whatever the deck's theme.
    bgImage: '',
    bgAlt: '',
    label: 'PARTNER',
    title: 'Slide title',
    subheading: 'Optional subheading',
  },
  renderHtml: (content) => {
    const logos = Array.isArray(content?.logos) ? content.logos : [];
    const logosHtml = logos
      .filter((u) => typeof u === 'string' && u.trim())
      .slice(0, 5)
      .map((u, idx) => {
        const key = `logo${idx + 1}Alt`;
        const explicit =
          typeof content?.[key] === 'string' ? content[key].trim() : '';
        const alt = pickAltText({
          explicit,
          src: u,
          hardFallback: 'Partner logo',
        });
        return `<img class="partner-logo" src="${esc(u)}" alt="${esc(
          alt
        )}" />`;
      })
      .join('');

    // No image means no <img> and no scrim: the overlay gradient exists to keep
    // white text readable over a photo, and on a bare panel it is just a black
    // smear. The panel itself carries the theme's dark surface via CSS.
    const bg =
      typeof content?.bgImage === 'string' ? content.bgImage.trim() : '';
    const bgAlt =
      typeof content?.bgAlt === 'string' ? content.bgAlt.trim() : '';
    const label = content?.label ? `<div class="badge" data-inline-field="label" dir="auto">${esc(content.label)}</div>` : '';
    const subtitle = content?.subheading
      ? `<p class="subtitle" data-inline-field="subheading" dir="auto">${esc(content.subheading)}</p>`
      : '';

    return `
        <div class="slide slide-partner-split">
          <div class="slide-inner">
            <div class="split-50">
              <div class="left">
                <div class="logo-stack" data-morph-role="logo">${logosHtml}</div>
              </div>
              <div class="right">
                ${
                  !bg
                    ? ''
                    : bgAlt
                      ? `<img class="bg" src="${esc(bg)}" alt="${esc(
                          bgAlt
                        )}" />`
                      : `<img class="bg" src="${esc(
                          bg
                        )}" alt="" aria-hidden="true" />`
                }
                ${bg ? '<div class="overlay" aria-hidden="true"></div>' : ''}
                <div class="text">
                  ${label}
                  <h2 class="title" data-morph-role="title" data-inline-field="title" dir="auto">${esc(content?.title)}</h2>
                  ${subtitle}
                </div>
              </div>
            </div>
          </div>
        </div>
      `;
  },
};

import { esc, pickAltText } from '../helpers.js';

export default {
  label: 'Partner split',
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
    bgImage: '/assets/images/backgrounds/backgroundpic-1.jpg',
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

    const bg =
      typeof content?.bgImage === 'string' && content.bgImage.trim()
        ? content.bgImage.trim()
        : '/assets/images/backgrounds/backgroundpic-1.jpg';
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
                  bgAlt
                    ? `<img class="bg" src="${esc(bg)}" alt="${esc(
                        bgAlt
                      )}" />`
                    : `<img class="bg" src="${esc(
                        bg
                      )}" alt="" aria-hidden="true" />`
                }
                <div class="overlay" aria-hidden="true"></div>
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

import { esc, pickAltText, nonEmpty, cardLinkOverlayHtml } from '../helpers.js';

const MAX_LOGOS = 12;

function clampInt(n, min, max) {
  const v = Number(n);
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, Math.trunc(v)));
}

/**
 * Resolve logos from either the new `logos[]` array or legacy numbered fields.
 * Returns an array of { image, name, alt } objects.
 */
export function resolveLogos(content) {
  // New format: logos[]
  if (Array.isArray(content?.logos) && content.logos.length > 0) {
    return content.logos.map((l) => ({
      image: l.image || '',
      name: l.name || '',
      alt: l.alt || '',
      link: l.link || '',
    }));
  }

  // Legacy format: logo{N}Image, logo{N}Name, etc.
  const count = clampInt(content?.logoCount || 1, 1, MAX_LOGOS);
  let maxUsedIdx = 0;
  for (let i = 1; i <= MAX_LOGOS; i++) {
    if (content?.[`logo${i}Image`] || content?.[`logo${i}Name`]) {
      maxUsedIdx = i;
    }
  }
  const scanCount = Math.max(count, maxUsedIdx);

  const logos = [];
  for (let i = 1; i <= scanCount; i++) {
    const image = content?.[`logo${i}Image`] || '';
    const name = content?.[`logo${i}Name`] || '';
    if (image || name) {
      logos.push({
        image,
        name,
        alt: content?.[`logo${i}Alt`] || '',
        link: content?.[`logo${i}Link`] || '',
      });
    }
  }
  return logos;
}

export default {
  label: 'Logo wall',
  fields: [
    {
      key: 'title',
      label: 'Title',
      type: 'string',
      required: false,
      maxLength: 120,
    },
    {
      key: 'subheading',
      label: 'Subheading',
      type: 'string',
      required: false,
      maxLength: 220,
    },
    {
      key: 'logoCount',
      label: 'Number of logos',
      type: 'enum',
      required: false,
      options: Array.from({ length: MAX_LOGOS }, (_v, i) => String(i + 1)),
      deprecated: true,
    },

    // New format: logos[] array (preferred for AI generation)
    {
      key: 'logos',
      label: 'Logos',
      type: 'items',
      required: false,
      itemFields: [
        { key: 'image', type: 'image', label: 'Logo image' },
        { key: 'name', type: 'string', label: 'Name', maxLength: 80 },
        // Optional: makes the whole logo clickable. `#N` jumps to slide N in the
        // deck (presenter only); an http(s)/mailto URL opens in a new tab.
        { key: 'link', type: 'string', label: 'Link URL', maxLength: 500 },
      ],
    },

    // Legacy 1..12 logos: image + (optional) name + optional explicit alt (author intent)
    ...Array.from({ length: MAX_LOGOS }, (_v, idx) => {
      const i = idx + 1;
      return [
        {
          key: `logo${i}Image`,
          label: `Logo ${i} image`,
          type: 'image',
          required: false,
        },
        {
          key: `logo${i}Name`,
          label: `Logo ${i} name`,
          type: 'string',
          required: false,
          maxLength: 80,
        },
        {
          key: `logo${i}Alt`,
          label: `Logo ${i} alt text`,
          type: 'string',
          required: false,
          maxLength: 180,
        },
        {
          key: `logo${i}Link`,
          label: `Logo ${i} link`,
          type: 'string',
          required: false,
          maxLength: 500,
          deprecated: true,
        },
      ];
    }).flat(),
  ],

  defaults: {
    title: '',
    subheading: '',
    logoCount: '1',
    logo1Image: '',
    logo1Name: 'Logo',
  },

  renderHtml: (content, _slide, ctx) => {
    const mode = ctx?.mode;
    const logos = resolveLogos(content);

    // Inline-edit paths must point at the data source resolveLogos() used. Only
    // logos[]-backed items carry a stable index, so the photo hook is array-only.
    const useLogos = Array.isArray(content?.logos) && content.logos.length > 0;

    const title = nonEmpty(content?.title);
    const subtitle = nonEmpty(content?.subheading);
    const hasHeader = !!(title || subtitle);

    const headerHtml =
      title || subtitle
        ? `
          <div class="header">
            ${title ? `<h2 class="title" data-morph-role="title" data-inline-field="title" dir="auto">${esc(title)}</h2>` : ''}
            ${subtitle ? `<p class="subtitle" data-morph-role="subtitle" data-inline-field="subheading" dir="auto">${esc(subtitle)}</p>` : ''}
          </div>
        `
        : '';

    const items = [];
    for (let i = 0; i < logos.length; i++) {
      const logo = logos[i];
      const img = nonEmpty(logo.image);
      const name = nonEmpty(logo.name);

      const alt = pickAltText({
        explicit: logo.alt || name,
        src: img,
        fallbacks: [],
        hardFallback: 'Logo',
      });

      // Inline-edit hook: clicking the logo in the WYSIWYG editor opens a media
      // popover (image + alt). Members[]-backed logos only (stable index/path).
      const photoAttr = useLogos ? ` data-inline-photo="${i}"` : '';
      const imgHtml = img
        ? `<img class="logo-wall-img"${photoAttr} src="${esc(img)}" alt="${esc(alt)}" />`
        : `<div class="logo-wall-placeholder is-empty"${photoAttr} aria-hidden="true">Logo</div>`;

      // Optional click behavior: a full-item overlay anchor (shared helper).
      // Suppressed in the editor so it never blocks the media popover.
      const linkHtml = cardLinkOverlayHtml(logo.link, mode, name || `Logo ${i + 1}`);

      items.push(`
        <div class="logo-wall-item${linkHtml ? ' has-link' : ''}" role="group" aria-label="${esc(
          name || `Logo ${i + 1}`
        )}">
          <div class="logo-wall-frame">
            ${imgHtml}
          </div>
          ${linkHtml}
        </div>
      `);
    }

    const count = items.length;
    const emptyHtml =
      count === 0
        ? `
          <div class="logo-wall-empty" role="note">
            Voeg logo’s toe in de editor.
          </div>
        `
        : '';

    return `
      <div class="slide slide-logo-wall slide-bg-mist${
        hasHeader ? ' has-header' : ''
      }" data-logo-count="${count}">
        <div class="slide-inner">
          ${headerHtml}
          <div class="logo-wall-grid">
            ${items.join('')}
          </div>
          ${emptyHtml}
        </div>
      </div>
    `;
  },
};

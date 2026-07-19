import {
  esc,
  pickAltText,
  nonEmpty,
  cardLinkOverlayHtml,
  bgClass,
  BACKGROUND_FIELD,
} from '../helpers.js';

// Cap for the logos[] array. The legacy numbered fields (logo{N}*) stay at 12:
// they predate logos[], and logoCount is a strictly validated enum — walls
// beyond 12 logos exist only in the array format.
export const MAX_LOGOS = 30;
const LEGACY_MAX = 12;

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
    return content.logos.slice(0, MAX_LOGOS).map((l) => ({
      image: l.image || '',
      name: l.name || '',
      alt: l.alt || '',
      link: l.link || '',
    }));
  }

  // Legacy format: logo{N}Image, logo{N}Name, etc.
  const count = clampInt(content?.logoCount || 1, 1, LEGACY_MAX);
  let maxUsedIdx = 0;
  for (let i = 1; i <= LEGACY_MAX; i++) {
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

/**
 * Canonicalize a logo wall to the array form (editor-only, idempotent).
 *
 * The read side (`resolveLogos`) folds the legacy numbered fields and the
 * preferred `logos[]` array into one view; this mutating helper materializes
 * `logos[]` so the inline media popover and card affordances have a stable,
 * mutable array to write to. Never called from `renderHtml` (which stays pure):
 * the inline editor runs it via the descriptor's `ensure` knob, on a legacy
 * deck this converts the numbered fields into `logos[]` the first time the deck
 * is opened for editing. Mirrors `ensureImageTextImages`.
 * @param {Object} content
 * @returns {Object} the same content object
 */
export function ensureLogos(content) {
  if (!content || typeof content !== 'object') return content;
  if (Array.isArray(content.logos) && content.logos.length > 0) {
    if (content.logos.length > MAX_LOGOS) content.logos.length = MAX_LOGOS;
    return content;
  }
  const folded = resolveLogos(content);
  // Guarantee one slot so an empty wall still offers a clickable "add a first
  // logo" cell on the canvas.
  content.logos =
    folded.length > 0 ? folded : [{ image: '', name: '', alt: '', link: '' }];
  return content;
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
    BACKGROUND_FIELD,
    {
      key: 'logoCount',
      label: 'Number of logos',
      type: 'enum',
      required: false,
      options: Array.from({ length: LEGACY_MAX }, (_v, i) => String(i + 1)),
      deprecated: true,
    },

    // New format: logos[] array (preferred for AI generation)
    {
      key: 'logos',
      label: 'Logos',
      type: 'items',
      required: false,
      minItems: 0,
      maxItems: MAX_LOGOS,
      itemDefaults: { image: '', name: '', alt: '', link: '' },
      itemFields: [
        { key: 'image', type: 'image', label: 'Logo image' },
        { key: 'name', type: 'string', label: 'Name', maxLength: 80 },
        // Optional: makes the whole logo clickable. `#N` jumps to slide N in the
        // deck (presenter only); an http(s)/mailto URL opens in a new tab.
        { key: 'link', type: 'string', label: 'Link URL', maxLength: 500 },
      ],
    },

    // Legacy 1..12 logos: image + (optional) name + optional explicit alt (author intent)
    ...Array.from({ length: LEGACY_MAX }, (_v, idx) => {
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
    background: 'mist',
    logoCount: '1',
    logo1Image: '',
    logo1Name: 'Logo',
  },

  renderHtml: (content, _slide, ctx) => {
    const mode = ctx?.mode;
    const editMode = mode === 'edit';
    const logos = resolveLogos(content);

    // In the editor an empty wall still needs one clickable cell so a FIRST
    // logo can be added in-slide (the media popover writes logos[0]); present /
    // export stay empty. The inline editor's `ensure` knob (ensureLogos) has
    // already materialized content.logos, so index 0 has a live item to mutate.
    const renderLogos =
      logos.length > 0 ? logos : editMode ? [{ image: '', name: '', alt: '', link: '' }] : [];

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
    for (let i = 0; i < renderLogos.length; i++) {
      const logo = renderLogos[i];
      const img = nonEmpty(logo.image);
      const name = nonEmpty(logo.name);

      const alt = pickAltText({
        explicit: logo.alt || name,
        src: img,
        fallbacks: [],
        hardFallback: 'Logo',
      });

      // Inline-edit hook: clicking the logo (filled or empty placeholder) in the
      // WYSIWYG editor opens the media popover (image + alt). The attribute is
      // inert on present/export; the inline editor's `ensure` knob guarantees a
      // matching logos[i] to write to.
      const photoAttr = ` data-inline-photo="${i}"`;
      const imgHtml = img
        ? `<img class="logo-wall-img"${photoAttr} src="${esc(img)}" alt="${esc(alt)}" />`
        : `<div class="logo-wall-placeholder is-empty"${photoAttr} aria-hidden="true">Logo</div>`;

      // Optional click behavior: a full-item overlay anchor (shared helper).
      // Suppressed in the editor so it never blocks the media popover.
      const linkHtml = cardLinkOverlayHtml(logo.link, mode, name || `Logo ${i + 1}`);

      items.push(`
        <div class="logo-wall-item${linkHtml ? ' has-link' : ''}" role="group" data-inline-item="logos" data-inline-item-index="${i}" aria-label="${esc(
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

    // Existing decks carry no background value; their historical look is mist.
    const bg = bgClass(content?.background || 'mist');

    // Counts 1-12 use the hand-tuned CSS tiers (fixed cell sizes that grow as
    // the wall empties). Beyond 12 the grid switches to fluid columns: a
    // steady 7-wide (8 for the last tier) so cell size stays consistent and
    // rows grow with the count.
    let fluidClass = '';
    let fluidStyle = '';
    if (count > 12) {
      const cols = count <= 28 ? 7 : 8;
      const rows = Math.ceil(count / cols);
      fluidClass = ' is-fluid';
      fluidStyle = ` style="--lw-cols: ${cols}; --lw-rows: ${rows};"`;
    }

    return `
      <div class="slide slide-logo-wall ${bg}${
        hasHeader ? ' has-header' : ''
      }${fluidClass}" data-logo-count="${count}"${fluidStyle}>
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

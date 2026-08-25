import {
  escapeHtml,
  pickAltText,
  clampInt,
  getSubheadingText,
  renderSubheadingHtml,
  renderBottomSubheadingHtml,
  hasBottomSubheading,
  bgClass,
  nonEmpty,
  objectPositionStyleAttrFromFocus,
  imagePlaceholderHtml,
} from '../helpers.js';

const MAX_CARDS = 25;

const LINKEDIN_ICON_SVG =
  '<svg class="team-card-linkedin-icon" viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true" focusable="false"><path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.32 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.79M6.88 8.56a1.68 1.68 0 0 0 1.68-1.68c0-.93-.75-1.69-1.68-1.69a1.69 1.69 0 0 0-1.69 1.69c0 .93.76 1.68 1.69 1.68m1.39 9.94v-8.37H5.5v8.37h2.77z"/></svg>';

/** Normalize a user-entered LinkedIn URL by adding a scheme if missing. */
function normalizeLinkedinUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith('//')) return `https:${s}`;
  return `https://${s}`;
}

/**
 * Normalize `members[]` into the shape the renderer reads: every declared item
 * key present, focus points defaulted to the centre.
 *
 * Until the v7 -> v8 schema fold this also carried a second branch for the flat
 * `card1Name`…`card25Linkedin` family. That family no longer exists — stored
 * decks are folded once at read time (`shared/slide-types/schema-version.js`),
 * so `members[]` is the only shape there is.
 *
 * @param {Object} content
 * @returns {Array<{image: string, alt: string, imageFocusX: number,
 *   imageFocusY: number, name: string, byline: string, linkedin: string}>}
 */
function resolveMembers(content) {
  if (!Array.isArray(content?.members)) return [];
  return content.members.slice(0, MAX_CARDS).map((m) => ({
    image: m?.image || '',
    alt: m?.alt || '',
    imageFocusX: m?.imageFocusX ?? 50,
    imageFocusY: m?.imageFocusY ?? 50,
    name: m?.name || '',
    byline: m?.byline || '',
    linkedin: m?.linkedin || '',
  }));
}

/**
 * Canonicalize an "Image blocks" slide to the array form (editor-only,
 * idempotent). Mirrors `ensureLogos` / `ensureImageTextImages`: it materializes
 * `members[]` so the inline media popover and card affordances have a stable,
 * mutable array to write to. Never called from `renderHtml` (which stays pure):
 * the inline editor runs it via the descriptor's `ensure` knob.
 *
 * When there is genuinely nothing, it leaves an empty array (not a seeded empty
 * member): the renderer skips all-empty members, so a seed would be an
 * invisible orphan — the inline "+ Add block" affordance provides the first
 * block instead.
 * @param {Object} content
 * @returns {Object} the same content object
 */
export function ensureMembers(content) {
  if (!content || typeof content !== 'object') return content;
  if (!Array.isArray(content.members)) {
    content.members = [];
    return content;
  }
  if (content.members.length > MAX_CARDS) content.members.length = MAX_CARDS;
  return content;
}

export default {
  structure: 'collection',
  fallback: 'list-slide',
  runtime: 'static',
  label: 'Image blocks',
  fields: [
    {
      key: 'title',
      label: 'Title (optional)',
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
      key: 'bottomSubheading',
      label: 'Bottom subheading',
      type: 'string',
      required: false,
      maxLength: 200,
    },
    {
      key: 'subheading2',
      label: 'Right group subheading',
      type: 'string',
      required: false,
      maxLength: 220,
    },

    // Declared before the layout enums so the editor's definition-order form
    // leads with content (the blocks), settings after.
    {
      key: 'members',
      label: 'Members',
      type: 'items',
      required: false,
      minItems: 0,
      maxItems: MAX_CARDS,
      collapsible: true, // item-rich: per-block collapse in the editor
      // Seed placeholder title/caption so a newly added block renders immediately
      // (an all-empty member is skipped by the renderer). Matches the side form's
      // "+ Add block" behaviour.
      itemDefaults: {
        image: '',
        alt: '',
        imageFocusX: 50,
        imageFocusY: 50,
        name: 'Title',
        byline: 'Caption',
        linkedin: '',
      },
      itemDefaultsByLang: {
        nl: {
          image: '',
          alt: '',
          imageFocusX: 50,
          imageFocusY: 50,
          name: 'Titel',
          byline: 'Bijschrift',
          linkedin: '',
        },
      },
      itemFields: [
        // Labels match the "Image blocks" framing (and the side form): the
        // photo's name is the block Title, the byline is its Caption. These
        // labels also drive the in-slide inline "+ …" ghost chips.
        { key: 'image', type: 'image', label: 'Photo' },
        // Declared because the renderer reads it (see resolveMembers) and
        // itemDefaults seeds it. gallery-slide's images[] declares its `alt`
        // the same way.
        { key: 'alt', type: 'string', label: 'Photo alt text', maxLength: 180 },
        { key: 'name', type: 'string', label: 'Title', maxLength: 80 },
        { key: 'byline', type: 'string', label: 'Caption', maxLength: 120 },
        {
          key: 'linkedin',
          type: 'string',
          label: 'LinkedIn URL',
          maxLength: 300,
        },
      ],
    },
    {
      key: 'background',
      label: 'Background',
      type: 'enum',
      required: false,
      options: [
        { value: 'mist', label: 'Mist' },
        { value: 'lime', label: 'Lime' },
        { value: 'calm', label: 'Calm' },
      ],
    },
    {
      key: 'textPosition',
      label: 'Text position',
      type: 'enum',
      required: false,
      options: [
        { value: 'below', label: 'Both below image' },
        { value: 'split', label: 'Title above, caption below' },
      ],
    },
    {
      key: 'imageShape',
      label: 'Image shape',
      type: 'enum',
      required: false,
      options: [
        { value: 'rounded', label: 'Rounded' },
        { value: 'square', label: 'Square' },
        { value: 'circle', label: 'Circle' },
      ],
    },
    {
      key: 'imageAspect',
      label: 'Image aspect',
      type: 'enum',
      required: false,
      options: [
        { value: 'square', label: 'Square' },
        { value: 'original', label: 'Original' },
      ],
    },
    {
      key: 'showPhotoFrame',
      label: 'Show photo frame',
      type: 'enum',
      required: false,
      options: [
        { value: 'off', label: 'Off' },
        { value: 'on', label: 'On' },
      ],
    },
    {
      key: 'columnSplit',
      label: 'Column split',
      type: 'enum',
      required: false,
      options: [
        { value: '', label: 'No split' },
        { value: '1', label: 'After 1' },
        { value: '2', label: 'After 2' },
        { value: '3', label: 'After 3' },
        { value: '4', label: 'After 4' },
        { value: '5', label: 'After 5' },
      ],
    },
  ],

  // A fresh slide opens with one block, so the canvas has something to click.
  // It is seeded in `members[]` — the numbered `card1*` keys this used to write
  // are gone (v7 -> v8), and seeding the flat form was how a brand-new slide
  // ended up stored in the legacy shape in the first place.
  defaults: {
    title: '',
    subheading: '',
    bottomSubheading: '',
    background: 'mist',
    textPosition: 'below',
    imageShape: 'rounded',
    imageAspect: 'square',
    showPhotoFrame: 'off',
    columnSplit: '',
    subheading2: '',
    members: [
      {
        image: '',
        alt: '',
        imageFocusX: 50,
        imageFocusY: 50,
        name: 'Title',
        byline: 'Caption',
        linkedin: '',
      },
    ],
  },

  renderHtml: (content) => {
    const members = resolveMembers(content);

    const title = nonEmpty(content?.title);
    const subheading = getSubheadingText(content);
    const subheading2 = nonEmpty(content?.subheading2);
    const hasHeader = !!(title || subheading);
    const bottomSubheadingHtml = renderBottomSubheadingHtml(content);
    const hasBottom = hasBottomSubheading(content);

    // New options
    const bg = bgClass(content?.background || 'mist');
    const textPosition = content?.textPosition === 'split' ? 'split' : 'below';
    const imageShape = ['square', 'circle'].includes(content?.imageShape)
      ? content.imageShape
      : 'rounded';
    // Circles must be cropped to a square regardless of the aspect control —
    // you can't crop an ellipse cleanly.
    const imageAspect =
      imageShape === 'circle'
        ? 'square'
        : content?.imageAspect === 'original'
          ? 'original'
          : 'square';
    const showPhotoFrame = content?.showPhotoFrame === 'on';

    // Column split: number of columns in the left group (0 or empty = no split)
    const columnSplit = clampInt(content?.columnSplit || 0, 0, 5, 0);
    const hasSplit = columnSplit > 0;

    // Inline-edit paths target members[] — the only shape there is. The inline
    // editor's `ensure` knob (ensureMembers) guarantees the array exists before
    // decorating, so the paths are always live in edit mode; on present/export
    // the attributes are inert.

    // Helper to build a single card HTML from a member object
    const buildCard = (member, idx) => {
      const img = nonEmpty(member.image);
      const altExplicit = nonEmpty(member.alt || member.name);
      const focusX = member.imageFocusX;
      const focusY = member.imageFocusY;
      const name = nonEmpty(member.name);
      const byline = nonEmpty(member.byline);
      const isUsed = !!(img || name || byline);
      if (!isUsed) return null;

      const alt = pickAltText({
        explicit: altExplicit || name,
        src: img,
        fallbacks: [byline],
        hardFallback: 'Image',
      });

      // Only apply focus position for square aspect (cropped images)
      const focusStyle =
        imageAspect === 'square'
          ? objectPositionStyleAttrFromFocus({ focusX, focusY })
          : '';

      // Inline-edit hook: clicking the photo (filled or empty placeholder) in
      // the WYSIWYG editor opens a media popover (image + alt + LinkedIn). The
      // `ensure` knob guarantees a matching members[idx] to write to.
      const photoAttr = ` data-inline-photo="${idx}"`;
      const photoHtml = img
        ? `
          <div class="team-card-photo"${photoAttr}>
            <img src="${escapeHtml(img)}" alt="${escapeHtml(alt)}"${focusStyle ? ` ${focusStyle}` : ''} />
          </div>
        `
        : `
          ${imagePlaceholderHtml({ className: 'team-card-photo', compact: true, attrs: photoAttr })}
        `;

      const namePath = `members.${idx}.name`;
      const bylinePath = `members.${idx}.byline`;
      const nameHtml = name
        ? `<div class="team-card-name" data-inline-field="${namePath}" dir="auto">${escapeHtml(name)}</div>`
        : '';
      const bylineHtml = byline
        ? `<div class="team-card-byline" data-inline-field="${bylinePath}" dir="auto">${escapeHtml(byline)}</div>`
        : '';

      const linkedinUrl = normalizeLinkedinUrl(member.linkedin);
      const linkedinHtml = linkedinUrl
        ? `<a class="team-card-linkedin" href="${escapeHtml(linkedinUrl)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(
            name ? `LinkedIn - ${name}` : 'LinkedIn',
          )}">${LINKEDIN_ICON_SVG}</a>`
        : '';

      // Order content based on textPosition
      let cardContent;
      if (textPosition === 'split') {
        // Split: title above image, caption below image
        cardContent = `${nameHtml}${photoHtml}${bylineHtml}${linkedinHtml}`;
      } else {
        // Below (default): both title and caption below image
        const textHtml =
          nameHtml || bylineHtml || linkedinHtml
            ? `<div class="team-card-text">${nameHtml}${bylineHtml}${linkedinHtml}</div>`
            : '';
        cardContent = `${photoHtml}${textHtml}`;
      }

      const itemAttrs = ` data-inline-item="members" data-inline-item-index="${idx}"`;
      return `
        <div class="team-card" role="group" aria-label="${escapeHtml(
          name || `Block ${idx + 1}`,
        )}"${itemAttrs}>
          ${cardContent}
        </div>
      `;
    };

    // Build all cards from resolved members
    const allCards = [];
    for (let i = 0; i < members.length; i++) {
      const cardHtml = buildCard(members[i], i);
      if (cardHtml) allCards.push(cardHtml);
    }

    const count = allCards.length;
    const emptyHtml =
      count === 0
        ? `
          <div class="team-cards-empty" role="note">
            Add blocks in the editor.
          </div>
        `
        : '';

    // Determine row count based on standard layout.
    // 1–6: 1 row · 7–12: 2 · 13–18: 3 · 19–24: 4 · 25: 5.
    const getRowCount = (n) => {
      if (n <= 6) return 1;
      if (n <= 12) return 2;
      if (n <= 18) return 3;
      if (n <= 24) return 4;
      return 5;
    };
    const rows = getRowCount(count);

    // For split layout, divide cards into two groups
    if (hasSplit && count > 0) {
      // Left group gets columnSplit columns worth of cards
      const leftCardCount = Math.min(columnSplit * rows, count);
      const leftCards = allCards.slice(0, leftCardCount);
      const rightCards = allCards.slice(leftCardCount);

      const leftCols = columnSplit;
      const rightCols = Math.ceil(rightCards.length / rows);

      // Header with just title (no subheadings here - they go in the groups)
      const headerHtml = title
        ? `
          <div class="header">
            <h2 class="title" data-morph-role="title" data-inline-field="title" dir="auto">${escapeHtml(title)}</h2>
          </div>
        `
        : '';

      // Subheadings go inside each group for proper alignment
      const leftSubheadingHtml = subheading
        ? `<p class="team-cards-group-subheading" data-morph-role="subtitle" data-inline-field="subheading" dir="auto">${escapeHtml(subheading)}</p>`
        : '';
      const rightSubheadingHtml = subheading2
        ? `<p class="team-cards-group-subheading" data-inline-field="subheading2" dir="auto">${escapeHtml(subheading2)}</p>`
        : '';

      return `
        <div class="slide slide-team-cards ${bg} text-${textPosition} aspect-${imageAspect} shape-${imageShape}${
          showPhotoFrame ? ' has-photo-frame' : ''
        }${
          hasHeader ? ' has-header' : ''
        }${hasBottom ? ' has-bottom-subheading' : ''} has-column-split" data-card-count="${count}" data-split-left="${leftCols}" data-split-right="${rightCols}">
          <div class="slide-inner">
            ${headerHtml}
            <div class="team-cards-split-container">
              <div class="team-cards-group" data-cols="${leftCols}">
                ${leftSubheadingHtml}
                <div class="team-cards-grid" data-cols="${leftCols}">
                  ${leftCards.join('')}
                </div>
              </div>
              <div class="team-cards-group team-cards-group-right" data-cols="${rightCols}">
                ${rightSubheadingHtml}
                <div class="team-cards-grid" data-cols="${rightCols}">
                  ${rightCards.join('')}
                </div>
              </div>
            </div>
            ${emptyHtml}
            ${bottomSubheadingHtml}
          </div>
        </div>
      `;
    }

    // Non-split layout (original)
    const headerHtml =
      title || subheading
        ? `
          <div class="header">
            ${title ? `<h2 class="title" data-morph-role="title" data-inline-field="title" dir="auto">${escapeHtml(title)}</h2>` : ''}
            ${renderSubheadingHtml(content, 'subheading', 'subtitle')}
          </div>
        `
        : '';

    return `
      <div class="slide slide-team-cards ${bg} text-${textPosition} aspect-${imageAspect} shape-${imageShape}${
        showPhotoFrame ? ' has-photo-frame' : ''
      }${
        hasHeader ? ' has-header' : ''
      }${hasBottom ? ' has-bottom-subheading' : ''}" data-card-count="${count}">
        <div class="slide-inner">
          ${headerHtml}
          <div class="team-cards-grid">
            ${allCards.join('')}
          </div>
          ${emptyHtml}
          ${bottomSubheadingHtml}
        </div>
      </div>
    `;
  },
};

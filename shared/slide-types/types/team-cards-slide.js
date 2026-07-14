import {
  esc,
  pickAltText,
  clampInt,
  getSubheadingText,
  renderBottomSubheadingHtml,
  hasBottomSubheading,
  bgClass,
  nonEmpty,
  objectPositionStyleAttrFromFocus,
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
 * Resolve members from either the new `members[]` array or legacy numbered fields.
 * Returns an array of { image, alt, imageFocusX, imageFocusY, name, byline } objects.
 */
export function resolveMembers(content) {
  // New format: members[]
  if (Array.isArray(content?.members) && content.members.length > 0) {
    return content.members.map((m) => ({
      image: m.image || '',
      alt: m.alt || '',
      imageFocusX: m.imageFocusX ?? 50,
      imageFocusY: m.imageFocusY ?? 50,
      name: m.name || '',
      byline: m.byline || '',
      linkedin: m.linkedin || '',
    }));
  }

  // Legacy format: card{N}Name, card{N}Byline, etc.
  const count = Math.max(1, Math.min(MAX_CARDS, Number(content?.cardCount) || 1));
  // Be forgiving: scan beyond cardCount for populated cards
  let maxUsedIdx = 0;
  for (let i = 1; i <= MAX_CARDS; i++) {
    if (content?.[`card${i}Image`] || content?.[`card${i}Name`] || content?.[`card${i}Byline`]) {
      maxUsedIdx = i;
    }
  }
  const scanCount = Math.max(count, maxUsedIdx);

  const members = [];
  for (let i = 1; i <= scanCount; i++) {
    const image = content?.[`card${i}Image`] || '';
    const name = content?.[`card${i}Name`] || '';
    const byline = content?.[`card${i}Byline`] || '';
    if (image || name || byline) {
      members.push({
        image,
        alt: content?.[`card${i}Alt`] || '',
        imageFocusX: content?.[`card${i}ImageFocusX`] ?? 50,
        imageFocusY: content?.[`card${i}ImageFocusY`] ?? 50,
        name,
        byline,
        linkedin: content?.[`card${i}Linkedin`] || '',
      });
    }
  }
  return members;
}

export default {
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
      key: 'background',
      label: 'Background',
      type: 'enum',
      required: false,
      options: ['mist', 'lime', 'calm'],
    },
    {
      key: 'textPosition',
      label: 'Text position',
      type: 'enum',
      required: false,
      options: ['below', 'split'],
    },
    {
      key: 'imageShape',
      label: 'Image shape',
      type: 'enum',
      required: false,
      options: ['rounded', 'square', 'circle'],
    },
    {
      key: 'imageAspect',
      label: 'Image aspect',
      type: 'enum',
      required: false,
      options: ['square', 'original'],
    },
    {
      key: 'showPhotoFrame',
      label: 'Show photo frame',
      type: 'enum',
      required: false,
      options: ['off', 'on'],
    },
    {
      key: 'columnSplit',
      label: 'Column split',
      type: 'enum',
      required: false,
      options: ['', '1', '2', '3', '4', '5'],
    },
    {
      key: 'subheading2',
      label: 'Right group subheading',
      type: 'string',
      required: false,
      maxLength: 220,
    },
    {
      key: 'cardCount',
      label: 'Number of cards',
      type: 'enum',
      required: false,
      options: Array.from({ length: MAX_CARDS }, (_v, i) => String(i + 1)),
      deprecated: true,
    },

    // New format: members[] array (preferred for AI generation)
    {
      key: 'members',
      label: 'Members',
      type: 'items',
      required: false,
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
      itemFields: [
        // Labels match the "Image blocks" framing (and the side form): the
        // photo's name is the block Title, the byline is its Caption. These
        // labels also drive the in-slide inline "+ …" ghost chips.
        { key: 'image', type: 'image', label: 'Photo' },
        { key: 'name', type: 'string', label: 'Title', maxLength: 80 },
        { key: 'byline', type: 'string', label: 'Caption', maxLength: 120 },
        { key: 'linkedin', type: 'string', label: 'LinkedIn URL', maxLength: 300 },
      ],
    },

    // Legacy 1..12 cards: image + name + byline + optional explicit alt (author intent) + focus
    ...Array.from({ length: MAX_CARDS }, (_v, idx) => {
      const i = idx + 1;
      return [
        {
          key: `card${i}Image`,
          label: `Card ${i} photo`,
          type: 'image',
          required: false,
        },
        {
          key: `card${i}Alt`,
          label: `Card ${i} photo alt text (optional)`,
          type: 'string',
          required: false,
          maxLength: 180,
        },
        {
          key: `card${i}ImageFocusX`,
          label: `Card ${i} image focus X`,
          type: 'number',
          required: false,
          min: 0,
          max: 100,
          step: 1,
        },
        {
          key: `card${i}ImageFocusY`,
          label: `Card ${i} image focus Y`,
          type: 'number',
          required: false,
          min: 0,
          max: 100,
          step: 1,
        },
        {
          key: `card${i}Name`,
          label: `Card ${i} name`,
          type: 'string',
          required: false,
          maxLength: 80,
        },
        {
          key: `card${i}Byline`,
          label: `Card ${i} byline`,
          type: 'string',
          required: false,
          maxLength: 120,
        },
        {
          key: `card${i}Linkedin`,
          label: `Card ${i} LinkedIn URL`,
          type: 'string',
          required: false,
          maxLength: 300,
        },
      ];
    }).flat(),
  ],

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
    cardCount: '1',
    card1Image: '',
    card1Name: 'Title',
    card1Byline: 'Caption',
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

    // Inline-edit paths must point at the data source resolveMembers() used.
    const useMembers = Array.isArray(content?.members) && content.members.length > 0;

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
      const focusStyle = imageAspect === 'square'
        ? objectPositionStyleAttrFromFocus({ focusX, focusY })
        : '';

      // Inline-edit hook: clicking the photo in the WYSIWYG editor opens a media
      // popover (image + alt + LinkedIn). Only members[]-backed cards carry a
      // stable index/path, so the attribute is members-only.
      const photoAttr = useMembers ? ` data-inline-photo="${idx}"` : '';
      const photoHtml = img
        ? `
          <div class="team-card-photo"${photoAttr}>
            <img src="${esc(img)}" alt="${esc(alt)}"${focusStyle ? ` ${focusStyle}` : ''} />
          </div>
        `
        : `
          <div class="team-card-photo is-empty"${photoAttr}></div>
        `;

      const namePath = useMembers ? `members.${idx}.name` : `card${idx + 1}Name`;
      const bylinePath = useMembers ? `members.${idx}.byline` : `card${idx + 1}Byline`;
      const nameHtml = name
        ? `<div class="team-card-name" data-inline-field="${namePath}" dir="auto">${esc(name)}</div>`
        : '';
      const bylineHtml = byline
        ? `<div class="team-card-byline" data-inline-field="${bylinePath}" dir="auto">${esc(byline)}</div>`
        : '';

      const linkedinUrl = normalizeLinkedinUrl(member.linkedin);
      const linkedinHtml = linkedinUrl
        ? `<a class="team-card-linkedin" href="${esc(linkedinUrl)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(
            name ? `LinkedIn - ${name}` : 'LinkedIn'
          )}">${LINKEDIN_ICON_SVG}</a>`
        : '';

      // Order content based on textPosition
      let cardContent;
      if (textPosition === 'split') {
        // Split: title above image, caption below image
        cardContent = `${nameHtml}${photoHtml}${bylineHtml}${linkedinHtml}`;
      } else {
        // Below (default): both title and caption below image
        const textHtml = (nameHtml || bylineHtml || linkedinHtml)
          ? `<div class="team-card-text">${nameHtml}${bylineHtml}${linkedinHtml}</div>`
          : '';
        cardContent = `${photoHtml}${textHtml}`;
      }

      const itemAttrs = useMembers
        ? ` data-inline-item="members" data-inline-item-index="${idx}"`
        : '';
      return `
        <div class="team-card" role="group" aria-label="${esc(
          name || `Block ${idx + 1}`
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
            <h2 class="title" data-morph-role="title" data-inline-field="title" dir="auto">${esc(title)}</h2>
          </div>
        `
        : '';

      // Subheadings go inside each group for proper alignment
      const leftSubheadingHtml = subheading
        ? `<p class="team-cards-group-subheading" data-morph-role="subtitle" data-inline-field="subheading" dir="auto">${esc(subheading)}</p>`
        : '';
      const rightSubheadingHtml = subheading2
        ? `<p class="team-cards-group-subheading" data-inline-field="subheading2" dir="auto">${esc(subheading2)}</p>`
        : '';

      return `
        <div class="slide slide-team-cards ${bg} text-${textPosition} aspect-${imageAspect} shape-${imageShape}${
          showPhotoFrame ? ' has-photo-frame' : ''
        }${hasHeader ? ' has-header' : ''
        }${hasBottom ? ' has-bottom-subheading' : ''} has-column-split" data-card-count="${count}" data-split-left="${leftCols}" data-split-right="${rightCols}">
          <div class="slide-inner">
            ${headerHtml}
            <div class="team-cards-split-container">
              <div class="team-cards-group team-cards-group-left" data-cols="${leftCols}">
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
            ${title ? `<h2 class="title" data-morph-role="title" data-inline-field="title" dir="auto">${esc(title)}</h2>` : ''}
            ${subheading ? `<p class="subheading" data-morph-role="subtitle" data-inline-field="subheading" dir="auto">${esc(subheading)}</p>` : ''}
          </div>
        `
        : '';

    return `
      <div class="slide slide-team-cards ${bg} text-${textPosition} aspect-${imageAspect} shape-${imageShape}${
        showPhotoFrame ? ' has-photo-frame' : ''
      }${hasHeader ? ' has-header' : ''
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

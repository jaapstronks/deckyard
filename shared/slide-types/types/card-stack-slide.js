import { esc, renderSubheadingHtml, getCardTitle } from '../helpers.js';
import { markdownToSafeHtml } from '../../markdown.js';

function hexToRgb(hex) {
  const s = String(hex || '').trim();
  const m = s.match(/^#?([0-9a-f]{6})$/i);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function relLuminance({ r, g, b }) {
  const toLin = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const R = toLin(r);
  const G = toLin(g);
  const B = toLin(b);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

function pickTextColorForBg(bgHex, { light = '#ffffff', dark = '#212121' } = {}) {
  const rgb = hexToRgb(bgHex);
  if (!rgb) return dark;
  // Midpoint-ish threshold: works well for saturated blues and dark greys.
  const lum = relLuminance(rgb);
  return lum < 0.5 ? light : dark;
}

function themeCardStackPalette(theme) {
  const slideColors = theme?.slides?.['card-stack-slide']?.colors;
  if (Array.isArray(slideColors) && slideColors.filter(Boolean).length)
    return slideColors.map((c) => String(c).trim()).filter(Boolean);
  const brand = theme?.brandColors;
  if (Array.isArray(brand) && brand.filter(Boolean).length)
    return brand.map((c) => String(c).trim()).filter(Boolean);
  return ['#5b21b6', '#7c3aed', '#a78bfa', '#c4b5fd'];
}

export default {
  deprecated: true, // Hidden from editor + AI. Kept for rendering existing slides. Migrate to icon-card-grid-slide.
  label: 'Card stack',
  // Reader/reflow projection: treat the flat card1Title / card1Label / card1Body
  // … slots as one bounded, per-slot-grouped collection, so existing decks
  // project cleanly (title + body stay one unit; slots beyond cardCount don't
  // leak). See semantic-projection.js#projectRepeatingGroup. Card order is
  // incidental → unordered list.
  repeatingGroups: [
    { countKey: 'cardCount', prefix: 'card', slotFields: ['Title', 'Label', 'Body'], ordered: false },
  ],
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
      maxLength: 200,
    },
    {
      key: 'cardCount',
      label: 'Cards',
      type: 'enum',
      required: false,
      options: ['1', '2', '3', '4', '5', '6'],
    },
    {
      key: 'card1Title',
      label: 'Card 1 title',
      type: 'string',
      required: false,
      maxLength: 40,
    },
    // DEPRECATED: Remove after April 2026
    {
      key: 'card1Label',
      label: 'Card 1 label',
      type: 'string',
      required: false,
      maxLength: 40,
      hidden: true,
    },
    {
      key: 'card1Body',
      label: 'Card 1 body (Markdown)',
      type: 'markdown',
      required: false,
      maxLength: 900,
    },
    {
      key: 'card2Title',
      label: 'Card 2 title',
      type: 'string',
      required: false,
      maxLength: 40,
    },
    // DEPRECATED: Remove after April 2026
    {
      key: 'card2Label',
      label: 'Card 2 label',
      type: 'string',
      required: false,
      maxLength: 40,
      hidden: true,
    },
    {
      key: 'card2Body',
      label: 'Card 2 body (Markdown)',
      type: 'markdown',
      required: false,
      maxLength: 900,
    },
    {
      key: 'card3Title',
      label: 'Card 3 title',
      type: 'string',
      required: false,
      maxLength: 40,
    },
    // DEPRECATED: Remove after April 2026
    {
      key: 'card3Label',
      label: 'Card 3 label',
      type: 'string',
      required: false,
      maxLength: 40,
      hidden: true,
    },
    {
      key: 'card3Body',
      label: 'Card 3 body (Markdown)',
      type: 'markdown',
      required: false,
      maxLength: 900,
    },
    {
      key: 'card4Title',
      label: 'Card 4 title',
      type: 'string',
      required: false,
      maxLength: 40,
    },
    // DEPRECATED: Remove after April 2026
    {
      key: 'card4Label',
      label: 'Card 4 label',
      type: 'string',
      required: false,
      maxLength: 40,
      hidden: true,
    },
    {
      key: 'card4Body',
      label: 'Card 4 body (Markdown)',
      type: 'markdown',
      required: false,
      maxLength: 900,
    },
    {
      key: 'card5Title',
      label: 'Card 5 title',
      type: 'string',
      required: false,
      maxLength: 40,
    },
    {
      key: 'card5Body',
      label: 'Card 5 body (Markdown)',
      type: 'markdown',
      required: false,
      maxLength: 900,
    },
    {
      key: 'card6Title',
      label: 'Card 6 title',
      type: 'string',
      required: false,
      maxLength: 40,
    },
    {
      key: 'card6Body',
      label: 'Card 6 body (Markdown)',
      type: 'markdown',
      required: false,
      maxLength: 900,
    },
  ],
  defaults: {
    title: "What we're building",
    subheading: 'Four key focus areas',
    cardCount: '4',
    card1Title: 'Insight',
    card1Body: '- First point\n- Second point',
    card2Title: 'Design',
    card2Body: '- First point\n- Second point',
    card3Title: 'Build',
    card3Body: '- First point\n- Second point',
    card4Title: 'Launch',
    card4Body: '- First point\n- Second point',
  },
  renderHtml: (content, slide, ctx) => {
    const theme =
      ctx?.theme && typeof ctx.theme === 'object'
        ? ctx.theme
        : null;
    const count = Math.max(1, Math.min(6, Number(content?.cardCount || 4) || 4));
    const subheading = renderSubheadingHtml(content, 'subheading', 'subtitle');

    const palette = themeCardStackPalette(theme);
    const lightText = String(theme?.textColorLight || '#ffffff');
    const darkText = String(theme?.textColorDark || '#212121');

    const cards = [];
    for (let i = 1; i <= count; i += 1) {
      const title = getCardTitle(content, i);
      const bodyRaw = String(content?.[`card${i}Body`] || '').trim();
      const bg = palette[(i - 1) % palette.length] || '#7c3aed';
      const fg = pickTextColorForBg(bg, { light: lightText, dark: darkText });
      cards.push(`
          <div class="card-stack-row" data-morph-role="card-${i - 1}" role="group" aria-label="${esc(
            title || `Card ${i}`
          )}">
            <div class="card-stack-label" data-inline-field="card${i}Title" dir="auto" style="--cs-label-bg:${esc(bg)}; --cs-label-fg:${esc(fg)}">
              ${esc(title || `Card ${i}`)}
            </div>
            <div class="card-stack-body" data-inline-field="card${i}Body">
              ${markdownToSafeHtml(bodyRaw)}
            </div>
          </div>
        `);
    }

    return `
        <div class="slide slide-card-stack slide-bg-mist" data-card-count="${count}">
          <div class="slide-inner">
            <div class="header">
              <h2 class="title" data-morph-role="title" data-inline-field="title" dir="auto">${esc(content?.title)}</h2>
              ${subheading}
            </div>
            <div class="card-stack">
              ${cards.join('')}
            </div>
          </div>
        </div>
      `;
  },
};

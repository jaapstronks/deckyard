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

/** Max cards a stack holds. Mirrors the schema's maxItems + the cardCount enum. */
const MAX_CARDS = 6;

/** True when an items[] entry carries nothing worth rendering. */
function isBlankItem(item) {
  if (!item || typeof item !== 'object') return true;
  return !['title', 'body'].some((k) => String(item[k] || '').trim());
}

/**
 * Length of items[] up to and including its last non-blank entry. Mirrors
 * icon-card-grid: imported / API-authored decks sometimes pad items[] with
 * trailing blanks; trimming (rather than filtering) keeps the surviving indices
 * aligned with the `items.N.field` inline-edit paths.
 */
function filledItemCount(items) {
  let last = -1;
  for (let i = 0; i < items.length; i += 1) {
    if (!isBlankItem(items[i])) last = i;
  }
  return last + 1;
}

/**
 * Resolve cards from content — supports both the canonical items[] array and
 * the legacy numbered fields (card1Title / card1Label / card1Body). items[]
 * takes precedence when present. Card titles fold the deprecated cardNLabel
 * mirror via getCardTitle.
 * @param {object} content
 * @param {number} count
 * @returns {Array<{title:string, body:string}>}
 */
function resolveCards(content, count) {
  const cards = [];

  // Canonical format: items[] array.
  if (Array.isArray(content?.items) && content.items.length > 0) {
    for (let i = 0; i < count; i += 1) {
      const item = content.items[i] || {};
      cards.push({
        title: String(item.title || '').trim(),
        body: String(item.body || '').trim(),
      });
    }
    return cards;
  }

  // Legacy format: card1Title / card1Label / card1Body.
  for (let i = 1; i <= count; i += 1) {
    cards.push({
      title: getCardTitle(content, i),
      body: String(content?.[`card${i}Body`] || '').trim(),
    });
  }
  return cards;
}

/**
 * Resolve the rendered card view once, shared by renderHtml and the print
 * export so both read the same source. items[] is the source of truth when
 * present: cardCount is a stale legacy mirror there (inline add/remove only
 * mutates the array), so counting it would keep rendering an empty slot after a
 * card removal.
 * @param {object} content
 * @returns {{ useItems: boolean, count: number, cards: Array<{title:string, body:string}> }}
 */
export function resolveCardStack(content) {
  const useItems = Array.isArray(content?.items) && content.items.length > 0;
  const count = useItems
    ? Math.max(1, Math.min(MAX_CARDS, filledItemCount(content.items)))
    : Math.max(1, Math.min(MAX_CARDS, Number(content?.cardCount || 4) || 4));
  return { useItems, count, cards: resolveCards(content, count) };
}

/**
 * Canonical items[] for a card-stack slide, bounded by cardCount and trimmed of
 * trailing blanks. Used by the schema-version migration (v2 -> v3) to fold
 * legacy numbered decks into the array shape once, so the semantic projection
 * and everything else read one shape. Returns [] when there is nothing to fold.
 * @param {object} content
 * @returns {Array<{title:string, body:string}>}
 */
export function resolveCardStackItems(content) {
  if (!content || typeof content !== 'object') return [];
  const count = Math.max(1, Math.min(MAX_CARDS, Number(content.cardCount || 4) || 4));
  const resolved = resolveCards(content, count);
  return resolved.slice(0, filledItemCount(resolved));
}

/**
 * Materialize items[] from the legacy numbered fields so the inline editor's
 * card affordances (add / remove / reorder) have a stable, mutable array to
 * write to. Mirrors ensureIconCards (icon-card-grid): the read side
 * (resolveCards) folds the two sources into one view; this mutating helper
 * commits that view to items[]. Idempotent, and never called from renderHtml
 * (which stays pure) — the inline editor runs it via the descriptor's `ensure`
 * knob. The legacy numbered fields are read, not deleted, so they survive as a
 * mirror (renderHtml already prefers items[]).
 * @param {object} content
 * @returns {object} the same content object
 */
export function ensureCardStack(content) {
  if (!content || typeof content !== 'object') return content;
  if (Array.isArray(content.items) && content.items.length > 0) {
    if (content.items.length > MAX_CARDS) content.items.length = MAX_CARDS;
    return content;
  }
  content.items = resolveCardStackItems(content);
  return content;
}

export default {
  deprecated: true, // Hidden from editor + AI. Kept for rendering existing slides. Migrate to icon-card-grid-slide.
  label: 'Card stack',
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

    // Canonical items[] format. Card order is incidental → unordered list in the
    // reader projection (ordered: false). This replaces the former
    // `repeatingGroups` projection bridge: a real items[] field projects
    // natively (one grouped block per card), so the bridge declaration is gone.
    {
      key: 'items',
      label: 'Cards',
      type: 'items',
      required: false,
      minItems: 1,
      maxItems: 6,
      ordered: false,
      itemDefaults: { title: 'Card', body: '- First point\n- Second point' },
      itemFields: [
        { key: 'title', label: 'Title', type: 'string', required: false, maxLength: 40 },
        { key: 'body', label: 'Body', type: 'markdown', required: false, maxLength: 900 },
      ],
    },

    // LEGACY: numbered card fields (card1Title / card1Label / card1Body, etc.).
    // Hidden so they never double-project beside items[] in the semantic
    // projection; the editor still reads/writes them as a mirror and old decks
    // keep loading. Removed in a later deprecation-window cleanup.
    ...Array.from({ length: MAX_CARDS }, (_, idx) => {
      const i = idx + 1;
      return [
        {
          key: `card${i}Title`,
          label: `Card ${i} title`,
          type: 'string',
          required: false,
          maxLength: 40,
          hidden: true,
        },
        // DEPRECATED: Remove after April 2026
        {
          key: `card${i}Label`,
          label: `Card ${i} label`,
          type: 'string',
          required: false,
          maxLength: 40,
          hidden: true,
        },
        {
          key: `card${i}Body`,
          label: `Card ${i} body (Markdown)`,
          type: 'markdown',
          required: false,
          maxLength: 900,
          hidden: true,
        },
      ];
    }).flat(),
  ],
  // Numbered defaults (NOT items[]): a deck import / validation merges the
  // type defaults onto provided content, so seeding items[] here would inject
  // default cards over an imported numbered deck and mask its content. The
  // canonical items[] is produced by the schema-version fold (legacy decks) or
  // by the editor's ensureCardStack on mount — the same contract as
  // icon-card-grid. New card-stack slides only arise via conversion, which
  // writes items[] explicitly.
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

    const { useItems, count, cards: resolved } = resolveCardStack(content);

    const subheading = renderSubheadingHtml(content, 'subheading', 'subtitle');

    const palette = themeCardStackPalette(theme);
    const lightText = String(theme?.textColorLight || '#ffffff');
    const darkText = String(theme?.textColorDark || '#212121');

    const cards = [];
    for (let i = 1; i <= count; i += 1) {
      const card = resolved[i - 1] || {};
      const title = card.title || '';
      const bodyRaw = card.body || '';
      const titlePath = useItems ? `items.${i - 1}.title` : `card${i}Title`;
      const bodyPath = useItems ? `items.${i - 1}.body` : `card${i}Body`;
      const itemAttrs = useItems
        ? ` data-inline-item="items" data-inline-item-index="${i - 1}"`
        : '';
      const bg = palette[(i - 1) % palette.length] || '#7c3aed';
      const fg = pickTextColorForBg(bg, { light: lightText, dark: darkText });
      cards.push(`
          <div class="card-stack-row" data-morph-role="card-${i - 1}" role="group" aria-label="${esc(
            title || `Card ${i}`
          )}"${itemAttrs}>
            <div class="card-stack-label" data-inline-field="${titlePath}" dir="auto" style="--cs-label-bg:${esc(bg)}; --cs-label-fg:${esc(fg)}">
              ${esc(title || `Card ${i}`)}
            </div>
            <div class="card-stack-body" data-inline-field="${bodyPath}">
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

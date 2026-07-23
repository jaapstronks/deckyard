import {
  esc,
  renderSubheadingHtml,
  renderBottomSubheadingHtml,
  hasBottomSubheading,
  cardLinkOverlayHtml,
} from '../helpers.js';
import { iconUrl } from '../../icon-names.js';
import { markdownToSafeHtml } from '../../markdown.js';

/** True when an items[] entry carries nothing worth rendering. */
function isBlankItem(item) {
  if (!item || typeof item !== 'object') return true;
  return !['icon', 'title', 'body'].some((k) => String(item[k] || '').trim());
}

/**
 * Length of items[] up to and including its last non-blank entry.
 *
 * The editor never leaves trailing blanks, but imported or API-authored decks
 * sometimes pad items[] out to a fixed length (six empty objects, or three
 * cards followed by three `{}`). Counting those rendered blank cards on the
 * slide. Trailing blanks are trimmed rather than all blanks filtered out, so
 * the surviving indices still match the `items.N.field` inline-edit paths.
 */
function filledItemCount(items) {
  let last = -1;
  for (let i = 0; i < items.length; i += 1) {
    if (!isBlankItem(items[i])) last = i;
  }
  return last + 1;
}

/** Max cards a grid holds (both layouts). Mirrors the schema's maxItems. */
const MAX_CARDS = 6;

/**
 * Materialize `items[]` from the legacy numbered card fields so the inline
 * editor's card affordances (add / remove / reorder) have a stable, mutable
 * array to write to. Mirrors `ensureMembers` (team-cards) / `ensureLogos`
 * (logo-wall): the read side (`resolveCards`) folds the two sources into one
 * view; this mutating helper commits that view to `items[]`. Idempotent, and
 * never called from `renderHtml` (which stays pure) — the inline editor runs it
 * via the descriptor's `ensure` knob. The legacy numbered fields are read, not
 * deleted, so they survive as a mirror (renderHtml already prefers items[]).
 * @param {Object} content
 * @returns {Object} the same content object
 */
export function ensureIconCards(content) {
  if (!content || typeof content !== 'object') return content;
  if (Array.isArray(content.items) && content.items.length > 0) {
    if (content.items.length > MAX_CARDS) content.items.length = MAX_CARDS;
    return content;
  }
  // Fold the legacy numbered fields (bounded by cardCount) into items[], then
  // trim trailing blanks so we don't seed invisible empty slots. When there is
  // genuinely nothing, leave an empty array — the "+ Add card" affordance
  // provides the first card.
  const count = Math.max(1, Math.min(MAX_CARDS, Number(content.cardCount || MAX_CARDS) || MAX_CARDS));
  const resolved = resolveCards(content, count);
  content.items = resolved.slice(0, filledItemCount(resolved));
  return content;
}

/**
 * Resolve cards from content — supports both legacy numbered fields
 * (card1Icon, card1Title, card1Body) and the new items[] array.
 * items[] takes precedence when present.
 */
function resolveCards(content, count) {
  const cards = [];

  // New format: items[] array
  if (Array.isArray(content?.items) && content.items.length > 0) {
    for (let i = 0; i < count; i++) {
      const item = content.items[i] || {};
      cards.push({
        icon: String(item.icon || '').trim(),
        title: String(item.title || '').trim(),
        body: String(item.body || '').trim(),
        link: String(item.link || '').trim(),
      });
    }
    return cards;
  }

  // Legacy format: card1Icon, card1Title, card1Body
  for (let i = 1; i <= count; i++) {
    cards.push({
      icon: String(content?.[`card${i}Icon`] || '').trim(),
      title: String(content?.[`card${i}Title`] || '').trim(),
      body: String(content?.[`card${i}Body`] || '').trim(),
      link: String(content?.[`card${i}Link`] || '').trim(),
    });
  }
  return cards;
}

export default {
  label: 'Icon cards',
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
      key: 'layout',
      label: 'Layout',
      type: 'enum',
      required: false,
      options: [
        { value: 'cards', label: 'Cards' },
        { value: 'tiles', label: 'Tiles' },
      ],
    },
    {
      key: 'bottomSubheading',
      label: 'Bottom subheading',
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

    // New items[] format (preferred for AI generation)
    {
      key: 'items',
      label: 'Cards',
      type: 'items',
      required: false,
      minItems: 1,
      maxItems: 6,
      itemDefaults: { icon: 'lightbulb', title: 'Title', body: 'Description.', link: '' },
      itemFields: [
        { key: 'icon', label: 'Icon', type: 'string', required: false, maxLength: 40 },
        { key: 'title', label: 'Title', type: 'string', required: false, maxLength: 80 },
        { key: 'body', label: 'Body', type: 'markdown', required: false, maxLength: 700 },
        // Optional: makes the whole card clickable. `#N` jumps to slide N in the
        // deck (presenter only); an http(s)/mailto URL opens in a new tab.
        { key: 'link', label: 'Link URL', type: 'string', required: false, maxLength: 500 },
      ],
    },

    // LEGACY: numbered card fields (card1Icon, card1Title, card1Body, etc.)
    // Kept for backward compatibility with existing slides and editor form.
    // The editor still reads/writes these; renderHtml reads items[] first.
    ...Array.from({ length: 6 }, (_, idx) => {
      const i = idx + 1;
      return [
        {
          key: `card${i}Icon`,
          label: `Card ${i} icon`,
          type: 'string',
          required: false,
          maxLength: 40,
          deprecated: true,
        },
        {
          key: `card${i}Title`,
          label: `Card ${i} title`,
          type: 'string',
          required: false,
          maxLength: 80,
          deprecated: true,
        },
        {
          key: `card${i}Body`,
          label: `Card ${i} body`,
          type: 'markdown',
          required: false,
          maxLength: 700,
          deprecated: true,
        },
        {
          key: `card${i}Link`,
          label: `Card ${i} link`,
          type: 'string',
          required: false,
          maxLength: 500,
          deprecated: true,
        },
      ];
    }).flat(),
  ],
  defaultsByLang: {
    nl: {
      title: 'Nieuwe titel',
      subheading: 'Optionele ondertitel',
      layout: 'cards',
      cardCount: '6',
      card1Icon: 'lightbulb',
      card1Title: 'Inzicht',
      card1Body: 'Korte uitleg.',
      card2Icon: 'target',
      card2Title: 'Focus',
      card2Body: 'Korte uitleg.',
      card3Icon: 'users',
      card3Title: 'Samen',
      card3Body: 'Korte uitleg.',
      card4Icon: 'settings',
      card4Title: 'Proces',
      card4Body: 'Korte uitleg.',
      card5Icon: 'trending-up',
      card5Title: 'Groei',
      card5Body: 'Korte uitleg.',
      card6Icon: 'shield-check',
      card6Title: 'Kwaliteit',
      card6Body: 'Korte uitleg.',
    },
    'en-GB': {
      title: 'New title',
      subheading: 'Optional subtitle',
      layout: 'cards',
      cardCount: '6',
      card1Icon: 'lightbulb',
      card1Title: 'Insight',
      card1Body: 'Short explanation.',
      card2Icon: 'target',
      card2Title: 'Focus',
      card2Body: 'Short explanation.',
      card3Icon: 'users',
      card3Title: 'Together',
      card3Body: 'Short explanation.',
      card4Icon: 'settings',
      card4Title: 'Process',
      card4Body: 'Short explanation.',
      card5Icon: 'trending-up',
      card5Title: 'Growth',
      card5Body: 'Short explanation.',
      card6Icon: 'shield-check',
      card6Title: 'Quality',
      card6Body: 'Short explanation.',
    },
  },
  // Back-compat fallback
  defaults: {
    title: 'New title',
    subheading: 'Optional subtitle',
    layout: 'cards',
    cardCount: '6',
    card1Icon: 'lightbulb',
    card1Title: 'Insight',
    card1Body: 'Short explanation.',
    card2Icon: 'target',
    card2Title: 'Focus',
    card2Body: 'Short explanation.',
    card3Icon: 'users',
    card3Title: 'Together',
    card3Body: 'Short explanation.',
    card4Icon: 'gear',
    card4Title: 'Process',
    card4Body: 'Short explanation.',
    card5Icon: 'trend-up',
    card5Title: 'Growth',
    card5Body: 'Short explanation.',
    card6Icon: 'shield-check',
    card6Title: 'Quality',
    card6Body: 'Short explanation.',
  },
  renderHtml: (content, _slide, ctx) => {
    const mode = ctx?.mode;
    const layout = content?.layout === 'tiles' ? 'tiles' : 'cards';
    const hasBottom = hasBottomSubheading(content);
    // Both layouts support up to 6: cards is 3 rows of 2; tiles is a single row
    // for 1-4 and wraps to two rows of three for 5-6 (see the tiles CSS).
    const maxCards = 6;
    // items[] is the source of truth when present: cardCount is a stale
    // legacy mirror there (inline add/remove only mutates the array), so
    // counting it would keep rendering an empty slot after a card removal.
    const useItems = Array.isArray(content?.items) && content.items.length > 0;
    let count = useItems
      ? Math.max(1, Math.min(maxCards, filledItemCount(content.items)))
      : Math.max(1, Math.min(maxCards, Number(content?.cardCount || maxCards) || maxCards));
    // A bottom subheading eats a row of vertical space in the cards layout, so
    // cap at 4 (2 rows) to keep everything on the slide.
    if (hasBottom && layout === 'cards') count = Math.min(count, 4);

    const subheading = renderSubheadingHtml(content, 'subheading', 'subtitle');
    const bottomSubheadingHtml = renderBottomSubheadingHtml(content);

    const resolved = resolveCards(content, count);
    // Inline-edit paths must point at the data source resolveCards() used
    // (useItems above).
    const cards = [];
    for (let i = 1; i <= maxCards; i += 1) {
      const isEmpty = i > count;
      const card = resolved[i - 1] || {};
      const titlePath = useItems ? `items.${i - 1}.title` : `card${i}Title`;
      const bodyPath = useItems ? `items.${i - 1}.body` : `card${i}Body`;
      const iconPath = useItems ? `items.${i - 1}.icon` : `card${i}Icon`;
      const itemAttrs = !isEmpty && useItems
        ? ` data-inline-item="items" data-inline-item-index="${i - 1}"`
        : '';
      const iconName = card.icon || '';
      const iconSrc = iconUrl(iconName);
      const title = card.title || '';
      const bodyRaw = card.body || '';

      // Render as a CSS mask tinted by the container `color` rather than an
      // <img>: an <img>-loaded SVG is an isolated document and never inherits
      // the host `color`, so its `currentColor` fell back to the OS default
      // text color (black in light mode, white in dark) — making the themed
      // --t-icon-card-grid-icon-fg dead code. iconSrc is always a vetted
      // /client/vendor/lucide-icons/<name>.svg (name matches /^[a-z0-9-]+$/),
      // so it is URL/CSS-safe inside url() with no escaping surprises.
      const iconHtml = iconSrc
        ? `<span class="icon-card-icon-img" aria-hidden="true" style="--icg-icon-url:url(${esc(iconSrc)})"></span>`
        : `<div class="icon-card-icon-fallback" aria-hidden="true"></div>`;

      // Optional click behavior: a full-card overlay anchor (shared helper).
      // Only emitted in non-editor render modes, so it never intercepts inline
      // editing (which runs in mode 'thumb'/'edit').
      const linkHtml = isEmpty ? '' : cardLinkOverlayHtml(card.link, mode, title || 'Card link');

      cards.push(`
          <div class="icon-card${isEmpty ? ' is-empty' : ''}${linkHtml ? ' has-link' : ''}" data-morph-role="icon-card-${i - 1}" role="group" ${
        isEmpty ? 'aria-hidden="true"' : ''
      }${itemAttrs}>
            <div class="icon-card-icon"${isEmpty ? '' : ` data-inline-icon="${iconPath}"`}>
              ${iconHtml}
            </div>
            <div class="icon-card-body">
              <h3 class="icon-card-title"${isEmpty ? '' : ` data-inline-field="${titlePath}"`} dir="auto">${esc(title || 'Title')}</h3>
              <div class="icon-card-text"${isEmpty ? '' : ` data-inline-field="${bodyPath}"`}>
                ${markdownToSafeHtml(bodyRaw)}
              </div>
            </div>
            ${linkHtml}
          </div>
        `);
    }

    return `
        <div class="slide slide-icon-card-grid${hasBottom ? ' has-bottom-subheading' : ''}" data-layout="${layout}">
          <div class="slide-inner">
            <div class="header">
              <h2 class="title" data-morph-role="title" data-inline-field="title" dir="auto">${esc(content?.title)}</h2>
              ${subheading}
            </div>
            <div class="icon-card-grid" data-layout="${layout}" data-card-count="${count}">
              ${cards.join('')}
            </div>
            ${bottomSubheadingHtml}
          </div>
        </div>
      `;
  },
};

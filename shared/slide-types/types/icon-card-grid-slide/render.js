/**
 * icon-card-grid-slide — renderHtml.
 *
 * Isomorphic: the presenter, the editor preview and the export all run this,
 * so it stays pure (no DOM, no fs, no mutation of `content`). It may import
 * `./cards.js` and the shared render helpers, and nothing else from this
 * directory — see docs/reference/slide-type-directory.md.
 */

import {
  escapeHtml,
  renderSubheadingHtml,
  renderBottomSubheadingHtml,
  hasBottomSubheading,
  cardLinkOverlayHtml,
} from '../../helpers.js';
import { iconUrl } from '../../../icon-names.js';
import { markdownToSafeHtml } from '../../../markdown.js';
import { MAX_CARDS, filledItemCount, resolveCards } from './cards.js';

/**
 * @param {Object} content
 * @param {Object} _slide
 * @param {Object} [ctx]
 * @returns {string}
 */
export default function renderHtml(content, _slide, ctx) {
  const mode = ctx?.mode;
  const layout = content?.layout === 'tiles' ? 'tiles' : 'cards';
  const hasBottom = hasBottomSubheading(content);
  // Both layouts support up to 6: cards is 3 rows of 2; tiles is a single row
  // for 1-4 and wraps to two rows of three for 5-6 (see the tiles CSS).
  const maxCards = MAX_CARDS;
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
    // --slide-on-accent-soft dead code. iconSrc is always a vetted
    // /client/vendor/lucide-icons/<name>.svg (name matches /^[a-z0-9-]+$/),
    // so it is URL/CSS-safe inside url() with no escaping surprises.
    const iconHtml = iconSrc
      ? `<span class="icon-card-icon-img" aria-hidden="true" style="--icg-icon-url:url(${escapeHtml(iconSrc)})"></span>`
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
              <h3 class="icon-card-title"${isEmpty ? '' : ` data-inline-field="${titlePath}"`} dir="auto">${escapeHtml(title || 'Title')}</h3>
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
              <h2 class="title" data-morph-role="title" data-inline-field="title" dir="auto">${escapeHtml(content?.title)}</h2>
              ${subheading}
            </div>
            <div class="icon-card-grid" data-layout="${layout}" data-card-count="${count}">
              ${cards.join('')}
            </div>
            ${bottomSubheadingHtml}
          </div>
        </div>
      `;
}

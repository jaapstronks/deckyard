/**
 * Preset variants folded into their base tile (D341).
 *
 * A type with curated presets (SLIDE_TYPE_PRESETS in ./data.js) shows one tile
 * in its shelf; a corner button "N variants" unfolds a row of variant tiles
 * inside the same shelf grid, under the tile's visual row, while the rest of
 * the shelf stays where it is. The row is built up front, hidden, so search
 * still reaches a variant directly and the keyboard nav finds its cards in DOM
 * order without a second code path.
 *
 * Pure DOM helpers: which row is open is render state and lives in ./index.js.
 */

import { h } from '../../../lib/dom/index.js';
import { icon } from '../../../lib/dom/icons.js';
import { t } from '../../../lib/ui-i18n.js';

export const VARIANT_ROW_SELECTOR = '.ps-type-variants';

/**
 * The corner button on a base tile that opens its variant row.
 * @param {{ type: string, count: number, onToggle: () => void }} opts
 * @returns {HTMLButtonElement}
 */
export function buildVariantsToggle({ type, count, onToggle }) {
  const label = t(
    'editor.slideTypePicker.variants',
    { one: '1 variant', many: '{count} variants' },
    { count },
  );
  const btn = h(
    'button',
    {
      class: 'ps-type-variants-btn',
      type: 'button',
      'aria-expanded': 'false',
      'data-variants-for': type,
      onclick: (e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      },
    },
    [h('span', { text: label })],
  );
  btn.append(icon('chevron-down', { size: 12 }));
  return btn;
}

/**
 * The hidden row of variant tiles for one base tile. It spans the shelf grid
 * and holds a grid of its own, so the tiles keep their usual box.
 * @param {{ type: string, typeLabel: string, tiles: HTMLElement[], baseWrap: HTMLElement }} opts
 * @returns {HTMLElement}
 */
export function buildVariantRow({ type, typeLabel, tiles, baseWrap }) {
  const row = h('div', {
    class: 'ps-type-variants',
    'data-variants-for': type,
    role: 'group',
    'aria-label': typeLabel,
    hidden: true,
  });
  row.__baseWrap = baseWrap;
  row.append(
    h('p', {
      class: 'ps-type-variants-hint',
      text: t(
        'editor.slideTypePicker.variantsHint',
        '{type}: pick a variant, or click the tile itself for the default',
        { type: typeLabel },
      ),
    }),
    h('div', { class: 'ps-type-grid ps-type-grid-thumbs' }, tiles),
  );
  return row;
}

/**
 * Move a variant row to just after the last tile on its base tile's visual
 * row, so it opens under that row and the tiles after it keep their places.
 * The row is measured out of the flow: a shown full-width row would itself
 * break the line it is looking for. Without layout (base hidden by a search,
 * or no layout engine) the row stays right after its base tile. Focus inside
 * the row survives the move.
 * @param {HTMLElement} row
 */
export function placeVariantRow(row) {
  const base = row.__baseWrap;
  if (!base) return;
  const wasHidden = row.hidden;
  // Hiding and moving the row blurs a variant tile reached with the arrow
  // keys; remember it and hand the focus back once the row is in place.
  const active = row.ownerDocument.activeElement;
  const refocus = active && row.contains(active) ? active : null;
  row.hidden = true;
  let anchor = base;
  if (base.offsetParent !== null) {
    const top = base.offsetTop;
    for (let el = base.nextElementSibling; el; el = el.nextElementSibling) {
      if (el.hidden) continue;
      if (!el.classList.contains('ps-type-card-wrap')) break;
      if (el.offsetTop !== top) break;
      anchor = el;
    }
  }
  if (anchor.nextElementSibling !== row) anchor.after(row);
  row.hidden = wasHidden;
  if (refocus && !wasHidden) refocus.focus({ preventScroll: true });
}

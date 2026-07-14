/**
 * Keyboard-first navigation for the insert-slide type grid (item 17).
 *
 * The picker autofocuses its search box, so the natural flow is type-to-filter
 * then arrow-to-pick: ArrowDown from the search enters the grid, arrow keys move
 * between the visible slide-type cards, Enter/Space inserts (native <button>),
 * and ArrowUp from the top row returns to the search box.
 *
 * Matches the image-library grid convention (arrow-key focus movement among the
 * primary card buttons, native button semantics) rather than a roving-tabindex
 * listbox: each tile also carries secondary buttons (peek, pin), so listbox/
 * option roles would misrepresent the structure and a listbox's roving tabindex
 * would pull those out of the tab order. Up/Down use geometry (nearest card in
 * the adjacent row) so navigation stays correct across the responsive auto-fill
 * grid, partial last rows, and multiple category sections.
 */

/**
 * Wire arrow-key navigation across a multi-section card grid.
 * @param {object} opts
 * @param {HTMLElement} opts.container - Scrollable wrapper holding every card.
 * @param {HTMLElement} [opts.searchInput] - Search box that feeds the grid.
 * @param {string} [opts.cardSelector] - Selector for the primary card buttons.
 * @returns {() => void} Teardown that removes the listeners.
 */
export function wireGridKeyboardNav({
  container,
  searchInput = null,
  cardSelector = '.ps-type-card',
} = {}) {
  if (!container) return () => {};

  // Cards that are actually on screen: offsetParent is null for a card inside a
  // collapsed section (grid `display:none`) or a search-hidden tile/section.
  const visibleCards = () =>
    Array.from(container.querySelectorAll(cardSelector)).filter(
      (el) => el.offsetParent !== null
    );

  // Nearest visible card in the row above/below the current one, chosen by
  // smallest vertical gap then smallest horizontal-centre offset.
  const nearestInDirection = (cards, current, dir) => {
    const cur = current.getBoundingClientRect();
    const curCx = cur.left + cur.width / 2;
    let best = null;
    let bestScore = Infinity;
    for (const c of cards) {
      if (c === current) continue;
      const r = c.getBoundingClientRect();
      const dy = r.top - cur.top;
      // 4px tolerance so same-row cards (sub-pixel top diffs) aren't "below".
      if (dir === 'down' && dy <= 4) continue;
      if (dir === 'up' && dy >= -4) continue;
      const cx = r.left + r.width / 2;
      // Row distance dominates; column offset breaks ties within a row.
      const score = Math.abs(dy) * 1000 + Math.abs(cx - curCx);
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }
    return best;
  };

  const onGridKeydown = (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const current = e.target?.closest?.(cardSelector);
    if (!current || !container.contains(current)) return;
    const cards = visibleCards();
    const idx = cards.indexOf(current);
    if (idx === -1) return;

    let target = null;
    switch (e.key) {
      case 'ArrowRight':
        target = cards[idx + 1] || null;
        break;
      case 'ArrowLeft':
        target = cards[idx - 1] || null;
        break;
      case 'ArrowDown':
        target = nearestInDirection(cards, current, 'down');
        break;
      case 'ArrowUp':
        target = nearestInDirection(cards, current, 'up');
        if (!target && searchInput) {
          // Top row: hand focus back to the search box.
          e.preventDefault();
          searchInput.focus();
          return;
        }
        break;
      case 'Home':
        target = cards[0] || null;
        break;
      case 'End':
        target = cards[cards.length - 1] || null;
        break;
      default:
        return;
    }
    if (target && target !== current) {
      e.preventDefault();
      target.focus();
    }
  };

  const onSearchKeydown = (e) => {
    if (e.key !== 'ArrowDown') return;
    const cards = visibleCards();
    if (!cards.length) return;
    e.preventDefault();
    cards[0].focus();
  };

  container.addEventListener('keydown', onGridKeydown);
  searchInput?.addEventListener('keydown', onSearchKeydown);

  return () => {
    container.removeEventListener('keydown', onGridKeydown);
    searchInput?.removeEventListener('keydown', onSearchKeydown);
  };
}

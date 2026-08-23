/**
 * Card resolution for icon-card-grid-slide — the type's own data layer.
 *
 * This is an *internal* module of the type directory, not one of the named
 * companion slots: `render.js` and `inline-edit.js` both need the same answer to
 * "what cards does this content actually hold", and neither is the natural owner
 * of the other. Isomorphic (no DOM, no fs), so both sides may import it.
 *
 * `items[]` is the type's one data model. Until the v7 -> v8 schema fold it also
 * carried a flat `card1Icon` / `card1Title` / `card1Body` / `card1Link` mirror
 * that stored decks and the side form wrote in parallel; stored decks are folded
 * once at read time (`shared/slide-types/schema-version.js`), so nothing here
 * has a second shape to reconcile any more.
 */

/** Max cards a grid holds (both layouts). Mirrors the `items` field's maxItems. */
export const MAX_CARDS = 6;

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
 *
 * @param {Array<Object>} items
 * @returns {number}
 */
export function filledItemCount(items) {
  let last = -1;
  for (let i = 0; i < items.length; i += 1) {
    if (!isBlankItem(items[i])) last = i;
  }
  return last + 1;
}

/**
 * Resolve the first `count` cards from `items[]`, padded with blanks so the
 * renderer always has an entry per grid cell it draws.
 *
 * @param {Object} content
 * @param {number} count
 * @returns {Array<{icon: string, title: string, body: string, link: string}>}
 */
export function resolveCards(content, count) {
  const items = Array.isArray(content?.items) ? content.items : [];
  const cards = [];
  for (let i = 0; i < count; i++) {
    const item = items[i] || {};
    cards.push({
      icon: String(item.icon || '').trim(),
      title: String(item.title || '').trim(),
      body: String(item.body || '').trim(),
      link: String(item.link || '').trim(),
    });
  }
  return cards;
}

/**
 * Materialize `items[]` so the inline editor's card affordances (add / remove /
 * reorder) have a stable, mutable array to write to. Mirrors `ensureMembers`
 * (team-cards) / `ensureLogos` (logo-wall). Idempotent, and never called from
 * `renderHtml` (which stays pure) — the inline editor runs it via the
 * descriptor's `ensure` knob.
 * @param {Object} content
 * @returns {Object} the same content object
 */
export function ensureIconCards(content) {
  if (!content || typeof content !== 'object') return content;
  if (!Array.isArray(content.items)) {
    // Nothing stored: leave an empty array — the "+ Add card" affordance
    // provides the first card.
    content.items = [];
    return content;
  }
  if (content.items.length > MAX_CARDS) content.items.length = MAX_CARDS;
  return content;
}

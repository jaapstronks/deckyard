/**
 * Card resolution for icon-card-grid-slide — the type's own data layer.
 *
 * This is an *internal* module of the type directory, not one of the named
 * companion slots: `render.js` and `inline-edit.js` both need the same answer to
 * "what cards does this content actually hold", and neither is the natural owner
 * of the other. Isomorphic (no DOM, no fs), so both sides may import it.
 *
 * The type carries two data models at once. `items[]` is canonical; the numbered
 * `card1Icon` / `card1Title` / `card1Body` / `card1Link` fields are the legacy
 * mirror that stored decks and the side form still write. Everything here folds
 * the two into one view or keeps them in step.
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
 * Resolve cards from content — supports both legacy numbered fields
 * (card1Icon, card1Title, card1Body) and the new items[] array.
 * items[] takes precedence when present.
 *
 * @param {Object} content
 * @param {number} count
 * @returns {Array<{icon: string, title: string, body: string, link: string}>}
 */
export function resolveCards(content, count) {
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
  const count = Math.max(
    1,
    Math.min(MAX_CARDS, Number(content.cardCount || MAX_CARDS) || MAX_CARDS),
  );
  const resolved = resolveCards(content, count);
  content.items = resolved.slice(0, filledItemCount(resolved));
  return content;
}

/**
 * Write `items[]` back to the numbered legacy fields (and `cardCount`).
 *
 * The inverse of ensureIconCards: every surface that mutates `items[]` — the
 * side form, the phase-3 inspector, the inline icon picker — calls this so the
 * mirror never goes stale under a consumer that still reads the numbered
 * fields. It lives here rather than in the editor form it used to sit in
 * because it is a fact about the type's data model, not about any one editing
 * surface; keeping it in `client/` was what forced the type's inline-edit
 * descriptor to import from the editor.
 *
 * @param {{content: Object}} slide
 */
export function syncIconCardsToNumbered(slide) {
  const items = slide.content.items || [];
  slide.content.cardCount = String(items.length);
  for (let i = 0; i < MAX_CARDS; i++) {
    const item = items[i] || {};
    slide.content[`card${i + 1}Icon`] = item.icon || '';
    slide.content[`card${i + 1}Title`] = item.title || '';
    slide.content[`card${i + 1}Body`] = item.body || '';
    slide.content[`card${i + 1}Link`] = item.link || '';
  }
}

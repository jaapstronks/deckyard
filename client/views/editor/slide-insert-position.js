/**
 * Where a newly inserted slide lands in the deck.
 *
 * The editor has one insertion rule — "behind `afterSlideId`" — and one place
 * where two slides are inserted in a single gesture: the follow-invite
 * suggestion. Both live here so the second one cannot quietly disagree with
 * the first.
 */

/**
 * Splice `slide` into `slides` behind `afterSlideId`.
 *
 * A null anchor means the front of the deck; an anchor that is no longer in
 * the deck means the end.
 *
 * @param {Array<Object>} slides - the deck's slides, mutated in place
 * @param {Object} slide - the slide to insert
 * @param {string|null|undefined} afterSlideId - the slide to insert behind
 * @returns {Array<Object>} the same array
 */
export function insertSlideAfter(slides, slide, afterSlideId) {
  slides.splice(resolveInsertIndex(slides, afterSlideId), 0, slide);
  return slides;
}

function resolveInsertIndex(slides, afterSlideId) {
  if (afterSlideId == null) return 0;
  const afterIdx = slides.findIndex((x) => x.id === afterSlideId);
  return afterIdx >= 0 ? afterIdx + 1 : slides.length;
}

/**
 * The anchor for the pending interactive slide once the follow-invite has
 * claimed slot two.
 *
 * "Add as second slide" promises the invite position two. When the interactive
 * slide was headed for that same slot — its anchor is the first slide — both
 * inserts resolve to the same index and the later one wins, which used to put
 * the invite third. Anchoring the interactive slide to the invite instead
 * keeps the promise.
 *
 * A nested slide keeps its own anchor: its place is inside its parent's group,
 * which the invite is not part of.
 *
 * @param {Object} options
 * @param {string|null|undefined} options.afterSlideId - where the interactive
 *   slide was headed
 * @param {string|null|undefined} options.firstSlideId - the deck's first slide
 * @param {string} options.inviteSlideId - the invite that just took slot two
 * @param {string|null} [options.parentId] - parent of the interactive slide,
 *   when it is being nested
 * @returns {string|null|undefined} the anchor to insert the interactive slide behind
 */
export function anchorBehindInvite({
  afterSlideId,
  firstSlideId,
  inviteSlideId,
  parentId = null,
}) {
  if (parentId) return afterSlideId;
  if (afterSlideId == null || afterSlideId !== firstSlideId)
    return afterSlideId;
  return inviteSlideId;
}

/**
 * The three placements the follow-invite suggestion offers, as one rule set.
 *
 * Adding an interactive slide to a deck without a follow-invite opens a modal
 * with three answers, and the editor has two insertion paths (the type picker
 * and the slide library) that each have to honour all three. Wiring them
 * twice is how "add before this slide" came to look up the invite by type —
 * finding the deck's *first* invite instead of the one the gesture just
 * inserted. The placements live here so both paths get the same three.
 *
 * `insertInvite` inserts the follow-invite behind the anchor it is given and
 * returns its id; `insertPending` inserts the waiting interactive slide behind
 * the anchor it is given.
 *
 * @param {Object} options
 * @param {string|null|undefined} options.afterSlideId - where the interactive
 *   slide was headed before the suggestion interrupted it
 * @param {string|null} [options.parentId] - parent of the interactive slide,
 *   when it is being nested
 * @param {() => (string|null|undefined)} options.getFirstSlideId - the deck's
 *   first slide, read at answer time
 * @param {(afterSlideId: string|null|undefined) => string} options.insertInvite
 * @param {(afterSlideId: string|null|undefined) => void} options.insertPending
 * @returns {{onAddAsSecond: () => void, onAddBeforeCurrent: () => void, onSkip: () => void}}
 */
export function followInvitePlacements({
  afterSlideId,
  parentId = null,
  getFirstSlideId,
  insertInvite,
  insertPending,
}) {
  return {
    onAddAsSecond() {
      const firstSlideId = getFirstSlideId();
      const inviteSlideId = insertInvite(firstSlideId);
      insertPending(
        anchorBehindInvite({
          afterSlideId,
          firstSlideId,
          inviteSlideId,
          parentId,
        }),
      );
    },
    onAddBeforeCurrent() {
      // Behind the invite this gesture just inserted — not behind whichever
      // invite happens to come first in the deck.
      insertPending(insertInvite(afterSlideId));
    },
    onSkip() {
      insertPending(afterSlideId);
    },
  };
}

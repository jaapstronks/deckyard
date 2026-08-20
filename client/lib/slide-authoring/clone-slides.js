/**
 * Copying slides into a deck — the one routine behind duplicate and paste.
 *
 * The editor copies slides from five places: the slide list's duplicate
 * (keyboard + context menu), the form header's ⋯ menu, the paste bar, Ctrl+V,
 * and the slide-library insert. Before this module each of them wrote its own
 * version of the same three steps — fresh ids, re-point nested children at
 * their cloned parent, re-mint the content keys that belong to one slide
 * instance — and the two paste paths were a literal 45-line copy of each other
 * down to the `splice`. They had drifted at the edges: the ⋯ menu re-minted the
 * poll id but not the follow-invite's presentation id, and only the keyboard
 * path cleared the multi-selection afterwards.
 *
 * The per-type half of the recipe is not here: which content keys are
 * instance-bound is declared by the type as `rekeyOnClone` and applied through
 * shared/slide-types/clone.js, so a fork type that carries an id of its own is
 * handled by every path without touching this file.
 *
 * Nothing in here reads the DOM; the callers own selection, refresh and toast.
 */

import { newId } from '../util/id.js';
import { applyCloneRekey } from '../../../shared/slide-types/clone.js';
import { getClipboardSlides } from './slide-clipboard.js';

/**
 * Deep-copy a value. `structuredClone` where the browser has it, JSON
 * round-trip otherwise — slide content is JSON by definition.
 * @param {*} value
 * @returns {*}
 */
function deepClone(value) {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value ?? null));
}

/**
 * Clone slides for insertion into a deck: fresh ids, nesting preserved within
 * the cloned set, and the declaring type's instance-bound content keys
 * re-derived.
 *
 * Nesting: a clone whose parent is *also* being cloned is re-pointed at the
 * parent's clone. A clone whose parent is not in the set keeps its original
 * parent (duplicate: the copy lands next to its sibling under the same parent)
 * unless `detachOrphans` is set (paste: the parent lives in whichever deck the
 * slide was copied from, so a child copied without it lands at the top level).
 *
 * The source slides are never mutated.
 *
 * @param {Array<Object>} sourceSlides - the slides to copy, in deck order
 * @param {Object} [opts]
 * @param {Object} [opts.slideTypes] - the editor's slide-type metadata map
 * @param {string} [opts.presentationId] - id of the deck the clones land in
 * @param {boolean} [opts.detachOrphans=false] - drop a parent link that points
 *   outside the cloned set instead of keeping it
 * @returns {Array<Object>} the clones, in the order given
 */
export function cloneSlidesForInsert(
  sourceSlides,
  { slideTypes = null, presentationId = '', detachOrphans = false } = {},
) {
  const sources = Array.isArray(sourceSlides) ? sourceSlides : [];
  if (!sources.length) return [];

  // A new id per clone first, so a child cloned alongside its parent can be
  // re-pointed at the parent's clone rather than the original.
  const idMap = new Map();
  for (const s of sources) {
    if (s?.id != null) idMap.set(s.id, newId());
  }

  return sources.map((s) => {
    const clone = deepClone(s);
    clone.id = idMap.get(s?.id) || newId();
    const mappedParent = s?.parentId ? idMap.get(s.parentId) : null;
    clone.parentId =
      mappedParent || (detachOrphans ? null : (s?.parentId ?? null));
    applyCloneRekey(clone, {
      def: slideTypes?.[clone?.type] || null,
      presentationId,
      newId,
    });
    return clone;
  });
}

/**
 * Paste the slide clipboard into a deck, after the selected slide.
 *
 * The whole paste: read the clipboard, clone, insert, select the first pasted
 * slide, mark dirty and refresh. Both entry points (the paste bar and Ctrl+V)
 * call this, so the two cannot drift again.
 *
 * Clipboard slides carry their source `id` and `parentId` (see
 * slide-clipboard.js), so a parent copied together with its children keeps them
 * nested here; a child copied without its parent lands at the top level.
 *
 * @param {Object} opts
 * @param {Object} opts.pres - the presentation, mutated
 * @param {Object} [opts.slideTypes] - the editor's slide-type metadata map
 * @param {Function} [opts.getSelectedSlideId] - insert after this slide
 * @param {Function} [opts.setSelectedSlideId] - select the first pasted slide
 * @param {Function} [opts.clearMultiSelection]
 * @param {Function} [opts.onMultiSelectionChange]
 * @param {Object} opts.editorState - editor state updater (dirtyRefreshAll)
 * @param {Object} [opts.toast] - toast API for the confirmation
 * @param {Function} opts.t - translator
 * @returns {number} how many slides were pasted (0 if the clipboard was empty)
 */
export function pasteSlidesFromClipboard({
  pres,
  slideTypes = null,
  getSelectedSlideId,
  setSelectedSlideId,
  clearMultiSelection,
  onMultiSelectionChange,
  editorState,
  toast,
  t,
}) {
  const clipboardSlides = getClipboardSlides();
  if (!clipboardSlides?.length) return 0;

  const slides = pres?.slides || [];
  const afterSlideId = getSelectedSlideId?.();
  let insertIdx = slides.length;
  if (afterSlideId) {
    const afterIdx = slides.findIndex((x) => x.id === afterSlideId);
    insertIdx = afterIdx >= 0 ? afterIdx + 1 : slides.length;
  }

  const newSlides = cloneSlidesForInsert(clipboardSlides, {
    slideTypes,
    presentationId: pres?.id || '',
    detachOrphans: true,
  }).map((clone) => ({
    // The clipboard shape is thin by design, so normalise the two fields a
    // slide row is read for before it lands in the deck.
    ...clone,
    content:
      clone.content && typeof clone.content === 'object' ? clone.content : {},
    notes: clone.notes || '',
  }));

  pres.slides.splice(insertIdx, 0, ...newSlides);

  clearMultiSelection?.();
  setSelectedSlideId?.(newSlides[0]?.id || null);
  editorState?.dirtyRefreshAll?.();
  onMultiSelectionChange?.();

  toast?.success?.(
    t('editor.slides.pasted', '{n} slide(s) pasted', { n: newSlides.length }),
  );
  return newSlides.length;
}

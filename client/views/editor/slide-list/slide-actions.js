/**
 * Shared slide-list operations (copy / duplicate / delete / lock / save to
 * library).
 *
 * These were previously inlined in the keyboard handlers and the slide
 * header's ⋯ menu; one module lets the keyboard shortcuts and the slide-list
 * menu (right-click and the thumbnail's ⋯, B703 PR 3) drive one
 * implementation, so "Duplicate" means the same everywhere: the slide with its
 * nested children (D118). The functions take a resolved set of slide ids plus
 * the editor callbacks they need — they own the mutation, selection update,
 * refresh and user feedback, but not the "which slides are selected"
 * resolution (the caller decides that).
 */

import { cloneSlidesForInsert } from '../../../lib/slide-authoring/clone-slides.js';
import { copySlides } from '../../../lib/slide-authoring/slide-clipboard.js';
import { confirmModal } from '../../../lib/dom/modal.js';
import { t } from '../../../lib/ui-i18n.js';
import { toast } from '../../../lib/dom/toast.js';
import { isLibrarySlideType } from '../../../../shared/slide-types/policy.js';
import { slidePrimaryLabel } from '../editor-utils.js';
import { openSaveToLibraryModal } from '../modals/save-to-library-modal.js';
import { getChildIds } from './nested-helpers.js';

/**
 * Expand a selection to include the children of any selected parent (one level;
 * the editor only nests one deep). Exported so the keyboard handlers share it.
 * @param {Set<string>} selectedIds
 * @param {Array} slides
 * @returns {Set<string>}
 */
export function expandSelectionWithChildren(selectedIds, slides) {
  const expanded = new Set(selectedIds);
  for (const id of selectedIds) {
    for (const childId of getChildIds(id, slides)) expanded.add(childId);
  }
  return expanded;
}

function toIdSet(ids) {
  return ids instanceof Set ? ids : new Set(ids || []);
}

/**
 * Duplicate the given slides in place, right after the (contiguous) selection.
 * Faithful deep copy with fresh ids and regenerated interaction ids (the clone
 * recipe lives in client/lib/slide-authoring/clone-slides.js).
 * @param {Object} [opts.slideTypes] - slide-type metadata, for the per-type
 *   `instanceKeys` declaration
 * @returns {number} how many slides were created (0 if nothing to do)
 */
export function duplicateSlides({
  ids,
  pres,
  slideTypes = null,
  editorState,
  setSelectedSlideId,
  clearMultiSelection,
  markDirty,
  onMultiSelectionChange,
} = {}) {
  const slides = pres?.slides || [];
  const selectedIds = toIdSet(ids);
  if (selectedIds.size === 0) return 0;

  const toClone = expandSelectionWithChildren(selectedIds, slides);
  const sourceSlides = slides.filter((s) => toClone.has(s.id));
  if (!sourceSlides.length) return 0;

  // Fresh ids, nesting kept within the duplicated set, and the instance-bound
  // content keys each type declares re-derived. A child whose parent is not
  // duplicated stays under the original parent, which is what makes this a
  // duplicate rather than a paste.
  const newSlides = cloneSlidesForInsert(sourceSlides, {
    slideTypes,
    presentationId: pres?.id || '',
  });

  // Insert immediately after the last slide of the (contiguous) selection.
  let lastIdx = -1;
  for (let i = 0; i < slides.length; i += 1) {
    if (toClone.has(slides[i].id)) lastIdx = i;
  }
  const insertIdx = lastIdx >= 0 ? lastIdx + 1 : slides.length;
  pres.slides.splice(insertIdx, 0, ...newSlides);

  clearMultiSelection?.();
  setSelectedSlideId?.(newSlides[0]?.id || null);
  markDirty?.();
  editorState?.refreshAll?.();
  onMultiSelectionChange?.();

  toast?.success?.(
    t(
      'editor.slides.duplicated',
      { one: '1 slide duplicated', many: '{count} slides duplicated' },
      {
        count: newSlides.length,
      },
    ),
  );
  return newSlides.length;
}

/**
 * Delete the given slides (and their children), after a confirm dialog. Selects
 * the nearest surviving neighbour of the first deleted slide.
 * @returns {Promise<boolean>} true if slides were deleted, false if cancelled
 */
export async function deleteSlides({
  ids,
  pres,
  editorState,
  setSelectedSlideId,
  clearMultiSelection,
  onMultiSelectionChange,
} = {}) {
  const slides = pres?.slides || [];
  const selectedIds = toIdSet(ids);
  if (selectedIds.size === 0) return false;

  const toDelete = expandSelectionWithChildren(selectedIds, slides);
  const childCount = toDelete.size - selectedIds.size;

  let confirmMsg;
  if (selectedIds.size === 1 && childCount === 0) {
    confirmMsg = t('editor.slide.deleteConfirm', 'Delete this slide?');
  } else if (childCount > 0) {
    confirmMsg = t(
      'editor.slides.bulkDeleteConfirmWithChildren',
      {
        one: 'Delete 1 selected slide and {c} nested slides?',
        many: 'Delete {count} selected slides and {c} nested slides?',
      },
      { count: selectedIds.size, c: childCount },
    );
  } else {
    confirmMsg = t(
      'editor.slides.bulkDeleteConfirm',
      {
        one: 'Delete 1 selected slide?',
        many: 'Delete {count} selected slides?',
      },
      { count: selectedIds.size },
    );
  }

  if (
    !(await confirmModal(document.body, {
      title: t('editor.slide.delete', 'Delete'),
      message: confirmMsg,
      confirmLabel: t('common.delete', 'Delete'),
      danger: true,
    }))
  ) {
    return false;
  }

  const firstIdx = slides.findIndex((s) => toDelete.has(s.id));
  pres.slides = slides.filter((s) => !toDelete.has(s.id));
  const nextIdx = Math.max(0, Math.min(firstIdx, pres.slides.length - 1));
  clearMultiSelection?.();
  setSelectedSlideId?.(pres.slides[nextIdx]?.id || null);
  editorState?.dirtyRefreshAll?.();
  onMultiSelectionChange?.();
  return true;
}

/**
 * Copy the given slides (with the children of a selected parent) to the
 * slide clipboard, the one buffer ⌘V, the paste bar and the slide-list menu
 * paste from, also into another deck (`slide-clipboard.js`).
 * @returns {number} how many slides were copied (0 if nothing was written)
 */
export function copySlidesToClipboard({
  ids,
  pres,
  onMultiSelectionChange,
} = {}) {
  const slides = pres?.slides || [];
  const selectedIds = toIdSet(ids);
  if (selectedIds.size === 0) return 0;
  const toCopy = expandSelectionWithChildren(selectedIds, slides);
  const slidesToCopy = slides.filter((s) => toCopy.has(s.id));
  if (!slidesToCopy.length || !copySlides(slidesToCopy)) return 0;
  toast?.success?.(
    t(
      'editor.slides.copiedToClipboard',
      { one: '1 slide copied', many: '{count} slides copied' },
      { count: slidesToCopy.length },
    ),
  );
  // The paste bar reads the clipboard on a selection change.
  onMultiSelectionChange?.();
  return slidesToCopy.length;
}

/**
 * Whether every given slide carries the author lock: the slide-list menu
 * offers "Unlock" then, "Lock" otherwise.
 * @returns {boolean}
 */
export function allAuthorLocked({ ids, pres } = {}) {
  const selectedIds = toIdSet(ids);
  const slides = (pres?.slides || []).filter((s) => selectedIds.has(s.id));
  return slides.length > 0 && slides.every((s) => !!s.lockedByAuthor);
}

/**
 * Set or clear the author lock on the given slides (author only; the caller
 * decides who may). One save, one refresh.
 * @param {Object} opts
 * @param {boolean} opts.locked - the lock state to set
 */
export function setAuthorLock({ ids, pres, locked, editorState } = {}) {
  const selectedIds = toIdSet(ids);
  if (selectedIds.size === 0) return;
  for (const slide of pres?.slides || []) {
    if (selectedIds.has(slide.id)) slide.lockedByAuthor = !!locked;
  }
  editorState?.dirtyRefreshAll?.();
}

/**
 * Whether a slide can be saved to the slide library. A type without content of
 * its own declares `library: false` (the Follow-along invite); the rule lives
 * on the type, not on its name (B401).
 * @returns {boolean}
 */
export function canSaveSlideToLibrary({ slide, SLIDE_TYPES, api } = {}) {
  return !!api && isLibrarySlideType(SLIDE_TYPES?.[slide?.type]);
}

/** Open the save-to-library dialog for one slide. */
export function saveSlideToLibrary({
  slide,
  pres,
  api,
  SLIDE_TYPES,
  openSlideLibraryModal,
} = {}) {
  if (!canSaveSlideToLibrary({ slide, SLIDE_TYPES, api })) return;
  openSaveToLibraryModal({
    root: document.body,
    slide,
    pres,
    api,
    suggestedName: slidePrimaryLabel(slide, SLIDE_TYPES) || '',
    openSlideLibraryModal,
  });
}

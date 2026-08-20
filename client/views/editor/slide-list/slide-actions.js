/**
 * Shared slide-list operations (duplicate / delete).
 *
 * These were previously inlined in the keyboard handlers; extracting them lets
 * the keyboard shortcuts and the right-click context menu drive one
 * implementation. The functions take a resolved set of slide ids plus the
 * editor callbacks they need — they own the mutation, selection update, refresh
 * and user feedback, but not the "which slides are selected" resolution (the
 * caller decides that).
 */

import { h } from '../../../lib/dom.js';
import { cloneSlidesForInsert } from '../../../lib/slide-authoring/clone-slides.js';
import { confirmModal } from '../../../lib/dom/modal.js';
import { t } from '../../../lib/ui-i18n.js';
import { toast } from '../../../lib/dom/toast.js';
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
 *   `rekeyOnClone` declaration
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
    t('editor.slides.duplicated', '{n} slide(s) duplicated', {
      n: newSlides.length,
    }),
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
      'Delete {n} selected slides and {c} nested slides?',
      { n: selectedIds.size, c: childCount },
    );
  } else {
    confirmMsg = t(
      'editor.slides.bulkDeleteConfirm',
      'Delete {n} selected slides?',
      {
        n: selectedIds.size,
      },
    );
  }

  if (
    !(await confirmModal(h, document.body, {
      title: t('editor.slide.delete', 'Delete slide'),
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

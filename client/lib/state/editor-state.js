/**
 * Creates an editor state updater utility that consolidates common
 * rerender patterns into a single, easy-to-use API.
 *
 * Common patterns replaced:
 * - markDirty?.(); rerenderSlideList?.(); rerenderEditor(); rerenderPreview?.();
 * - markDirty?.(); updateSelectedSlideListItem?.(); rerenderEditor(); rerenderPreview?.();
 *
 * @param {Object} options
 * @param {Function} [options.markDirty] - Mark presentation as having unsaved changes
 * @param {Function} [options.rerenderSlideList] - Re-render the slide list panel
 * @param {Function} [options.rerenderEditor] - Re-render the editor form
 * @param {Function} [options.rerenderPreview] - Re-render the preview pane
 * @param {Function} [options.updateSelectedSlideListItem] - Update just the selected slide item
 * @returns {Object} Editor state updater with methods for common patterns
 */
export function createEditorStateUpdater({
  markDirty,
  rerenderSlideList,
  rerenderEditor,
  rerenderPreview,
  updateSelectedSlideListItem,
} = {}) {
  /**
   * Update editor state with configurable options.
   * @param {Object} [opts]
   * @param {boolean} [opts.dirty=false] - Whether to mark as dirty
   * @param {boolean} [opts.slideList=false] - Whether to rerender slide list
   * @param {boolean} [opts.editor=false] - Whether to rerender editor
   * @param {boolean} [opts.preview=false] - Whether to rerender preview
   * @param {boolean} [opts.selectedItem=false] - Whether to update selected item only (skipped if slideList is true)
   */
  function update({
    dirty = false,
    slideList = false,
    editor = false,
    preview = false,
    selectedItem = false,
  } = {}) {
    if (dirty) markDirty?.();
    if (slideList) rerenderSlideList?.();
    if (selectedItem && !slideList) updateSelectedSlideListItem?.();
    if (editor) rerenderEditor?.();
    if (preview) rerenderPreview?.();
  }

  return {
    update,

    /**
     * Full refresh: slide list, editor, and preview (no dirty mark)
     * Use when: Selection changed, need to show different slide
     */
    refreshAll() {
      rerenderSlideList?.();
      rerenderEditor?.();
      rerenderPreview?.();
    },

    /**
     * Mark dirty and do full refresh
     * Use when: Slide added/removed/reordered, or content changed that affects list
     */
    dirtyRefreshAll() {
      markDirty?.();
      rerenderSlideList?.();
      rerenderEditor?.();
      rerenderPreview?.();
    },

    /**
     * Mark dirty and refresh editor + preview only
     * Use when: Slide content changed but doesn't affect list display
     */
    dirtyRefreshEditor() {
      markDirty?.();
      rerenderEditor?.();
      rerenderPreview?.();
    },

    /**
     * Mark dirty and update selected item + editor + preview
     * Use when: Content changed that affects thumbnail but not list structure
     */
    dirtyRefreshWithItem() {
      markDirty?.();
      updateSelectedSlideListItem?.();
      rerenderEditor?.();
      rerenderPreview?.();
    },

    /**
     * Just mark as dirty without rerendering
     * Use when: Only tracking change for save, UI already updated
     */
    dirty() {
      markDirty?.();
    },
  };
}
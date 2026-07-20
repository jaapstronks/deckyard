/**
 * Open every collapsed `<details>` ancestor of `el` so a subsequent
 * `focus()` / `scrollIntoView()` actually reaches it. Inspector fields now
 * live in default-collapsed per-type groups (e.g. "Card icons & links",
 * "Column images & blocks"); without this walk, focusing a hit inside a
 * closed group is a no-op on display:none content.
 * @param {Element|null} el
 */
export function openAncestorDetails(el) {
  let node = el?.parentElement;
  while (node) {
    if (node.tagName === 'DETAILS' && !node.open) node.open = true;
    node = node.parentElement;
  }
}

export function focusSearchHitInEditor({
  query,
  slideId,
  pres,
  editorMount,
  previewNotesTa,
  // Notes and form fields live in rail panes: these surface the right pane
  // before focusing (no-ops when not provided).
  onFocusNotes,
  onFocusField,
} = {}) {
  const q = String(query || '').trim();
  if (!q) return;
  const slide = (pres?.slides || []).find((s) => s?.id === slideId);
  if (!slide) return;

  const qLower = q.toLowerCase();
  const notes = String(slide?.notes || '');
  const notesIdx = notes.toLowerCase().indexOf(qLower);
  if (notesIdx >= 0) {
    try {
      onFocusNotes?.();
      previewNotesTa?.focus?.();
      previewNotesTa?.setSelectionRange?.(notesIdx, notesIdx + q.length);
      previewNotesTa?.scrollIntoView?.({ block: 'nearest' });
    } catch {
      // ignore
    }
    return;
  }

  // Generic fallback: find the first matching input/textarea in the edit pane.
  try {
    const fields = Array.from(
      editorMount.querySelectorAll('input.form-input, textarea.form-input')
    );
    for (const el of fields) {
      const val = String(el?.value || '');
      const idx = val.toLowerCase().indexOf(qLower);
      if (idx < 0) continue;
      onFocusField?.();
      openAncestorDetails(el);
      el.focus?.();
      try {
        el.setSelectionRange?.(idx, idx + q.length);
      } catch {
        // Some inputs don't support selectionRange.
      }
      el.scrollIntoView?.({ block: 'nearest' });
      return;
    }
  } catch {
    // ignore
  }
}

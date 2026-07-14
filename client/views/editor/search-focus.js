export function focusSearchHitInEditor({
  query,
  slideId,
  pres,
  editorMount,
  previewNotesTa,
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

export function attachEditorFindShortcut({ focusSearch } = {}) {
  // In-editor shortcut: Cmd/Ctrl+F focuses the slide search (without clobbering
  // the browser find while typing inside a text field).
  try {
    const onFindKey = (e) => {
      try {
        const key = String(e?.key || '').toLowerCase();
        const isFind = key === 'f' && (e?.metaKey || e?.ctrlKey);
        if (!isFind) return;
        const t = e?.target;
        const tag = String(t?.tagName || '').toUpperCase();
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (t?.isContentEditable) return;
        e.preventDefault();
        focusSearch?.();
      } catch {
        // ignore
      }
    };
    window.addEventListener('keydown', onFindKey);
    return () => window.removeEventListener('keydown', onFindKey);
  } catch {
    return () => {};
  }
}

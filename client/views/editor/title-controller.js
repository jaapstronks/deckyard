export function createEditorTitleController({
  pres,
  markDirty,
  requestSave,
  onTitleChanged,
} = {}) {
  const setTitle = (nextTitle) => {
    const next = String(nextTitle || '').trim();
    if (!next) return false;
    pres.title = next;
    if (
      pres?.i18n?.active &&
      pres?.i18n?.versions &&
      pres.i18n.versions[pres.i18n.active]
    ) {
      pres.i18n.versions[pres.i18n.active].title = next;
    }
    try {
      onTitleChanged?.(next);
    } catch {
      // ignore
    }
    markDirty?.();
    // Nudge an immediate save so the title is persisted quickly.
    requestSave?.();
    return true;
  };

  const maybePromptNewTitle = ({ newTitleKey, openTitleModal } = {}) => {
    try {
      const shouldPrompt =
        sessionStorage.getItem(newTitleKey) === '1' &&
        String(pres.title || '').trim() === 'Untitled presentation';
      if (shouldPrompt) openTitleModal?.({ mode: 'new' });
    } catch {
      // ignore
    }
  };

  return { setTitle, maybePromptNewTitle };
}

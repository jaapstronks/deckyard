function isTypingTarget(t) {
  const el = t && t.nodeType === 1 ? t : null;
  if (!el) return false;
  const tag = (el.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'button')
    return true;
  if (el.isContentEditable) return true;
  return false;
}

export function attachPresenterKeys({
  onNext,
  onPrev,
  onRevealAll,
  onCollapseAll,
  onHome,
  onEnd,
  onToggleFullscreen,
  onEscape,
  onToggleLaser,
  onToggleDraw,
  onClearDrawings,
  onTogglePersistentDraw,
  onToggleAutoAdvance,
  onToggleHelp,
} = {}) {
  const onKeyDown = (e) => {
    // Never hijack keys while the user is typing in an input/textarea (prevents "spacebar doesn't work" bugs).
    if (isTypingTarget(e.target)) return;
    if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') {
      e.preventDefault();
      onNext?.();
    }
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
      e.preventDefault();
      onPrev?.();
    }
    // Down: reveal all remaining builds on this slide at once (power-user);
    // falls back to advancing when nothing is left to reveal.
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      onRevealAll?.();
    }
    // Up: collapse this slide's build back to empty; falls back to stepping
    // back a slide (which lands fully revealed).
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      onCollapseAll?.();
    }
    if (e.key === 'Home') {
      e.preventDefault();
      onHome?.();
    }
    if (e.key === 'End') {
      e.preventDefault();
      onEnd?.();
    }
    if (e.key.toLowerCase() === 'f') {
      e.preventDefault();
      onToggleFullscreen?.();
    }
    if (e.key.toLowerCase() === 'l') {
      e.preventDefault();
      onToggleLaser?.();
    }
    if (e.key.toLowerCase() === 'd') {
      e.preventDefault();
      onToggleDraw?.();
    }
    if (e.key.toLowerCase() === 'c') {
      e.preventDefault();
      onClearDrawings?.();
    }
    if (e.key.toLowerCase() === 'p') {
      e.preventDefault();
      onTogglePersistentDraw?.();
    }
    if (e.key.toLowerCase() === 'a') {
      e.preventDefault();
      onToggleAutoAdvance?.();
    }
    // "?" (Shift+/) opens the shortcut help overlay.
    if (e.key === '?') {
      e.preventDefault();
      onToggleHelp?.();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      onEscape?.();
    }
  };

  document.addEventListener('keydown', onKeyDown);
  return () => {
    document.removeEventListener('keydown', onKeyDown);
  };
}

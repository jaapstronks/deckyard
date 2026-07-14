import { t } from '../../../lib/ui-i18n.js';

export function createSlideNotesModal({
  h,
  root,
  pres,
  lockDocumentScroll,
  openOverlayClosers,
  getSelectedSlideId,
  markDirty,
  onNotesChanged,
} = {}) {
  let closeCurrent = null;

  const open = () => {
    const sid = getSelectedSlideId?.();
    const slide = (pres?.slides || []).find((s) => s?.id === sid);
    if (!slide) return;

    // Close any previous instance (defensive).
    try {
      closeCurrent?.();
    } catch {
      // ignore
    }

    const unlockScroll = lockDocumentScroll?.();
    const backdrop = h('div', { class: 'modal-backdrop ps-modal-overlay' });
    const modal = h('div', { class: 'modal ps-modal slide-notes-modal' });

    const header = h('div', { class: 'ps-modal-header' });
    const title = h('h2', {
      text: t('editor.notes.title', 'Presenter notes'),
    });
    const closeBtn = h(
      'button',
      {
        class: 'btn btn-secondary btn-icon ps-modal-close',
        type: 'button',
        'aria-label': t('common.close', 'Close'),
        onclick: () => close(),
      },
      [
        h(
          'svg',
          {
            width: '16',
            height: '16',
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            'stroke-width': '2',
          },
          [h('path', { d: 'M18 6L6 18M6 6l12 12' })]
        ),
      ]
    );
    header.append(title, closeBtn);

    const body = h('div', { class: 'ps-modal-body slide-notes-modal-body' });
    const help = h('div', {
      class: 'help',
      text: t(
        'editor.notes.modalHelp',
        "Saved per slide. Tip: open 'Notes (QR)' to view this on your phone."
      ),
    });
    const ta = h('textarea', {
      class: 'form-input slide-notes-modal-input',
      placeholder:
        t(
          'editor.notes.placeholder',
          "Text you write here shows on your phone. Click 'Notes (QR)' to show a QR code for your phone."
        ),
    });
    ta.value = slide.notes || '';

    ta.addEventListener('input', () => {
      const curId = getSelectedSlideId?.();
      const curSlide = (pres?.slides || []).find((s) => s?.id === curId);
      if (!curSlide) return;
      curSlide.notes = ta.value;
      markDirty?.();
      try {
        onNotesChanged?.(ta.value);
      } catch {
        // ignore
      }
    });

    body.append(help, ta);
    modal.append(header, body);
    backdrop.append(modal);

    const onKey = (e) => {
      if (e.key === 'Escape') close();
    };

    const close = () => {
      try {
        document.removeEventListener('keydown', onKey);
        backdrop.remove();
      } finally {
        try {
          unlockScroll?.();
        } catch {
          // ignore
        }
        openOverlayClosers?.delete(close);
        if (closeCurrent === close) closeCurrent = null;
      }
    };

    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close();
    });

    root.append(backdrop);
    openOverlayClosers?.add(close);
    closeCurrent = close;
    document.addEventListener('keydown', onKey);

    // Focus the textarea after it's in the DOM.
    try {
      requestAnimationFrame(() => ta.focus?.());
    } catch {
      // ignore
    }
  };

  return { open };
}
